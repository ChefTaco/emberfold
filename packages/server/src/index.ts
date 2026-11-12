import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { prepareContext, rebuildCheckpoint, validateCheckpoint, PrepareRequestSchema, ValidationRequestSchema, sha256 } from '@hivemagnus/emberfold';
import { ServiceConfigSchema, configureProviders, requestAdapters, type ServiceConfig } from './config.js';
export * from './config.js';

export function createEmberfoldServer(value: Partial<ServiceConfig> = {}, env: NodeJS.ProcessEnv = process.env,
  log: (record: Record<string, unknown>) => void = record => process.stderr.write(JSON.stringify(record) + '\n')): Server {
  const config = ServiceConfigSchema.parse(value);
  const token = env[config.token_env];
  if (!token || token.length < 32) throw new Error('Service bearer token must contain at least 32 characters');
  const providers = configureProviders(config, env);
  let active = 0;
  let closing = false;
  const requests = new Set<AbortController>();
  const send = (response: ServerResponse, status: number, body: unknown): void => {
    if (!response.destroyed && !response.writableEnded) {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(body));
    }
  };
  const handler = async (request: IncomingMessage, response: ServerResponse): Promise<void> => {
    if (request.headers.origin) { send(response, 403, { error: 'ORIGIN_REJECTED' }); return; }
    if (request.method === 'GET' && request.url === '/healthz') { send(response, 200, { status: 'ok', version: '0.3.0' }); return; }
    if (request.method === 'GET' && request.url === '/readyz') { send(response, closing ? 503 : 200, { ready: !closing, providers_configured: providers.size }); return; }
    const supplied = sha256(request.headers.authorization ?? '');
    const expected = sha256(`Bearer ${token}`);
    if (!timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) { send(response, 401, { error: 'UNAUTHORIZED' }); request.resume(); return; }
    if (request.method !== 'POST' || !['/v1/prepare', '/v1/checkpoints/validate', '/v1/checkpoints/rebuild'].includes(request.url ?? '')) {
      send(response, 404, { error: 'NOT_FOUND' }); request.resume(); return;
    }
    if (closing || active >= config.concurrency) { send(response, 429, { error: 'OVERLOADED' }); request.resume(); return; }
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) { send(response, 415, { error: 'JSON_REQUIRED' }); request.resume(); return; }
    active++;
    const started = Date.now();
    const controller = new AbortController();
    requests.add(controller);
    const timeout = setTimeout(() => { controller.abort(); response.once('finish', () => request.destroy()); send(response, 504, { error: 'DEADLINE_EXCEEDED' }); }, config.timeout_ms);
    response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    let status = 200;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        controller.signal.throwIfAborted();
        const buffer = Buffer.from(chunk as Uint8Array);
        size += buffer.length;
        if (size > config.max_body_bytes) { status = 413; send(response, status, { error: 'BODY_TOO_LARGE' }); request.resume(); return; }
        chunks.push(buffer);
      }
      const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (request.url === '/v1/checkpoints/validate') {
        const parsed = ValidationRequestSchema.parse(input);
        const checkpoint = validateCheckpoint(parsed.checkpoint, parsed.history, parsed.namespace);
        send(response, 200, { valid: true, checkpoint_id: checkpoint.id });
      } else {
        const parsed = PrepareRequestSchema.parse(input);
        const adapters = requestAdapters(parsed, config, providers, controller.signal);
        const operation = request.url === '/v1/checkpoints/rebuild' ? rebuildCheckpoint : prepareContext;
        send(response, 200, await operation(parsed, adapters));
      }
    } catch (error: unknown) {
      status = controller.signal.aborted ? 504 : error instanceof SyntaxError || error instanceof z.ZodError ? 400 : 422;
      const code = error instanceof Error ? /^[A-Z_]+(?=:|$)/.exec(error.message)?.[0] ?? 'INVALID_REQUEST' : 'INVALID_REQUEST';
      send(response, status, { error: code });
    } finally {
      clearTimeout(timeout);
      requests.delete(controller);
      active--;
      log({ event: 'request', operation: request.url, status, duration_ms: Date.now() - started });
    }
  };
  const server = createServer((request, response) => { void handler(request, response).catch(() => send(response, 500, { error: 'INTERNAL_ERROR' })); });
  const close = server.close.bind(server);
  server.close = callback => {
    closing = true;
    for (const controller of requests) controller.abort();
    server.closeIdleConnections();
    return close(callback);
  };
  server.requestTimeout = config.timeout_ms;
  server.headersTimeout = Math.min(config.timeout_ms, 30000);
  return server;
}
