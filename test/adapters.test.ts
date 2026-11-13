import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { createHttpSummarizer, createCodexSummarizer } from '../packages/core/src/adapters.js';

const servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } });
describe('optional summarizers', () => {
  it('calls compatible HTTP endpoints with explicit model, output cap, and no tools', async () => {
    const server = createServer(async (request, response) => {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { model: string; max_tokens: number; tools: unknown[] };
      expect(body.model).toBe('fixture-model');
      response.setHeader('Content-Type', 'application/json');
      if (request.url?.endsWith('/input_tokens')) response.end(JSON.stringify({ input_tokens: 123 }));
      else {
        expect(body.max_tokens).toBe(128);
        expect(body.tools).toEqual([]);
        response.end(JSON.stringify({ choices: [{ message: { content: '{"items":[]}' } }] }));
      }
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture listener unavailable');
    const adapter = createHttpSummarizer({ id: 'fixture', base_url: `http://127.0.0.1:${address.port}/v1`, model: 'fixture-model', input_tokens_path: 'chat/completions/input_tokens' });
    expect(await adapter.summarize({ prompt: 'Synthetic history', output_tokens: 128, signal: AbortSignal.timeout(5000) })).toBe('{"items":[]}');
    expect(await adapter.countTokens!([], [], AbortSignal.timeout(5000))).toBe(123);
  });
  it('reports unreachable, slow and malformed HTTP providers with stable codes and passes caller cancellation through', async () => {
    const listen = async (handler: Parameters<typeof createServer>[1]) => {
      const server = createServer(handler);
      servers.push(server);
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Fixture listener unavailable');
      return `http://127.0.0.1:${address.port}/v1`;
    };
    const input = () => ({ prompt: 'Synthetic history', output_tokens: 128, signal: AbortSignal.timeout(5000) });
    const closed = await listen(() => {});
    await new Promise<void>(resolve => servers.pop()!.close(() => resolve()));
    const unreachable = createHttpSummarizer({ id: 'fixture', base_url: closed, model: 'fixture', input_tokens_path: 'tokens' });
    await expect(unreachable.summarize(input())).rejects.toThrow('PROVIDER_FAILED: request failed');
    await expect(unreachable.countTokens!([], [], AbortSignal.timeout(5000))).rejects.toThrow('TOKENIZER_UNAVAILABLE: request failed');
    const page = await listen((_request, response) => { response.setHeader('Content-Type', 'text/html'); response.end('<html>proxy sign-in</html>'); });
    const malformed = createHttpSummarizer({ id: 'fixture', base_url: page, model: 'fixture', input_tokens_path: 'tokens' });
    await expect(malformed.summarize(input())).rejects.toThrow('PROVIDER_FAILED: invalid response');
    await expect(malformed.countTokens!([], [], AbortSignal.timeout(5000))).rejects.toThrow('TOKENIZER_UNAVAILABLE: invalid response');
    const shapeless = await listen((_request, response) => { response.setHeader('Content-Type', 'application/json'); response.end('{"choices":[]}'); });
    await expect(createHttpSummarizer({ id: 'fixture', base_url: shapeless, model: 'fixture' }).summarize(input())).rejects.toThrow('PROVIDER_FAILED: invalid response');
    const failing = await listen((_request, response) => { response.statusCode = 503; response.end(); });
    await expect(createHttpSummarizer({ id: 'fixture', base_url: failing, model: 'fixture' }).summarize(input())).rejects.toThrow('PROVIDER_FAILED: HTTP 503');
    const silent = await listen(() => {});
    await expect(createHttpSummarizer({ id: 'fixture', base_url: silent, model: 'fixture', timeout_ms: 100 }).summarize(input())).rejects.toThrow('PROVIDER_FAILED: request timed out');
    const controller = new AbortController();
    const cancelled = createHttpSummarizer({ id: 'fixture', base_url: silent, model: 'fixture' }).summarize({ ...input(), signal: controller.signal });
    controller.abort(new Error('Caller cancelled'));
    await expect(cancelled).rejects.toThrow('Caller cancelled');
  });
  it('requires configured credentials and rejects credential-bearing URLs', () => {
    expect(() => createHttpSummarizer({ id: 'fixture', base_url: 'https://example.com/v1', model: 'fixture', api_key_env: 'ABSENT_FIXTURE_KEY' }, {})).toThrow('credential');
    expect(() => createHttpSummarizer({ id: 'fixture', base_url: 'https://alice:synthetic@example.com', model: 'fixture' })).toThrow('URL');
  });
  it('supports a tools-disabled Codex protocol with cancellation and provider errors', async () => {
    const command = new URL('./fixtures/codex-stub.mjs', import.meta.url).pathname;
    const inheritedMcp = createCodexSummarizer({ id: 'fixture', command, model: 'fixture', cwd: process.cwd(), timeout_ms: 5000 }, { ...process.env, EMBERFOLD_FIXTURE_MCP: '1' });
    expect(await inheritedMcp.summarize({ prompt: 'Synthetic history', output_tokens: 128, signal: AbortSignal.timeout(5000) })).toBe('{"items":[]}');
    const adapter = createCodexSummarizer({ id: 'fixture', command, model: 'fixture', cwd: process.cwd(), timeout_ms: 5000 });
    expect(await adapter.summarize({ prompt: 'Synthetic history', output_tokens: 128, signal: AbortSignal.timeout(5000) })).toBe('{"items":[]}');
    const broken = createCodexSummarizer({ id: 'fixture', command, model: 'fixture', cwd: process.cwd() }, { ...process.env, EMBERFOLD_FIXTURE_FAIL: '1' });
    await expect(broken.summarize({ prompt: 'Synthetic history', output_tokens: 128, signal: AbortSignal.timeout(5000) })).rejects.toThrow('CODEX_REQUEST');
    const malformed = createCodexSummarizer({ id: 'fixture', command, model: 'fixture', cwd: process.cwd() }, { ...process.env, EMBERFOLD_FIXTURE_MALFORMED: '1' });
    await expect(malformed.summarize({ prompt: 'Synthetic history', output_tokens: 128, signal: AbortSignal.timeout(5000) })).rejects.toThrow('CODEX_PROTOCOL_INVALID');
    const hanging = createCodexSummarizer({ id: 'fixture', command, model: 'fixture', cwd: process.cwd(), timeout_ms: 100 }, { ...process.env, EMBERFOLD_FIXTURE_HANG: '1' });
    await expect(hanging.summarize({ prompt: 'Synthetic history', output_tokens: 128, signal: AbortSignal.timeout(5000) })).rejects.toThrow('CANCELLED');
  });
});
