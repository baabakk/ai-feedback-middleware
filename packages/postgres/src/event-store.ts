import type { Pool, PoolClient } from "pg";
import type {
  EventStorePort,
  FeedbackEvent,
  EventFilter,
  Transaction,
} from "@llm-feedback-middleware/core";

export interface PostgresEventStoreOptions {
  pool: Pool;
  /** Override the table name (default: `feedback_events`). Useful for multi-tenant prefixing. */
  tableName?: string;
  /** Polling interval for subscribeAll. Default 500ms. */
  subscribePollMs?: number;
}

interface EventRow {
  event_id: string;
  event_version: number;
  event_position: string; // bigint as string
  timestamp: Date;
  captured_at: Date;
  partition_key: string;
  source: "explicit" | "implicit";
  polarity: "positive" | "negative" | "neutral";
  inference: "whitelist" | "blacklist" | "observe";
  action: string;
  artifact_type: string;
  artifact_id: string;
  artifact_version: number;
  producer: string;
  task_type: string;
  payload: unknown;
  provenance: FeedbackEvent["provenance"];
  correction_of: string | null;
  correlates_with: string[] | null;
}

function rowToEvent(row: EventRow): FeedbackEvent {
  const event: FeedbackEvent = {
    event_id: row.event_id,
    event_version: row.event_version,
    timestamp: row.timestamp.toISOString(),
    captured_at: row.captured_at.toISOString(),
    partition_key: row.partition_key,
    source: row.source,
    polarity: row.polarity,
    inference: row.inference,
    action: row.action,
    artifact_type: row.artifact_type,
    artifact_id: row.artifact_id,
    artifact_version: row.artifact_version,
    producer: row.producer,
    task_type: row.task_type,
    payload: row.payload,
    provenance: row.provenance,
  };
  if (row.correction_of !== null) {
    event.correction_of = row.correction_of;
  }
  if (row.correlates_with && row.correlates_with.length > 0) {
    event.correlates_with = row.correlates_with;
  }
  return event;
}

export function createPostgresEventStore(options: PostgresEventStoreOptions): EventStorePort {
  const pool = options.pool;
  const table = options.tableName ?? "feedback_events";
  const pollMs = options.subscribePollMs ?? 500;

  function buildWhere(filter?: EventFilter): { where: string; params: unknown[] } {
    if (!filter) return { where: "", params: [] };
    const conditions: string[] = [];
    const params: unknown[] = [];
    function add(col: string, val: unknown): void {
      params.push(val);
      conditions.push(`${col} = $${params.length}`);
    }
    if (filter.source !== undefined) add("source", filter.source);
    if (filter.polarity !== undefined) add("polarity", filter.polarity);
    if (filter.inference !== undefined) add("inference", filter.inference);
    if (filter.action !== undefined) add("action", filter.action);
    if (filter.artifact_type !== undefined) add("artifact_type", filter.artifact_type);
    if (filter.producer !== undefined) add("producer", filter.producer);
    if (filter.task_type !== undefined) add("task_type", filter.task_type);
    if (filter.partition_key !== undefined) add("partition_key", filter.partition_key);
    if (filter.from_timestamp !== undefined) {
      params.push(filter.from_timestamp);
      conditions.push(`timestamp >= $${params.length}`);
    }
    if (filter.to_timestamp !== undefined) {
      params.push(filter.to_timestamp);
      conditions.push(`timestamp <= $${params.length}`);
    }
    return {
      where: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
      params,
    };
  }

  function executor(tx?: Transaction): Pool | PoolClient {
    return (tx ?? pool) as Pool | PoolClient;
  }

  async function appendInternal(client: Pool | PoolClient, event: FeedbackEvent): Promise<void> {
    await client.query(
      `INSERT INTO ${table} (
        event_id, event_version, timestamp, captured_at, partition_key,
        source, polarity, inference, action,
        artifact_type, artifact_id, artifact_version, producer, task_type,
        payload, provenance, correction_of, correlates_with
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9,
        $10, $11, $12, $13, $14,
        $15, $16, $17, $18
      )`,
      [
        event.event_id,
        event.event_version,
        event.timestamp,
        event.captured_at,
        event.partition_key,
        event.source,
        event.polarity,
        event.inference,
        event.action,
        event.artifact_type,
        event.artifact_id,
        event.artifact_version,
        event.producer,
        event.task_type,
        JSON.stringify(event.payload),
        JSON.stringify(event.provenance),
        event.correction_of ?? null,
        event.correlates_with ?? null,
      ],
    );
  }

  return {
    async withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    },

    async append(event: FeedbackEvent, tx?: Transaction): Promise<void> {
      await appendInternal(executor(tx), event);
    },

    async appendBatch(batch: FeedbackEvent[], tx?: Transaction): Promise<void> {
      if (batch.length === 0) return;
      const ownClient = !tx;
      const client = ownClient ? await pool.connect() : (tx as PoolClient);
      try {
        if (ownClient) await client.query("BEGIN");
        for (const event of batch) {
          await appendInternal(client, event);
        }
        if (ownClient) await client.query("COMMIT");
      } catch (err) {
        if (ownClient) await client.query("ROLLBACK");
        throw err;
      } finally {
        if (ownClient) client.release();
      }
    },

    async *readStream(partitionKey: string, fromVersion?: number): AsyncIterable<FeedbackEvent> {
      const params: unknown[] = [partitionKey];
      let where = "WHERE partition_key = $1";
      if (fromVersion !== undefined) {
        params.push(fromVersion);
        where += ` AND artifact_version >= $${params.length}`;
      }
      const result = await pool.query<EventRow>(
        `SELECT * FROM ${table} ${where} ORDER BY event_position ASC`,
        params,
      );
      for (const row of result.rows) {
        yield rowToEvent(row);
      }
    },

    async *readAll(filter?: EventFilter, pageSize = 500): AsyncIterable<FeedbackEvent> {
      const { where, params } = buildWhere(filter);
      let lastPos = "0";
      while (true) {
        const queryParams = [...params, lastPos, pageSize];
        const posPlaceholder = `$${params.length + 1}`;
        const limitPlaceholder = `$${params.length + 2}`;
        const sql = `
          SELECT * FROM ${table}
          ${where}
          ${where ? "AND" : "WHERE"} event_position > ${posPlaceholder}
          ORDER BY event_position ASC
          LIMIT ${limitPlaceholder}
        `;
        const result = await pool.query<EventRow>(sql, queryParams);
        if (result.rows.length === 0) return;
        for (const row of result.rows) {
          yield rowToEvent(row);
          lastPos = row.event_position;
        }
        if (result.rows.length < pageSize) return;
      }
    },

    subscribeAll(
      handler: (event: FeedbackEvent) => Promise<void>,
      _fromPosition?: string,
    ): () => Promise<void> {
      let stopped = false;
      let lastPos = "0";
      const interval = setInterval(async () => {
        if (stopped) return;
        try {
          const result = await pool.query<EventRow>(
            `SELECT * FROM ${table} WHERE event_position > $1
             ORDER BY event_position ASC LIMIT 100`,
            [lastPos],
          );
          for (const row of result.rows) {
            if (stopped) break;
            await handler(rowToEvent(row));
            lastPos = row.event_position;
          }
        } catch {
          // Swallow errors so a transient DB hiccup does not kill the loop.
        }
      }, pollMs);

      return async () => {
        stopped = true;
        clearInterval(interval);
      };
    },
  };
}
