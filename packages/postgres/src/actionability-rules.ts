import type { Pool } from "pg";
import type {
  ActionabilityRule,
  ActionabilityRulesPort,
} from "@ai-feedback-middleware/core";

export interface PostgresActionabilityRulesOptions {
  pool: Pool;
  /** Override the table name (default: `actionability_rules`). */
  tableName?: string;
}

interface DbRow {
  rule_id: string;
  rule_version: string;
  applies_when: ActionabilityRule["applies_when"];
  axis: ActionabilityRule["axis"];
  threshold: number;
  window_ms: string;
  result_if_met: ActionabilityRule["result_if_met"];
  result_if_unmet: ActionabilityRule["result_if_unmet"];
  active: boolean;
  notes: string | null;
}

function rowToRule(r: DbRow): ActionabilityRule {
  const out: ActionabilityRule = {
    rule_id: r.rule_id,
    rule_version: r.rule_version,
    applies_when: r.applies_when,
    axis: r.axis,
    threshold: r.threshold,
    window_ms: parseInt(r.window_ms, 10),
    result_if_met: r.result_if_met,
    active: r.active,
  };
  if (r.result_if_unmet) out.result_if_unmet = r.result_if_unmet;
  if (r.notes !== null) out.notes = r.notes;
  return out;
}

export function createPostgresActionabilityRulesStore(
  options: PostgresActionabilityRulesOptions,
): ActionabilityRulesPort {
  const pool = options.pool;
  const table = options.tableName ?? "actionability_rules";

  return {
    async list(): Promise<ActionabilityRule[]> {
      const result = await pool.query<DbRow>(
        `SELECT rule_id, rule_version, applies_when, axis, threshold,
                window_ms::text AS window_ms,
                result_if_met, result_if_unmet, active, notes
         FROM ${table}
         ORDER BY created_at ASC`,
      );
      return result.rows.map(rowToRule);
    },

    async upsert(rule: ActionabilityRule): Promise<void> {
      await pool.query(
        `INSERT INTO ${table} (
          rule_id, rule_version, applies_when, axis, threshold, window_ms,
          result_if_met, result_if_unmet, active, notes
        ) VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7, $8, $9, $10)
        ON CONFLICT (rule_id) DO UPDATE SET
          rule_version = EXCLUDED.rule_version,
          applies_when = EXCLUDED.applies_when,
          axis = EXCLUDED.axis,
          threshold = EXCLUDED.threshold,
          window_ms = EXCLUDED.window_ms,
          result_if_met = EXCLUDED.result_if_met,
          result_if_unmet = EXCLUDED.result_if_unmet,
          active = EXCLUDED.active,
          notes = EXCLUDED.notes`,
        [
          rule.rule_id,
          rule.rule_version,
          JSON.stringify(rule.applies_when),
          rule.axis,
          rule.threshold,
          rule.window_ms,
          rule.result_if_met,
          rule.result_if_unmet ?? "continue_to_observe",
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
