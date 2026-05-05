import type { Pool } from "pg";
import type {
  InferenceRulesPort,
  InferenceRule,
  RulePredicate,
} from "@llm-feedback-middleware/core";

export interface PostgresInferenceRulesOptions {
  pool: Pool;
  tableName?: string;
}

interface DbRow {
  rule_id: string;
  applies_when: RulePredicate;
  threshold: number;
  window_ms: string; // bigint as string from pg
  result_if_met: "whitelist" | "blacklist";
  result_if_unmet: "whitelist" | "blacklist" | "observe";
  active: boolean;
  notes: string | null;
}

function rowToRule(row: DbRow): InferenceRule {
  const rule: InferenceRule = {
    rule_id: row.rule_id,
    applies_when: row.applies_when,
    threshold: row.threshold,
    window_ms: parseInt(row.window_ms, 10),
    result_if_met: row.result_if_met,
    result_if_unmet: row.result_if_unmet,
    active: row.active,
  };
  if (row.notes !== null) rule.notes = row.notes;
  return rule;
}

export function createPostgresInferenceRulesStore(
  options: PostgresInferenceRulesOptions,
): InferenceRulesPort {
  const pool = options.pool;
  const table = options.tableName ?? "feedback_inference_rules";

  return {
    async list(): Promise<InferenceRule[]> {
      const result = await pool.query<DbRow>(
        `SELECT rule_id, applies_when, threshold, window_ms, result_if_met,
                result_if_unmet, active, notes
         FROM ${table}
         WHERE active = TRUE
         ORDER BY rule_id ASC`,
      );
      return result.rows.map(rowToRule);
    },

    async upsert(rule: InferenceRule): Promise<void> {
      await pool.query(
        `INSERT INTO ${table}
           (rule_id, applies_when, threshold, window_ms, result_if_met, result_if_unmet, active, notes)
         VALUES ($1, $2::jsonb, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (rule_id) DO UPDATE SET
           applies_when = EXCLUDED.applies_when,
           threshold = EXCLUDED.threshold,
           window_ms = EXCLUDED.window_ms,
           result_if_met = EXCLUDED.result_if_met,
           result_if_unmet = EXCLUDED.result_if_unmet,
           active = EXCLUDED.active,
           notes = EXCLUDED.notes`,
        [
          rule.rule_id,
          JSON.stringify(rule.applies_when),
          rule.threshold,
          rule.window_ms,
          rule.result_if_met,
          rule.result_if_unmet ?? "observe",
          rule.active,
          rule.notes ?? null,
        ],
      );
    },

    async remove(ruleId: string): Promise<void> {
      await pool.query(`DELETE FROM ${table} WHERE rule_id = $1`, [ruleId]);
    },
  };
}
