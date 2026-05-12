import type { FeedbackEvent } from "../event-types.js";
import type { Middleware } from "./types.js";

/**
 * Attach a correlation_id to the provenance if absent, and propagate it
 * through async storage if available. Useful for tracing a feedback event
 * across multiple subscribers and downstream services.
 *
 * If the consumer already sets `provenance.correlation_id`, this middleware
 * is a no-op for that field.
 */
export function correlationIdMiddleware(
  generate: () => string = defaultCorrelationId,
): Middleware<FeedbackEvent> {
  return (next) => async (event) => {
    const existing = (event.provenance as { correlation_id?: string }).correlation_id;
    if (existing) {
      return next(event);
    }
    const provenance = {
      ...event.provenance,
      correlation_id: generate(),
    } as FeedbackEvent["provenance"];
    const enriched: FeedbackEvent =
      event.event_kind === "capture"
        ? { ...event, provenance }
        : { ...event, provenance };
    return next(enriched);
  };
}

function defaultCorrelationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `cid-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
