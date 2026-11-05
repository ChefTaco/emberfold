#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { prepareContext, rebuildCheckpoint, validateCheckpoint, resolveSources, PrepareRequestSchema, ValidationRequestSchema, RecallRequestSchema } from '@hivemagnus/emberfold';
import { createEmberfoldServer, loadServiceConfig, configureProviders, requestAdapters } from '@hivemagnus/emberfold-server';

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: {
    input: { type: 'string' }, output: { type: 'string' }, config: { type: 'string' },
    'dry-run': { type: 'boolean', default: false }, help: { type: 'boolean', default: false }, version: { type: 'boolean', default: false }
  } });
  if (values.version) { process.stdout.write('0.2.1\n'); return; }
  if (values.help) { process.stdout.write('emberfold prepare|inspect|rebuild|recall --input FILE|- [--output FILE] [--config FILE] [--dry-run]\nemberfold serve --config FILE\n'); return; }
  const command = positionals[0];
  if (positionals.length !== 1 || !['prepare', 'inspect', 'rebuild', 'recall', 'serve'].includes(command ?? '')) throw new Error('INVALID_INPUT: use --help');
  const config = await loadServiceConfig(values.config);
  if (command === 'serve') {
    const server = createEmberfoldServer(config);
    const stop = (): void => {
      server.close(() => process.exit(0));
      const timer = setTimeout(() => { server.closeAllConnections(); process.exit(1); }, 5000);
      timer.unref();
    };
    process.once('SIGTERM', stop);
    process.once('SIGINT', stop);
    server.listen(config.port, config.host, () => process.stderr.write(JSON.stringify({ event: 'listening', port: config.port }) + '\n'));
    return;
  }
  if (!values.input) throw new Error('INVALID_INPUT: --input is required');
  let bytes: string;
  if (values.input === '-') {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of process.stdin) {
      size += (chunk as Buffer).length;
      if (size > config.max_body_bytes) throw new Error('INVALID_INPUT: input is too large');
      chunks.push(chunk as Buffer);
    }
    bytes = Buffer.concat(chunks).toString('utf8');
  } else {
    const content = await readFile(values.input);
    if (content.length > config.max_body_bytes) throw new Error('INVALID_INPUT: input is too large');
    bytes = content.toString('utf8');
  }
  const input: unknown = JSON.parse(bytes);
  let result: unknown;
  let dryRun = values['dry-run'];
  if (command === 'inspect') {
    const parsed = ValidationRequestSchema.parse(input);
    const checkpoint = validateCheckpoint(parsed.checkpoint, parsed.history, parsed.namespace);
    result = { valid: true, checkpoint_id: checkpoint.id, generation: checkpoint.generation, profile: checkpoint.profile,
      items: checkpoint.summary.items.length, source_messages: checkpoint.source_message_ids.length, historical_status: 'historical_unverified' };
  } else if (command === 'recall') {
    const parsed = RecallRequestSchema.parse(input);
    result = { messages: resolveSources(parsed.history, parsed.message_ids) };
  } else {
    const parsed = PrepareRequestSchema.parse(input);
    dryRun = dryRun || parsed.dry_run;
    const providers = dryRun ? new Map() : configureProviders(config);
    const adapters = dryRun ? { signal: AbortSignal.timeout(config.timeout_ms) }
      : requestAdapters(parsed, config, providers, AbortSignal.timeout(config.timeout_ms));
    result = await (command === 'rebuild' ? rebuildCheckpoint : prepareContext)({ ...parsed, dry_run: dryRun }, adapters);
  }
  const output = JSON.stringify(result, null, 2) + '\n';
  if (dryRun && values.output) throw new Error('INVALID_INPUT: dry run does not write output files');
  if (values.output) await writeFile(values.output, output, { mode: 0o600, flag: 'wx' });
  else process.stdout.write(output);
}
void main().catch((error: unknown) => {
  const code = error instanceof Error ? /^[A-Z_]+(?=:|$)/.exec(error.message)?.[0] ?? 'INVALID_INPUT' : 'INVALID_INPUT';
  process.stderr.write(JSON.stringify({ error: code }) + '\n');
  process.exitCode = code.startsWith('CONTEXT_BUDGET') ? 3 : code.includes('UNAVAILABLE') || code.includes('PROVIDER') || code.includes('CODEX') ? 4 : 2;
});
