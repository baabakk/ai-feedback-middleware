import type { FeedbackEvent } from "../event-types.js";
import type { Middleware } from "./types.js";

export interface RetryOptions {
  /** Maximum number of attempts including the first. Default 3. */
  max?: number;
  /** Returns delay in ms for a given attempt index (0-based). Default exponential 100/200/400/... */
  backoff?: (attempt: number) => number;
  /** Predicate: should this error be retried? Default: all thrown errors are retryable. */
  retryable?: (err: unknown) => boolean;
  /** Hook fired on each retry, useful for metrics or logging. */
  onRetry?: (attempt: number, err: unknown, event: FeedbackEvent) => void;
}

const defaultBackoff = (attempt: number): number => 100 * Math.pow(2, attempt);

export function retryMiddleware(options: RetryOptions = {}): Middleware<FeedbackEvent> {
  const max = options.max ?? 3;
  const backoff = options.backoff ?? defaultBackoff;
  const retryable = options.retryable ?? (() => true);

  return (next) => async (event) => {
    let lastErr: unknown;
    for (let attempt = 0; attempt < max; attempt++) {
      try {
        return await next(event);
      } catch (err) {
        lastErr = err;
        if (!retryable(err) || attempt === max - 1) {
          throw err;
        }
        if (options.onRetry) options.onRetry(attempt, err, event);
        await sleep(backoff(attempt));
      }
    }
    throw lastErr;
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
