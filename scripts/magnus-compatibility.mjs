import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { z } from 'zod';

const { values } = parseArgs({ options: { source: { type: 'string' }, revision: { type: 'string', default: 'HEAD' } } });
if (!values.source) throw new Error('Use --source PATH and optionally --revision COMMIT to select a trusted Magnus checkout');
const root = resolve(import.meta.dirname, '..');
const source = resolve(values.source);
const revision = execFileSync('git', ['-C', source, 'rev-parse', '--verify', '--end-of-options', `${values.revision}^{commit}`], { encoding: 'utf8' }).trim();
const temporary = await mkdtemp(join(tmpdir(), 'emberfold-magnus-'));
const manifestSchema = z.object({ name: z.literal('@hivemagnus/ardent'), type: z.literal('module'), version: z.string().min(1),
  dependencies: z.record(z.string(), z.string()), devDependencies: z.record(z.string(), z.string()) });
const tests = ['test/context.test.ts', 'test/context-checkpoints.test.ts', 'test/emberfold.test.ts'];
try {
  const env = { PATH: process.env.PATH, HOME: join(temporary, 'home'), TMPDIR: temporary,
    npm_config_cache: join(temporary, 'cache'), CI: 'true' };
  await mkdir(env.HOME);
  const run = (command, args, cwd, timeout = 180000) => execFileSync(command, args,
    { cwd, env, encoding: 'utf8', timeout, maxBuffer: 8 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  const archive = join(temporary, 'magnus.tar');
  execFileSync('git', ['-C', source, 'archive', '--output', archive, revision, 'packages/ardent']);
  run('tar', ['-xf', archive, '-C', temporary], temporary);
  const consumer = join(temporary, 'packages/ardent');
  const manifestPath = join(consumer, 'package.json');
  const original = manifestSchema.parse(JSON.parse(await readFile(manifestPath, 'utf8')));
  const dependency = original.dependencies['@hivemagnus/emberfold'];
  if (!dependency || !/^\d+\.\d+\.\d+$/.test(dependency)) throw new Error('Ardent must declare an exact Emberfold dependency');
  for (const test of tests) await readFile(join(consumer, test));
  const workspace = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  const candidate = JSON.parse(await readFile(join(root, 'packages/core/package.json'), 'utf8'));
  const [pack] = z.array(z.object({ filename: z.string().regex(/^hivemagnus-emberfold-[0-9][A-Za-z0-9.-]*\.tgz$/),
    integrity: z.string().startsWith('sha512-') })).length(1)
    .parse(JSON.parse(run('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], join(root, 'packages/core'))));
  const tarball = join(temporary, pack.filename);
  await writeFile(manifestPath, JSON.stringify({ ...original, private: true,
    dependencies: { ...original.dependencies, '@hivemagnus/emberfold': `file:${tarball}` },
    devDependencies: { '@types/better-sqlite3': original.devDependencies['@types/better-sqlite3'],
      '@types/express': original.devDependencies['@types/express'], '@types/ws': original.devDependencies['@types/ws'],
      '@types/node': workspace.devDependencies['@types/node'], vitest: workspace.devDependencies.vitest, typescript: workspace.devDependencies.typescript },
    overrides: workspace.overrides
  }));
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--registry=https://registry.npmjs.org'], consumer, 300000);
  const installed = join(consumer, 'node_modules/@hivemagnus/emberfold');
  if (await realpath(installed) !== join(await realpath(consumer), 'node_modules/@hivemagnus/emberfold'))
    throw new Error('Consumer resolved a linked checkout instead of the candidate package');
  const installedPackage = JSON.parse(await readFile(join(installed, 'package.json'), 'utf8'));
  if (installedPackage.version !== candidate.version) throw new Error('Consumer installed the wrong candidate version');
  const lock = JSON.parse(await readFile(join(consumer, 'package-lock.json'), 'utf8'));
  z.object({ integrity: z.literal(pack.integrity) }).parse(lock.packages['node_modules/@hivemagnus/emberfold']);
  run(process.execPath, [join(consumer, 'node_modules/typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json'], consumer);
  const resultsPath = join(temporary, 'results.json');
  run(process.execPath, [join(consumer, 'node_modules/vitest/vitest.mjs'), 'run', ...tests, '--reporter=json', '--outputFile', resultsPath], consumer);
  const results = z.object({ success: z.literal(true), numTotalTests: z.number().int().positive(),
    numPassedTests: z.number().int().positive(), numFailedTests: z.literal(0), numPendingTests: z.literal(0) })
    .parse(JSON.parse(await readFile(resultsPath, 'utf8')));
  if (results.numTotalTests !== results.numPassedTests) throw new Error('Consumer compatibility tests did not all pass');
  const receipt = { schema_version: 1, source_revision: revision, node_version: process.versions.node, ardent_version: original.version,
    declared_emberfold: dependency, candidate_emberfold: candidate.version, packaged_engine: true,
    package_sha256: createHash('sha256').update(await readFile(tarball)).digest('hex'), package_integrity: pack.integrity,
    typecheck: true, tests_passed: results.numPassedTests, at: new Date().toISOString() };
  await mkdir(join(root, 'output/compatibility'), { recursive: true });
  await writeFile(join(root, 'output/compatibility/magnus.json'), JSON.stringify(receipt, null, 2) + '\n', { mode: 0o600 });
  console.log(JSON.stringify(receipt));
} finally {
  await rm(temporary, { recursive: true, force: true });
}
