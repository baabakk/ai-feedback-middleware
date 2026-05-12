# threshold-crystallization

Demonstrates `@ai-feedback-middleware/streams` for stateful across-event aggregation.

## What it shows

- Subscribing to a wildcard topic via `toEventStream(bus, "feedback.captured.*")`
- Filtering to a specific action (`regenerate`)
- Grouping by `(producer, task_type)` so each task accumulates independently
- Buffering until 3 events accumulate, then firing a "blacklist" callback
- Working with the in-memory bus (no external infrastructure)

## Run

```bash
pnpm --filter threshold-crystallization start
```

## Output

The example captures 5 regenerate events:

- 3 on different `art-A-*` artifacts but same `(demo-agent, draft:email)` group
- 2 on different `art-B-*` artifacts but same `(demo-agent, draft:slack)` group

Only the first group crosses the 3-event threshold, so only `draft:email` is promoted to the (demo) blacklist.
