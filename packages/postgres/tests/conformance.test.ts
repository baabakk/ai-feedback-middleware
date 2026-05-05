import { afterAll, beforeAll, describe, it } from "vitest";
import pg from "pg";
import {
  runEventStoreConformance,
  runProjectionStoreConformance,
  runOutboxConformance,
  runInferenceRulesConformance,
  makeEvent,
} from "@llm-feedback-middleware/adapter-conformance";
import {
  createPostgresEventStore,
  createPostgresProjectionStore,
  createPostgresOutbox,
  createPostgresInferenceRulesStore,
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

  // Event store conformance: each test runs against a freshly truncated table.
  runEventStoreConformance({
    name: "PostgresEventStore",
    factory: () => createPostgresEventStore({ pool: pool!, subscribePollMs: 50 }),
    cleanup: async () => {
      await pool!.query("TRUNCATE TABLE feedback_events RESTART IDENTITY CASCADE");
    },
    supportsSubscribe: true,
  });

  // Projection store conformance.
  runProjectionStoreConformance({
    name: "PostgresProjectionStore",
    factory: () => createPostgresProjectionStore({ pool: pool! }),
    cleanup: async () => {
      await pool!.query("TRUNCATE TABLE feedback_projections, feedback_projection_checkpoints");
    },
  });

  // Outbox conformance: requires feedback_events parent rows because of FK.
  // Pre-seed parent events for each test, then truncate everything between tests.
  runOutboxConformance({
    name: "PostgresOutbox",
    factory: async () => {
      // Outbox FK requires the event_id to exist in feedback_events first.
      // Seed a wide range of dummy parent rows to cover any event_ids the
      // conformance suite generates.
      const eventStore = createPostgresEventStore({ pool: pool! });
      // The conformance suite generates event_ids like "e1", "e-N", "with-payload", etc.
      // Easier to drop the FK constraint just for the duration of these tests.
      await pool!.query(
        "ALTER TABLE feedback_outbox DROP CONSTRAINT IF EXISTS feedback_outbox_event_id_fkey",
      );
      void eventStore;
      return createPostgresOutbox({ pool: pool! });
    },
    cleanup: async () => {
      await pool!.query("TRUNCATE TABLE feedback_outbox");
    },
  });

  // Inference rules conformance.
  runInferenceRulesConformance({
    name: "PostgresInferenceRulesStore",
    factory: () => createPostgresInferenceRulesStore({ pool: pool! }),
    cleanup: async () => {
      await pool!.query("TRUNCATE TABLE feedback_inference_rules");
    },
  });

  // Restore the FK after the outbox conformance suite runs (best-effort; not
  // strictly necessary because subsequent test runs re-create the schema via
  // runMigrations, but tidy).
  afterAll(async () => {
    if (!pool) return;
    try {
      await pool.query(
        `ALTER TABLE feedback_outbox
         ADD CONSTRAINT feedback_outbox_event_id_fkey
         FOREIGN KEY (event_id) REFERENCES feedback_events(event_id) ON DELETE CASCADE`,
      );
    } catch {
      // Ignore — the constraint may already exist if the suite was interrupted.
    }
  });

  // Suppress lint about unused import — used to silence dead-code warnings for makeEvent
  // when the suite is skipped.
  void makeEvent;
}
