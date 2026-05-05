import type { FeedbackEvent } from "@llm-feedback-middleware/core";

export function makeEvent(overrides: Partial<FeedbackEvent> = {}): FeedbackEvent {
  const id = overrides.event_id ?? `e-${Math.random().toString(36).slice(2, 10)}`;
  return {
    event_id: id,
    event_version: 1,
    timestamp: "2026-04-24T00:00:00Z",
    captured_at: "2026-04-24T00:00:00Z",
    partition_key: "p-1",
    source: "explicit",
    polarity: "positive",
    inference: "whitelist",
    action: "approve",
    artifact_type: "draft",
    artifact_id: "p-1",
    artifact_version: 1,
    producer: "test",
    task_type: "test_task",
    payload: {},
    provenance: { channel: "test", captured_by_adapter: "test" },
    ...overrides,
  };
}

export async function collect<T>(iter: AsyncIterable<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const v of iter) out.push(v);
  return out;
}
