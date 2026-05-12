import type { Pool } from "pg";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * Run bundled SQL migrations in filename-order against the given pool.
 *
 * Tracking. The first migration (`000-feedback-migrations.sql`) creates a
 * `feedback_migrations(filename, applied_at)` table. After it runs, the
 * runner records every applied filename so subsequent calls skip
 * already-applied migrations. The very first run on a fresh database
 * applies `000-feedback-migrations.sql` unconditionally before consulting
 * the tracker.
 *
 * **Bootstrap-only.** This helper exists so a consumer can stand the
 * framework up in a fresh database with one call. It is intentionally
 * minimal: no down migrations, no checksums, no out-of-order detection.
 * For production migration management, use a full tool (Knex,
 * node-pg-migrate, Flyway) and run framework migrations alongside your own.
 *
 * The shipped SQL files live under
 * `@ai-feedback-middleware/postgres/migrations/`.
 *
 * @returns `applied` is the list of filenames applied during this call.
 *          `skipped` is the list previously-applied files that were
 *          consulted and skipped.
 */
export async function runMigrations(pool: Pool): Promise<{ applied: string[]; skipped: string[] }> {
  const migrationsDir = resolveMigrationsDir();
  const filenames = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();

  const applied: string[] = [];
  const skipped: string[] = [];

  // First file is always the tracking-table bootstrap; apply unconditionally.
  // It is `CREATE TABLE IF NOT EXISTS`, so re-running is safe even when the
  // table already exists from a prior call.
  const bootstrapFilename = filenames[0];
  if (bootstrapFilename === undefined) {
    return { applied, skipped };
  }
  const bootstrapSql = await readFile(join(migrationsDir, bootstrapFilename), "utf8");
  await pool.query(bootstrapSql);
  // Record the bootstrap itself so subsequent runs see it as applied.
  await pool.query(
    `INSERT INTO feedback_migrations (filename) VALUES ($1) ON CONFLICT (filename) DO NOTHING`,
    [bootstrapFilename],
  );

  // Look up everything that has already been applied.
  const result = await pool.query<{ filename: string }>(`SELECT filename FROM feedback_migrations`);
  const alreadyApplied = new Set(result.rows.map((r) => r.filename));

  for (const filename of filenames.slice(1)) {
    if (alreadyApplied.has(filename)) {
      skipped.push(filename);
      continue;
    }
    const sql = await readFile(join(migrationsDir, filename), "utf8");
    await pool.query(sql);
    await pool.query(`INSERT INTO feedback_migrations (filename) VALUES ($1)`, [filename]);
    applied.push(filename);
  }
  return { applied, skipped };
}

function resolveMigrationsDir(): string {
  // ESM-friendly resolve of ../migrations/ relative to this module.
  const here = dirname(fileURLToPath(import.meta.url));
  // dist/migrate.js sits next to ../migrations/, OR src/migrate.ts sits next to ../migrations/.
  return join(here, "..", "migrations");
}
