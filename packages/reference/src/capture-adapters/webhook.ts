import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import type { CapturePort } from "@ai-feedback-middleware/core";

const WebhookPayloadSchema = z.object({
  artifact_id: z.string(),
  action: z.string(),
  payload: z.unknown().optional(),
  source_system: z.string().optional(),
});

export interface WebhookCaptureOptions {
  /** Required HMAC-SHA256 secret for verifying inbound webhook signatures. */
  signingSecret: string;
  /** HMAC verification function. Default: timing-safe compareSync. */
  verify?: (rawBody: string, signature: string, secret: string) => boolean;
  /** Optional default channel name. Defaults to "webhook". */
  channel?: string;
}

/**
 * Webhook capture adapter. Designed for receiving reaction events from
 * external systems (e.g., a SaaS product fires a webhook when a user clicks
 * "this answer was helpful"). Verifies HMAC signature, parses the body,
 * records the reaction via the feedback port.
 *
 * v2.1: a webhook delivers a *reaction* to an artifact whose lifecycle was
 * already opened by the consumer's own `captureArtifact()` call. The
 * webhook payload only needs `artifact_id` + `action`; the artifact
 * metadata (artifact_type, producer, task_type, etc.) is resolved by the
 * framework from the existing `tracked_artifacts` row.
 *
 * NOTE: provide your own `verify` function in production. The default uses
 * `node:crypto` timingSafeEqual but the verification semantics (header
 * name, encoding) vary per source system.
 */
export function createWebhookCaptureAdapter(
  feedback: CapturePort,
  options: WebhookCaptureOptions,
): {
  handle: (rawBody: string, signature: string) => Promise<{ event_id: string }>;
} {
  const channel = options.channel ?? "webhook";
  const verify = options.verify ?? defaultHmacVerify;

  return {
    async handle(rawBody: string, signature: string): Promise<{ event_id: string }> {
      if (!verify(rawBody, signature, options.signingSecret)) {
        throw new Error("Invalid webhook signature");
      }
      const parsed = WebhookPayloadSchema.parse(JSON.parse(rawBody));
      const result = await feedback.recordReaction({
        artifact_id: parsed.artifact_id,
        action: parsed.action,
        payload: parsed.payload,
        provenance: {
          channel,
          captured_by_adapter: "webhook",
          ...(parsed.source_system !== undefined && { instance_id: parsed.source_system }),
        },
      });
      return { event_id: result.event_id };
    },
  };
}

function defaultHmacVerify(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  if (expected.length !== signature.length) return false;
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}
