/**
 * multi-tenant-feedback — tenant isolation via partition_key.
 *
 * Scenario: a SaaS product hosts feedback for many customers ("tenants").
 * Each customer's events must be queryable independently. The framework
 * does not own tenant identity; it exposes `partition_key` and treats it
 * as opaque. Consumers populate `partition_key` with their tenant_id (or
 * `${tenant_id}:${artifact_id}`) and get tenant-scoped reads, projections,
 * and actionability rules for free.
 *
 * No schema changes, no separate database per tenant, no per-tenant
 * runtime — the framework's index on partition_key is the boundary.
 *
 * This example seeds events for 3 tenants ("acme", "globex", "initech"),
 * then runs the same query scoped per-tenant and shows the isolation.
 */
import {
  createFeedback,
  DEFAULT_ACTIONS,
  rejectByDefault,
  type CapturePort,
  type CapturedEvaluatedReactionEvent,
} from "@ai-feedback-middleware/core";
import {
  createInMemoryEventStore,
  createInMemoryProjectionStore,
  createInMemoryTrackedArtifactsStore,
} from "@ai-feedback-middleware/in-memory";

interface TenantContext {
  tenant_id: string;
}

/**
 * The framework primitive. Consumers wrap this so business code never has
 * to remember to set partition_key — the wrapper does it.
 */
function makeTenantClient(feedback: CapturePort, ctx: TenantContext) {
  // The convention: prefix BOTH artifact_id and partition_key with the
  // tenant_id. The framework's artifact_id is a global namespace, so two
  // tenants both calling captureArtifact with raw "draft-001" would
  // collide on the second call. Prefixing prevents that and keeps tenant
  // scoping consistent across reads.
  const scopedId = (id: string): string => `${ctx.tenant_id}/${id}`;
  return {
    async captureArtifact(input: {
      artifact_id: string;
      artifact_type: string;
      artifact_version: number;
      producer: string;
      task_type: string;
      payload: unknown;
      expires_at: string;
    }) {
      const tenantArtifactId = scopedId(input.artifact_id);
      return feedback.captureArtifact({
        ...input,
        artifact_id: tenantArtifactId,
        partition_key: tenantArtifactId,
      });
    },
    async recordReaction(input: { artifact_id: string; action: string; payload?: unknown }) {
      return feedback.recordReaction({
        ...input,
        artifact_id: scopedId(input.artifact_id),
      });
    },
    /** Tenant-scoped reaction reader. */
    async listReactions(): Promise<CapturedEvaluatedReactionEvent[]> {
      const out: CapturedEvaluatedReactionEvent[] = [];
      for await (const r of feedback.readReactions()) {
        if (r.partition_key.startsWith(`${ctx.tenant_id}/`)) {
          out.push(r);
        }
      }
      return out;
    },
  };
}

async function seedTenant(
  feedback: CapturePort,
  tenant_id: string,
  events: Array<{ artifact_id: string; action: string }>,
): Promise<void> {
  const tenant = makeTenantClient(feedback, { tenant_id });
  const future = (): string => new Date(Date.now() + 60_000).toISOString();
  for (const e of events) {
    await tenant.captureArtifact({
      artifact_id: e.artifact_id,
      artifact_type: "draft_email",
      artifact_version: 1,
      producer: "secretary-agent",
      task_type: "outbound:warm_intro",
      payload: { tenant_id }, // also denormalized into payload for cross-cut queries
      expires_at: future(),
    });
    await tenant.recordReaction({
      artifact_id: e.artifact_id,
      action: e.action,
      payload: { actor_id: `user-${tenant_id}` },
    });
  }
}

async function main(): Promise<void> {
  const feedback = createFeedback({
    eventStore: createInMemoryEventStore(),
    projectionStore: createInMemoryProjectionStore(),
    trackedArtifacts: createInMemoryTrackedArtifactsStore(),
    actions: DEFAULT_ACTIONS,
    artifactTypes: [rejectByDefault("draft_email")],
  });

  console.log("--- Seeding events for 3 tenants ---\n");
  await seedTenant(feedback, "acme", [
    { artifact_id: "draft-001", action: "approved" },
    { artifact_id: "draft-002", action: "manually_edited" },
    { artifact_id: "draft-003", action: "approved" },
  ]);
  await seedTenant(feedback, "globex", [
    { artifact_id: "draft-001", action: "rejected" },
    { artifact_id: "draft-002", action: "approved" },
  ]);
  await seedTenant(feedback, "initech", [{ artifact_id: "draft-001", action: "manually_edited" }]);

  console.log("--- Reading per-tenant ---\n");
  for (const tenant_id of ["acme", "globex", "initech"]) {
    const tenant = makeTenantClient(feedback, { tenant_id });
    const reactions = await tenant.listReactions();
    console.log(`  ${tenant_id.padEnd(10)} reactions=${reactions.length}`);
    for (const r of reactions) {
      console.log(`    - ${r.artifact_id.padEnd(12)} action=${r.action}`);
    }
  }

  console.log("\n--- Cross-tenant aggregation (admin / observability view) ---\n");
  const byTenant = new Map<string, number>();
  for await (const r of feedback.readReactions()) {
    const tenant_id = r.partition_key.split("/")[0]!;
    byTenant.set(tenant_id, (byTenant.get(tenant_id) ?? 0) + 1);
  }
  for (const [t, n] of byTenant) {
    console.log(`  ${t.padEnd(10)} total reactions: ${n}`);
  }

  console.log("\nKey takeaways:");
  console.log(
    "  • partition_key is the framework's tenant boundary. The framework doesn't own tenant",
  );
  console.log(
    "    identity — it exposes the field and treats it as opaque. You pick the convention.",
  );
  console.log(
    "  • Wrap captureArtifact in a tenant-aware client so business code can't forget to set",
  );
  console.log("    partition_key. Forgetting is the failure mode — guard against it at the seam.");
  console.log(
    "  • Adapter indexes on partition_key make tenant-scoped reads cheap (see the Postgres",
  );
  console.log("    schema's idx_captured_artifacts_partition + idx_reactions_partition).");
  console.log("  • If you need actionability rules per-tenant, scope the rule's applies_when by");
  console.log(
    "    task_type or by storing the tenant_id in task_type itself (e.g. `tenant:acme:draft`).",
  );
  console.log("    The framework doesn't enforce tenancy on rules; that's your responsibility.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
