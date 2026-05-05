/**
 * A middleware is a function from a continuation handler to a wrapped handler.
 * Composing middlewares gives an onion-style pipeline where the outermost
 * middleware is the first to see the event and the last to see the result.
 *
 * Generic over T so the same primitive works for both publish-side and
 * subscribe-side pipelines.
 */
export type Middleware<T> = (next: (value: T) => Promise<void>) => (value: T) => Promise<void>;

/**
 * Compose an array of middlewares into a single middleware. Earlier entries
 * wrap later entries (so `compose([logging, retry, metrics])` runs as
 * logging → retry → metrics → final handler).
 */
export function compose<T>(middlewares: Middleware<T>[]): Middleware<T> {
  return (final) => middlewares.reduceRight((next, mw) => mw(next), final);
}
