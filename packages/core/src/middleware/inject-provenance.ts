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
    const provenance = {
      channel: event.provenance.channel || defaults.channel || "system",
      captured_by_adapter:
        event.provenance.captured_by_adapter || defaults.captured_by_adapter || "unknown",
      ...(event.provenance.instance_id !== undefined && {
        instance_id: event.provenance.instance_id,
      }),
      ...(event.provenance.latency_ms !== undefined && {
        latency_ms: event.provenance.latency_ms,
      }),
    };
    const captured_at = event.captured_at || new Date().toISOString();
    const enriched: FeedbackEvent =
      event.event_kind === "capture"
        ? { ...event, provenance, captured_at }
        : { ...event, provenance, captured_at };
    return next(enriched);
  };
}
