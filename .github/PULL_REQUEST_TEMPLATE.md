<!--
Thanks for contributing! A few asks before we can merge:

1. Open an issue first for substantial changes so we can align on direction.
2. Add a changeset (`pnpm changeset`) for any user-visible change.
3. Run `pnpm lint && pnpm typecheck && pnpm test && pnpm depcheck` locally
   before pushing. CI runs the same against Postgres + Redis service
   containers and will block on the first failure.
4. By submitting this PR you agree to the terms in CLA.md.
-->

## What

<!-- One paragraph: what does this change do? -->

## Why

<!-- One paragraph: what problem does it solve / which issue does it close? -->

Closes #

## Affected packages

<!-- Tick all that apply. -->

- [ ] `@llm-feedback-middleware/core`
- [ ] `@llm-feedback-middleware/in-memory`
- [ ] `@llm-feedback-middleware/postgres`
- [ ] `@llm-feedback-middleware/redis-pubsub`
- [ ] `@llm-feedback-middleware/streams`
- [ ] `@llm-feedback-middleware/reference`
- [ ] `@llm-feedback-middleware/adapter-conformance`
- [ ] documentation only
- [ ] CI / repo tooling only

## Type of change

- [ ] Bug fix (non-breaking)
- [ ] New feature (non-breaking)
- [ ] Breaking change
- [ ] Documentation
- [ ] Refactor (no behavior change)
- [ ] Tests / CI

## Checklist

- [ ] Added or updated tests
- [ ] Added a changeset (`pnpm changeset`)
- [ ] Updated the relevant README or docs page
- [ ] `pnpm lint && pnpm typecheck && pnpm test && pnpm depcheck` all pass locally
- [ ] If this PR closes a tech-debt item, the entry in `TECH-DEBT.md` is updated to `Resolved` with the commit reference

## Notes for the reviewer

<!-- Anything tricky? Anything you want a second opinion on? -->
