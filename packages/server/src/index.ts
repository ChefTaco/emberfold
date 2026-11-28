import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { z } from 'zod';
import { createRequestContext, runWithRequestContext, type RequestContext } from '@hivemagnus/hive-common/context';
import { createHealth } from '@hivemagnus/hive-common/health';
import { createLogger } from '@hivemagnus/hive-common/log';
import { handleHealth } from '@hivemagnus/hive-common/node-http';
import { createOathweaveVerifier, isOathweaveError } from '@hivemagnus/hive-common/oathweave';
import { matchesSha256Digest } from '@hivemagnus/hive-common/secrets';
import { prepareContext, rebuildCheckpoint, validateCheckpoint, resolveSources, PrepareRequestSchema, ValidationRequestSchema, RecallRequestSchema,
  sha256 } from '@hivemagnus/emberfold';
import { ServiceConfigSchema, configureProviders, requestAdapters, type ServiceConfig } from './config.js';
import { createServiceMetrics } from './metrics.js';
export * from './config.js';

const Routes = ['/v1/prepare', '/v1/checkpoints/validate', '/v1/checkpoints/rebuild', '/v1/recall'] as const;
type Route = (typeof Routes)[number];
/** One structured line per API request. Bodies, tokens and query strings are never logged. */
export type RequestLogRecord = { event: 'request'; operation: Route; status: number; duration_ms: number; request_id: string; trace_id: string;
  error?: string; execution?: { root: string; parent?: string; self?: string }; caller: Caller };
/** Who was authenticated: the static service bearer, or an Oathweave service client. */
export type Caller = { kind: 'static' } | { kind: 'service'; subject: string; client_id: string };
export type ServerOptions = { /** The fetch used for Oathweave key discovery (tests). */ fetch?: typeof fetch };
/** The default sink: HiveCommon structured JSON lines (with secret redaction) on stderr. */
export function defaultRequestLog(): (record: Record<string, unknown>) => void {
  const logger = createLogger({ bindings: { service: 'emberfold' }, context: () => undefined, write: line => process.stderr.write(line + '\n') });
  return record => logger.info(typeof record.event === 'string' ? record.event : 'event', record);
}
const pathOf = (request: IncomingMessage): string | null => {
  try { return new URL(request.url ?? '/', 'http://localhost').pathname; } catch { return null; }
};
const executionOf = (context: RequestContext): RequestLogRecord['execution'] => context.execution ? { root: context.execution.root,
  ...(context.execution.parent ? { parent: context.execution.parent } : {}), ...(context.execution.self ? { self: context.execution.self } : {}) } : undefined;

