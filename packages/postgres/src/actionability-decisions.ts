import type { Pool, PoolClient } from "pg";
import type {
  ActionabilityDecision,
  ActionabilityDecisionsStore,
  ActionabilityFilter,
  Transaction,
} from "@ai-feedback-middleware/core";

export interface PostgresActionabilityDecisionsOptions {
  pool: Pool;
  tableName?: string;
}

interface DbRow {
  decision_id: string;
  rule_id: string;
  rule_version: string;
  rule_run_at: Date;
  artifact_id: string;
  axis: ActionabilityDecision["axis"];
  inference: ActionabilityDecision["inference"];
  evidence_event_ids: string[];
}

function rowToDecision(r: DbRow): ActionabilityDecision {
  return {
    decision_id: r.decision_id,
    rule_id: r.rule_id,
    rule_version: r.rule_version,
    rule_run_at: r.rule_run_at.toISOString(),
    artifact_id: r.artifact_id,
    axis: r.axis,
    inference: r.inference,
    evidence_event_ids: r.evidence_event_ids,
  };
}

export function createPostgresActionabilityDecisionsStore(
  options: PostgresActionabilityDecisionsOptions,
): ActionabilityDecisionsStore {
  const pool = options.pool;
  const table = options.tableName ?? "actionability_decisions";

  function executor(tx?: Transaction): Pool | PoolClient {
    return (tx ?? pool) as Pool | PoolClient;
  }

  return {
    async appendBatch(batch: ActionabilityDecision[], tx?: Transaction): Promise<void> {
      if (batch.length === 0) return;
      const client = executor(tx);
      for (const d of batch) {
        await client.query(
          `INSERT INTO ${table} (
            decision_id, rule_id, rule_version, rule_run_at,
            artifact_id, axis, inference, evidence_event_ids
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            d.decision_id,
            d.rule_id,
            d.rule_version,
            d.rule_run_at,
            d.artifact_id,
            d.axis,
            d.inference,
            d.evidence_event_ids,
          ],
        );
      }
    },

    async *read(filter?: ActionabilityFilter): AsyncIterable<ActionabilityDecision> {
      const conditions: string[] = [];
      const params: unknown[] = [];
      function add(col: string, val: unknown): void {
        params.push(val);
        conditions.push(`${col} = $${params.length}`);
      }
      if (filter?.axis !== undefined) add("axis", filter.axis);
      if (filter?.inference !== undefined) add("inference", filter.inference);
      if (filter?.rule_id !== undefined) add("rule_id", filter.rule_id);
      if (filter?.from_timestamp !== undefined) {
        params.push(filter.from_timestamp);
        conditions.push(`rule_run_at >= $${params.length}`);
      }
      if (filter?.to_timestamp !== undefined) {
        params.push(filter.to_timestamp);
        conditions.push(`rule_run_at <= $${params.length}`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
      const result = await pool.query<DbRow>(
        `SELECT * FROM ${table} ${where} ORDER BY rule_run_at ASC`,
        params,
      );
      for (const row of result.rows) yield rowToDecision(row);
    },
  };
}
