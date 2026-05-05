# postgres-redis

Full-stack example combining all framework layers:

- Postgres event store + projection store + transactional outbox
- Redis pub/sub event bus
- Outbox scanner draining outbox to bus
- Middleware pipeline (logging + retry) wrapping bus publishes
- Sync projection updated in capture transaction
- Async subscriber listening on a wildcard topic
- Inference rule triggering threshold-based blacklist

## Run

```bash
DATABASE_URL=postgres://user:pass@localhost:5432/feedback \
REDIS_URL=redis://localhost:6379 \
  pnpm --filter postgres-redis start
```

## What it shows

- 5 events captured (1 approve + 3 regenerates + 1 edit)
- The 3rd regenerate crosses the 3-events-in-60s threshold and is classified as `blacklist` instead of the action's default `observe`
- The outbox is drained to the bus by a scheduled scanner
- An async subscriber on `feedback.inference.>` counts events by inference outcome
- All seven canonical topics are emitted for each event
