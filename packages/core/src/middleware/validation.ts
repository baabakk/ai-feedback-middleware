import { FeedbackEventSchema, type FeedbackEvent } from "../event-types.js";
import type { Middleware } from "./types.js";

/**
 * Validate the event shape against the canonical schema before passing
 * downstream. Throws on schema violation, halting the pipeline.
 *
 * Useful at adapter boundaries (e.g., HTTP ingest) where consumer-provided
 * events may be malformed.
 */
export function validationMiddleware(): Middleware<FeedbackEvent> {
  return (next) => async (event) => {
    const parsed = FeedbackEventSchema.parse(event);
    return next(parsed);
  };
}
