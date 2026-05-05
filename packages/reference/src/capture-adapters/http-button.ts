import type { CaptureInput, FeedbackPort } from "@llm-feedback-middleware/core";

export interface HttpButtonClickPayload {
  action: string;
  artifact_type: string;
  artifact_id: string;
  artifact_version: number;
  producer: string;
  task_type: string;
  payload?: unknown;
  partition_key?: string;
  /** Optional UI-side latency (ms from artifact display to button click). */
  latency_ms?: number;
}

/**
 * HTTP button-click capture adapter. Designed to wrap an HTTP route handler
 * (Express, Fastify, Hono, etc.) so the route just calls
 * `adapter.handle(payload, channel)` after auth/validation.
 *
 * The adapter does the framework's `feedback.capture()` and returns the
 * generated event_id. The route returns it to the client.
 */
export function createHttpButtonCaptureAdapter(feedback: FeedbackPort): {
  handle: (payload: HttpButtonClickPayload, channel?: string) => Promise<{ event_id: string }>;
} {
  return {
    async handle(payload, channel = "http") {
      const input: CaptureInput = {
        action: payload.action,
        artifact_type: payload.artifact_type,
        artifact_id: payload.artifact_id,
        artifact_version: payload.artifact_version,
        producer: payload.producer,
        task_type: payload.task_type,
        payload: payload.payload ?? {},
        provenance: {
          channel,
          captured_by_adapter: "http_button",
          ...(payload.latency_ms !== undefined && { latency_ms: payload.latency_ms }),
        },
        ...(payload.partition_key !== undefined && { partition_key: payload.partition_key }),
      };
      const event_id = await feedback.capture(input);
      return { event_id };
    },
  };
}
