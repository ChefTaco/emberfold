import { afterEach, describe, expect, it } from 'vitest';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { once } from 'node:events';
import { connect } from 'node:net';
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
  it('answers an oversized upload that is still in flight and keeps the connection usable', async () => {
    const { url, logs } = await serve({ max_body_bytes: 1024 });
    const socket = connect(Number(new URL(url).port), '127.0.0.1');
    try {
      let received = '';
      socket.on('data', chunk => { received += String(chunk); });
      const failed = new Promise<never>((_resolve, reject) => { socket.on('error', reject); socket.on('close', () => reject(new Error('Connection closed'))); });
      const head = (length: number) => `POST /v1/prepare HTTP/1.1\r\nHost: service.example.com\r\nContent-Type: application/json\r\nAuthorization: Bearer ${token}\r\nContent-Length: ${length}\r\n\r\n`;
      const statuses = async (count: number) => {
        while (received.split('HTTP/1.1 ').length <= count) await Promise.race([once(socket, 'data'), failed]);
        return received.split('HTTP/1.1 ').slice(1).map(response => response.slice(0, 3));
      };
      socket.write(head(96 * 65536));
      for (let sent = 0; sent < 96; sent++) if (!socket.write(Buffer.alloc(65536, 120))) await Promise.race([once(socket, 'drain'), failed]);
      expect(await statuses(1)).toEqual(['413']);
      socket.write(head(1) + '{');
      expect(await statuses(2)).toEqual(['413', '400']);
    } finally { socket.destroy(); }
    for (let attempt = 0; attempt < 4; attempt++)
      expect((await fetch(url + '/v1/prepare', { method: 'POST', headers, body: 'x'.repeat(200000) })).status).toBe(413);
    expect(logs.map(record => record.status)).toEqual([413, 400, 413, 413, 413, 413]);
  });
  it('closes an oversized upload that stalls and frees its capacity', async () => {
    const { url, logs } = await serve({ max_body_bytes: 1024, concurrency: 1, timeout_ms: 200 });
    const socket = connect(Number(new URL(url).port), '127.0.0.1');
    try {
      let received = '';
      socket.on('data', chunk => { received += String(chunk); });
      socket.on('error', () => {});
      socket.write(`POST /v1/prepare HTTP/1.1\r\nHost: service.example.com\r\nContent-Type: application/json\r\nAuthorization: Bearer ${token}\r\nContent-Length: 1000000\r\n\r\n` + 'x'.repeat(2048));
      await once(socket, 'close');
      expect(received.slice(0, 12)).toBe('HTTP/1.1 413');
    } finally { socket.destroy(); }
    expect(logs.map(record => record.status)).toEqual([413]);
    expect((await fetch(url + '/v1/prepare', { method: 'POST', headers, body: '{' })).status).toBe(400);
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
