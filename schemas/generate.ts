/**
 * Schema regenerator + drift checker (v2.1).
 *
 * The Zod schemas in `packages/core/src/event-types.ts` and
 * `packages/core/src/inference-engine.ts` are the source of truth. The
 * JSON-Schema and protobuf artifacts in this folder are convenience exports
 * for non-Node consumers. They must be kept in sync.
 *
 * This script imports the Zod schemas, walks each top-level shape, and
 * asserts the JSON-Schema `properties` keys + the `required` array stay in
 * lock-step. It does not auto-rewrite the JSON-Schema files. When it fails,
 * hand-edit the JSON Schema (and proto) files, then re-run.
 *
 * Run from the framework root, after building core so the dist exists:
 *
 *   pnpm --filter @ai-feedback-middleware/core build
 *   pnpm dlx tsx schemas/generate.ts
 *
 * Exit code 0 means the artifacts are in sync. Exit code 1 means drift; the
 * script prints the diff and you fix the artifacts by hand.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CapturedArtifactEventSchema,
  CapturedEvaluatedReactionEventSchema,
  ProvenanceSchema,
  EvaluationVectorSchema,
} from "../packages/core/dist/index.js";

const here = dirname(fileURLToPath(import.meta.url));

interface JsonSchema {
  required?: string[];
  properties?: Record<string, unknown>;
}

function loadJsonSchema(path: string): JsonSchema {
  return JSON.parse(readFileSync(resolve(here, path), "utf8")) as JsonSchema;
}

function zodTopLevelKeys(shape: Record<string, { isOptional: () => boolean }>): {
  required: string[];
  optional: string[];
} {
  const required: string[] = [];
  const optional: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    if (value.isOptional()) {
      optional.push(key);
    } else {
      required.push(key);
    }
  }
  return { required: required.sort(), optional: optional.sort() };
}

function diffArrays(label: string, want: string[], got: string[]): string[] {
  const errors: string[] = [];
  const wantSet = new Set(want);
  const gotSet = new Set(got);
  for (const k of want) {
    if (!gotSet.has(k)) errors.push(`${label}: missing key in JSON Schema: ${k}`);
  }
  for (const k of got) {
    if (!wantSet.has(k)) errors.push(`${label}: extra key in JSON Schema: ${k}`);
  }
  return errors;
}

function checkSchema(
  jsonPath: string,
  shape: Record<string, { isOptional: () => boolean }>,
  label: string,
): string[] {
  const errors: string[] = [];
  const json = loadJsonSchema(jsonPath);
  const { required, optional } = zodTopLevelKeys(shape);
  const allKeys = [...required, ...optional].sort();
  const jsonProps = Object.keys(json.properties ?? {}).sort();
  const jsonRequired = (json.required ?? []).slice().sort();
  errors.push(...diffArrays(`${label} properties`, allKeys, jsonProps));
  errors.push(...diffArrays(`${label} required`, required, jsonRequired));
  return errors;
}

function main(): void {
  const errors: string[] = [];

  // CapturedArtifactEvent
  errors.push(
    ...checkSchema(
      "./captured-artifact.schema.json",
      CapturedArtifactEventSchema.shape as Record<string, { isOptional: () => boolean }>,
      "CapturedArtifactEvent",
    ),
  );

  // CapturedEvaluatedReactionEvent
  errors.push(
    ...checkSchema(
      "./captured-evaluated-reaction.schema.json",
      CapturedEvaluatedReactionEventSchema.shape as Record<string, { isOptional: () => boolean }>,
      "CapturedEvaluatedReactionEvent",
    ),
  );

  // Provenance is shared between the two event shapes; cross-check via the
  // capture-event JSON Schema.
  const captureJson = loadJsonSchema("./captured-artifact.schema.json");
  const provShape = ProvenanceSchema.shape;
  const provZodKeys = Object.keys(provShape).sort();
  const provJsonProps = Object.keys(
    ((captureJson.properties?.provenance as { properties?: Record<string, unknown> })?.properties ??
      {}) as Record<string, unknown>,
  ).sort();
  errors.push(...diffArrays("Provenance properties (capture)", provZodKeys, provJsonProps));

  // EvaluationVector on the reaction schema.
  const reactionJson = loadJsonSchema("./captured-evaluated-reaction.schema.json");
  const evalShape = EvaluationVectorSchema.shape;
  const evalZodKeys = Object.keys(evalShape).sort();
  const evalJsonProps = Object.keys(
    ((reactionJson.properties?.evaluations as { properties?: Record<string, unknown> })
      ?.properties ?? {}) as Record<string, unknown>,
  ).sort();
  errors.push(...diffArrays("EvaluationVector axes", evalZodKeys, evalJsonProps));

  if (errors.length === 0) {
    console.log(
      "schemas/{captured-artifact,captured-evaluated-reaction,actionability-decision}.schema.json " +
        "are in sync with the Zod source of truth.",
    );
    process.exit(0);
  }

  console.error("Schema drift detected. Fix the JSON Schema (and proto) files so they match Zod.");
  console.error("");
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

main();
