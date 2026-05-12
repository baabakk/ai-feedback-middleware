import { z } from "zod";
import type { FeedbackActionDefinition } from "./actions.js";

/**
 * The framework-locked thirteen actions. See spec §4 and architecture §32.
 *
 * All names follow a past-tense passive-voice pattern: each describes what
 * happened to the artifact, not what the user did. The per-axis polarity
 * defaults are starting heuristics the classifier applies in absence of
 * richer signal; consumers may override per-event via
 * `RecordReactionInput.evaluations_override`.
 *
 * Polarity legend (per axis): `positive` | `negative` | undefined (omitted).
 * Source legend: `explicit` (user took an action), `implicit` (no direct
 * user action; framework or scan adapter detected), `meta` (operational
 * tombstone — excluded from inference; no per-axis evidence).
 */

// ---------- Payload schemas (per action) ---------------------------------

export const ApprovedPayloadSchema = z.object({
  actor_id: z.string().optional(),
  artifact_hash: z.string().optional(),
});

export const ManuallyEditedPayloadSchema = z.object({
  actor_id: z.string().optional(),
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

export const RejectedPayloadSchema = z.object({
  actor_id: z.string().optional(),
  reason: z.string().optional(),
});

export const RegeneratedPayloadSchema = z.object({
  actor_id: z.string().optional(),
  reason: z.string().optional(),
});

export const NotSelectedFromListPayloadSchema = z.object({
  competitors: z.array(z.string()),
  chosen: z.string(),
});

export const MuteTriggeredPayloadSchema = z.object({
  actor_id: z.string().optional(),
  trigger_pattern: z.string().optional(),
  scope: z.enum(["task_type", "producer", "artifact_type", "global"]).optional(),
});

export const SilentlyAcceptedPayloadSchema = z.object({
  approval_window_seconds: z.number().optional(),
  recipient_action: z.enum(["none", "replied", "forwarded"]).optional(),
});

export const SilentlyRejectedExpiredPayloadSchema = z.object({
  approval_window_seconds: z.number().optional(),
});

export const InternallyUnobservedExternallyCompletedPayloadSchema = z.object({
  detected_via: z.string().optional(),
  external_completion_at: z.string().optional(),
});

export const ManuallyReplacedPayloadSchema = z.object({
  actor_id: z.string().optional(),
  original: z.string().optional(),
  replacement: z.string(),
  diff_metrics: z
    .object({
      length_ratio: z.number().optional(),
      word_delta: z.number().optional(),
    })
    .optional(),
});

export const CorrectedPayloadSchema = z.object({
  reason: z.string(),
  actor_id: z.string().optional(),
});

export const CancelledPayloadSchema = z.object({
  reason: z.string(),
  actor_id: z.string().optional(),
});

export const SupersededByPayloadSchema = z.object({
  reason: z.string().optional(),
});

// ---------- Action vocabulary --------------------------------------------

export const DEFAULT_ACTIONS: FeedbackActionDefinition[] = [
  // --- Explicit feedback (user took a direct action) ---
  {
    name: "approved",
    source: "explicit",
    defaultEvaluations: {
      detection: "positive",
      content: "positive",
      timing: "positive",
      channel: "positive",
    },
    payloadSchema: ApprovedPayloadSchema,
    description: "User explicitly approved the artifact.",
  },
  {
    name: "manually_edited",
    source: "explicit",
    defaultEvaluations: {
      detection: "positive",
      content: "negative",
      timing: "positive",
      channel: "positive",
    },
    payloadSchema: ManuallyEditedPayloadSchema,
    description: "User opened, modified, used the edited version. Diff in payload.",
  },
  {
    name: "rejected",
    source: "explicit",
    defaultEvaluations: {
      // Detection deliberately empty: a single rejection cannot disambiguate
      // trigger error vs just-this-version content error.
      content: "negative",
    },
    payloadSchema: RejectedPayloadSchema,
    description:
      "User explicitly rejected this artifact. Detection uncertain — could be trigger or just this version.",
  },
  {
    name: "regenerated",
    source: "explicit",
    defaultEvaluations: {
      detection: "positive",
      content: "negative",
      timing: "positive",
      channel: "positive",
    },
    payloadSchema: RegeneratedPayloadSchema,
    description: "User asked for another attempt. Trigger right, content wrong.",
  },
  {
    name: "not_selected_from_list",
    source: "explicit",
    defaultEvaluations: {
      // Detection confirmed by the fact that the user picked *something* in the set.
      detection: "positive",
      content: "negative",
    },
    payloadSchema: NotSelectedFromListPayloadSchema,
    description:
      "One of N alternatives, not picked. Detection confirmed by selecting something in the set.",
  },
  {
    name: "mute_triggered",
    source: "explicit",
    defaultEvaluations: {
      // T and C as candidate causes; detection and content uncertain at the
      // single-event level. Mute is rejection-of-engagement, not a positive
      // signal on detection.
      timing: "negative",
      channel: "negative",
    },
    payloadSchema: MuteTriggeredPayloadSchema,
    description:
      "User disabled the trigger pattern. Timing and channel as candidate causes; detection and content uncertain at single-event level.",
  },

  // --- Implicit feedback (framework or scan adapter detects) ---
  {
    name: "silently_accepted",
    source: "implicit",
    defaultEvaluations: {
      detection: "positive",
      content: "positive",
    },
    payloadSchema: SilentlyAcceptedPayloadSchema,
    description:
      "(accepted_by_default policy.) Deadline passed without reaction; silence reads as endorsement on D and C. Timing and channel uncertain.",
  },
  {
    name: "silently_rejected_expired",
    source: "implicit",
    defaultEvaluations: {
      // Aggregate-negative is policy-driven; no per-axis evidence from a single
      // event. Cross-event inference rules (Layer 4) localize which axis is at fault.
    },
    payloadSchema: SilentlyRejectedExpiredPayloadSchema,
    description:
      "(rejected_by_default policy.) Deadline passed without reaction. Aggregate-negative is policy-driven; no per-axis evidence from one event.",
  },
  {
    name: "internally_unobserved_externally_completed",
    source: "implicit",
    defaultEvaluations: {
      // Pure detection failure (we missed the trigger). Other axes
      // structurally don't apply: no artifact existed.
      detection: "negative",
    },
    payloadSchema: InternallyUnobservedExternallyCompletedPayloadSchema,
    description:
      "User completed the task externally; the framework never produced an artifact. Pure detection failure.",
  },
  {
    name: "manually_replaced",
    source: "implicit",
    defaultEvaluations: {
      // Framework produced an artifact; user did the task with their own
      // version from scratch. Detection right (we noticed); content rejected.
      detection: "positive",
      content: "negative",
    },
    payloadSchema: ManuallyReplacedPayloadSchema,
    description:
      "Framework produced an artifact; user did the task with their own version from scratch.",
  },

  // --- Meta / tombstone (excluded from inference; no per-axis evidence) ---
  {
    name: "corrected",
    source: "meta",
    defaultEvaluations: {},
    payloadSchema: CorrectedPayloadSchema,
    description:
      "Appended event that supersedes a prior event by event_id with stated reason. Original event remains unchanged.",
  },
  {
    name: "cancelled",
    source: "meta",
    defaultEvaluations: {},
    payloadSchema: CancelledPayloadSchema,
    description:
      "Lifecycle terminated by explicit non-feedback decision (duplicate, business cancellation, stale cleanup).",
  },
  {
    name: "superseded_by",
    source: "meta",
    defaultEvaluations: {},
    payloadSchema: SupersededByPayloadSchema,
    description:
      "Lifecycle terminated in favor of a successor. payload.successor_artifact_id carries the link. Successor's events apply going forward.",
  },
];

/**
 * Set of action names whose source is `meta`. Useful for tombstone-aware
 * filtering at inference time.
 */
export const META_ACTION_NAMES: ReadonlySet<string> = new Set(
  DEFAULT_ACTIONS.filter((a) => a.source === "meta").map((a) => a.name),
);

/**
 * Locked names of the framework's three tombstone actions. Tombstone-aware
 * filtering in Layer 4 keys off these names.
 */
export const TOMBSTONE_ACTION_NAMES = ["cancelled", "corrected", "superseded_by"] as const;
export type TombstoneActionName = (typeof TOMBSTONE_ACTION_NAMES)[number];

/**
 * @deprecated v1 names retained for upcaster code only. New consumers must
 * use the past-tense names from {@link DEFAULT_ACTIONS}.
 */
export const V1_ACTION_RENAMES: Readonly<Record<string, string>> = {
  approve: "approved",
  edit: "manually_edited",
  reject: "rejected",
  regenerate: "regenerated",
  expired: "silently_rejected_expired",
  silent_accept: "silently_accepted",
};
