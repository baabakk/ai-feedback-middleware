import type { z } from "zod";

export type RetentionPolicy = {
  full_payload_days: number;
  metadata_retention: "forever" | string;
};

/**
 * Per-artifact-type policy for what silence-until-deadline means.
 *
 * - `accepted_by_default`: no reaction within the window reads as silent
 *   acceptance. The Lifecycle Worker emits `silently_accepted` on deadline
 *   (implicit positive). Example: a daily briefing the user has 24h to flag
 *   if it's wrong.
 * - `rejected_by_default`: no reaction within the window reads as rejection.
 *   The Lifecycle Worker emits `silently_rejected_expired` on deadline
 *   (implicit negative). Example: an outbound email draft requiring explicit
 *   approval before sending.
 *
 * Required, no default. See spec §5 and architecture §38 for why this is a
 * required choice — making it inheritable or providing a global default is
 * exactly the failure mode that produces incoherent implicit-feedback data.
 */
export type ExpirationPolicy = "accepted_by_default" | "rejected_by_default";

export interface ArtifactTypeDefinition {
  name: string;

  /**
   * REQUIRED. What does silence-until-deadline mean for this artifact type?
   */
  expirationPolicy: ExpirationPolicy;

  payloadSchema?: z.ZodType<unknown>;
  partitioningStrategy?: "by_artifact_id" | "by_session_id" | "custom";
  retentionPolicy?: RetentionPolicy;
  description?: string;
}

export class ArtifactTypeRegistry {
  private readonly types = new Map<string, ArtifactTypeDefinition>();

  constructor(types: ArtifactTypeDefinition[] = []) {
    for (const type of types) {
      this.register(type);
    }
  }

  register(type: ArtifactTypeDefinition): void {
    if (this.types.has(type.name)) {
      throw new Error(`Artifact type already registered: ${type.name}`);
    }
    if (
      type.expirationPolicy !== "accepted_by_default" &&
      type.expirationPolicy !== "rejected_by_default"
    ) {
      throw new Error(
        `Artifact type "${type.name}" must declare expirationPolicy as ` +
          `"accepted_by_default" or "rejected_by_default". Got: ${String(type.expirationPolicy)}`,
      );
    }
    this.types.set(type.name, type);
  }

  get(name: string): ArtifactTypeDefinition {
    const type = this.types.get(name);
    if (!type) {
      throw new Error(
        `Unknown artifact type: ${name}. Registered types: ${Array.from(this.types.keys()).join(", ")}`,
      );
    }
    return type;
  }

  has(name: string): boolean {
    return this.types.has(name);
  }

  list(): ArtifactTypeDefinition[] {
    return Array.from(this.types.values());
  }
}

/**
 * Helper constructor: declares an artifact type whose silence reads as
 * acceptance. Equivalent to:
 *
 * ```ts
 * { name, expirationPolicy: "accepted_by_default", ...overrides }
 * ```
 *
 * See spec §5.2.
 */
export function acceptByDefault(
  name: string,
  overrides: Omit<ArtifactTypeDefinition, "name" | "expirationPolicy"> = {},
): ArtifactTypeDefinition {
  return {
    name,
    expirationPolicy: "accepted_by_default",
    ...overrides,
  };
}

/**
 * Helper constructor: declares an artifact type whose silence reads as
 * rejection. Equivalent to:
 *
 * ```ts
 * { name, expirationPolicy: "rejected_by_default", ...overrides }
 * ```
 *
 * See spec §5.2.
 */
export function rejectByDefault(
  name: string,
  overrides: Omit<ArtifactTypeDefinition, "name" | "expirationPolicy"> = {},
): ArtifactTypeDefinition {
  return {
    name,
    expirationPolicy: "rejected_by_default",
    ...overrides,
  };
}
