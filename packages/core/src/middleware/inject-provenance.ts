import type { FeedbackEvent } from "../event-types.js";
import type { Middleware } from "./types.js";

/**
 * Fill in provenance defaults if the upstream caller did not provide them.
 *
 * Idempotent: only writes fields that are missing.
 */
export function injectProvenanceMiddleware(defaults: {
  channel?: string;
  captured_by_adapter?: string;
}): Middleware<FeedbackEvent> {
  return (next) => async (event) => {
    const enriched: FeedbackEvent = {
      ...event,
      provenance: {
        channel: event.provenance.channel || defaults.channel || "system",
        captured_by_adapter:
          event.provenance.captured_by_adapter || defaults.captured_by_adapter || "unknown",
        ...(event.provenance.instance_id !== undefined && {
          instance_id: event.provenance.instance_id,
        }),
        ...(event.provenance.latency_ms !== undefined && {
          latency_ms: event.provenance.latency_ms,
        }),
      },
      captured_at: event.captured_at || new Date().toISOString(),
    };
    return next(enriched);
  };
}
