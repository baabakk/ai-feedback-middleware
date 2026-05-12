# topk-rag-selection

Captures the full "the user chose A out of A/B/C/D/E" signal — not just "the user approved A." Use this for any selection-from-a-set UI: RAG retrieval results, model-output A/B testing, image-generation variant picking, ranker training data.

## Problem

Naive instrumentation captures `approved` on the picked option and silently drops the others. That throws away the most valuable signal: **which losers it beat**. You can't train a ranker on "A is good" alone; you need "A is good and B, C, D, E were rejected in the same comparison context."

## Solution

`feedback.recordCompetitiveSelection(...)` writes N reactions in a single atomic batch:

- The chosen artifact → `action: "approved"`.
- Every other alternative → `action: "not_selected_from_list"`.

Each loser carries `{ competitors: [...], chosen }` in its payload, so any downstream consumer can reconstruct the comparison set without joining. Per-axis evaluation:

| Reaction                          | detection                                       | content  |
| --------------------------------- | ----------------------------------------------- | -------- |
| `approved` (chosen)               | positive                                        | positive |
| `not_selected_from_list` (losers) | **positive** (user picked something in the set) | negative |

## Run

```bash
pnpm --filter topk-rag-selection start
```

## What it shows

- `recordCompetitiveSelection({ alternatives, chosen, selection_method, payload })`
- Atomic fan-out — projections see the full comparison at once
- The `not_selected_from_list` action with correct per-axis defaults (detection positive, content negative)
- How to attach the query/context to every reaction's payload for retrievability

## Adapt it

| Use case                      | What changes                                                                                                                   |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Image-gen variants**        | `artifact_type: "image_variant"`, `selection_method: "user_pick"`. Train a preference model from the resulting reactions.      |
| **Multi-armed bandit reward** | Pipe the chosen + losers into your bandit's reward path. The framework's per-axis evaluations are the structured reward shape. |
| **Recommender training data** | Each comparative event is one training row: `(query, candidates, chosen) → relevance labels`.                                  |
| **Prompt A/B/N testing**      | `artifact_type: "prompt_variant"`. Aggregate `approved`/`not_selected_from_list` counts per prompt to find winners.            |

## Variants on `selection_method`

The framework accepts a free-form string here — the framework-locked values are just conventions. Common ones:

- `"user_pick"` — explicit user click
- `"scoring_tiebreak"` — algorithmic, e.g. highest BM25 score
- `"policy"` — rule-based, e.g. "always pick the lowest-latency model"
- `"random"` — for control groups in experiments
