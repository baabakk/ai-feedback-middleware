# slack-approval-bot

External-system bridge via the webhook capture adapter. Pattern works for any source that can POST signed payloads: Slack, Discord, Telegram, Linear, Jira, GitHub, in-app buttons.

## Problem

Your agent doesn't have its own UI — it posts drafts to Slack and waits for human review. Slack's `reaction_added` event fires when someone reacts with emoji. You need to:

1. Verify Slack's signature (the framework can't trust unsigned webhook input).
2. Map Slack's emoji vocabulary to the framework's action vocabulary.
3. Record the reaction with enough provenance to trace it back to the Slack message.

## Solution

The framework ships a [`createWebhookCaptureAdapter`](../../packages/reference/src/capture-adapters/webhook.ts) that handles step 1 + step 3 for you. You write step 2 — a tiny function mapping `:white_check_mark:` → `"approved"`, `:pencil2:` → `"manually_edited"`, etc.

In a real Express/Fastify route:

```ts
const webhook = createWebhookCaptureAdapter(feedback, {
  signingSecret: process.env.SLACK_SIGNING_SECRET!,
  channel: "slack",
});

app.post("/webhooks/slack/reaction", async (req, reply) => {
  const body = JSON.stringify(req.body);
  const sig = req.headers["x-slack-signature"] as string;
  const { event_id } = await webhook.handle(body, sig);
  reply.send({ event_id });
});
```

This example fakes the HTTP layer by handing pre-signed payloads to the adapter directly, so the bridge wiring is visible without standing up a server.

## Run

```bash
pnpm --filter slack-approval-bot start
```

## What it shows

- `createWebhookCaptureAdapter` with HMAC-SHA256 signature verification
- Mapping a source-system primitive (Slack emoji) to the framework's action vocabulary
- Provenance: `channel`, `captured_by_adapter`, `instance_id` (set to `slack:<channel_id>`) for full back-traceability
- Carrying the source's native identifiers (Slack `message_ts`, `user_id`) in `payload` so you can deep-link back

## Adapt it

| Source                      | What changes                                                                                                                                                                                               |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Telegram callback_query** | Read `update.callback_query.data` as your "emoji" equivalent (your bot would set this when rendering the inline keyboard).                                                                                 |
| **Linear comment :emoji:**  | Listen for `Reaction.emoji` on `Comment` resources.                                                                                                                                                        |
| **GitHub issue reactions**  | Listen for the `reaction` event, map `+1` → `approved` etc.                                                                                                                                                |
| **In-app button click**     | Use the [http-button capture adapter](../../packages/reference/src/capture-adapters/http-button.ts) instead — it takes a typed JSON body, no signature verification (auth is your route's responsibility). |

## Production checklist

- [ ] Replace the demo signing secret with `process.env.SLACK_SIGNING_SECRET`
- [ ] Use the [Slack signature spec](https://api.slack.com/authentication/verifying-requests-from-slack) format (timestamp + body) — Slack actually wants `v0=<timestamp>:<body>` HMAC, not raw body. The default `defaultHmacVerify` in this adapter hashes the raw body; provide your own `verify` function for Slack's variant.
- [ ] Persist via Postgres adapters (see [`../postgres-only`](../postgres-only)) — in-memory is for the demo only
- [ ] Add an idempotency middleware so Slack's at-least-once delivery doesn't double-count reactions
