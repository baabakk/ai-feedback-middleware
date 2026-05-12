import type { CapturePort, RecordReactionInput } from "@ai-feedback-middleware/core";

export interface HttpButtonClickPayload {
  /** REQUIRED. The artifact that was already captured and is now being reacted to. */
  artifact_id: string;
  /** Action name from `DEFAULT_ACTIONS` (e.g. `approved`, `rejected`). */
  action: string;
  payload?: unknown;
  /** Optional UI-side latency (ms from artifact display to button click). */
  latency_ms?: number;
}

/**
 * HTTP button-click capture adapter. Designed to wrap an HTTP route handler
 * (Express, Fastify, Hono, etc.) so the route just calls
 * `adapter.handle(payload, channel)` after auth/validation.
 *
 * v2.1: a button click is naturally a *reaction* to an already-captured
 * artifact. The route caller is responsible for having opened the lifecycle
 * via `captureArtifact()` earlier (typically when the artifact was rendered
 * to the user).
 *
 * The adapter calls `feedback.recordReaction()` and returns the generated
 * event_id. The route returns it to the client.
 */
export function createHttpButtonCaptureAdapter(feedback: CapturePort): {
  handle: (
    payload: HttpButtonClickPayload,
    channel?: string,
  ) => Promise<{ event_id: string }>;
} {
  return {
    async handle(payload, channel = "http") {
      const input: RecordReactionInput = {
        artifact_id: payload.artifact_id,
        action: payload.action,
        payload: payload.payload,
        provenance: {
          channel,
          captured_by_adapter: "http_button",
          ...(payload.latency_ms !== undefined && { latency_ms: payload.latency_ms }),
        },
      };
      const result = await feedback.recordReaction(input);
      return { event_id: result.event_id };
    },
  };
}