export function createEmberfoldServer(value: Partial<ServiceConfig> = {}, env: NodeJS.ProcessEnv = process.env,
  log: (record: Record<string, unknown>) => void = defaultRequestLog(), options: ServerOptions = {}): Server {
  const config = ServiceConfigSchema.parse(value);
  const token = env[config.token_env];
  if (!token || token.length < 32) throw new Error('Service bearer token must contain at least 32 characters');
  const providers = configureProviders(config, env);
  const oathweave = config.oathweave;
  const verifier = oathweave ? createOathweaveVerifier({ issuer: oathweave.issuer, audience: oathweave.audience, jwksUrl: oathweave.jwks_url,
    accept: 'service', ...(oathweave.native_issuers ? { nativeIssuers: oathweave.native_issuers } : {}), ...(options.fetch ? { fetch: options.fetch } : {}) }) : undefined;
  // The whole header is compared (exact `Bearer ` scheme and spacing), digest against digest, so neither length nor content leaks.
  const expected = sha256(`Bearer ${token}`);
  const authenticate = async (header: string | undefined): Promise<Caller | { status: 401 | 403 | 503; error: string }> => {
    if (matchesSha256Digest(header, expected)) return { kind: 'static' };
    if (!verifier || !header) return { status: 401, error: 'UNAUTHORIZED' };
    try {
      const principal = await verifier.verifyAuthorization(header, { accept: 'service' });
      if (!principal.scopes.includes(oathweave!.scope) && !principal.permissions.includes(oathweave!.scope)) return { status: 403, error: 'FORBIDDEN' };
      return { kind: 'service', subject: principal.subject, client_id: principal.clientId };
    } catch (error: unknown) {
      // Key discovery failing is not the caller's fault: fail closed with a retryable status.
      return isOathweaveError(error) && error.status === 503 ? { status: 503, error: 'AUTH_UNAVAILABLE' } : { status: 401, error: 'UNAUTHORIZED' };
    }
  };
  let active = 0;
  let closing = false;
  const requests = new Set<AbortController>();
  const metrics = createServiceMetrics();
  const health = createHealth({ service: 'emberfold', version: '0.5.0',
    checks: [{ name: 'accepting', check: () => ({ ok: !closing, details: { providers_configured: providers.size } }) }] });
  const send = (response: ServerResponse, status: number, body: unknown): void => {
    if (!response.destroyed && !response.writableEnded) {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(JSON.stringify(body));
    }
  };
  const handler = async (request: IncomingMessage, response: ServerResponse, context: RequestContext): Promise<void> => {
    response.setHeader('X-Request-Id', context.requestId);
    if (request.headers.origin) { send(response, 403, { error: 'ORIGIN_REJECTED' }); return; }
    const path = pathOf(request);
    // Health answers by path, whatever the query string. The original `/healthz` and `/readyz` bodies are kept.
    if (request.method === 'GET' && path === '/healthz') { send(response, 200, { status: 'ok', version: '0.5.0' }); return; }
    if (request.method === 'GET' && path === '/readyz') { send(response, closing ? 503 : 200, { ready: !closing, providers_configured: providers.size }); return; }
    if (await handleHealth(request, response, health)) return;
    const route = Routes.find(candidate => candidate === path);
    const started = Date.now();
    // Every API answer is counted, including refusals; health and metrics scrapes are not.
    if (route) response.once('finish', () => metrics.request(route, response.statusCode, (Date.now() - started) / 1000));
    const caller = await authenticate(request.headers.authorization);
    if ('error' in caller) { send(response, caller.status, { error: caller.error }); request.resume(); return; }
    if (request.method === 'GET' && path === '/metrics') {
      response.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(metrics.render({ in_flight: active, ready: !closing }));
      return;
    }
    if (request.method !== 'POST' || !route) { send(response, 404, { error: 'NOT_FOUND' }); request.resume(); return; }
    if (closing || active >= config.concurrency) { send(response, 429, { error: 'OVERLOADED' }); request.resume(); return; }
    if (!request.headers['content-type']?.toLowerCase().startsWith('application/json')) { send(response, 415, { error: 'JSON_REQUIRED' }); request.resume(); return; }
    active++;
    let failure: string | undefined;
    const controller = new AbortController();
    requests.add(controller);
    const timeout = setTimeout(() => { controller.abort(); response.once('finish', () => request.destroy()); send(response, 504, { error: 'DEADLINE_EXCEEDED' }); }, config.timeout_ms);
    response.on('close', () => { if (!response.writableEnded) controller.abort(); });
    let status = 200;
    let oversized = false;
    let linger: NodeJS.Timeout | undefined;
    try {
      const chunks: Buffer[] = [];
      let size = 0;
      for await (const chunk of request) {
        controller.signal.throwIfAborted();
        if (oversized) continue;
        const buffer = Buffer.from(chunk as Uint8Array);
        size += buffer.length;
        // Answer at once, then briefly discard the rest: leaving the loop abandons the request stream under a
        // client that is still uploading, which then sees a reset or a stalled connection, not this response.
        if (size > config.max_body_bytes) {
          oversized = true;
          chunks.length = 0;
          status = 413;
          send(response, status, { error: 'BODY_TOO_LARGE' });
          linger = setTimeout(() => request.destroy(), Math.min(5000, config.timeout_ms));
        } else chunks.push(buffer);
      }
      if (oversized) return;
      const input: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (route === '/v1/checkpoints/validate') {
        const parsed = ValidationRequestSchema.parse(input);
        const checkpoint = validateCheckpoint(parsed.checkpoint, parsed.history, parsed.namespace);
        send(response, 200, { valid: true, checkpoint_id: checkpoint.id });
      } else if (route === '/v1/recall') {
        const parsed = RecallRequestSchema.parse(input);
        send(response, 200, { messages: resolveSources(parsed.history, parsed.message_ids) });
      } else {
        const parsed = PrepareRequestSchema.parse(input);
        const adapters = requestAdapters(parsed, config, providers, controller.signal);
        const operation = route === '/v1/checkpoints/rebuild' ? rebuildCheckpoint : prepareContext;
        const result = await operation(parsed, adapters);
        if (result.compacted) metrics.compaction(route);
        send(response, 200, result);
      }
    } catch (error: unknown) {
      if (oversized) return;
      status = controller.signal.aborted ? 504 : error instanceof SyntaxError || error instanceof z.ZodError ? 400 : 422;
      const code = error instanceof Error ? /^[A-Z_]+(?=:|$)/.exec(error.message)?.[0] ?? 'INVALID_REQUEST' : 'INVALID_REQUEST';
      failure = status === 504 ? 'DEADLINE_EXCEEDED' : code;
      metrics.failure(code);
      send(response, status, { error: code });
    } finally {
      clearTimeout(timeout);
      clearTimeout(linger);
      requests.delete(controller);
      active--;
      const execution = executionOf(context);
      const record: RequestLogRecord = { event: 'request', operation: route, status, duration_ms: Date.now() - started, request_id: context.requestId,
        trace_id: context.trace.traceId, ...(failure ? { error: failure } : {}), ...(execution ? { execution } : {}), caller };
      log(record);
    }
  };
  const server = createServer((request, response) => {
    // Request ID, trace and `x-hive-execution` attribution come from the caller when valid (attribution only, never authority).
    const context = createRequestContext(request.headers);
    void runWithRequestContext(context, () => handler(request, response, context)).catch(() => send(response, 500, { error: 'INTERNAL_ERROR' }));
  });
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
