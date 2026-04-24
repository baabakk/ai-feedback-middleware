import type { z } from "zod";

export type RetentionPolicy = {
  full_payload_days: number;
  metadata_retention: "forever" | string;
};

export interface ArtifactTypeDefinition {
  name: string;
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
