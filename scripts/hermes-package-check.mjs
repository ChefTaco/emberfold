import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const source = new URL('../integrations/emberfold-hermes/', import.meta.url);
const directory = await mkdtemp(join(tmpdir(), 'emberfold-hermes-package-'));
try {
  await cp(source, directory, { recursive: true,
    filter: path => !path.split('/').some(part => part === 'node_modules' || part === '__pycache__') });
  const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(join(directory, 'package-lock.json'), 'utf8'));
  if (manifest.dependencies['@hivemagnus/emberfold'] !== '0.1.0' ||
      lock.packages['node_modules/@hivemagnus/emberfold'].version !== '0.1.0' ||
      !lock.packages['node_modules/@hivemagnus/emberfold'].integrity.startsWith('sha512-')) throw new Error('Hermes sidecar dependency is not pinned');
  execFileSync('npm', ['ci', '--ignore-scripts', '--no-audit', '--no-fund'], { cwd: directory, stdio: 'pipe' });
  const result = JSON.parse(execFileSync(process.execPath, ['bridge/worker.js'], { cwd: directory,
    input: JSON.stringify({ version: 1, operation: 'digest', payload: { synthetic: true } }) + '\n', encoding: 'utf8' }));
  const expected = createHash('sha256').update('{"synthetic":true}').digest('hex');
  if (result.version !== 1 || result.result !== expected) throw new Error('Installed Hermes bridge failed its protocol check');
  for (const file of ['LICENSE', 'NOTICE', 'plugin.yaml', '__init__.py', 'engine.py', 'onboarding.py', 'protocol.py']) await readFile(join(directory, file));
  console.log('Hermes plugin sidecar verified outside the checkout with exact registry dependencies');
} finally {
  await rm(directory, { recursive: true, force: true });
}
