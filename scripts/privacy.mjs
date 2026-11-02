import { readdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

let paths;
try { paths = execFileSync('git', ['ls-files', '--cached', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split('\0').filter(Boolean); }
catch { paths = []; }
if (!paths.length) {
  const walk = async directory => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (['node_modules', 'dist', 'output', '.git', 'coverage'].includes(entry.name) || entry.name.startsWith('.env') && entry.name !== '.env.example') continue;
      const path = `${directory}/${entry.name}`;
      if (entry.isDirectory()) await walk(path); else if (entry.isFile()) paths.push(path.replace(/^\.\//, ''));
    }
  };
  await walk('.');
}
const forbidden = /(^|\/)(?:\.env(?:\..*)?|\.npmrc|auth\.json|id_rsa|id_ed25519)$|\.(?:sqlite\w*|db|pem|key|pfx|tgz)$|^(?:output|artifacts|state|node_modules)\//;
const secret = /-----BEGIN (?:RSA |OPENSSH |EC )?PRIVATE KEY-----|\b(?:gh[pousr]_[A-Za-z0-9]{30,}|sk-[A-Za-z0-9]{30,})\b/;
const privateData = /\/home\/[a-zA-Z][a-zA-Z0-9_-]*\/|(?:[a-z0-9-]+\.)+ts\.net\b/;
const failures = [];
for (const path of paths) {
  if (forbidden.test(path) && !path.endsWith('.env.example')) { failures.push(path); continue; }
  const data = await readFile(path);
  if (data.includes(0)) continue;
  const text = data.toString('utf8');
  if (secret.test(text) || privateData.test(text)) failures.push(path);
}
if (failures.length) throw new Error(`Privacy validation failed in ${[...new Set(failures)].join(', ')}; matches withheld`);
console.log(`Privacy scan passed for ${paths.length} files`);
