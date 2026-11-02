import { execFileSync } from 'node:child_process';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { remote, privilegedRemote, quote, deploymentConfig } from './remote.mjs';

const action = process.argv[2] ?? 'preflight';
if (!['preflight', 'deploy', 'status', 'restart', 'rollback'].includes(action)) throw new Error('Use preflight, deploy, status, restart, or rollback');
const config = await deploymentConfig();
const port = Number(config.DEPLOY_PORT ?? 8096);
const tlsPort = Number(config.DEPLOY_TLS_PORT ?? 8097);
for (const value of [port, tlsPort]) if (!Number.isInteger(value) || value < 1024 || value > 65535) throw new Error('Invalid deployment port');
const remoteRoot = '"$HOME/.local/share/emberfold"';
await mkdir('output/deploy', { recursive: true });
const probe = `node -e ${quote(String.raw`const fs=require('fs');const root=process.env.HOME+'/.local/share/emberfold';const text=fs.readFileSync(root+'/service.env','utf8');const line=text.split('\n').find(line=>line.startsWith('EMBERFOLD_API_TOKEN='));if(!line)throw Error('Token unavailable');const token=line.slice(line.indexOf('=')+1);(async()=>{const base='http://127.0.0.1:${port}';const health=await fetch(base+'/healthz');const anonymous=await fetch(base+'/v1/prepare',{method:'POST'});const prepared=await fetch(base+'/v1/prepare',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token},body:JSON.stringify({schema_version:1,namespace:'synthetic:deployment',instructions:'Current application policy',history:[],exchanges:[],current:[{id:'current',role:'user',content:'Synthetic deployment check'}],budget:{context_tokens:8192,output_reserve_tokens:1024}})});const body=await prepared.json();if(!health.ok||anonymous.status!==401||!prepared.ok||!body.fits)throw Error('Service verification failed');console.log(JSON.stringify({health:health.status,anonymous:anonymous.status,authenticated:prepared.status,fits:body.fits}))})().catch(()=>process.exit(1));`)}`;
const start = image => `docker run -d --name emberfold --restart unless-stopped --label org.opencontainers.image.source=https://github.com/ChefTaco/emberfold --read-only --cap-drop ALL --security-opt no-new-privileges --pids-limit 128 --memory 512m --tmpfs /tmp:rw,noexec,nosuid,size=32m -p 127.0.0.1:${port}:8096 --env-file ${remoteRoot}/service.env -v ${remoteRoot}/service.json:/config/service.json:ro ${quote(image)}`;
if (action === 'preflight') {
  const status = await remote('docker info --format "{{.ServerVersion}}"; command -v tailscale; command -v node; ss -ltn', undefined, { diagnostic: true });
  await privilegedRemote('test "$(id -u)" = 0');
  await writeFile('output/deploy/preflight.txt', status, { mode: 0o600 });
  console.log('Verified SSH, privileged deployment access, Docker, and listener inventory');
} else if (action === 'status') {
  console.log(await remote('docker inspect --format "{{.State.Status}} {{.Image}}" emberfold && ' + probe, undefined, { diagnostic: true }));
} else if (action === 'restart') {
  await remote('docker restart emberfold', undefined, { diagnostic: true });
  await new Promise(resolve => setTimeout(resolve, 1000));
  console.log(await remote(probe, undefined, { diagnostic: true }));
} else if (action === 'rollback') {
  const state = JSON.parse(await remote('cat ' + remoteRoot + '/release.json'));
  await remote('docker rm -f emberfold', undefined, { diagnostic: true });
  if (state.previous_image) {
    await remote(start(state.previous_image), undefined, { diagnostic: true });
    await new Promise(resolve => setTimeout(resolve, 1000));
    await remote(probe);
  }
  await writeFile('output/deploy/rollback.json', JSON.stringify({ at: new Date().toISOString(), restored_image: state.previous_image ?? null }, null, 2), { mode: 0o600 });
  console.log(state.previous_image ? 'Previous immutable image restored and verified' : 'First deployment rolled back to the previous absent-service state');
} else {
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  if (execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' }).trim()) throw new Error('Commit verified source before deployment');
  const service = JSON.parse(await readFile('output/deploy/service.json', 'utf8'));
  if (service.host !== '0.0.0.0' || service.port !== 8096) throw new Error('Container service must bind port 8096 internally');
  const env = await readFile('output/deploy/service.env');
  const archive = execFileSync('git', ['archive', '--format=tar', 'HEAD'], { maxBuffer: 33554432 });
  const archiveSha = createHash('sha256').update(archive).digest('hex');
  const root = `"$HOME/.local/share/emberfold/releases/${revision}"`;
  await remote('umask 077; mkdir -p ' + root + '; cat > ' + root + '/source.tar', archive);
  await remote('umask 077; cat > ' + remoteRoot + '/service.env', env);
  await remote('umask 077; cat > ' + remoteRoot + '/service.json; chmod 644 ' + remoteRoot + '/service.json', JSON.stringify(service));
  const previous = await remote('docker inspect --format "{{.Image}}" emberfold 2>/dev/null || true');
  if (previous.trim()) {
    const source = await remote('docker inspect --format \'{{index .Config.Labels "org.opencontainers.image.source"}}\' emberfold');
    if (source.trim() !== 'https://github.com/ChefTaco/emberfold') throw new Error('Existing container is not managed by Emberfold');
  }
  await remote('cd ' + root + ' && printf "%s  source.tar\\n" ' + quote(archiveSha) + ' | sha256sum -c - && tar -xf source.tar && docker build --label org.opencontainers.image.revision=' + revision + ' -t emberfold:' + revision + ' . > build.log 2>&1', undefined, { timeout: 600000, diagnostic: true });
  const image = (await remote('docker image inspect --format "{{.Id}}" emberfold:' + revision)).trim();
  if (!/^sha256:[a-f0-9]{64}$/.test(image)) throw new Error('Invalid built image digest');
  try {
    if (previous.trim()) await remote('docker rm -f emberfold');
    await remote(start(image), undefined, { diagnostic: true });
    await new Promise(resolve => setTimeout(resolve, 1000));
    const proof = JSON.parse(await remote(probe, undefined, { diagnostic: true }));
    const beforeTls = await privilegedRemote('tailscale serve status --json');
    const tls = JSON.parse(beforeTls);
    if (tls.TCP?.[String(tlsPort)] && !JSON.stringify(tls.Web ?? {}).includes(`127.0.0.1:${port}`)) throw new Error('TLS port already has an unrelated route');
    await privilegedRemote(`tailscale serve --bg --https=${tlsPort} http://127.0.0.1:${port}`, { diagnostic: true });
    const state = { revision, image, archive_sha256: archiveSha, previous_image: previous.trim() || null, port, tls_port: tlsPort, proof, at: new Date().toISOString() };
    await remote('umask 077; cat > ' + remoteRoot + '/release.json', JSON.stringify(state));
    await writeFile('output/deploy/release.json', JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
    await writeFile('output/deploy/tls-before.json', beforeTls, { mode: 0o600 });
    console.log(JSON.stringify({ deployed: true, revision, image, proof }));
  } catch (error) {
    await remote('docker rm -f emberfold 2>/dev/null || true');
    if (previous.trim()) await remote(start(previous.trim()));
    throw error;
  }
}
