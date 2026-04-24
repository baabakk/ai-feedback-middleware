import { z } from "zod";

export type Source = "explicit" | "implicit";
export type Polarity = "positive" | "negative" | "neutral";
export type Inference = "whitelist" | "blacklist" | "observe";

export const ProvenanceSchema = z.object({
  channel: z.string(),
  instance_id: z.string().optional(),
  latency_ms: z.number().optional(),
  captured_by_adapter: z.string(),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;

export const FeedbackEventSchema = z.object({
  event_id: z.string(),
  event_version: z.number().int().positive(),

  timestamp: z.string(),
  captured_at: z.string(),

  partition_key: z.string(),

  source: z.enum(["explicit", "implicit"]),
  polarity: z.enum(["positive", "negative", "neutral"]),
  inference: z.enum(["whitelist", "blacklist", "observe"]),
  action: z.string(),

  artifact_type: z.string(),
  artifact_id: z.string(),
  artifact_version: z.number().int().nonnegative(),
  producer: z.string(),
  task_type: z.string(),

  payload: z.unknown(),
  provenance: ProvenanceSchema,

  correction_of: z.string().optional(),
  correlates_with: z.array(z.string()).optional(),
});

export type FeedbackEvent = z.infer<typeof FeedbackEventSchema>;

export interface CaptureInput {
  action: string;
  artifact_type: string;
  artifact_id: string;
  artifact_version: number;
  producer: string;
  task_type: string;
  payload: unknown;
  partition_key?: string;
  source?: Source;
  provenance?: Partial<Provenance>;
  timestamp?: string;
  correction_of?: string;
  correlates_with?: string[];
}

export interface EventFilter {
  source?: Source;
  polarity?: Polarity;
  inference?: Inference;
  action?: string;
  artifact_type?: string;
  producer?: string;
  task_type?: string;
  partition_key?: string;
  from_timestamp?: string;
  to_timestamp?: string;
}
