import { execFileSync } from 'node:child_process';

export async function publishedIntegrity(name, version, options = {}) {
  const lookup = options.lookup ?? (() => {
    try { return JSON.parse(execFileSync('npm', ['view', `${name}@${version}`, 'dist.integrity', '--json'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })); }
    catch (error) { if (/E404/.test(error.stderr?.toString() ?? '')) return null; throw new Error('Registry lookup failed'); }
  });
  const delay = options.delay ?? (() => new Promise(resolve => setTimeout(resolve, 10000)));
  const attempts = options.attempts ?? 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const integrity = await lookup();
    if (integrity) return integrity;
    if (attempt + 1 < attempts) await delay();
  }
  return null;
}
