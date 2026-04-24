# @llm-feedback-middleware/in-memory

In-memory adapters for `llm-feedback-middleware`. Use for tests and small single-process deployments.

## Adapters

- `createInMemoryEventStore()` — implements `EventStorePort`
- `createInMemoryProjectionStore()` — implements `ProjectionStorePort`

Events are stored in arrays. Projection state lives in maps. Subscribers are EventEmitter-based. Nothing is persisted across process restarts.

## Use cases

- Unit and integration tests of consumer code
- Local development without spinning up Postgres / Redis
- Small single-node deployments where event durability is not required

## Caveats

- No durability across restarts
- No multi-process or multi-host coordination
- Subscriber backpressure is not handled

For durable storage, use `@llm-feedback-middleware/postgres`.

## License

Apache 2.0
