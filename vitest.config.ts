import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Real-Git fixtures spawn many processes; avoid competing Git workloads.
    fileParallelism: false,
    reporters: ['default'],
  },
});
