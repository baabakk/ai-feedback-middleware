import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: ["tests/**/*.test.ts"],
    testTimeout: 30_000,
    // Postgres tests share a database. Run all test files in a single fork
    // so `runMigrations` does not race against itself (parallel
    // `CREATE TABLE IF NOT EXISTS` invocations against the same Postgres
    // instance can deadlock on `pg_type_typname_nsp_index`).
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
  },
});
