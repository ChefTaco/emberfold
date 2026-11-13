import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { prepareContext } from '../packages/core/src/index.js';
import { deterministicSummarizer, fixture } from './fixtures.js';

const executable = new URL('../packages/cli/dist/index.js', import.meta.url).pathname;
describe('JSON CLI', () => {
  it('matches library preparation over stdin and keeps diagnostics off stdout', async () => {
    const request = { ...fixture(), dry_run: true };
    const result = spawnSync(process.execPath, [executable, 'prepare', '--input', '-'], { input: JSON.stringify(request), encoding: 'utf8' });
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual(await prepareContext(request));
  });
  it('inspects checkpoints and recovers exact original messages', async () => {
    const request = fixture();
    const checkpoint = (await prepareContext(request, { summarizer: deterministicSummarizer })).candidate_checkpoint;
    const inspect = execFileSync(process.execPath, [executable, 'inspect', '--input', '-'], { input: JSON.stringify({ checkpoint, history: request.history, namespace: request.namespace }), encoding: 'utf8' });
    expect(JSON.parse(inspect)).toMatchObject({ valid: true, historical_status: 'historical_unverified' });
    const recall = execFileSync(process.execPath, [executable, 'recall', '--input', '-'], { input: JSON.stringify({ history: request.history, message_ids: ['user-0'] }), encoding: 'utf8' });
    expect(JSON.parse(recall).messages[0]).toEqual(request.history[0]);
  });
  it('exits 4 when the configured provider is unreachable or exceeds the deadline', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'emberfold-cli-'));
    const silent = createServer(() => {});
    await new Promise<void>(resolve => silent.listen(0, '127.0.0.1', resolve));
    const address = silent.address();
    if (!address || typeof address === 'string') throw new Error('Fixture listener unavailable');
    const run = async (name: string, config: object) => {
      await writeFile(join(temporary, name), JSON.stringify(config));
      const child = spawn(process.execPath, [executable, 'prepare', '--input', '-', '--config', join(temporary, name)], { stdio: ['pipe', 'pipe', 'pipe'] });
      let stderr = '';
      child.stderr.on('data', chunk => { stderr += String(chunk); });
      child.stdout.resume();
      child.stdin.end(JSON.stringify(fixture()));
      const status = await new Promise<number | null>(resolve => child.on('close', resolve));
      return { status, error: (JSON.parse(stderr) as { error: string }).error };
    };
    try {
      const provider = { type: 'http', id: 'fixture', base_url: `http://127.0.0.1:${address.port}/v1`, model: 'fixture' };
      expect(await run('slow.json', { default_provider_id: 'fixture', providers: [provider], timeout_ms: 300 })).toEqual({ status: 4, error: 'DEADLINE_EXCEEDED' });
      silent.closeAllConnections();
      await new Promise<void>(resolve => silent.close(() => resolve()));
      expect(await run('down.json', { default_provider_id: 'fixture', providers: [provider] })).toEqual({ status: 4, error: 'PROVIDER_FAILED' });
    } finally {
      silent.closeAllConnections();
      if (silent.listening) silent.close();
      await rm(temporary, { recursive: true, force: true });
    }
  });
  it('never overwrites files and refuses dry-run persistence', async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'emberfold-cli-'));
    try {
      const output = join(temporary, 'output.json');
      await writeFile(output, 'Existing artifact');
      const result = spawnSync(process.execPath, [executable, 'prepare', '--input', '-', '--output', output], { input: JSON.stringify({ ...fixture(), force: false }), encoding: 'utf8' });
      expect(result.status).not.toBe(0);
      expect(await readFile(output, 'utf8')).toBe('Existing artifact');
      const dry = spawnSync(process.execPath, [executable, 'prepare', '--input', '-', '--dry-run', '--output', join(temporary, 'dry.json')], { input: JSON.stringify(fixture()), encoding: 'utf8' });
      expect(dry.status).toBe(2);
    } finally { await rm(temporary, { recursive: true, force: true }); }
  });
});
