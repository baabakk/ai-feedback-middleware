# @llm-feedback-middleware/core

Core types, classifier, registry, and ports for the llm-feedback-middleware framework.

This package has zero infrastructure dependencies. It defines:

- `FeedbackEvent` and related types
- `ActionRegistry` and `ArtifactTypeRegistry` for consumer extension points
- `DEFAULT_ACTIONS` (approve, edit, reject, regenerate, expired, silent_accept)
- `classify()` — pure deterministic classifier
- `ProjectionEngine` — generic projection builder framework
- Port interfaces: `FeedbackPort`, `EventStorePort`, `ProjectionStorePort`
- `createFeedback()` factory composing the above

See the [framework spec](../../../A02-Feedback-Middleware-Framework-Spec.md) for the full design.

## License

Apache 2.0
