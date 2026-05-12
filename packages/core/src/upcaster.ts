import type {
  AxisPolarity,
  CapturedEvaluatedReactionEvent,
  EvaluationVector,
  FeedbackEvent,
  Source,
} from "./event-types.js";
import { DEFAULT_ACTIONS, V1_ACTION_RENAMES } from "./registry/default-actions.js";

/**
 * An upcaster transforms an event from version N to version N+1.
 *
 * The framework's schema-evolution contract: events are immutable in storage,
 * but readers always see the current schema version. Upcasters chain so that
 * a reader at v3 can correctly interpret a v1 event written long ago, by
 * applying v1→v2 then v2→v3 at read time.
 *
 * Rules:
 * 1. Upcasters MUST be deterministic and pure (no I/O, no clock).
 * 2. fromVersion + 1 == toVersion. No version-skipping (chain instead).
 * 3. Upcasting is one-way: there is no downcaster path.
 *
 * Notes for v1 → v2.1:
 * - v1 stored a single flat event with `polarity` (scalar) and `inference`
 *   (scalar). v2 splits per-axis, embedded as columns on a reaction row.
 * - v1 had no notion of `captured_artifacts`; the migration that ships the
 *   v2 schema synthesizes a `captured_artifacts` row per artifact_id seen
 *   in the v1 event log. The synthesizer is invoked once at migration time;
 *   per-event upcasters only translate v1-event shape → v2 reaction-event
 *   shape.
 */
export interface EventUpcaster {
  fromVersion: number;
  toVersion: number;
  upcast(event: unknown): FeedbackEvent;
}

/**
 * Validate that a list of upcasters forms a contiguous chain ending at
 * currentSchemaVersion. Throws if any upcaster goes backwards / skips, or
 * if the registered chain has gaps below its top version.
 *
 * **Empty upcasters at `currentSchemaVersion > 1` are permitted.** This is
 * the common case for a fresh deployment that emits and reads only the
 * current schema. If you do want to read events from an older deploy,
 * register the chain explicitly.
 *
 * If upcasters ARE registered, the chain must be contiguous from
 * `lowest_fromVersion` up through `currentSchemaVersion - 1`. We do not
 * mandate that the chain start at v1 — a fresh deployment that wants to
 * read v2 and v3 events but doesn't care about v1 may register only the
 * v2 → v3 upcaster.
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
  if (upcasters.length === 0) {
    // No upcasters registered → consumer is opting out of cross-version
    // reads. Valid; we do not require a chain.
    return;
  }
  const sorted = [...upcasters].sort((a, b) => a.fromVersion - b.fromVersion);
  const start = sorted[0]!.fromVersion;
  const end = currentSchemaVersion - 1;
  for (let v = start; v <= end; v++) {
    const u = sorted[v - start];
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
 * Events already at currentSchemaVersion pass through unchanged. Events with
 * event_version > currentSchemaVersion (e.g., a reader on an older deploy)
 * throw — readers cannot downcast.
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
  const sorted = [...upcasters].sort((a, b) => a.fromVersion - b.fromVersion);
  let current: FeedbackEvent = event;
  for (let v = current.event_version; v < currentSchemaVersion; v++) {
    const u = sorted.find((x) => x.fromVersion === v);
    if (!u) {
      throw new Error(`No upcaster found for v${v} -> v${v + 1}`);
    }
    current = u.upcast(current);
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

// ---------- v1 → v2.1 upcaster --------------------------------------------

/**
 * Shape of v1 events as written by `@ai-feedback-middleware/core@0.2.x`.
 * Used only by the v1→v2.1 upcaster; consumers do not import this directly.
 */
interface V1FlatEvent {
  event_id: string;
  event_version: 1;
  timestamp: string;
  captured_at: string;
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
  provenance: {
    channel: string;
    instance_id?: string;
    latency_ms?: number;
    captured_by_adapter: string;
  };
  correction_of?: string;
  correlates_with?: string[];
}

