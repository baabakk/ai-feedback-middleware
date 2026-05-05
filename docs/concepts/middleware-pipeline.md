# Middleware pipeline

`createFeedback` accepts an optional middleware pipeline that wraps every
`capture()` call. Use it for cross-cutting concerns: logging, validation,
provenance injection, metrics, retry, idempotency, correlation IDs.

## Shape

A middleware is a function from a "next" handler to a wrapped handler:

```typescript
type Middleware = (next: CaptureHandler) => CaptureHandler;
```

`compose(...middlewares)` chains them right-to-left so the _first_
middleware in the array is the _outermost_ layer:

```typescript
const handler = compose(
  loggingMiddleware({ pipelineName: "capture" }),
  validationMiddleware(),
  injectProvenanceMiddleware({ source_system: "bepa" }),
  metricsMiddleware(metricsAdapter),
  retryMiddleware({ max: 3 }),
  idempotencyMiddleware({ store: dedupeStore }),
  correlationIdMiddleware(),
)(coreCaptureHandler);
```

In this order the request flows:

```
log -> validate -> inject_provenance -> metrics -> retry -> idempotency -> correlation_id -> core
```

and the response flows back out in reverse.

## Built-in middlewares

| Middleware                   | Why                                                                                               |
| ---------------------------- | ------------------------------------------------------------------------------------------------- |
| `loggingMiddleware`          | Structured log of every capture (with elapsed time and event_id).                                 |
| `validationMiddleware`       | Re-runs the action's payload schema. Cheap belt-and-suspenders for trust boundaries.              |
| `injectProvenanceMiddleware` | Stamps `source_system` / `instance_id` so events are attributable.                                |
| `metricsMiddleware`          | Increments per-action / per-artifact-type counters via `MetricsPort`.                             |
| `retryMiddleware`            | Retries transient infrastructure errors with backoff. Skips deterministic errors.                 |
| `idempotencyMiddleware`      | First-write-wins via `DedupeStorePort` keyed on event hash.                                       |
| `correlationIdMiddleware`    | Threads a correlation id through nested captures (e.g. a workflow that captures multiple events). |

Each middleware is independent. If you do not want one, do not include
it.

## Configuring publish-side middleware

`createFeedback` also accepts a separate `publishMiddleware` array that
wraps bus publishes. This is where `loggingMiddleware` and
`retryMiddleware` are usually applied to the dispatch path:

```typescript
const feedback = createFeedback({
  /* ... */
  publishMiddleware: [loggingMiddleware({ pipelineName: "publish" }), retryMiddleware({ max: 3 })],
});
```

The split exists because capture and publish have different failure modes:
capture failures should usually surface to the consumer; publish failures
should usually be retried in the background.

## Writing your own middleware

```typescript
import type { Middleware } from "@llm-feedback-middleware/core";

export const tracingMiddleware =
  (tracer: Tracer): Middleware =>
  (next) =>
  async (input) => {
    const span = tracer.startSpan("feedback.capture", { attributes: { action: input.action } });
    try {
      return await next(input);
    } finally {
      span.end();
    }
  };
```

Rules of thumb for custom middlewares:

- Keep them small. Each middleware should do one cross-cutting thing.
- Do not swallow errors silently. If you catch, re-throw or use the error
  callbacks the framework provides (`onPublishError`, adapter `onError`).
- Be transparent: the result you return must be the result the next layer
  produced (or a thrown error). Do not transform the event silently.

## When to use middleware vs. a custom handler

Middleware is for _cross-cutting_ concerns. If your concern is specific
to one call site (e.g. capturing a particular kind of approval), put it
at the call site. If it applies to every capture (logging, metrics,
provenance), middleware is the right place.
