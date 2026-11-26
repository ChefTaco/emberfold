import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { publishedIntegrity } from '../scripts/registry.mjs';

describe('release version', () => {
  it('is the same in every manifest and every version reported at runtime', async () => {
    const read = (path: string) => readFile(new URL('../' + path, import.meta.url), 'utf8');
    const { version } = JSON.parse(await read('package.json')) as { version: string };
    for (const name of ['core', 'server', 'cli']) {
      const manifest = JSON.parse(await read(`packages/${name}/package.json`)) as { version: string; dependencies?: Record<string, string> };
      expect([name, manifest.version]).toEqual([name, version]);
      for (const [dependency, range] of Object.entries(manifest.dependencies ?? {})) if (dependency.startsWith('@hivemagnus/emberfold')) expect([name, dependency, range]).toEqual([name, dependency, version]);
    }
    expect(await read('packages/cli/src/index.ts')).toContain(`process.stdout.write('${version}\\n')`);
    expect(await read('packages/server/src/index.ts')).toContain(`{ status: 'ok', version: '${version}' }`);
    expect(await read('packages/server/src/index.ts')).toContain(`createHealth({ service: 'emberfold', version: '${version}'`);
    expect(await read('packages/core/src/adapters.ts')).toContain(`title: 'Emberfold', version: '${version}'`);
  });
});
describe('documented version pins', () => {
  const read = (path: string) => readFile(new URL('../' + path, import.meta.url), 'utf8');
  it('names the Ardent commit that the CI compatibility gate checks', async () => {
    const workflow = await read('.github/workflows/ci.yml');
    const refs = [...workflow.matchAll(/ref: ([0-9a-f]{40}) # (v\d+\.\d+\.\d+)/g)];
    expect(refs).toHaveLength(1);
    const [, commit, tag] = refs[0]!;
    expect(workflow).toContain(`--revision ${commit}`);
    const doc = await read('docs/MAGNUS.md');
    expect(doc).toContain(commit);
    expect(doc).toContain(`Ardent ${tag!.slice(1)}`);
    expect(doc).toContain(`tag \`${tag}\``);
  });
  it('keeps the Hermes plugin pin consistent across its manifest, lockfile and package check', async () => {
    const manifest = JSON.parse(await read('integrations/emberfold-hermes/package.json')) as { dependencies: Record<string, string> };
    const lock = JSON.parse(await read('integrations/emberfold-hermes/package-lock.json')) as { packages: Record<string, { version: string }> };
    const pin = manifest.dependencies['@hivemagnus/emberfold']!;
    expect(lock.packages['node_modules/@hivemagnus/emberfold']!.version).toBe(pin);
    expect(await read('scripts/hermes-package-check.mjs')).toContain(`!== '${pin}'`);
  });
});
describe('registry publication verification', () => {
  it('waits for accepted publications to become visible without repeating publication', async () => {
    let reads = 0;
    let waits = 0;
    const integrity = await publishedIntegrity('@example/package', '0.1.0', { attempts: 4,
      lookup: () => ++reads < 3 ? null : 'sha512-synthetic', delay: async () => { waits++; } });
    expect(integrity).toBe('sha512-synthetic');
    expect(reads).toBe(3);
    expect(waits).toBe(2);
  });
  it('bounds unavailable-registry waiting and propagates non-404 failures', async () => {
    let reads = 0;
    expect(await publishedIntegrity('@example/package', '0.1.0', { attempts: 2, lookup: () => { reads++; return null; }, delay: async () => {} })).toBeNull();
    expect(reads).toBe(2);
    await expect(publishedIntegrity('@example/package', '0.1.0', { lookup: () => { throw new Error('Registry lookup failed'); } })).rejects.toThrow('Registry lookup failed');
  });
});
