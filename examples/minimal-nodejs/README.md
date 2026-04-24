# minimal-nodejs

The smallest possible consumer of `@llm-feedback-middleware/*`.

## Run

From the monorepo root:

```bash
pnpm --filter minimal-nodejs start
```

## What it shows

- Composing the framework with in-memory adapters
- Capturing approve, edit, and reject events
- A simple sync projection (approval count by producer)
- Reading the raw event stream
- Querying projection state
