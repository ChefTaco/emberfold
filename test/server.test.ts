import { afterEach, describe, expect, it } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { once } from 'node:events';
import { createEmberfoldServer } from '../packages/server/src/index.js';
import { fixture } from './fixtures.js';

const token = 'synthetic-test-bearer-token-for-fixtures-only';
const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
async function serve(config = {}) {
  const logs: Record<string, unknown>[] = [];
  const server = createEmberfoldServer(config, { EMBERFOLD_API_TOKEN: token }, record => logs.push(record));
  servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture listener unavailable');
  return { url: `http://127.0.0.1:${address.port}`, logs, server };
}
const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };
describe('authenticated stateless HTTP wrapper', () => {
  it('rejects missing credentials and browser origins; exposes metadata-only health', async () => {
    const { url } = await serve();
    expect((await fetch(url + '/v1/prepare', { method: 'POST' })).status).toBe(401);
    expect((await fetch(url + '/healthz', { headers: { Origin: 'https://example.com' } })).status).toBe(403);
    expect(await (await fetch(url + '/readyz')).json()).toMatchObject({ ready: true });
  });
  it('returns prepared JSON matching library behavior and never logs bodies or tokens', async () => {
    const { url, logs } = await serve();
    const request = { ...fixture(), dry_run: true };
    const response = await fetch(url + '/v1/prepare', { method: 'POST', headers, body: JSON.stringify(request) });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ schema_version: 1, compacted: false, fits: true, candidate_checkpoint: null });
    expect(JSON.stringify(logs)).not.toContain('Ω-42');
    expect(JSON.stringify(logs)).not.toContain(token);
  });
  it('rejects unknown provider IDs and executable or endpoint fields in requests', async () => {
    const { url } = await serve();
    const body = { ...fixture(), provider_id: 'absent' };
    expect((await fetch(url + '/v1/prepare', { method: 'POST', headers, body: JSON.stringify(body) })).status).toBe(422);
    expect((await fetch(url + '/v1/prepare', { method: 'POST', headers, body: JSON.stringify({ ...body, command: 'arbitrary' }) })).status).toBe(400);
  });
  it('enforces body limits, JSON parsing and media type', async () => {
    const { url } = await serve({ max_body_bytes: 64 });
    expect((await fetch(url + '/v1/prepare', { method: 'POST', headers, body: 'x'.repeat(65) })).status).toBe(413);
    expect((await fetch(url + '/v1/prepare', { method: 'POST', headers, body: '{' })).status).toBe(400);
    expect((await fetch(url + '/v1/prepare', { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: '{}' })).status).toBe(415);
  });
  it('attributes provider and model-output failures to the provider, not the caller request', async () => {
    const replies = ['<html>proxy sign-in</html>', JSON.stringify({ choices: [{ message: { content: 'not a summary' } }] })];
    const provider = createServer((request, response) => { request.resume(); response.setHeader('Content-Type', 'application/json'); response.end(replies[request.url?.startsWith('/page') ? 0 : 1]); });
    servers.push(provider);
    await new Promise<void>(resolve => provider.listen(0, '127.0.0.1', resolve));
    const address = provider.address();
    if (!address || typeof address === 'string') throw new Error('Fixture listener unavailable');
    const unused = createServer();
    await new Promise<void>(resolve => unused.listen(0, '127.0.0.1', resolve));
    const closed = unused.address();
    if (!closed || typeof closed === 'string') throw new Error('Fixture listener unavailable');
    await new Promise<void>(resolve => unused.close(() => resolve()));
    const { url } = await serve({ providers: [
      { type: 'http', id: 'page', base_url: `http://127.0.0.1:${address.port}/page`, model: 'fixture' },
      { type: 'http', id: 'prose', base_url: `http://127.0.0.1:${address.port}/prose`, model: 'fixture' },
      { type: 'http', id: 'down', base_url: `http://127.0.0.1:${closed.port}/v1`, model: 'fixture' }] });
    for (const [provider_id, error] of [['page', 'PROVIDER_FAILED'], ['prose', 'INVALID_SUMMARY'], ['down', 'PROVIDER_FAILED']]) {
      const response = await fetch(url + '/v1/prepare', { method: 'POST', headers, body: JSON.stringify({ ...fixture(), provider_id }) });
      expect([provider_id, response.status, await response.json()]).toEqual([provider_id, 422, { error }]);
    }
  });
  it('fails startup for missing or weak authentication and invalid provider configuration', () => {
    expect(() => createEmberfoldServer({}, {})).toThrow('bearer token');
    expect(() => createEmberfoldServer({ providers: [], default_provider_id: 'missing' }, { EMBERFOLD_API_TOKEN: token })).toThrow('Default provider');
  });
  it('rejects overload and expires stalled request bodies without retaining capacity', async () => {
    const { url, server } = await serve({ concurrency: 1, timeout_ms: 250 });
    const started = once(server, 'request');
    const stalled = httpRequest(url + '/v1/prepare', { method: 'POST', headers });
    const expired = new Promise<number | undefined>((resolve, reject) => {
      stalled.on('error', reject);
      stalled.on('response', response => { response.resume(); response.on('end', () => resolve(response.statusCode)); });
    });
    stalled.write('{');
    await started;
    expect((await fetch(url + '/v1/prepare', { method: 'POST', headers, body: '{}' })).status).toBe(429);
    expect(await expired).toBe(504);
    const response = await fetch(url + '/v1/prepare', { method: 'POST', headers, body: JSON.stringify({ ...fixture(), dry_run: true }) });
    expect(response.status).toBe(200);
  });
});
