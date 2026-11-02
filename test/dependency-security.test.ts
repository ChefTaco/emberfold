import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const require = createRequire(import.meta.url);

describe('development dependency security', () => {
  it.each(['eslint', '@eslint/config-array', '@typescript-eslint/typescript-estree'])(
    'bounds amplified glob preprocessing through %s', dependency => {
      const dependencyRequire = createRequire(require.resolve(dependency));
      const { Minimatch } = dependencyRequire('minimatch') as typeof import('minimatch');
      const pattern = Array(8).fill('**/../segment/leaf').join('/');
      const matcher = new Minimatch(pattern, { optimizationLevel: 2, braceExpandMax: 16 });
      expect(matcher.set.length).toBeLessThanOrEqual(16);
      expect(matcher.match(Array(8).fill('../segment/leaf').join('/'))).toBe(true);
    }
  );
});
