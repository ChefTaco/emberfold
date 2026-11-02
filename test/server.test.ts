import { afterEach, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
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
  return { url: `http://127.0.0.1:${address.port}`, logs };
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
  it('fails startup for missing or weak authentication and invalid provider configuration', () => {
    expect(() => createEmberfoldServer({}, {})).toThrow('bearer token');
    expect(() => createEmberfoldServer({ providers: [], default_provider_id: 'missing' }, { EMBERFOLD_API_TOKEN: token })).toThrow('Default provider');
  });
});
