# @ai-feedback-middleware/streams

Optional RxJS stream wrapper for `EventBusPort`. Use only if your subscribers benefit from operators like `debounce`, `bufferTime`, `groupBy`, `windowTime`. Consumers that don't need these never import this package.

## Install

```bash
npm install @ai-feedback-middleware/streams rxjs
```

## Use

```typescript
import {
  toStream,
  bufferTime,
  filter,
  groupBy,
  mergeMap,
  tap,
} from "@ai-feedback-middleware/streams";

// 3 regenerates on the same task within 7 days -> blacklist promotion
toStream(bus, "feedback.captured.*")
  .pipe(
    filter(({ event }) => event.action === "regenerate"),
    groupBy(({ event }) => `${event.producer}:${event.task_type}`),
    mergeMap((group) =>
      group.pipe(
        bufferTime(7 * 24 * 60 * 60 * 1000),
        filter((batch) => batch.length >= 3),
        tap(([first]) => promoteToBlacklist(first.event.producer, first.event.task_type)),
      ),
    ),
  )
  .subscribe();
```

## Two helpers

- `toStream(bus, topic)` — `Observable<{ event, topic }>` (preserves the delivered topic)
- `toEventStream(bus, topic)` — `Observable<FeedbackEvent>` (drops topic, simpler shape)

## When to use

✅ Threshold crystallization (buffer + filter by count)
✅ Rate-limit alerting (throttle + distinct)
✅ Pattern detection across events (groupBy + windowTime)
✅ Live dashboard aggregation

❌ Simple per-event subscribers (use port directly)
❌ Sync projections (use in-transaction path)
❌ Once-per-event webhooks (use port directly + retry middleware)

## License

Apache 2.0
