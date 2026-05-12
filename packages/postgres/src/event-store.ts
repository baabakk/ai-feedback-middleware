import type { Pool, PoolClient } from "pg";
import type {
  CapturedArtifactEvent,
  CapturedEvaluatedReactionEvent,
  EventFilter,
  EventStorePort,
  FeedbackEvent,
  Transaction,
} from "@ai-feedback-middleware/core";
import { TOMBSTONE_ACTION_NAMES } from "@ai-feedback-middleware/core";

export interface PostgresEventStoreOptions {
  pool: Pool;
  /** Polling interval for subscribeAll. Default 500ms. */
  subscribePollMs?: number;
  /** Optional error callback fired when subscribeAll polling or handlers throw. */
  onError?: (err: unknown, context: { phase: "poll" | "handler" }) => void;
}

interface CaptureRow {
  event_id: string;
  event_version: number;
  event_position: string;
  artifact_id: string;
  artifact_type: string;
  artifact_version: number;
  partition_key: string;
  producer: string;
  task_type: string;
  payload: unknown;
  provenance: CapturedArtifactEvent["provenance"];
  expires_at: Date;
  occurred_at: Date;
  captured_at: Date;
  previous_artifact_id: string | null;
}

interface ReactionRow {
  event_id: string;
  event_version: number;
  event_position: string;
  artifact_id: string;
  artifact_type: string;
  artifact_version: number;
  partition_key: string;
  producer: string;
  task_type: string;
  source: "explicit" | "implicit" | "meta";
  action: string;
  occurred_at: Date;
  captured_at: Date;
  payload: unknown;
  provenance: CapturedEvaluatedReactionEvent["provenance"];
  classifier_version: string;
  detection_polarity: "positive" | "negative" | null;
  content_polarity: "positive" | "negative" | null;
  timing_polarity: "positive" | "negative" | null;
  channel_polarity: "positive" | "negative" | null;
  correction_of_event_id: string | null;
  successor_artifact_id: string | null;
}

function captureRowToEvent(row: CaptureRow): CapturedArtifactEvent {
  const out: CapturedArtifactEvent = {
    event_kind: "capture",
    event_id: row.event_id,
    event_version: row.event_version,
    artifact_id: row.artifact_id,
    artifact_type: row.artifact_type,
    artifact_version: row.artifact_version,
    partition_key: row.partition_key,
    producer: row.producer,
    task_type: row.task_type,
    expires_at: row.expires_at.toISOString(),
    occurred_at: row.occurred_at.toISOString(),
    captured_at: row.captured_at.toISOString(),
    payload: row.payload,
    provenance: row.provenance,
  };
  if (row.previous_artifact_id !== null) {
    out.previous_artifact_id = row.previous_artifact_id;
  }
  return out;
}

function reactionRowToEvent(row: ReactionRow): CapturedEvaluatedReactionEvent {
  const evaluations: CapturedEvaluatedReactionEvent["evaluations"] = {};
  if (row.detection_polarity !== null) evaluations.detection = row.detection_polarity;
  if (row.content_polarity !== null) evaluations.content = row.content_polarity;
  if (row.timing_polarity !== null) evaluations.timing = row.timing_polarity;
  if (row.channel_polarity !== null) evaluations.channel = row.channel_polarity;
  const out: CapturedEvaluatedReactionEvent = {
    event_kind: "reaction",
    event_id: row.event_id,
    event_version: row.event_version,
    artifact_id: row.artifact_id,
    artifact_type: row.artifact_type,
    artifact_version: row.artifact_version,
    partition_key: row.partition_key,
    producer: row.producer,
    task_type: row.task_type,
    source: row.source,
    action: row.action,
    evaluations,
    classifier_version: row.classifier_version,
    occurred_at: row.occurred_at.toISOString(),
    captured_at: row.captured_at.toISOString(),
    payload: row.payload,
    provenance: row.provenance,
  };
  if (row.correction_of_event_id !== null) out.correction_of_event_id = row.correction_of_event_id;
  if (row.successor_artifact_id !== null) out.successor_artifact_id = row.successor_artifact_id;
  return out;
}

async function appendCapture(
  client: Pool | PoolClient,
  event: CapturedArtifactEvent,
): Promise<void> {
  await client.query(
    `INSERT INTO captured_artifacts (
      artifact_id, artifact_type, artifact_version, partition_key,
      producer, task_type, payload, provenance,
      expires_at, occurred_at, captured_at,
      event_id, event_version, previous_artifact_id
    ) VALUES (
      $1, $2, $3, $4,
      $5, $6, $7, $8,
      $9, $10, $11,
      $12, $13, $14
    )`,
    [
      event.artifact_id,
      event.artifact_type,
      event.artifact_version,
      event.partition_key,
      event.producer,
      event.task_type,
      JSON.stringify(event.payload),
      JSON.stringify(event.provenance),
      event.expires_at,
      event.occurred_at,
      event.captured_at,
      event.event_id,
      event.event_version,
      event.previous_artifact_id ?? null,
    ],
  );
}

