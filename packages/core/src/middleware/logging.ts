import type { FeedbackEvent } from "../event-types.js";
import type { Middleware } from "./types.js";

export interface LoggingOptions {
  /** Where to send log lines. Defaults to console. */
  log?: (level: "debug" | "info" | "warn" | "error", message: string, fields: object) => void;
  /** Tag identifying this pipeline (e.g. "publish", "subscribe:gold-examples"). */
  pipelineName?: string;
}

const defaultLog: NonNullable<LoggingOptions["log"]> = (level, message, fields) => {
  // eslint-disable-next-line no-console
  const fn = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  fn(`[${level}] ${message}`, fields);
};

/**
 * Structured logging around the wrapped handler. Logs start, success with
 * latency, and errors with stack.
 */
export function loggingMiddleware(options: LoggingOptions = {}): Middleware<FeedbackEvent> {
  const log = options.log ?? defaultLog;
  const pipeline = options.pipelineName ?? "unknown";
  return (next) => async (event) => {
    const start = Date.now();
    log("debug", `[${pipeline}] handling`, {
      event_id: event.event_id,
      event_kind: event.event_kind,
      action: event.event_kind === "reaction" ? event.action : undefined,
      pipeline,
    });
    try {
      await next(event);
      log("debug", `[${pipeline}] ok`, {
        event_id: event.event_id,
        ms: Date.now() - start,
        pipeline,
      });
    } catch (err) {
      log("error", `[${pipeline}] failed`, {
        event_id: event.event_id,
        ms: Date.now() - start,
        pipeline,
        error: err instanceof Error ? err.message : String(err),
        stack: err instanceof Error ? err.stack : undefined,
      });
      throw err;
    }
  };
}
