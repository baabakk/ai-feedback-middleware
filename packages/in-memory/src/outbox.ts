import type { OutboxPort, OutboxRow, FeedbackEvent } from "@ai-feedback-middleware/core";

interface Row {
  event_id: string;
  artifact_id: string;
  topics: string[];
  event: FeedbackEvent;
  enqueued_at: string;
  published_at: string | null;
  attempt_count: number;
  last_error: string | null;
  next_attempt_at: number; // epoch ms
}

/**
 * In-memory outbox. Mirrors the Postgres adapter's semantics for testing
 * and small single-process deployments.
 *
 * Caveat: not transactional with the in-memory event store (which has no
 * real transactions). Use the Postgres outbox for the at-least-once
 * delivery guarantee in production.
 */
export function createInMemoryOutbox(): OutboxPort {
  const rows = new Map<string, Row>();

  return {
    async enqueue(event, topics, artifact_id): Promise<void> {
      rows.set(event.event_id, {
        event_id: event.event_id,
        artifact_id,
        topics,
        event,
        enqueued_at: new Date().toISOString(),
        published_at: null,
        attempt_count: 0,
        last_error: null,
        next_attempt_at: Date.now(),
      });
    },

    async pickUnpublished(limit: number): Promise<OutboxRow[]> {
      const now = Date.now();
      const eligible = Array.from(rows.values())
        .filter((r) => r.published_at === null && r.next_attempt_at <= now)
        .sort((a, b) => a.enqueued_at.localeCompare(b.enqueued_at))
        .slice(0, limit);
      return eligible.map((r) => ({
        event_id: r.event_id,
        artifact_id: r.artifact_id,
        topics: r.topics,
        enqueued_at: r.enqueued_at,
        attempt_count: r.attempt_count,
        last_error: r.last_error,
        event: r.event,
      }));
    },

    async markPublished(eventId: string): Promise<void> {
      const row = rows.get(eventId);
      if (row) row.published_at = new Date().toISOString();
    },

    async markFailed(eventId: string, error: string, nextAttemptInMs: number): Promise<void> {
      const row = rows.get(eventId);
      if (!row) return;
      row.attempt_count++;
      row.last_error = error;
      row.next_attempt_at = Date.now() + nextAttemptInMs;
    },

    async backlogSize(): Promise<number> {
      let count = 0;
      for (const r of rows.values()) if (r.published_at === null) count++;
      return count;
    },

    async oldestUnpublishedAgeMs(): Promise<number | null> {
      let oldest: number | null = null;
      const nowMs = Date.now();
      for (const r of rows.values()) {
        if (r.published_at !== null) continue;
        const age = nowMs - Date.parse(r.enqueued_at);
        if (oldest === null || age > oldest) oldest = age;
      }
      return oldest;
    },
  };
}
