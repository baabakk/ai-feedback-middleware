# @ai-feedback-middleware/reference

Reference projections and capture adapters. Use as templates or starting points; nothing here is a hard requirement.

## Projections

- **`approvalRateProjection`** — tracks approval rate per (producer, task_type). Sync-mode counters with derived rate. Read directly via `feedback.queryProjection("approval_rate")`.
- **`createWhitelistExamplesProjection({ capPerKey })`** — collects `inference: whitelist` events into a small library keyed by (producer, task_type). Useful for few-shot examples in the next generation. Default cap 50 per key.
- **`createBlacklistPhrasesProjection({ watchPhrases })`** — observes edits that REMOVE a watched phrase. Increments a counter per phrase. Default phrase list is corporate-pleasantry filler ("I hope this finds you well", "leveraging synergies", etc.). Consumer can wire the counts as a runtime anti-pattern list for the next prompt.

## Capture adapters

- **`createHttpButtonCaptureAdapter(feedback)`** — wraps an HTTP route. Call `adapter.handle(payload, channel)` from your route handler.
- **`createWebhookCaptureAdapter(feedback, { signingSecret })`** — receives signed webhooks from external systems. HMAC-SHA256 verification by default; provide your own `verify` function for source-specific schemes.

## License

Apache 2.0
