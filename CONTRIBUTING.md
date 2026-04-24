# Contributing to llm-feedback-middleware

> **This project is in early development (v0.x).** APIs may change. Contributions are welcome but please open an issue first to discuss substantial changes.

## Setup

```bash
git clone <repo>
cd llm-feedback-middleware
pnpm install
pnpm test
```

## Workflow

1. Open an issue describing the change
2. Fork and create a feature branch
3. Make your changes with tests
4. Run `pnpm lint && pnpm typecheck && pnpm test && pnpm depcheck`
5. Add a changeset: `pnpm changeset` (describe your change)
6. Open a PR

## Guidelines

- **Core has zero infrastructure dependencies.** No imports of `pg`, `redis`, `fastify`, etc. in `packages/core/`.
- **Adapters are independent.** No package may import another adapter package.
- **No consumer-specific imports.** Framework packages must not reference any consumer codebase. dependency-cruiser enforces this in CI.
- **Classifier must stay pure.** No LLM calls, no I/O, no randomness in `packages/core/src/classifier.ts`.
- **Tests for every public API.** Use Vitest. Co-locate tests under `packages/<name>/tests/`.
- **Conventional Commits.** Format commit messages as `feat(core): ...`, `fix(postgres): ...`, etc.

## License

By contributing, you agree your contributions will be licensed under Apache License 2.0.
