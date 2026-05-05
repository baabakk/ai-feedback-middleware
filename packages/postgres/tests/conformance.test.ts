import { afterAll, beforeAll, describe, it } from "vitest";
import pg from "pg";
import {
  runEventStoreConformance,
  runProjectionStoreConformance,
} from "@llm-feedback-middleware/adapter-conformance";
import {
  createPostgresEventStore,
  createPostgresProjectionStore,
  runMigrations,
} from "../src/index.js";

const { Pool } = pg;

const connectionString = process.env.FEEDBACK_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;

const skip = !connectionString;

if (skip) {
  describe.skip("@llm-feedback-middleware/postgres conformance", () => {
    it("skipped: set FEEDBACK_TEST_DATABASE_URL or TEST_DATABASE_URL to run Postgres tests", () => {
      // intentionally empty
    });
  });
} else {
  let pool: pg.Pool | null = null;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    await runMigrations(pool);
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  // Event store conformance: each test case runs against a freshly truncated table.
  runEventStoreConformance({
    name: "PostgresEventStore",
    factory: () => createPostgresEventStore({ pool: pool!, subscribePollMs: 50 }),
    cleanup: async () => {
      // Truncate between tests to reset state.
      await pool!.query("TRUNCATE TABLE feedback_events RESTART IDENTITY CASCADE");
    },
    supportsSubscribe: true,
  });

  // Projection store conformance: truncate both projection tables between tests.
  runProjectionStoreConformance({
    name: "PostgresProjectionStore",
    factory: () => createPostgresProjectionStore({ pool: pool! }),
    cleanup: async () => {
      await pool!.query("TRUNCATE TABLE feedback_projections, feedback_projection_checkpoints");
    },
  });
}
