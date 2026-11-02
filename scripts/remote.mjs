import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { parse } from 'dotenv';

export async function deploymentConfig() {
  const config = { ...parse(await readFile(new URL('../.env', import.meta.url))), ...process.env };
  for (const key of ['DEPLOY_HOST', 'DEPLOY_USERNAME', 'DEPLOY_PASSWORD']) if (!config[key]) throw new Error(`${key} is required`);
  if (!/^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(config.DEPLOY_HOST) || !/^[A-Za-z_][A-Za-z0-9_-]*$/.test(config.DEPLOY_USERNAME)) throw new Error('Invalid deployment identity');
  return config;
}
export async function remote(command, input, options = {}) {
  const config = await deploymentConfig();
  const args = ['-d', '3', 'ssh', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', '-l', config.DEPLOY_USERNAME, config.DEPLOY_HOST, command];
  return new Promise((resolve, reject) => {
    const child = spawn('sshpass', args, { stdio: ['pipe', 'pipe', 'pipe', 'pipe'] });
    child.stdio[3].end(config.DEPLOY_PASSWORD + '\n');
    child.stdin.on('error', () => {});
    child.stdin.end(input);
    const output = [];
    const errors = [];
    child.stdout.on('data', chunk => output.push(chunk));
    child.stderr.on('data', chunk => errors.push(chunk));
    const timer = setTimeout(() => child.kill('SIGTERM'), options.timeout ?? 120000);
    child.on('error', reject);
    child.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`Remote command failed (${code}); ${options.diagnostic ? Buffer.concat(errors).toString().slice(-2000) : 'diagnostics withheld'}`));
      else resolve(Buffer.concat(output).toString());
    });
  });
}
export const quote = value => "'" + value.replaceAll("'", "'\\''") + "'";
export async function privilegedRemote(command, options) {
  const config = await deploymentConfig();
  return remote('sudo -S -p "" sh -c ' + quote(command), config.DEPLOY_PASSWORD + '\n', options);
}
