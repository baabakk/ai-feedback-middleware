/**
 * topk-rag-selection — comparative selection via recordCompetitiveSelection.
 *
 * Scenario: a RAG retriever returns top-5 candidate documents for a query.
 * The user picks one and ignores the rest. Naive instrumentation captures
 * a single "approved" on the chosen one and drops the losers on the floor.
 * That's lossy: the fact that A beat B, C, D, E is signal — both about
 * the retriever's ranking and about what makes A a good answer here.
 *
 * `recordCompetitiveSelection` writes ONE atomic batch of N reactions:
 *   - chosen artifact → action="approved"
 *   - each loser     → action="not_selected_from_list"
 *
 * Each loser's payload carries `{ competitors: [...], chosen }` so a
 * downstream consumer can reconstruct the full comparison set per event.
 * The detection axis on losers is `positive` (the user picked SOMETHING
 * from the set, so the trigger was right); the content axis is `negative`
 * for losers and `positive` for the chosen one. Timing + channel are
 * empty by default — a comparative pick doesn't disambiguate those axes.
 */
import {
  createFeedback,
  DEFAULT_ACTIONS,
  acceptByDefault,
  type CapturedEvaluatedReactionEvent,
} from "@ai-feedback-middleware/core";
import {
  createInMemoryEventStore,
  createInMemoryProjectionStore,
  createInMemoryTrackedArtifactsStore,
} from "@ai-feedback-middleware/in-memory";

interface RagCandidate {
  doc_id: string;
  title: string;
  retrieval_score: number;
}

async function main(): Promise<void> {
  const feedback = createFeedback({
    eventStore: createInMemoryEventStore(),
    projectionStore: createInMemoryProjectionStore(),
    trackedArtifacts: createInMemoryTrackedArtifactsStore(),
    actions: DEFAULT_ACTIONS,
    artifactTypes: [acceptByDefault("rag_candidate")],
  });

  const query = "How do I configure shared Postgres for multi-tenant isolation?";
  const candidates: RagCandidate[] = [
    { doc_id: "doc-tenancy-101", title: "Tenancy 101", retrieval_score: 0.92 },
    {
      doc_id: "doc-rls-vs-schema",
      title: "Row-level security vs schema-per-tenant",
      retrieval_score: 0.88,
    },
    {
      doc_id: "doc-partition-key",
      title: "Picking a tenant partition_key",
      retrieval_score: 0.81,
    },
    {
      doc_id: "doc-shared-pool",
      title: "Sharing a connection pool across tenants",
      retrieval_score: 0.79,
    },
    {
      doc_id: "doc-isolation-tests",
      title: "Writing tenant-isolation tests",
      retrieval_score: 0.74,
    },
  ];

  const future = (): string => new Date(Date.now() + 60_000).toISOString();

  console.log(`--- Query: "${query}"\n`);
  console.log("--- Capturing 5 retrieval results as governed artifacts ---\n");

  for (const c of candidates) {
    await feedback.captureArtifact({
      artifact_type: "rag_candidate",
      artifact_id: c.doc_id,
      artifact_version: 1,
      producer: "rag-retriever",
      task_type: "retrieve:user_query",
      payload: { title: c.title, retrieval_score: c.retrieval_score, query },
      expires_at: future(),
    });
    console.log(`  ${c.doc_id.padEnd(22)} score=${c.retrieval_score}`);
  }

  // The user picks doc-rls-vs-schema, not the top-ranked one. That's a
  // valuable signal — the retriever's score ordering was wrong here.
  const chosen = "doc-rls-vs-schema";
  console.log(`\n--- User picks "${chosen}" (not the top-ranked candidate) ---\n`);

  const result = await feedback.recordCompetitiveSelection({
    alternatives: candidates.map((c) => c.doc_id),
    chosen,
    selection_method: "user_pick",
    payload: { query },
  });
  console.log(`  Fanned out ${result.event_ids.length} reactions atomically`);

  console.log("\n--- Reaction log ---\n");
  const reactions: CapturedEvaluatedReactionEvent[] = [];
  for await (const r of feedback.readReactions({ artifact_type: "rag_candidate" })) {
    reactions.push(r);
  }
  for (const r of reactions) {
    const e = r.evaluations;
    const axes = (["detection", "content"] as const)
      .map((a) => `${a[0]}=${e[a] ?? "—"}`)
      .join(" ");
    const competitors = (r.payload as { competitors?: string[] })?.competitors ?? [];
    console.log(
      `  ${r.artifact_id.padEnd(22)} action=${r.action.padEnd(24)} ${axes}` +
        (competitors.length > 0 ? `  competitors=[${competitors.length}]` : ""),
    );
  }

  console.log("\nKey takeaways:");
  console.log(
    "  • Single atomic fan-out: all 5 reactions live in one transaction so projections see",
  );
  console.log("    the full comparison at once, not 5 partial states.");
  console.log(
    "  • Chosen gets `approved` (all axes positive); losers get `not_selected_from_list`",
  );
  console.log(
    "    (detection: positive because user picked SOMETHING in the set; content: negative).",
  );
  console.log(
    "  • Each loser's payload carries the full competitor list, so downstream consumers can",
  );
  console.log("    reconstruct 'A beat B, C, D, E' without joins.");
  console.log(
    "  • Use the same primitive for: ranker training data, prompt A/B/N testing, image-gen",
  );
  console.log("    variant selection, multi-armed-bandit reward signals.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
