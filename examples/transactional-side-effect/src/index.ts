/**
 * `eventStore.withTransaction` from a consumer's perspective (v2.1).
 *
 * Demonstrates that a feedback reaction and a custom side-effect (writing
 * to a consumer-owned table) commit (or roll back) atomically when wrapped
 * in the same transaction handle. Useful when the consumer's domain demands
 * read-your-writes consistency between framework events and its own state.
 *
 * The example wires:
 *
 * 1. Postgres event store via @ai-feedback-middleware/postgres.
 * 2. A consumer-owned table `audit_log` that records every captured reaction.
 * 3. A capture flow that writes the reaction AND the audit row in the same
 *    `withTransaction` block. If the audit insert fails (we simulate a
 *    constraint violation), the framework's append rolls back too — the
 *    event_id never appears in `captured_evaluated_reactions`.
 *
 * Run:
 *   DATABASE_URL=postgres://user:pass@host:5432/feedback \
 *     pnpm --filter transactional-side-effect start
 */
import pg from "pg";
import type { CapturedEvaluatedReactionEvent } from "@ai-feedback-middleware/core";
import { createPostgresEventStore, runMigrations } from "@ai-feedback-middleware/postgres";

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
    await pool.query(`TRUNCATE audit_log`);

    // For this example, we also need to seed a captured_artifacts row so the
    // reaction-table FK is satisfied. We bypass createFeedback and append
    // directly via the EventStorePort to focus the example on transaction
    // semantics. For the full createFeedback flow, see examples/postgres-only.
    await pool.query(`
      INSERT INTO captured_artifacts (
        artifact_id, artifact_type, artifact_version, partition_key, producer,
        task_type, payload, provenance, expires_at, occurred_at,
        event_id, event_version
      ) VALUES (
        'draft-1', 'draft_email', 1, 'draft-1', 'transactional-example',
        'demo', '{}', '{"channel":"demo","captured_by_adapter":"demo"}',
        NOW() + INTERVAL '1 day', NOW(),
        'cap-draft-1', 2
      )
      ON CONFLICT (artifact_id) DO NOTHING
    `);

    const eventStore = createPostgresEventStore({ pool });

    async function reactWithAudit(
      ev: Pick<CapturedEvaluatedReactionEvent, "event_id" | "artifact_id" | "artifact_version" | "action">,
      auditShouldFail: boolean,
    ): Promise<void> {
      try {
        await eventStore.withTransaction(async (tx) => {
          await eventStore.append(
            {
              event_kind: "reaction",
              event_id: ev.event_id,
              event_version: 2,
              artifact_id: ev.artifact_id,
              artifact_type: "draft_email",
              artifact_version: ev.artifact_version,
              partition_key: ev.artifact_id,
              producer: "transactional-example",
              task_type: "demo",
              source: "explicit",
              action: ev.action,
              evaluations: { content: "positive" },
              classifier_version: "demo-2.1",
              occurred_at: new Date().toISOString(),
              captured_at: new Date().toISOString(),
              payload: { demo: true },
              provenance: { channel: "demo", captured_by_adapter: "demo" },
            },
            tx,
          );

          const client = tx as pg.PoolClient;
          if (auditShouldFail) {
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

    console.log("\n--- Capturing two reactions ---");
    console.log("First reaction: framework event + audit row commit together.");
    await reactWithAudit(
      { event_id: "evt-1", artifact_id: "draft-1", artifact_version: 1, action: "approved" },
      false,
    );
    console.log("Second reaction: audit insert fails — entire transaction rolls back.");
    await reactWithAudit(
      { event_id: "evt-2", artifact_id: "draft-1", artifact_version: 2, action: "approved" },
      true,
    );

    console.log("\n--- Verifying state ---");
    const auditRows = await pool.query<{ event_id: string }>(
      `SELECT event_id FROM audit_log ORDER BY captured_at`,
    );
    console.log(`audit_log rows: ${auditRows.rows.map((r) => r.event_id).join(", ") || "(none)"}`);

    const eventRows = await pool.query<{ event_id: string }>(
      `SELECT event_id FROM captured_evaluated_reactions
        WHERE artifact_id = 'draft-1' AND producer = 'transactional-example'
        ORDER BY captured_at`,
    );
    console.log(
      `captured_evaluated_reactions rows: ${eventRows.rows.map((r) => r.event_id).join(", ") || "(none)"}`,
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
