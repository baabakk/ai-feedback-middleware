import type {
  CapturedArtifactEvent,
  CapturedEvaluatedReactionEvent,
  FeedbackEvent,
} from "@ai-feedback-middleware/core";

/** Build a v2.1 reaction event for conformance suites. */
export function makeReaction(
  overrides: Partial<CapturedEvaluatedReactionEvent> = {},
): CapturedEvaluatedReactionEvent {
  const id = overrides.event_id ?? `e-${Math.random().toString(36).slice(2, 10)}`;
  const artifactId = overrides.artifact_id ?? "p-1";
  return {
    event_kind: "reaction",
    event_id: id,
    event_version: 2,
    artifact_id: artifactId,
    artifact_type: "draft_email",
    artifact_version: 1,
    partition_key: artifactId,
    producer: "test",
    task_type: "test_task",
    source: "explicit",
    action: "approved",
    evaluations: {
      detection: "positive",
      content: "positive",
      timing: "positive",
      channel: "positive",
    },
    classifier_version: "test-2.1",
    occurred_at: "2026-04-24T00:00:00Z",
    captured_at: "2026-04-24T00:00:00Z",
    payload: {},
    provenance: { channel: "test", captured_by_adapter: "test" },
    ...overrides,
  };
}

/** Build a v2.1 capture event for conformance suites. */
export function makeCapture(
  overrides: Partial<CapturedArtifactEvent> = {},
): CapturedArtifactEvent {
  const id = overrides.event_id ?? `e-${Math.random().toString(36).slice(2, 10)}`;
  const artifactId = overrides.artifact_id ?? "p-1";
  return {
    event_kind: "capture",
    event_id: id,
    event_version: 2,
    artifact_id: artifactId,
    artifact_type: "draft_email",
    artifact_version: 1,
    partition_key: artifactId,
    producer: "test",
    task_type: "test_task",
    expires_at: "2026-04-25T00:00:00Z",
    occurred_at: "2026-04-24T00:00:00Z",
    captured_at: "2026-04-24T00:00:00Z",
    payload: {},
    provenance: { channel: "test", captured_by_adapter: "test" },
    ...overrides,
  };
}

/**
 * @deprecated Use {@link makeReaction}. The v1 `makeEvent` produced a flat
 * shape that no longer compiles in 2.1; this alias just delegates.
 */
export function makeEvent(overrides: Partial<CapturedEvaluatedReactionEvent> = {}): FeedbackEvent {
  return makeReaction(overrides);
}

export async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}