/**
 * v1 → v2.1 per-event upcaster. Translates the flat v1 reaction shape into
 * the v2 `CapturedEvaluatedReactionEvent` shape, including:
 *
 * - Action rename (approve→approved, edit→manually_edited, etc.) per
 *   {@link V1_ACTION_RENAMES}.
 * - Polarity: scalar polarity is mapped onto the four-axis evaluation vector
 *   using a conservative heuristic — the renamed action's default
 *   evaluations from `DEFAULT_ACTIONS` are the source of truth, and the v1
 *   `polarity` is used only as a sanity check (mismatch is logged, not
 *   thrown).
 * - Inference (`whitelist`/`blacklist`/`observe`) is dropped: v2 inference
 *   is per-axis and lives in `actionability_decisions`, not on the event.
 *
 * Synthesizing missing `captured_artifacts` rows for v1 artifact_ids is a
 * separate migration concern (see `migrations/v1-to-v2.sql`); this upcaster
 * only handles per-event read-time translation.
 */
export const v1ToV2_1Upcaster: EventUpcaster = {
  fromVersion: 1,
  toVersion: 2,
  upcast(event: unknown): FeedbackEvent {
    const v1 = event as V1FlatEvent;
    if (v1.event_version !== 1) {
      throw new Error(`v1ToV2_1Upcaster expected event_version=1; got ${v1.event_version}`);
    }

    const renamedAction = V1_ACTION_RENAMES[v1.action] ?? v1.action;
    const evaluations = mapV1PolarityToEvaluations(v1.polarity, renamedAction);
    const source: Source = renamedAction === "corrected" ? "meta" : v1.source;

    const reaction: CapturedEvaluatedReactionEvent = {
      event_kind: "reaction",
      event_id: v1.event_id,
      event_version: 2,
      artifact_id: v1.artifact_id,
      artifact_type: v1.artifact_type,
      artifact_version: v1.artifact_version,
      partition_key: v1.partition_key,
      producer: v1.producer,
      task_type: v1.task_type,
      source,
      action: renamedAction,
      evaluations,
      classifier_version: "upcasted-v1",
      occurred_at: v1.timestamp,
      captured_at: v1.captured_at,
      payload: v1.payload,
      provenance: v1.provenance,
      ...(v1.correction_of !== undefined && { correction_of_event_id: v1.correction_of }),
    };

    return reaction;
  },
};

/**
 * Translate v1 scalar polarity onto a v2 per-axis evaluation vector.
 *
 * The v1 model collapsed four orthogonal axes into one bit, so a faithful
 * translation is impossible — but the *renamed* action carries default
 * heuristics that capture the same intent at the same fidelity v1 had. We
 * therefore use the renamed action's default-evaluation vector as the
 * baseline, and treat the v1 `polarity` as a tie-breaker only:
 *
 * - `polarity === "negative"` and the action's defaults are uniformly
 *   positive → drop to `{ content: 'negative' }` as the safest one-axis
 *   negative interpretation.
 * - Otherwise honor the action's default evaluations as authoritative.
 *
 * The `neutral` value disappears in v2.1 and translates to an empty vector.
 */
function mapV1PolarityToEvaluations(
  polarity: "positive" | "negative" | "neutral",
  renamedAction: string,
): EvaluationVector {
  if (polarity === "neutral") return {};

  // Look up the renamed action's default evaluations. Avoid a circular import
  // by resolving lazily through the registry shape.
  const defaults = lookupActionDefaults(renamedAction);
  if (!defaults) return polarityFallback(polarity);

  if (polarity === "negative" && allAxesPositive(defaults)) {
    return { content: "negative" };
  }
  return { ...defaults };
}

function lookupActionDefaults(actionName: string): EvaluationVector | undefined {
  const found = DEFAULT_ACTIONS.find((a) => a.name === actionName);
  return found?.defaultEvaluations;
}

function allAxesPositive(v: EvaluationVector): boolean {
  return (
    v.detection === "positive" &&
    v.content === "positive" &&
    v.timing === "positive" &&
    v.channel === "positive"
  );
}

function polarityFallback(polarity: "positive" | "negative"): EvaluationVector {
  // Custom action with no registered defaults: collapse to a single axis as
  // a best-effort signal. Content is the default carrier.
  const value: AxisPolarity = polarity;
  return { content: value };
}
