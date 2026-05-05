import type { FeedbackEvent } from "./event-types.js";

/**
 * An upcaster transforms an event from version N to version N+1.
 *
 * The framework's schema-evolution contract: events are immutable in storage,
 * but readers always see the current schema version. Upcasters chain so that
 * a reader of v3 can correctly interpret a v1 event written long ago, by
 * applying v1→v2 then v2→v3 at read time.
 *
 * Critical rules:
 * 1. Upcasters MUST be deterministic and pure (no I/O, no clock).
 * 2. fromVersion + 1 == toVersion. No version-skipping (chain instead).
 * 3. Upcasting is one-way: there is no downcaster path.
 */
export interface EventUpcaster {
  fromVersion: number;
  toVersion: number;
  upcast(event: FeedbackEvent): FeedbackEvent;
}

/**
 * Validate that a list of upcasters forms a contiguous chain starting at
 * version 1 and ending at currentSchemaVersion. Throws if there's a gap or
 * if any upcaster goes backwards / skips.
 */
export function validateUpcasterChain(
  upcasters: EventUpcaster[],
  currentSchemaVersion: number,
): void {
  if (currentSchemaVersion < 1) {
    throw new Error(`currentSchemaVersion must be >= 1; got ${currentSchemaVersion}`);
  }
  if (currentSchemaVersion === 1) {
    if (upcasters.length > 0) {
      throw new Error(
        `currentSchemaVersion is 1 but ${upcasters.length} upcasters were registered`,
      );
    }
    return;
  }
  // Sort defensively in case the consumer registers out of order.
  const sorted = [...upcasters].sort((a, b) => a.fromVersion - b.fromVersion);

  for (let v = 1; v < currentSchemaVersion; v++) {
    const u = sorted[v - 1];
    if (!u) {
      throw new Error(
        `Missing upcaster from v${v} to v${v + 1}. Registered: ${upcasters
          .map((x) => `v${x.fromVersion}->v${x.toVersion}`)
          .join(", ")}`,
      );
    }
    if (u.fromVersion !== v || u.toVersion !== v + 1) {
      throw new Error(`Expected upcaster v${v}->v${v + 1}, got v${u.fromVersion}->v${u.toVersion}`);
    }
  }
}

/**
 * Apply the upcaster chain to bring an event up to currentSchemaVersion.
 *
 * Events already at currentSchemaVersion pass through unchanged. Events
 * with event_version > currentSchemaVersion (e.g., a reader on an older
 * deploy) throw — readers cannot downcast.
 */
export function upcastEvent(
  event: FeedbackEvent,
  upcasters: EventUpcaster[],
  currentSchemaVersion: number,
): FeedbackEvent {
  if (event.event_version === currentSchemaVersion) return event;
  if (event.event_version > currentSchemaVersion) {
    throw new Error(
      `Cannot read event ${event.event_id} written at v${event.event_version}` +
        ` when reader's currentSchemaVersion is ${currentSchemaVersion}.` +
        ` Downcasting is not supported; upgrade the reader.`,
    );
  }
  // Walk forward from event.event_version to currentSchemaVersion.
  const sorted = [...upcasters].sort((a, b) => a.fromVersion - b.fromVersion);
  let current = event;
  for (let v = current.event_version; v < currentSchemaVersion; v++) {
    const u = sorted.find((x) => x.fromVersion === v);
    if (!u) {
      throw new Error(`No upcaster found for v${v} -> v${v + 1}`);
    }
    current = u.upcast(current);
    // Defensive: ensure the upcaster updated the version stamp.
    if (current.event_version !== v + 1) {
      throw new Error(
        `Upcaster v${v}->v${v + 1} did not update event_version (still ${current.event_version})`,
      );
    }
  }
  return current;
}

/**
 * Wrap an AsyncIterable<FeedbackEvent> so every yielded event is upcast to
 * the current schema version. Used by createFeedback's read paths so callers
 * always see the current shape.
 */
export async function* upcastStream(
  source: AsyncIterable<FeedbackEvent>,
  upcasters: EventUpcaster[],
  currentSchemaVersion: number,
): AsyncIterable<FeedbackEvent> {
  for await (const event of source) {
    yield upcastEvent(event, upcasters, currentSchemaVersion);
  }
}
