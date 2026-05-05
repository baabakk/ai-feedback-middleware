/**
 * Schema regenerator + drift checker.
 *
 * The Zod schema in `packages/core/src/event-types.ts` is the source of
 * truth. The JSON-Schema and protobuf artifacts in this folder are
 * convenience exports for non-Node consumers. They must be kept in sync.
 *
 * This script is intentionally tiny and dependency-free: it imports the
 * Zod schema, walks its top-level shape, and asserts the JSON-Schema
 * `properties` keys plus the `required` array stay in lock-step. It does
 * not auto-rewrite the JSON-Schema file. When it fails, hand-edit
 * `feedback-event.schema.json` and `feedback-event.proto`, then re-run.
 *
 * Why no auto-write? Two reasons:
 *
 * 1. The JSON-Schema and protobuf artifacts are short and human-edited
 *    documentation as much as machine-readable schemas. Tags like
 *    `description`, `minimum`, and `format` exist in the artifacts but not
 *    in the Zod schema. Auto-writing would lose those.
 * 2. Adding `zod-to-json-schema` as a dependency just for this script
 *    pulls in a non-trivial dependency for a small monorepo. We prefer the
 *    drift check.
 *
 * Run from the framework root, after building core so the dist exists:
 *
 *   pnpm --filter @llm-feedback-middleware/core build
 *   node --experimental-strip-types schemas/generate.ts
 *
 * (Or `pnpm dlx tsx schemas/generate.ts` if you have tsx available.)
 *
 * Exit code 0 means the artifacts are in sync. Exit code 1 means there is
 * drift; the script prints the diff and you fix the artifacts by hand.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FeedbackEventSchema, ProvenanceSchema } from "../packages/core/dist/event-types.js";

const here = dirname(fileURLToPath(import.meta.url));

interface JsonSchema {
  required?: string[];
  properties?: Record<string, unknown>;
}

function loadJsonSchema(path: string): JsonSchema {
  return JSON.parse(readFileSync(resolve(here, path), "utf8")) as JsonSchema;
}

function zodTopLevelKeys(schema: typeof FeedbackEventSchema): {
  required: string[];
  optional: string[];
} {
  const shape = schema.shape;
  const required: string[] = [];
  const optional: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    if ((value as { isOptional: () => boolean }).isOptional()) {
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

function main(): void {
  const errors: string[] = [];

  // FeedbackEvent
  const eventJson = loadJsonSchema("./feedback-event.schema.json");
  const { required: zodRequired, optional: zodOptional } = zodTopLevelKeys(FeedbackEventSchema);
  const allZodKeys = [...zodRequired, ...zodOptional].sort();
  const jsonProps = Object.keys(eventJson.properties ?? {}).sort();
  const jsonRequired = (eventJson.required ?? []).slice().sort();

  errors.push(...diffArrays("FeedbackEvent properties", allZodKeys, jsonProps));
  errors.push(...diffArrays("FeedbackEvent required", zodRequired, jsonRequired));

  // Provenance is nested but we still cross-check.
  const provShape = ProvenanceSchema.shape;
  const provZodKeys = Object.keys(provShape).sort();
  const provJsonProps = Object.keys(
    ((eventJson.properties?.provenance as { properties?: Record<string, unknown> })?.properties ??
      {}) as Record<string, unknown>,
  ).sort();
  errors.push(...diffArrays("Provenance properties", provZodKeys, provJsonProps));

  if (errors.length === 0) {
    console.log("schemas/feedback-event.schema.json is in sync with the Zod source of truth.");
    process.exit(0);
  }

  console.error("Schema drift detected. Fix schemas/feedback-event.schema.json (and");
  console.error("schemas/feedback-event.proto if applicable) so they match the Zod schema.");
  console.error("");
  for (const err of errors) console.error(`  - ${err}`);
  process.exit(1);
}

main();
