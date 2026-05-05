import type {
  EventStorePort,
  FeedbackEvent,
  EventFilter,
  Transaction,
} from "@llm-feedback-middleware/core";

export interface InMemoryEventStoreOptions {
  /** Optional initial events (useful for tests). */
  seed?: FeedbackEvent[];
}

interface StoredEvent {
  event: FeedbackEvent;
  position: number;
}

export function createInMemoryEventStore(options: InMemoryEventStoreOptions = {}): EventStorePort {
  const events: StoredEvent[] = (options.seed ?? []).map((e, idx) => ({
    event: e,
    position: idx + 1,
  }));
  let nextPosition = events.length + 1;

  const subscribers = new Set<(event: FeedbackEvent) => Promise<void>>();

  function matchesFilter(event: FeedbackEvent, filter?: EventFilter): boolean {
    if (!filter) return true;
    if (filter.source !== undefined && event.source !== filter.source) return false;
    if (filter.polarity !== undefined && event.polarity !== filter.polarity) return false;
    if (filter.inference !== undefined && event.inference !== filter.inference) return false;
    if (filter.action !== undefined && event.action !== filter.action) return false;
    if (filter.artifact_type !== undefined && event.artifact_type !== filter.artifact_type)
      return false;
    if (filter.producer !== undefined && event.producer !== filter.producer) return false;
    if (filter.task_type !== undefined && event.task_type !== filter.task_type) return false;
    if (filter.partition_key !== undefined && event.partition_key !== filter.partition_key)
      return false;
    if (filter.from_timestamp !== undefined && event.timestamp < filter.from_timestamp)
      return false;
    if (filter.to_timestamp !== undefined && event.timestamp > filter.to_timestamp) return false;
    return true;
  }

  return {
    async withTransaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
      // No real transactions in-memory; treat the work block as atomic-by-fiat.
      return work(undefined);
    },

    async append(event: FeedbackEvent): Promise<void> {
      events.push({ event, position: nextPosition++ });
      // Notify subscribers serially so handler errors propagate predictably in tests.
      for (const handler of subscribers) {
        await handler(event);
      }
    },

    async appendBatch(batch: FeedbackEvent[]): Promise<void> {
      for (const event of batch) {
        events.push({ event, position: nextPosition++ });
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
          const t = Date.parse(s.event.timestamp);
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
  };
}
