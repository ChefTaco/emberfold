import { execFileSync, spawnSync } from 'node:child_process';
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
