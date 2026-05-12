import type { FeedbackEvent } from "../event-types.js";
import type { MetricsPort } from "../ports/metrics-port.js";
import type { Middleware } from "./types.js";

/**
 * Emit success/error counters and latency timing for the wrapped handler.
 *
 * Counter naming: `<prefix>.success`, `<prefix>.error`. Timing: `<prefix>.duration_ms`.
 *
 * Standard label set: `event_kind`, plus `action` (for reaction events only).
 * Custom labels can be merged via options.
 */
export function metricsMiddleware(
  metrics: MetricsPort,
  options: {
    counterPrefix?: string;
    timingName?: string;
    labels?: (event: FeedbackEvent) => Record<string, string>;
  } = {},
): Middleware<FeedbackEvent> {
  const counter = options.counterPrefix ?? "feedback.pipeline";
  const timingName = options.timingName ?? `${counter}.duration_ms`;
  const labelsFor =
    options.labels ??
    ((e: FeedbackEvent): Record<string, string> =>
      e.event_kind === "reaction"
        ? { event_kind: "reaction", action: e.action }
        : { event_kind: "capture" });

  return (next) => async (event) => {
    const labels = labelsFor(event);
    const start = Date.now();
    try {
      await next(event);
      metrics.increment(`${counter}.success`, labels);
    } catch (err) {
      const errorLabel = err instanceof Error ? err.constructor.name : "Unknown";
      metrics.increment(`${counter}.error`, { ...labels, error: errorLabel });
      throw err;
    } finally {
      metrics.timing(timingName, Date.now() - start, labels);
    }
  };
}
