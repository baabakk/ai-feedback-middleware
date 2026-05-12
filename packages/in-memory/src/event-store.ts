import type {
  CapturedEvaluatedReactionEvent,
  EventFilter,
  EventStorePort,
  FeedbackEvent,
  Transaction,
} from "@ai-feedback-middleware/core";
import { TOMBSTONE_ACTION_NAMES } from "@ai-feedback-middleware/core";

export interface InMemoryEventStoreOptions {
  /** Optional initial events (useful for tests). */
  seed?: FeedbackEvent[];
  /**
   * Optional ring-buffer cap. When set, the store keeps at most `maxEvents`
   * entries; oldest events are evicted in append-order to make room. Defaults
   * to unbounded.
   *
   * **Use with care.** Eviction breaks the event-sourcing replay contract:
   * once an event has been evicted, projections rebuilt from the log will be
   * incomplete. The in-memory store is intended for tests and toy
   * single-process deployments; for any production workload that relies on
   * replay, use the Postgres adapter.
   */
  maxEvents?: number;
}

interface StoredEvent {
  event: FeedbackEvent;
  position: number;
}

export function createInMemoryEventStore(options: InMemoryEventStoreOptions = {}): EventStorePort {
  const maxEvents = options.maxEvents;
  if (maxEvents !== undefined && (!Number.isInteger(maxEvents) || maxEvents <= 0)) {
    throw new Error(
      `createInMemoryEventStore: maxEvents must be a positive integer, got ${String(maxEvents)}`,
    );
  }
  const events: StoredEvent[] = (options.seed ?? []).map((e, idx) => ({
    event: e,
    position: idx + 1,
  }));
  let nextPosition = events.length + 1;

  function maybeEvict(): void {
    if (maxEvents === undefined) return;
    while (events.length > maxEvents) {
      events.shift();
    }
  }
  maybeEvict();

  const subscribers = new Set<(event: FeedbackEvent) => Promise<void>>();

  function eventTimestamp(event: FeedbackEvent): string {
    return event.occurred_at;
  }

  function matchesFilter(event: FeedbackEvent, filter?: EventFilter): boolean {
    if (!filter) return true;
    if (filter.event_kind !== undefined && event.event_kind !== filter.event_kind) return false;
    if (filter.action !== undefined) {
      if (event.event_kind !== "reaction" || event.action !== filter.action) return false;
    }
    if (filter.source !== undefined) {
      if (event.event_kind !== "reaction" || event.source !== filter.source) return false;
    }
    if (filter.artifact_type !== undefined && event.artifact_type !== filter.artifact_type) {
      return false;
    }
    if (filter.artifact_id !== undefined && event.artifact_id !== filter.artifact_id) {
      return false;
    }
    if (filter.producer !== undefined && event.producer !== filter.producer) return false;
    if (filter.task_type !== undefined && event.task_type !== filter.task_type) return false;
    if (filter.partition_key !== undefined && event.partition_key !== filter.partition_key) {
      return false;
    }
    const ts = eventTimestamp(event);
    if (filter.from_timestamp !== undefined && ts < filter.from_timestamp) return false;
    if (filter.to_timestamp !== undefined && ts > filter.to_timestamp) return false;
    return true;
  }

  return {
    async withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
      return work(undefined);
    },

    async append(event: FeedbackEvent): Promise<void> {
      events.push({ event, position: nextPosition++ });
      maybeEvict();
      for (const handler of subscribers) {
        await handler(event);
      }
    },

    async appendBatch(batch: FeedbackEvent[]): Promise<void> {
      for (const event of batch) {
        events.push({ event, position: nextPosition++ });
        maybeEvict();
        for (const handler of subscribers) {
          await handler(event);
        }
      }
    },

    async *readStream(partitionKey: string, fromVersion?: number): AsyncIterable<FeedbackEvent> {
      const filtered = events
        .filter((s) => s.event.partition_key === partitionKey)
        .filter((s) => fromVersion === undefined || s.event.artifact_version >= fromVersion)
        .sort((a, b) => a.position - b.position);
      for (const stored of filtered) {
        yield stored.event;
      }
    },

    async *readStreamSince(
      partitionKey: string,
      sinceTimestamp: string,
    ): AsyncIterable<FeedbackEvent> {
      const cutoff = Date.parse(sinceTimestamp);
      const filtered = events
        .filter((s) => s.event.partition_key === partitionKey)
        .filter((s) => {
          const t = Date.parse(eventTimestamp(s.event));
          if (Number.isNaN(t)) return false;
          return t >= cutoff;
        })
        .sort((a, b) => a.position - b.position);
      for (const stored of filtered) {
        yield stored.event;
      }
    },

    async *readAll(filter?: EventFilter, _pageSize?: number): AsyncIterable<FeedbackEvent> {
      const filtered = events
        .filter((s) => matchesFilter(s.event, filter))
        .sort((a, b) => a.position - b.position);
      for (const stored of filtered) {
        yield stored.event;
      }
    },

    subscribeAll(
      handler: (event: FeedbackEvent) => Promise<void>,
      _fromPosition?: string,
    ): () => Promise<void> {
      subscribers.add(handler);
      return async () => {
        subscribers.delete(handler);
      };
    },

    async readRecentReactions(input: {
      partition_key: string;
      artifact_type?: string;
      since_timestamp: string;
    }): Promise<CapturedEvaluatedReactionEvent[]> {
      const cutoff = Date.parse(input.since_timestamp);
      const out: CapturedEvaluatedReactionEvent[] = [];
      for (const s of events) {
        const ev = s.event;
        if (ev.event_kind !== "reaction") continue;
        if (ev.partition_key !== input.partition_key) continue;
        if (input.artifact_type !== undefined && ev.artifact_type !== input.artifact_type) continue;
        const t = Date.parse(ev.occurred_at);
        if (Number.isNaN(t) || t < cutoff) continue;
        out.push(ev);
      }
      out.sort(
        (a, b) =>
          (events.find((s) => s.event === a)?.position ?? 0) -
          (events.find((s) => s.event === b)?.position ?? 0),
      );
      return out;
    },

    async readTombstonedArtifactIds(input: {
      candidate_artifact_ids: string[];
    }): Promise<Set<string>> {
      const candidateSet = new Set(input.candidate_artifact_ids);
      const tombstoned = new Set<string>();
      for (const s of events) {
        const ev = s.event;
        if (ev.event_kind !== "reaction") continue;
        if (!candidateSet.has(ev.artifact_id)) continue;
        if (TOMBSTONE_ACTION_NAMES.includes(ev.action as never)) {
          tombstoned.add(ev.artifact_id);
        }
      }
      return tombstoned;
    },
  };
}
