/**
 * Minimal metrics interface so the framework can emit counters and timings
 * without committing to a specific backend (Prometheus, StatsD, OpenTelemetry).
 *
 * Consumers wire an adapter that forwards to whatever metrics system they use.
 */
export interface MetricsPort {
  /** Increment a counter, optionally with labels and an amount (default 1). */
  increment(name: string, labels?: Record<string, string>, value?: number): void;

  /** Record a timing in milliseconds. */
  timing(name: string, ms: number, labels?: Record<string, string>): void;

  /** Record a gauge value (last-write-wins). */
  gauge?(name: string, value: number, labels?: Record<string, string>): void;
}

/** No-op metrics adapter. Used as the default when consumers do not wire one. */
export const noopMetrics: MetricsPort = {
  increment() {
    /* noop */
  },
  timing() {
    /* noop */
  },
  gauge() {
    /* noop */
  },
};
