import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { Buffer } from "node:buffer";
import type { FeedbackPort } from "@llm-feedback-middleware/core";

const WebhookPayloadSchema = z.object({
  action: z.string(),
  artifact_type: z.string(),
  artifact_id: z.string(),
  artifact_version: z.number().int().nonnegative(),
  producer: z.string(),
  task_type: z.string(),
  payload: z.unknown().optional(),
  partition_key: z.string().optional(),
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
 * Webhook capture adapter. Designed for receiving feedback events from
 * external systems (e.g., a SaaS product fires a webhook when a user clicks
 * "this answer was helpful"). Verifies HMAC signature, parses the body,
 * captures via the feedback port.
 *
 * NOTE: provide your own `verify` function in production. The default uses
 * `node:crypto` timingSafeEqual but the verification semantics (header name,
 * encoding) vary per source system.
 */
export function createWebhookCaptureAdapter(
  feedback: FeedbackPort,
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
      const event_id = await feedback.capture({
        action: parsed.action,
        artifact_type: parsed.artifact_type,
        artifact_id: parsed.artifact_id,
        artifact_version: parsed.artifact_version,
        producer: parsed.producer,
        task_type: parsed.task_type,
        payload: parsed.payload ?? {},
        provenance: {
          channel,
          captured_by_adapter: "webhook",
          ...(parsed.source_system !== undefined && { instance_id: parsed.source_system }),
        },
        ...(parsed.partition_key !== undefined && { partition_key: parsed.partition_key }),
      });
      return { event_id };
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
