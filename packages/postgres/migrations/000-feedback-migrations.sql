-- Migration tracking table.
--
-- The framework's runMigrations() helper records every successfully-applied
-- file here so subsequent runs skip already-applied migrations. This is a
-- minimal tracker, not a full migration tool: it does not support down
-- migrations, checksums, or out-of-order detection. For production-grade
-- migration management consumers should use Knex / node-pg-migrate / Flyway
-- and let runMigrations() bootstrap the framework's own files only.
--
-- This file is numbered 000 so it always runs first; the runner falls back
-- to "apply this file unconditionally" on initial run since the tracking
-- table does not yet exist when the very first migration begins.

CREATE TABLE IF NOT EXISTS feedback_migrations (
  filename    TEXT PRIMARY KEY,
  applied_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
