# daily-briefing-silent-accept

The **accept-by-default** flow. Contrast partner to [`../email-draft-approval`](../email-draft-approval). Use this pattern for periodic informational artifacts where silence is endorsement: morning briefings, daily summaries, weekly KPI digests, recurring report emails.

## Problem

You generate a daily briefing at 7am. You want to learn from feedback ("this brief was wrong"), but the common case is the user reads it once and moves on — explicit approval is rare. You need the framework to log silence as a positive-content signal so your training data isn't biased toward only-the-cases-where-the-user-pushed-back.

## Solution

Register `morning_briefing` with `expirationPolicy: "accepted_by_default"`. The Lifecycle Worker fires `silently_accepted` on deadline — explicit-positive on `detection` + `content`, deliberately empty on `timing` + `channel` (silence can't disambiguate a perfect brief from one that was never seen).

If the user *does* push back, the two interesting actions are:

- **`manually_edited`** — kept your brief and adjusted it. Diff in payload.
- **`manually_replaced`** — threw your brief out and wrote their own from scratch. Stronger content-axis negative than edit; diff size in payload distinguishes them.

## Run

```bash
pnpm --filter daily-briefing-silent-accept start
```

## What it shows

- `acceptByDefault(...)` as the opposite policy choice.
- Lifecycle Worker firing the **positive** implicit reaction (`silently_accepted`) on deadline.
- The `manually_replaced` action — when the user discards your output entirely and re-does the task.
- How the per-axis evaluation differs between `approved` (all four axes positive) vs `silently_accepted` (detection + content positive only) vs `manually_replaced` (detection positive, content negative).

## When to use accept-by-default

- The artifact is **informational**, not actionable. Briefings, dashboards, status emails, KPI reports.
- The cost of acting on a "silently accepted" artifact is **zero** (vs reject-by-default where you'd auto-send something).
- You want every artifact to reach a terminal status for completeness of your training data, not for safety gating.

If silence-means-don't-act is what you need, use [`../email-draft-approval`](../email-draft-approval) instead.