async function appendReaction(
  client: Pool | PoolClient,
  event: CapturedEvaluatedReactionEvent,
): Promise<void> {
  await client.query(
    `INSERT INTO captured_evaluated_reactions (
      event_id, event_version, artifact_id, artifact_type, artifact_version,
      partition_key, producer, task_type, source, action,
      occurred_at, captured_at, payload, provenance, classifier_version,
      detection_polarity, content_polarity, timing_polarity, channel_polarity,
      correction_of_event_id, successor_artifact_id
    ) VALUES (
      $1, $2, $3, $4, $5,
      $6, $7, $8, $9, $10,
      $11, $12, $13, $14, $15,
      $16, $17, $18, $19,
      $20, $21
    )`,
    [
      event.event_id,
      event.event_version,
      event.artifact_id,
      event.artifact_type,
      event.artifact_version,
      event.partition_key,
      event.producer,
      event.task_type,
      event.source,
      event.action,
      event.occurred_at,
      event.captured_at,
      JSON.stringify(event.payload),
      JSON.stringify(event.provenance),
      event.classifier_version,
      event.evaluations.detection ?? null,
      event.evaluations.content ?? null,
      event.evaluations.timing ?? null,
      event.evaluations.channel ?? null,
      event.correction_of_event_id ?? null,
      event.successor_artifact_id ?? null,
    ],
  );
}

