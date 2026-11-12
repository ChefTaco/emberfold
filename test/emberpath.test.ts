import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { ServiceConfigSchema, configureProviders, emberpathHttpConfig } from '../packages/server/src/config.js';

const key = 'synthetic-emberpath-client-key';
const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
const parse = (provider: Record<string, unknown>) => ServiceConfigSchema.parse({ providers: [{ type: 'emberpath', id: 'emberpath', model: 'routed-model', ...provider }] });

describe('emberpath provider', () => {
  it('parses with conventional environment variable defaults and leaves http providers unchanged', () => {
    const config = parse({});
    expect(config.providers[0]).toEqual({ type: 'emberpath', id: 'emberpath', model: 'routed-model', base_url_env: 'EMBERPATH_URL', api_key_env: 'EMBERPATH_API_KEY' });
    const http = ServiceConfigSchema.parse({ providers: [{ type: 'http', id: 'local', base_url: 'https://model.example.com/v1', model: 'm' }] });
    expect(http.providers[0]).toEqual({ type: 'http', id: 'local', base_url: 'https://model.example.com/v1', model: 'm' });
  });
  it('rejects unknown fields, invalid URLs, and invalid environment variable names', () => {
    expect(() => parse({ api_key: key })).toThrow();
    expect(() => parse({ base_url: 'not a url' })).toThrow();
    expect(() => parse({ api_key_env: 'BAD-NAME' })).toThrow();
    expect(() => parse({ base_url_env: '' })).toThrow();
    expect(() => ServiceConfigSchema.parse({ providers: [{ type: 'emberpath', id: 'emberpath' }] })).toThrow();
  });
  it('resolves the base URL from config or environment and appends the /v1 model API root', () => {
    const [provider] = parse({}).providers;
    if (provider?.type !== 'emberpath') throw new Error('Expected emberpath provider');
    expect(emberpathHttpConfig(provider, { EMBERPATH_URL: 'https://emberpath.example.com' }).base_url).toBe('https://emberpath.example.com/v1');
    expect(emberpathHttpConfig(provider, { EMBERPATH_URL: 'https://emberpath.example.com/v1/' }).base_url).toBe('https://emberpath.example.com/v1');
    expect(emberpathHttpConfig(provider, { EMBERPATH_URL: 'https://example.com/gateway/' }).base_url).toBe('https://example.com/gateway/v1');
    const [explicit] = parse({ base_url: 'https://explicit.example.com', base_url_env: 'CUSTOM_URL' }).providers;
    if (explicit?.type !== 'emberpath') throw new Error('Expected emberpath provider');
    expect(emberpathHttpConfig(explicit, { CUSTOM_URL: 'https://ignored.example.com' }).base_url).toBe('https://explicit.example.com/v1');
    expect(() => emberpathHttpConfig(provider, {})).toThrow('PROVIDER_UNCONFIGURED');
    expect(() => emberpathHttpConfig(provider, { EMBERPATH_URL: 'http://emberpath.example.com' })).toThrow('HTTPS');
    expect(() => emberpathHttpConfig(provider, { EMBERPATH_URL: 'garbage' })).toThrow('Invalid provider URL');
  });
  it('requires the client key at startup', () => {
    expect(() => configureProviders(parse({}), { EMBERPATH_URL: 'https://emberpath.example.com' })).toThrow('credential');
    expect(() => configureProviders(parse({ base_url: 'https://alice:synthetic@emberpath.example.com' }), { EMBERPATH_API_KEY: key })).toThrow('URL');
  });
  it('sends chat completions to <emberpath>/v1/chat/completions with the Bearer client key', async () => {
    const seen: { url?: string | undefined; authorization?: string | undefined; model?: string }[] = [];
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { model: string };
      seen.push({ url: request.url, authorization: request.headers.authorization, model: body.model });
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { content: '{"items":[]}' } }] }));
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture listener unavailable');
    const providers = configureProviders(parse({}), { EMBERPATH_URL: `http://127.0.0.1:${address.port}`, EMBERPATH_API_KEY: key });
    const summarizer = providers.get('emberpath')!;
    expect(summarizer.model).toBe('routed-model');
    expect(await summarizer.summarize({ prompt: 'Synthetic history', output_tokens: 64, signal: AbortSignal.timeout(5000) })).toBe('{"items":[]}');
    expect(seen).toEqual([{ url: '/v1/chat/completions', authorization: `Bearer ${key}`, model: 'routed-model' }]);
  });
});
