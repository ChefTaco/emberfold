import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

const publish = process.argv.includes('--publish');
const version = JSON.parse(await readFile('package.json', 'utf8')).version;
if (publish && execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Commit the verified release before publishing');
for (const name of ['emberfold', 'emberfold-server', 'emberfold-cli']) {
  const path = `output/packages/hivemagnus-${name}-${version}.tgz`;
  const bytes = await readFile(path);
  const integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  let existing;
  try { existing = JSON.parse(execFileSync('npm', ['view', `@hivemagnus/${name}@${version}`, 'dist.integrity', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch (error) { if (!/E404/.test(error.stderr?.toString() ?? '')) throw new Error('Registry lookup failed'); }
  if (existing) {
    if (existing !== integrity) throw new Error(`Published bytes differ for ${name}; choose a new version`);
    console.log(`${name}@${version}: already published and verified`);
    continue;
  }
  if (!publish) { console.log(`${name}@${version}: prepared`); continue; }
  execFileSync('npm', ['publish', path, '--access', 'public', '--ignore-scripts', ...(process.env.GITHUB_ACTIONS === 'true' ? ['--provenance'] : [])], { stdio: 'inherit' });
  const actual = JSON.parse(execFileSync('npm', ['view', `@hivemagnus/${name}@${version}`, 'dist.integrity', '--json'], { encoding: 'utf8' }));
  if (actual !== integrity) throw new Error('Published integrity differs');
}
