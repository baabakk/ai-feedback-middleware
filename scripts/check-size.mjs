#!/usr/bin/env node
/**
 * Bundle-size budget enforcement for every published package.
 *
 * Why a hand-rolled script instead of `size-limit` or `bundlewatch`?
 * Both are good tools but each pulls 50+ transitive deps that the framework
 * does not otherwise need. The framework's surface is small and the budgets
 * here are thresholds, not detailed analysis. A dependency-free script
 * stays in step with the project's "small, focused" ethos.
 *
 * Update the budget when you intentionally add API surface:
 *
 * 1. Run `pnpm build` to refresh `dist/` for every package.
 * 2. Run `pnpm size:check` and read the printed actual sizes.
 * 3. Bump the budget in the table below to the next round number above
 *    the new actual size (give yourself 10-20% headroom).
 * 4. Commit the budget bump alongside the change that grew the surface.
 *
 * Run from the framework root:
 *
 *   pnpm size:check
 *
 * Exit code 0 means every package is within budget. Exit code 1 means at
 * least one package exceeded its budget; the script prints the offenders
 * and the deltas.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Budgets in BYTES of the built `dist/index.js` (ESM output) per package.
// These reflect real F4-Round-2 sizes plus headroom; tighten once a release
// has shipped and we know how much to leave on the table.
const BUDGETS = {
  core: 40_000,
  "in-memory": 12_000,
  postgres: 25_000,
  "redis-pubsub": 10_000,
  streams: 5_000,
  reference: 8_000,
  "adapter-conformance": 35_000,
};

const here = process.cwd();

function checkOne(pkg, budget) {
  const distPath = join(here, "packages", pkg, "dist", "index.js");
  if (!existsSync(distPath)) {
    console.error(`[size:check] ${pkg}: dist/index.js missing — run "pnpm build" first.`);
    return { pkg, budget, actual: null, ok: false };
  }
  const actual = readFileSync(distPath).byteLength;
  const ok = actual <= budget;
  return { pkg, budget, actual, ok };
}

const results = Object.entries(BUDGETS).map(([pkg, budget]) => checkOne(pkg, budget));

const fmt = (n) => (n === null ? "  missing" : `${(n / 1024).toFixed(2).padStart(8, " ")} KB`);
const max = Math.max(...results.map((r) => r.pkg.length));

console.log("Package".padEnd(max + 2) + "Budget".padStart(12) + "  Actual".padStart(12) + "  Status");
console.log("-".repeat(max + 2 + 12 + 12 + 8));
for (const { pkg, budget, actual, ok } of results) {
  const status = ok ? "  OK" : "  OVER";
  console.log(pkg.padEnd(max + 2) + fmt(budget) + fmt(actual) + status);
}

const overs = results.filter((r) => !r.ok);
if (overs.length === 0) {
  console.log("\nAll packages within budget.");
  process.exit(0);
}

console.error("\nBundle-size budget breached. Either:");
console.error(" - Trim the public surface (preferred for accidental growth), or");
console.error(" - Bump the budget in scripts/check-size.mjs to ~110-120% of actual,");
console.error("   note the reason in the same commit, and add a CHANGELOG entry.");
for (const { pkg, budget, actual } of overs) {
  if (actual === null) continue;
  const over = (((actual - budget) / budget) * 100).toFixed(1);
  console.error(`   - ${pkg}: ${actual} bytes / budget ${budget} bytes (+${over}%)`);
}
process.exit(1);
