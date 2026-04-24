import { z } from "zod";
import type { FeedbackActionDefinition } from "./actions.js";

export const ApprovePayloadSchema = z.object({
  artifact_hash: z.string().optional(),
});

export const EditPayloadSchema = z.object({
  original: z.string(),
  corrected: z.string(),
  diff_labels: z.array(z.string()).optional(),
  diff_metrics: z
    .object({
      length_ratio: z.number().optional(),
      word_delta: z.number().optional(),
    })
    .optional(),
});

export const RejectPayloadSchema = z.object({
  reason: z.string().optional(),
});

export const RegeneratePayloadSchema = z.object({
  reason: z.string().optional(),
});

export const ExpiredPayloadSchema = z.object({
  approval_window_seconds: z.number().optional(),
});

export const SilentAcceptPayloadSchema = z.object({
  sent_at: z.string().optional(),
  silence_window_hours: z.number().optional(),
  recipient_action: z.enum(["none", "replied", "forwarded"]).optional(),
});

/**
 * Framework-provided default action set.
 *
 * Consumers may use these directly, extend with additional actions,
 * or skip entirely and register their own action vocabulary.
 */
export const DEFAULT_ACTIONS: FeedbackActionDefinition[] = [
  {
    name: "approve",
    polarity: "positive",
    defaultInference: "whitelist",
    source: "explicit",
    payloadSchema: ApprovePayloadSchema,
    description: "User explicitly approved the artifact as-is.",
  },
  {
    name: "edit",
    polarity: "negative",
    defaultInference: "blacklist",
    source: "explicit",
    payloadSchema: EditPayloadSchema,
    description:
      "User corrected the artifact. Payload includes original and corrected text and optional diff labels.",
  },
  {
    name: "reject",
    polarity: "negative",
    defaultInference: "blacklist",
    source: "explicit",
    payloadSchema: RejectPayloadSchema,
    description: "User rejected the artifact entirely.",
  },
  {
    name: "regenerate",
    polarity: "negative",
    defaultInference: "observe",
    source: "explicit",
    payloadSchema: RegeneratePayloadSchema,
    description:
      "User requested a new attempt. Negative signal but soft; threshold rules promote to blacklist after repetition.",
  },
  {
    name: "expired",
    polarity: "negative",
    defaultInference: "observe",
    source: "implicit",
    payloadSchema: ExpiredPayloadSchema,
    description:
      "Approval window closed without user response. Soft negative signal; threshold rules promote to blacklist after repetition.",
  },
  {
    name: "silent_accept",
    polarity: "positive",
    defaultInference: "observe",
    source: "implicit",
    payloadSchema: SilentAcceptPayloadSchema,
    description:
      "Artifact was sent and received no negative action within window. Soft positive signal; threshold rules promote to whitelist after repetition.",
  },
];
