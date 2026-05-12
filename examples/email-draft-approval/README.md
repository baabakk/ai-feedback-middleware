# email-draft-approval

The canonical **reject-by-default** approval flow. Any system that needs explicit human sign-off before an outbound action — outbound emails, contracts, paid API calls, code commits, anything irreversible — should use this pattern.

## Problem

An AI agent drafts an outbound email. You don't want the email to send unless a human says "ship it." But you also don't want to wait forever — drafts that nobody touches need a deterministic answer ("we never sent this") so downstream consumers (audit logs, analytics, retries) can rely on every draft reaching a terminal state.

## Solution

Register `draft_email` with `expirationPolicy: "rejected_by_default"`. Every captured draft carries an `expires_at` deadline. Three outcomes:

1. **Explicit approve / edit / reject** — `recordReaction` writes a terminal event before the deadline.
2. **Silence** — the [Lifecycle Worker](../../packages/core/src/lifecycle-worker.ts) detects the elapsed deadline and emits `silently_rejected_expired` for you. **The outbound action is never taken.**

The contrast partner — when silence reads as endorsement instead — is in [`../daily-briefing-silent-accept`](../daily-briefing-silent-accept) (uses `acceptByDefault`).

## Run

```bash
pnpm --filter email-draft-approval start
```

Expected output:

```
draft-warm-intro             action=approved                     d=positive c=positive t=positive ch=positive
draft-cold-outreach          action=manually_edited              d=positive c=negative t=positive ch=positive
draft-bad-tone               action=rejected                     d=—        c=negative t=—        ch=—
draft-forgot-about-me        action=silently_rejected_expired    d=—        c=—        t=—        ch=—

reacted: 3
silently_rejected_expired: 1
```

## What it shows

- `rejectByDefault(...)` helper as the artifact-type policy.
- `captureArtifact` with **required** `expires_at`.
- The four canonical user reactions on the same artifact type: `approved` / `manually_edited` / `rejected` / `silently_rejected_expired` (framework-fired).
- The Lifecycle Worker (`createLifecycleWorker`) polling on a 200ms cadence and resolving the silenced lifecycle automatically.
- Per-axis evaluation differences across the four actions — see the `evaluations` column in the output.

## Adapt it to your domain

Most adaptations are one-line changes:

| What you'd change | How |
|---|---|
| The artifact type | Replace `"draft_email"` with `"contract_proposal"`, `"deploy_plan"`, etc. |
| The deadline | Replace `shortDeadline()` with your domain's window (e.g. `24h`, `5min`) |
| Where reactions come from | Swap the inline `recordReaction` calls for HTTP routes / Slack callbacks (see [`../slack-approval-bot`](../slack-approval-bot)) |
| Persistence | Swap in-memory adapters for Postgres (see [`../postgres-only`](../postgres-only)) |
