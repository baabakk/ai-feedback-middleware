import type { FeedbackEvent } from "./event-types.js";
import type { ProjectionStorePort } from "./ports/projection-store-port.js";
import type { Transaction } from "./ports/event-store-port.js";

/**
 * A projection builder defines how an event mutates derived state.
 *
 * - `name`: unique projection identifier
 * - `mode`: `sync` (applied in capture transaction) or `async` (via bus subscriber)
 * - `applies(event)`: filter — does this event affect this projection?
 * - `keyFor(event)`: which projection-store key this event targets (default: event.partition_key)
 * - `apply(event, currentState)`: returns new state given the event and prior state
 * - `applyCorrection`: optional, defines how a correction event reverses the original
 */
export interface ProjectionBuilder<TState = unknown> {
  name: string;
  mode: "sync" | "async";
  applies(event: FeedbackEvent): boolean;
  keyFor?(event: FeedbackEvent): string;
  apply(event: FeedbackEvent, currentState: TState | null): TState;
  applyCorrection?(
    originalEvent: FeedbackEvent,
    correctionEvent: FeedbackEvent,
    currentState: TState,
  ): TState;
}

export class ProjectionEngine {
  constructor(
    private readonly store: ProjectionStorePort,
    private readonly builders: ProjectionBuilder[],
  ) {}

  /** Apply an event to all matching sync projections, optionally inside a transaction. */
  async applySync(event: FeedbackEvent, tx?: Transaction): Promise<void> {
    for (const builder of this.builders) {
      if (builder.mode !== "sync" || !builder.applies(event)) continue;
      const key = builder.keyFor ? builder.keyFor(event) : event.partition_key;
      const current = await this.store.get(builder.name, key, tx);
      const next = builder.apply(event, current);
      await this.store.put(builder.name, key, next, event.event_id, tx);
    }
  }

  /** Apply an event to all matching async projections (called by bus subscribers). */
  async applyAsync(event: FeedbackEvent): Promise<void> {
    for (const builder of this.builders) {
      if (builder.mode !== "async" || !builder.applies(event)) continue;
      const key = builder.keyFor ? builder.keyFor(event) : event.partition_key;
      const current = await this.store.get(builder.name, key);
      const next = builder.apply(event, current);
      await this.store.put(builder.name, key, next, event.event_id);
    }
  }

  /** Get all registered builder names (for rebuildProjection). */
  builderNames(): string[] {
    return this.builders.map((b) => b.name);
  }

  /** Find a builder by name; throws if not registered. */
  builderByName(name: string): ProjectionBuilder {
    const builder = this.builders.find((b) => b.name === name);
    if (!builder) {
      throw new Error(`Unknown projection: ${name}. Registered: ${this.builderNames().join(", ")}`);
    }
    return builder;
  }

  /** Rebuild a single projection from a stream of events. */
  async rebuild(
    name: string,
    events: AsyncIterable<FeedbackEvent>,
  ): Promise<{ eventsProcessed: number }> {
    const builder = this.builderByName(name);
    await this.store.truncate(name);
    let count = 0;
    let lastEventId: string | null = null;
    for await (const event of events) {
      if (!builder.applies(event)) continue;
      const key = builder.keyFor ? builder.keyFor(event) : event.partition_key;
      const current = await this.store.get(builder.name, key);
      const next = builder.apply(event, current);
      await this.store.put(builder.name, key, next, event.event_id);
      count += 1;
      lastEventId = event.event_id;
    }
    if (lastEventId) {
      await this.store.setCheckpoint(name, lastEventId);
    }
    return { eventsProcessed: count };
  }
}
