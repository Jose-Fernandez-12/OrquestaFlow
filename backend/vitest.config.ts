import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // The engine tests run against an in-memory SQLite database, never the real data/orquesta.sqlite
    env: { ORQUESTA_DB_PATH: ':memory:' },
    // Engine tests share one in-memory database and the global activeFlowExecutions map
    fileParallelism: false,
  },
});
