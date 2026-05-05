import type { Pool, PoolClient } from "pg";
import type {
  OutboxPort,
  OutboxRow,
  FeedbackEvent,
  Transaction,
} from "@llm-feedback-middleware/core";

export interface PostgresOutboxOptions {
  pool: Pool;
  /** Override the table name (default: `feedback_outbox`). */
  tableName?: string;
}

interface DbRow {
  event_id: string;
  topics: string[];
  event: FeedbackEvent;
  enqueued_at: Date;
  attempt_count: number;
  last_error: string | null;
}

export function createPostgresOutbox(options: PostgresOutboxOptions): OutboxPort {
  const pool = options.pool;
  const table = options.tableName ?? "feedback_outbox";

  function executor(tx?: Transaction): Pool | PoolClient {
    return (tx ?? pool) as Pool | PoolClient;
  }

  return {
    async enqueue(event: FeedbackEvent, topics: string[], tx?: Transaction): Promise<void> {
      await executor(tx).query(
        `INSERT INTO ${table} (event_id, topics, event)
         VALUES ($1, $2, $3::jsonb)`,
        [event.event_id, topics, JSON.stringify(event)],
      );
    },

    async pickUnpublished(limit: number): Promise<OutboxRow[]> {
      const result = await pool.query<DbRow>(
        `SELECT event_id, topics, event, enqueued_at, attempt_count, last_error
         FROM ${table}
         WHERE published_at IS NULL AND next_attempt_at <= NOW()
         ORDER BY enqueued_at ASC
         LIMIT $1`,
        [limit],
      );
      return result.rows.map((r) => ({
        event_id: r.event_id,
        topics: r.topics,
        enqueued_at: r.enqueued_at.toISOString(),
        attempt_count: r.attempt_count,
        last_error: r.last_error,
        event: r.event,
      }));
    },

    async markPublished(eventId: string): Promise<void> {
      await pool.query(`UPDATE ${table} SET published_at = NOW() WHERE event_id = $1`, [eventId]);
    },

    async markFailed(eventId: string, error: string, nextAttemptInMs: number): Promise<void> {
      await pool.query(
        `UPDATE ${table}
         SET attempt_count = attempt_count + 1,
             last_error = $2,
             next_attempt_at = NOW() + ($3::int || ' milliseconds')::interval
         WHERE event_id = $1`,
        [eventId, error, nextAttemptInMs],
      );
    },

    async backlogSize(): Promise<number> {
      const result = await pool.query<{ c: string }>(
        `SELECT COUNT(*)::text AS c FROM ${table} WHERE published_at IS NULL`,
      );
      return parseInt(result.rows[0]!.c, 10);
    },

    async oldestUnpublishedAgeMs(): Promise<number | null> {
      const result = await pool.query<{ ms: string | null }>(
        `SELECT EXTRACT(EPOCH FROM (NOW() - MIN(enqueued_at))) * 1000 AS ms
         FROM ${table} WHERE published_at IS NULL`,
      );
      const ms = result.rows[0]!.ms;
      return ms === null ? null : Math.floor(parseFloat(ms));
    },
  };
}
