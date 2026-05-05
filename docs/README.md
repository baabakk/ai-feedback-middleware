# Documentation

The framework's docs are organized as concept pages, adapter pages, and
cookbooks.

## Read these first

- [Getting started](./getting-started.md) - five-step walkthrough.
- [Concepts: the 2x2 framework](./concepts/the-2x2-framework.md) - the
  classification model.
- [Concepts: event sourcing basics](./concepts/event-sourcing-basics.md) -
  why the event log is canonical.
- [Concepts: ports and adapters](./concepts/ports-and-adapters.md) - how
  storage and transport are isolated.
- [Concepts: middleware pipeline](./concepts/middleware-pipeline.md) -
  cross-cutting concerns.

## Adapters

- [Postgres setup](./adapters/postgres-setup.md) - the production-default
  storage adapter.
- [Choosing a bus](./adapters/choosing-a-bus.md) - in-memory vs. Redis
  pub/sub vs. at-least-once.
- [Writing a custom adapter](./adapters/writing-a-custom-adapter.md) -
  how to implement and ship one.

## Cookbooks

- [Threshold crystallization](./cookbooks/threshold-crystallization.md) -
  promote `observe` to `blacklist` after N negative events.

More cookbooks coming in v0.2.0:

- Gold-example library (curate and inject `whitelist` events as in-context examples).
- Anti-pattern detection (synthesize "do not do this" rules from `blacklist` events).

## Reference

- [Framework spec](../../A02-Feedback-Middleware-Framework-Spec.md) - the
  full design document.
- [Implementation plan](../../IMPLEMENTATION-PLAN.md) - phase-by-phase
  build sequence.
- [Tech debt tracker](../TECH-DEBT.md) - what's open, what's closed.
- [Per-package READMEs](../packages/) - install + public API surface for
  each package.
