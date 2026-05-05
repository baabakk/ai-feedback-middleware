/**
 * `eventStore.withTransaction` from a consumer's perspective.
 *
 * Demonstrates that a feedback capture and a custom side-effect (writing to
 * a consumer-owned table) commit (or roll back) atomically when wrapped in
 * the same transaction handle. Useful when the consumer's domain demands
 * read-your-writes consistency between framework events and its own state.
 *
 * The example wires:
 *
 * 1. Postgres event store + projection store via @llm-feedback-middleware/postgres.
 * 2. A consumer-owned table `audit_log` that records every captured event.
 * 3. A capture flow that writes the event AND the audit row in the same
 *    `withTransaction` block. If the audit insert fails (we simulate a
 *    constraint violation), the framework's append rolls back too — the
 *    event_id never appears in feedback_events.
 *
 * Run:
 *   DATABASE_URL=postgres://user:pass@host:5432/feedback \
 *     pnpm --filter transactional-side-effect start
 */
import pg from "pg";
import type { FeedbackEvent } from "@llm-feedback-middleware/core";
import { createPostgresEventStore, runMigrations } from "@llm-feedback-middleware/postgres";

const { Pool } = pg;

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error("DATABASE_URL is required.");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  try {
    console.log("--- Running framework migrations ---");
    const m = await runMigrations(pool);
    console.log(`Applied: ${m.applied.length}, skipped: ${m.skipped.length}`);

    // Consumer-owned table. The framework does not know about it.
    await pool.query(`
      CREATE TABLE IF NOT EXISTS audit_log (
        event_id    TEXT PRIMARY KEY,
        captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // Reset the table so the example is reproducible run-to-run.
    await pool.query(`TRUNCATE audit_log`);

    const eventStore = createPostgresEventStore({ pool });
    // Note: this example demonstrates withTransaction at the EventStorePort
    // level directly, so we do not wire createFeedback. The classifier and
    // projection engine are not needed when you control the event shape and
    // perform the consumer-side write inline. For a tour of createFeedback
    // see examples/postgres-only.

    // Build the event ourselves and run append + the consumer-side audit
    // insert inside the same withTransaction block. If the audit insert
    // fails, withTransaction rolls back the framework append too.

    async function captureWithAudit(
      ev: Pick<FeedbackEvent, "event_id" | "artifact_id" | "artifact_version" | "action">,
      auditShouldFail: boolean,
    ): Promise<void> {
      try {
        await eventStore.withTransaction(async (tx) => {
          // Append the framework event inside the same transaction.
          await eventStore.append(
            {
              event_id: ev.event_id,
              event_version: 1,
              timestamp: new Date().toISOString(),
              captured_at: new Date().toISOString(),
              partition_key: ev.artifact_id,
              source: "explicit",
              polarity: "positive",
              inference: "whitelist",
              action: ev.action,
              artifact_type: "draft",
              artifact_id: ev.artifact_id,
              artifact_version: ev.artifact_version,
              producer: "transactional-example",
              task_type: "demo",
              payload: { demo: true },
              provenance: { channel: "demo", captured_by_adapter: "demo" },
            },
            tx,
          );

          // Custom side effect on the same `tx`. The Postgres adapter's
          // Transaction is a `pg.PoolClient`, so we cast and use it
          // directly. The framework deliberately does not enforce the
          // type so consumers can target the adapter they actually use.
          const client = tx as pg.PoolClient;
          if (auditShouldFail) {
            // Simulated failure: insert a row with a NULL primary key,
            // which violates the PK constraint and rolls everything back.
            await client.query(`INSERT INTO audit_log (event_id) VALUES (NULL)`);
          } else {
            await client.query(`INSERT INTO audit_log (event_id) VALUES ($1)`, [ev.event_id]);
          }
        });
        console.log(`  ✓ committed: ${ev.event_id}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`  ✗ rolled back: ${ev.event_id} — ${msg.split("\n")[0]}`);
      }
    }

    console.log("\n--- Capturing two events ---");
    console.log("First capture: framework event + audit row commit together.");
    await captureWithAudit(
      { event_id: "evt-1", artifact_id: "draft-1", artifact_version: 1, action: "approve" },
      false,
    );
    console.log("Second capture: audit insert fails — entire transaction rolls back.");
    await captureWithAudit(
      { event_id: "evt-2", artifact_id: "draft-1", artifact_version: 2, action: "approve" },
      true,
    );

    console.log("\n--- Verifying state ---");
    const auditRows = await pool.query<{ event_id: string }>(
      `SELECT event_id FROM audit_log ORDER BY captured_at`,
    );
    console.log(`audit_log rows: ${auditRows.rows.map((r) => r.event_id).join(", ") || "(none)"}`);

    const eventRows = await pool.query<{ event_id: string }>(
      `SELECT event_id FROM feedback_events
        WHERE artifact_id = 'draft-1' AND producer = 'transactional-example'
        ORDER BY captured_at`,
    );
    console.log(
      `feedback_events rows: ${eventRows.rows.map((r) => r.event_id).join(", ") || "(none)"}`,
    );

    if (
      auditRows.rows.length === 1 &&
      auditRows.rows[0]?.event_id === "evt-1" &&
      eventRows.rows.length === 1 &&
      eventRows.rows[0]?.event_id === "evt-1"
    ) {
      console.log("\n✓ Atomic commit semantics verified: only evt-1 is durable in BOTH tables.");
    } else {
      console.error("\n✗ Unexpected state — withTransaction did not honor atomicity.");
      process.exit(1);
    }
    console.log("\nDone.");
  } finally {
    await pool.end().catch(() => {});
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
