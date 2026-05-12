import { afterAll, beforeAll, describe, it } from "vitest";
import pg from "pg";
import {
  runEventStoreConformance,
  runProjectionStoreConformance,
  runOutboxConformance,
  runActionabilityRulesConformance,
  runTrackedArtifactsConformance,
  runActionabilityDecisionsConformance,
  makeReaction,
} from "@ai-feedback-middleware/adapter-conformance";
import {
  createPostgresEventStore,
  createPostgresProjectionStore,
  createPostgresOutbox,
  createPostgresActionabilityRulesStore,
  createPostgresTrackedArtifactsStore,
  createPostgresActionabilityDecisionsStore,
  runMigrations,
} from "../src/index.js";

const { Pool } = pg;

const connectionString = process.env.FEEDBACK_TEST_DATABASE_URL ?? process.env.TEST_DATABASE_URL;

const skip = !connectionString;

if (skip) {
  describe.skip("@ai-feedback-middleware/postgres conformance", () => {
    it("skipped: set FEEDBACK_TEST_DATABASE_URL or TEST_DATABASE_URL to run Postgres tests", () => {
      // intentionally empty
    });
  });
} else {
  let pool: pg.Pool | null = null;

  beforeAll(async () => {
    pool = new Pool({ connectionString });
    await runMigrations(pool);

    // The conformance suites exercise each port in isolation; e.g. the
    // EventStorePort suite appends reaction events without seeding their
    // parent captured_artifacts row, and the TrackedArtifactsPort suite
    // calls markTerminal with a synthetic reaction event_id that does not
    // exist in `captured_evaluated_reactions`. Both are valid in-isolation
    // tests of those ports, but Postgres enforces real FKs that the
    // in-memory adapter doesn't. Drop those FKs for the duration of the
    // test run so the in-isolation contract can be verified. The
    // constraints stay in production migrations.
    await pool.query(
      "ALTER TABLE captured_evaluated_reactions DROP CONSTRAINT IF EXISTS captured_evaluated_reactions_artifact_id_fkey",
    );
    await pool.query(
      "ALTER TABLE tracked_artifacts DROP CONSTRAINT IF EXISTS tracked_artifacts_terminal_reaction_event_id_fkey",
    );
  });

  afterAll(async () => {
    if (pool) await pool.end();
  });

  // Event store conformance: truncate both immutable tables between tests.
  runEventStoreConformance({
    name: "PostgresEventStore",
    factory: () => createPostgresEventStore({ pool: pool!, subscribePollMs: 50 }),
    cleanup: async () => {
      // Reactions FK -> captures, so drop reactions first.
      await pool!.query("TRUNCATE TABLE captured_evaluated_reactions RESTART IDENTITY CASCADE");
      await pool!.query("TRUNCATE TABLE captured_artifacts RESTART IDENTITY CASCADE");
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

  // Outbox conformance.
  runOutboxConformance({
    name: "PostgresOutbox",
    factory: () => createPostgresOutbox({ pool: pool! }),
    cleanup: async () => {
      await pool!.query("TRUNCATE TABLE feedback_outbox");
    },
  });

  // Actionability rules conformance.
  runActionabilityRulesConformance({
    name: "PostgresActionabilityRulesStore",
    factory: () => createPostgresActionabilityRulesStore({ pool: pool! }),
    cleanup: async () => {
      await pool!.query("TRUNCATE TABLE actionability_rules");
    },
  });

  // Tracked artifacts conformance. The conformance suite asserts the port in
  // isolation — without paired captured_artifacts rows. Drop the FK for the
  // duration of these tests so insertWaiting can stand alone.
  runTrackedArtifactsConformance({
    name: "PostgresTrackedArtifactsStore",
    factory: async () => {
      await pool!.query(
        "ALTER TABLE tracked_artifacts DROP CONSTRAINT IF EXISTS tracked_artifacts_artifact_id_fkey",
      );
      return createPostgresTrackedArtifactsStore({ pool: pool! });
    },
    cleanup: async () => {
      await pool!.query("TRUNCATE TABLE tracked_artifacts");
    },
  });

  // Actionability decisions conformance.
  runActionabilityDecisionsConformance({
    name: "PostgresActionabilityDecisionsStore",
    factory: () => createPostgresActionabilityDecisionsStore({ pool: pool! }),
    cleanup: async () => {
      await pool!.query("TRUNCATE TABLE actionability_decisions");
    },
  });

  // Suppress lint about unused import.
  void makeReaction;
}
