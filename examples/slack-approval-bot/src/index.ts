/**
 * slack-approval-bot — external-system bridge via the webhook capture adapter.
 *
 * Scenario: the AI agent posts a draft to a Slack channel. Reviewers react
 * with emoji to approve / edit / reject. Slack POSTs an Events API payload
 * to your webhook endpoint; this example shows how to map that payload to
 * the framework's action vocabulary and use the bundled webhook capture
 * adapter to verify the signature + record the reaction in one call.
 *
 * Real Slack integration requires:
 *   1. A Slack app with `reaction_added` event subscription enabled.
 *   2. The signing secret from the app's Basic Information page.
 *   3. An HTTPS endpoint to receive webhooks (Express / Fastify / Hono / etc).
 *
 * This example fakes step 3 by handing the adapter pre-signed payloads
 * directly, so you can see the full bridge wired without standing up a
 * web server. The signing logic is real HMAC-SHA256 against the same
 * secret the adapter verifies with.
 */
import { createHmac } from "node:crypto";
import {
  createFeedback,
  DEFAULT_ACTIONS,
  rejectByDefault,
  type CapturedEvaluatedReactionEvent,
} from "@ai-feedback-middleware/core";
import {
  createInMemoryEventStore,
  createInMemoryProjectionStore,
  createInMemoryTrackedArtifactsStore,
} from "@ai-feedback-middleware/in-memory";
import { createWebhookCaptureAdapter } from "@ai-feedback-middleware/reference";

/**
 * Map a Slack emoji reaction to a framework action. Customize per team —
 * teams often have their own conventions (e.g. :shipit: for approved).
 */
function slackEmojiToAction(emoji: string): string | null {
  switch (emoji) {
    case "white_check_mark":
    case "thumbsup":
    case "shipit":
      return "approved";
    case "pencil2":
    case "pencil":
      return "manually_edited";
    case "x":
    case "no_entry":
    case "thumbsdown":
      return "rejected";
    default:
      return null;
  }
}

/**
 * Translate a Slack `reaction_added` event into the webhook adapter's
 * expected schema. Real adapters would do this in an Express route handler;
 * we do it inline here.
 */
interface SlackReactionEvent {
  artifact_id: string;
  emoji: string;
  user_id: string;
  channel: string;
  message_ts: string;
}

function buildBodyAndSignature(
  evt: SlackReactionEvent,
  signingSecret: string,
): { body: string; signature: string } | null {
  const action = slackEmojiToAction(evt.emoji);
  if (!action) return null; // emoji we don't recognize; skip silently
  const body = JSON.stringify({
    artifact_id: evt.artifact_id,
    action,
    source_system: `slack:${evt.channel}`,
    payload: {
      actor_id: evt.user_id,
      slack_emoji: evt.emoji,
      slack_message_ts: evt.message_ts,
    },
  });
  const signature = createHmac("sha256", signingSecret).update(body).digest("hex");
  return { body, signature };
}

async function main(): Promise<void> {
  const signingSecret = "demo-signing-secret-do-not-use-in-prod";

  const feedback = createFeedback({
    eventStore: createInMemoryEventStore(),
    projectionStore: createInMemoryProjectionStore(),
    trackedArtifacts: createInMemoryTrackedArtifactsStore(),
    actions: DEFAULT_ACTIONS,
    artifactTypes: [rejectByDefault("draft_email")],
  });

  // The webhook adapter validates the signature, parses the body, then
  // calls feedback.recordReaction internally.
  const webhook = createWebhookCaptureAdapter(feedback, {
    signingSecret,
    channel: "slack",
  });

  const future = (): string => new Date(Date.now() + 60_000).toISOString();

  // Agent posts 3 drafts to Slack.
  console.log("--- Agent posts 3 drafts to #ai-drafts ---\n");
  for (const id of ["draft-001", "draft-002", "draft-003"]) {
    await feedback.captureArtifact({
      artifact_type: "draft_email",
      artifact_id: id,
      artifact_version: 1,
      producer: "secretary-agent",
      task_type: "outbound:warm_intro",
      payload: { posted_to: "#ai-drafts" },
      expires_at: future(),
    });
    console.log(`  posted ${id} to #ai-drafts`);
  }

  // Reviewers react in Slack. Each emoji event hits our webhook.
  console.log("\n--- Reviewers react via Slack emoji ---\n");
  const slackEvents: SlackReactionEvent[] = [
    {
      artifact_id: "draft-001",
      emoji: "white_check_mark",
      user_id: "U_BABAK",
      channel: "C_AI_DRAFTS",
      message_ts: "1717000000.000100",
    },
    {
      artifact_id: "draft-002",
      emoji: "pencil2",
      user_id: "U_BABAK",
      channel: "C_AI_DRAFTS",
      message_ts: "1717000005.000200",
    },
    {
      artifact_id: "draft-003",
      emoji: "x",
      user_id: "U_BABAK",
      channel: "C_AI_DRAFTS",
      message_ts: "1717000010.000300",
    },
    // An emoji we don't map to anything — should be silently skipped.
    {
      artifact_id: "draft-001",
      emoji: "eyes",
      user_id: "U_LURKER",
      channel: "C_AI_DRAFTS",
      message_ts: "1717000020.000400",
    },
  ];

  for (const evt of slackEvents) {
    const signed = buildBodyAndSignature(evt, signingSecret);
    if (!signed) {
      console.log(`  ${evt.artifact_id}  emoji=${evt.emoji}  → no-op (not a mapped reaction)`);
      continue;
    }
    const result = await webhook.handle(signed.body, signed.signature);
    console.log(
      `  ${evt.artifact_id}  emoji=${evt.emoji}  → event_id=${result.event_id.slice(0, 12)}…`,
    );
  }

  console.log("\n--- Reaction log (what landed) ---\n");
  const reactions: CapturedEvaluatedReactionEvent[] = [];
  for await (const r of feedback.readReactions()) reactions.push(r);
  for (const r of reactions) {
    const prov = r.provenance;
    const slackTs = (r.payload as { slack_message_ts?: string })?.slack_message_ts ?? "";
    console.log(
      `  ${r.artifact_id.padEnd(12)} action=${r.action.padEnd(18)} channel=${prov.channel.padEnd(8)} via=${prov.captured_by_adapter}  slack_ts=${slackTs}`,
    );
  }

  console.log("\nKey takeaways:");
  console.log(
    "  • The webhook capture adapter handles HMAC-SHA256 verification + JSON parsing + the",
  );
  console.log("    recordReaction call in one function. Your HTTP route is two lines.");
  console.log(
    "  • The bridge layer is the consumer's responsibility: mapping Slack emoji →",
  );
  console.log(
    "    framework action vocabulary. Keep this mapping in one place (slackEmojiToAction)",
  );
  console.log("    and unit-test it so emoji-convention drift doesn't silently break feedback.");
  console.log(
    "  • Provenance.channel + provenance.captured_by_adapter let you trace every reaction",
  );
  console.log(
    "    back to the source system. The Slack message timestamp lives in the payload so",
  );
  console.log("    you can deep-link back to the original message.");
  console.log(
    "  • The same pattern works for any external event source: Telegram callback queries,",
  );
  console.log(
    "    Linear/Jira webhooks, GitHub issue reactions, in-app button clicks. Swap the emoji",
  );
  console.log("    map for the source's primitive and the rest is identical.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
