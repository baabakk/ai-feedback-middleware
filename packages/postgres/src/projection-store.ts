import type { Pool, PoolClient } from "pg";
import type { ProjectionStorePort } from "@ai-feedback-middleware/core";

export interface PostgresProjectionStoreOptions {
  pool: Pool;
  /** Override the projections table name (default: `feedback_projections`). */
  projectionsTable?: string;
  /** Override the checkpoints table name (default: `feedback_projection_checkpoints`). */
  checkpointsTable?: string;
}

export function createPostgresProjectionStore(
  options: PostgresProjectionStoreOptions,
): ProjectionStorePort {
  const pool = options.pool;
  const projTable = options.projectionsTable ?? "feedback_projections";
  const checkTable = options.checkpointsTable ?? "feedback_projection_checkpoints";

  function executor(tx?: unknown): Pool | PoolClient {
    return (tx ?? pool) as Pool | PoolClient;
  }

  return {
    async get<T = unknown>(projectionName: string, key: string, tx?: unknown): Promise<T | null> {
      const result = await executor(tx).query<{ state: T }>(
        `SELECT state FROM ${projTable}
         WHERE projection_name = $1 AND key = $2`,
        [projectionName, key],
      );
      if (result.rows.length === 0) return null;
      return result.rows[0]!.state;
    },

    async put<T = unknown>(
      projectionName: string,
      key: string,
      state: T,
      eventId: string,
      tx?: unknown,
    ): Promise<void> {
      await executor(tx).query(
        `INSERT INTO ${projTable} (projection_name, key, state, last_event_id, updated_at)
         VALUES ($1, $2, $3::jsonb, $4, NOW())
         ON CONFLICT (projection_name, key) DO UPDATE SET
           state = EXCLUDED.state,
           last_event_id = EXCLUDED.last_event_id,
           updated_at = NOW()`,
        [projectionName, key, JSON.stringify(state), eventId],
      );
    },

    async list<T = unknown>(
      projectionName: string,
      _filter: unknown,
      pageSize: number,
    ): Promise<T[]> {
      const result = await pool.query<{ state: T }>(
        `SELECT state FROM ${projTable}
         WHERE projection_name = $1
         ORDER BY updated_at DESC
         LIMIT $2`,
        [projectionName, pageSize],
      );
      return result.rows.map((r) => r.state);
    },

    async checkpoint(projectionName: string): Promise<string | null> {
      const result = await pool.query<{ last_event_id: string }>(
        `SELECT last_event_id FROM ${checkTable} WHERE projection_name = $1`,
        [projectionName],
      );
      if (result.rows.length === 0) return null;
      return result.rows[0]!.last_event_id;
    },

    async setCheckpoint(projectionName: string, eventId: string): Promise<void> {
      await pool.query(
        `INSERT INTO ${checkTable} (projection_name, last_event_id, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (projection_name) DO UPDATE SET
           last_event_id = EXCLUDED.last_event_id,
           updated_at = NOW()`,
        [projectionName, eventId],
      );
    },

    async truncate(projectionName: string): Promise<void> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query(`DELETE FROM ${projTable} WHERE projection_name = $1`, [projectionName]);
        await client.query(`DELETE FROM ${checkTable} WHERE projection_name = $1`, [
          projectionName,
        ]);
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },
  };
}
