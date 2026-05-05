import type { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Run all bundled SQL migrations in order against the given pool.
 *
 * Migrations are idempotent (CREATE TABLE IF NOT EXISTS). Safe to run
 * multiple times. For production deployments, consumers may prefer to use
 * their own migration runner (Knex, node-pg-migrate, Flyway). The shipped
 * SQL files live under `@llm-feedback-middleware/postgres/migrations/`.
 */
export async function runMigrations(pool: Pool): Promise<{ applied: string[] }> {
  const migrationsDir = resolveMigrationsDir();
  const filenames = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();

  const applied: string[] = [];
  for (const filename of filenames) {
    const sql = await readFile(join(migrationsDir, filename), "utf8");
    await pool.query(sql);
    applied.push(filename);
  }
  return { applied };
}

function resolveMigrationsDir(): string {
  // ESM-friendly resolve of ../migrations/ relative to this module.
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/migrate.js sits next to ../migrations/, OR src/migrate.ts sits next to ../migrations/.
  return join(here, "..", "migrations");
}
