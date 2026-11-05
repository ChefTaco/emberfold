import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = process.cwd();
const temporary = await mkdtemp(join(tmpdir(), 'emberfold-pack-'));
try {
  const packs = [];
  for (const workspace of ['core', 'server', 'cli']) {
    const output = JSON.parse(execFileSync('npm', ['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], { cwd: join(root, 'packages', workspace), encoding: 'utf8' }))[0];
    const names = new Set(output.files.map(file => file.path));
    for (const required of ['LICENSE', 'NOTICE', 'README.md', 'package.json', 'dist/index.js']) if (!names.has(required)) throw new Error(`Missing ${required} in ${workspace}`);
    if ([...names].some(name => /(?:\.env|node_modules|output\/|test\/)/.test(name))) throw new Error('Unexpected package payload');
    packs.push(join(temporary, output.filename));
  }
  const install = join(temporary, 'installation');
  await mkdir(install);
  await writeFile(join(install, 'package.json'), '{"private":true,"type":"module"}');
  execFileSync('npm', ['install', '--ignore-scripts', '--omit=dev', '--no-audit', ...packs], { cwd: install, stdio: 'pipe' });
  const version = execFileSync(process.execPath, [join(install, 'node_modules/@hivemagnus/emberfold-cli/dist/index.js'), '--version'], { cwd: install, encoding: 'utf8' }).trim();
  if (version !== '0.2.1') throw new Error('Installed CLI version mismatch');
  execFileSync(process.execPath, ['--input-type=module', '-e', 'import {prepareContext} from "@hivemagnus/emberfold"; import {createEmberfoldServer} from "@hivemagnus/emberfold-server"; if(typeof prepareContext!=="function"||typeof createEmberfoldServer!=="function")process.exit(1)'], { cwd: install, stdio: 'pipe' });
  await mkdir(resolve(root, 'output/packages'), { recursive: true });
  const receipt = [];
  for (const path of packs) {
    const bytes = await readFile(path);
    const name = path.split('/').at(-1);
    await writeFile(join(root, 'output/packages', name), bytes);
    receipt.push({ name, sha256: createHash('sha256').update(bytes).digest('hex') });
  }
  await writeFile(join(root, 'output/packages/receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log('Three packaged installations and CLI verified outside the checkout');
} finally { await rm(temporary, { recursive: true, force: true }); }
