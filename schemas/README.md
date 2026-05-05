# `schemas/`

Cross-language schema artifacts for the framework's canonical
`FeedbackEvent`. These let consumers in non-Node ecosystems (Go, Rust,
Python, Java) decode events without depending on the TypeScript types.

| File                         | Purpose                                                                     |
| ---------------------------- | --------------------------------------------------------------------------- |
| `feedback-event.schema.json` | JSON Schema (Draft 7).                                                      |
| `feedback-event.proto`       | Protocol Buffers definition (`proto3`).                                     |
| `generate.ts`                | Drift checker: asserts artifacts stay in sync with the Zod source of truth. |

## Source of truth

The Zod schema in
[`packages/core/src/event-types.ts`](../packages/core/src/event-types.ts) is
authoritative. The artifacts in this folder are convenience exports.

When the Zod schema changes:

1. Hand-edit `feedback-event.schema.json` and (if the change is wire-visible)
   `feedback-event.proto`.
2. Run `pnpm tsx schemas/generate.ts` from the framework root to verify the
   top-level property keys + required arrays stay in lock-step.
3. Commit the artifact changes alongside the Zod change in the same PR.

## Why drift-check instead of auto-generate?

The artifacts carry information the Zod schema does not (`description`,
`format`, `minimum`, ordering, protobuf field numbers). Auto-generating
would either drop that metadata or require a custom emitter. The
drift-check is a pragmatic middle ground: small, dependency-free, and
self-documenting.

## Usage in non-Node consumers

### Go

Generate Go bindings from the proto:

```bash
protoc --go_out=. --go_opt=paths=source_relative schemas/feedback-event.proto
```

### Python (jsonschema validator)

```python
import json, jsonschema
schema = json.load(open("schemas/feedback-event.schema.json"))
jsonschema.validate(event_dict, schema)
```

### Rust (typify or schemars)

Generate Rust types from the JSON Schema using `typify` or write the type
by hand and validate using `jsonschema-rs`.

## License

Apache 2.0
