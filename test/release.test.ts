import { describe, expect, it } from 'vitest';
import { publishedIntegrity } from '../scripts/registry.mjs';

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
