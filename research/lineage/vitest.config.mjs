import { defineConfig } from 'vitest/config';
import { transformCandidate } from './prototype.mjs';

export default defineConfig({
  plugins: [{ name: 'lineage-verification-only', enforce: 'pre', transform(code, id) {
    const file = id.replaceAll('\\', '/');
    if (/\/src\/(?:model|layout)\/(?:graphBuilder|graphLayout|laneLayout|branchProtection)\.ts$/.test(file)) return { code: transformCandidate(code, file), map: null };
  } }],
  test: { include: ['tests/**/*.test.ts'], environment: 'node', reporters: ['default'] },
});