export function createPostgresEventStore(options: PostgresEventStoreOptions): EventStorePort {
  const pool = options.pool;
  const pollMs = options.subscribePollMs ?? 500;
  const onError = options.onError;

  function executor(tx?: Transaction): Pool | PoolClient {
    return (tx ?? pool) as Pool | PoolClient;
  }

  async function appendInternal(client: Pool | PoolClient, event: FeedbackEvent): Promise<void> {
    if (event.event_kind === "capture") {
      await appendCapture(client, event);
    } else {
      await appendReaction(client, event);
    }
  }

  // Build a UNION ALL view of captures + reactions ordered by an interleaved
  // event_position. Both tables maintain their own BIGSERIAL; the unioned
  // ordering interleaves them by capture / reaction insertion order.
  function unionSelectAndOrderBy(): string {
    return `
      SELECT 'capture' AS kind, event_position, ca.event_id, ca.partition_key,
             ca.producer, ca.task_type, ca.artifact_type, ca.artifact_id,
             ca.artifact_version, ca.occurred_at, NULL::TEXT AS source,
             NULL::TEXT AS action
      FROM captured_artifacts ca
      UNION ALL
      SELECT 'reaction' AS kind, event_position, cer.event_id, cer.partition_key,
             cer.producer, cer.task_type, cer.artifact_type, cer.artifact_id,
             cer.artifact_version, cer.occurred_at, cer.source, cer.action
      FROM captured_evaluated_reactions cer
    `;
  }

  function buildFilterPredicate(filter: EventFilter | undefined): {
    sql: string;
    params: unknown[];
  } {
    if (!filter) return { sql: "", params: [] };
    const conditions: string[] = [];
    const params: unknown[] = [];
    function add(col: string, val: unknown): void {
      params.push(val);
      conditions.push(`${col} = $${params.length}`);
    }
    if (filter.event_kind !== undefined) add("kind", filter.event_kind);
    if (filter.action !== undefined) add("action", filter.action);
    if (filter.source !== undefined) add("source", filter.source);
    if (filter.artifact_type !== undefined) add("artifact_type", filter.artifact_type);
    if (filter.artifact_id !== undefined) add("artifact_id", filter.artifact_id);
    if (filter.producer !== undefined) add("producer", filter.producer);
    if (filter.task_type !== undefined) add("task_type", filter.task_type);
    if (filter.partition_key !== undefined) add("partition_key", filter.partition_key);
    if (filter.from_timestamp !== undefined) {
      params.push(filter.from_timestamp);
      conditions.push(`occurred_at >= $${params.length}`);
    }
    if (filter.to_timestamp !== undefined) {
      params.push(filter.to_timestamp);
      conditions.push(`occurred_at <= $${params.length}`);
    }
    return {
      sql: conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "",
      params,
    };
  }

  async function fetchEventByKind(
    kind: "capture" | "reaction",
    eventId: string,
  ): Promise<FeedbackEvent | null> {
    if (kind === "capture") {
      const r = await pool.query<CaptureRow>(
        `SELECT * FROM captured_artifacts WHERE event_id = $1`,
        [eventId],
      );
      return r.rows[0] ? captureRowToEvent(r.rows[0]) : null;
    }
    const r = await pool.query<ReactionRow>(
      `SELECT * FROM captured_evaluated_reactions WHERE event_id = $1`,
      [eventId],
    );
    return r.rows[0] ? reactionRowToEvent(r.rows[0]) : null;
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
      const versionFilter = fromVersion !== undefined ? `AND artifact_version >= $2` : "";
      const params: unknown[] = [partitionKey];
      if (fromVersion !== undefined) params.push(fromVersion);

      const captureRes = await pool.query<CaptureRow>(
        `SELECT * FROM captured_artifacts
         WHERE partition_key = $1 ${versionFilter}
         ORDER BY event_position ASC`,
        params,
      );
      const reactionRes = await pool.query<ReactionRow>(
        `SELECT * FROM captured_evaluated_reactions
         WHERE partition_key = $1 ${versionFilter}
         ORDER BY event_position ASC`,
        params,
      );

      // Merge by event_position numerically. Each table's BIGSERIAL is
      // independent, so we interleave by order of insertion timestamp
      // (occurred_at) which is monotonic per consumer flow.
      const captures = captureRes.rows.map(captureRowToEvent);
      const reactions = reactionRes.rows.map(reactionRowToEvent);
      const merged: FeedbackEvent[] = [...captures, ...reactions].sort((a, b) =>
        a.occurred_at.localeCompare(b.occurred_at),
      );
      for (const e of merged) yield e;
    },

    async *readStreamSince(
      partitionKey: string,
      sinceTimestamp: string,
    ): AsyncIterable<FeedbackEvent> {
      const captureRes = await pool.query<CaptureRow>(
        `SELECT * FROM captured_artifacts
         WHERE partition_key = $1 AND occurred_at >= $2
         ORDER BY event_position ASC`,
        [partitionKey, sinceTimestamp],
      );
      const reactionRes = await pool.query<ReactionRow>(
        `SELECT * FROM captured_evaluated_reactions
         WHERE partition_key = $1 AND occurred_at >= $2
         ORDER BY event_position ASC`,
        [partitionKey, sinceTimestamp],
      );
      const merged: FeedbackEvent[] = [
        ...captureRes.rows.map(captureRowToEvent),
        ...reactionRes.rows.map(reactionRowToEvent),
      ].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
      for (const e of merged) yield e;
    },

    async *readAll(filter?: EventFilter, _pageSize = 500): AsyncIterable<FeedbackEvent> {
      const { sql: where, params } = buildFilterPredicate(filter);
      const result = await pool.query<{
        kind: "capture" | "reaction";
        event_id: string;
      }>(
        `WITH unioned AS (${unionSelectAndOrderBy()})
         SELECT kind, event_id FROM unioned ${where}
         ORDER BY occurred_at ASC, event_position ASC`,
        params,
      );
      for (const row of result.rows) {
        const event = await fetchEventByKind(row.kind, row.event_id);
        if (event) yield event;
      }
    },

    subscribeAll(
      handler: (event: FeedbackEvent) => Promise<void>,
      _fromPosition?: string,
    ): () => Promise<void> {
      let stopped = false;
      let lastSeen = "1970-01-01T00:00:00Z";
      const interval = setInterval(async () => {
        if (stopped) return;
        try {
          const captureRes = await pool.query<CaptureRow>(
            `SELECT * FROM captured_artifacts
             WHERE captured_at > $1 ORDER BY captured_at ASC LIMIT 100`,
            [lastSeen],
          );
          const reactionRes = await pool.query<ReactionRow>(
            `SELECT * FROM captured_evaluated_reactions
             WHERE captured_at > $1 ORDER BY captured_at ASC LIMIT 100`,
            [lastSeen],
          );
          const merged: FeedbackEvent[] = [
            ...captureRes.rows.map(captureRowToEvent),
            ...reactionRes.rows.map(reactionRowToEvent),
          ].sort((a, b) => a.captured_at.localeCompare(b.captured_at));
          for (const event of merged) {
            if (stopped) break;
            try {
              await handler(event);
            } catch (err) {
              if (onError) onError(err, { phase: "handler" });
            }
            if (event.captured_at > lastSeen) lastSeen = event.captured_at;
          }
        } catch (err) {
          if (onError) onError(err, { phase: "poll" });
        }
      }, pollMs);

      return async () => {
        stopped = true;
        clearInterval(interval);
      };
    },

    async readRecentReactions(input): Promise<CapturedEvaluatedReactionEvent[]> {
      const params: unknown[] = [input.partition_key, input.since_timestamp];
      let typeFilter = "";
      if (input.artifact_type !== undefined) {
        params.push(input.artifact_type);
        typeFilter = `AND artifact_type = $3`;
      }
      const client = (input.tx as PoolClient | undefined) ?? pool;
      const result = await client.query<ReactionRow>(
        `SELECT * FROM captured_evaluated_reactions
         WHERE partition_key = $1 AND occurred_at >= $2 ${typeFilter}
         ORDER BY event_position ASC`,
        params,
      );
      return result.rows.map(reactionRowToEvent);
    },

    async readTombstonedArtifactIds(input): Promise<Set<string>> {
      if (input.candidate_artifact_ids.length === 0) return new Set();
      const tombstoneList = TOMBSTONE_ACTION_NAMES as readonly string[];
      const client = (input.tx as PoolClient | undefined) ?? pool;
      const result = await client.query<{ artifact_id: string }>(
        `SELECT DISTINCT artifact_id FROM captured_evaluated_reactions
         WHERE artifact_id = ANY($1::text[]) AND action = ANY($2::text[])`,
        [input.candidate_artifact_ids, tombstoneList],
      );
      return new Set(result.rows.map((r) => r.artifact_id));
    },
  };
}
