#!/usr/bin/env node
/**
 * Integration-test runner: boots throwaway Postgres + Redis via
 * docker-compose.test.yml, sets the env vars the conformance suites look
 * for, runs `pnpm -r test`, then tears down. Always tears down — even when
 * the test run fails — so local re-runs start clean.
 *
 * Requires Docker (with `docker compose` v2). On Windows, Docker Desktop is
 * sufficient.
 *
 * Usage:
 *   pnpm test:integration
 *
 * Override the project name (useful when running multiple in parallel):
 *   COMPOSE_PROJECT=my-prefix pnpm test:integration
 */
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");
const composeFile = join(repoRoot, "docker-compose.test.yml");
const projectName = process.env.COMPOSE_PROJECT ?? "lfm-test";

const PG_URL = "postgres://feedback:feedback@127.0.0.1:55432/feedback_test";
const REDIS_URL = "redis://127.0.0.1:56379";

if (!existsSync(composeFile)) {
  console.error(`docker-compose.test.yml not found at ${composeFile}`);
  process.exit(1);
}

/** Run a command and stream stdio. Resolves with the exit code. */
function run(cmd, args, opts = {}) {
  return new Promise((resolveRun) => {
    const child = spawn(cmd, args, { stdio: "inherit", shell: false, ...opts });
    child.on("exit", (code) => resolveRun(code ?? 0));
    child.on("error", (err) => {
      console.error(`failed to spawn ${cmd}:`, err.message);
      resolveRun(127);
    });
  });
}

async function compose(...args) {
  return run("docker", ["compose", "-f", composeFile, "-p", projectName, ...args], {
    cwd: repoRoot,
  });
}

async function teardown() {
  console.log("\n--- tearing down test infrastructure ---");
  await compose("down", "-v");
}

let teardownScheduled = false;
function scheduleTeardown() {
  if (teardownScheduled) return;
  teardownScheduled = true;
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, async () => {
      await teardown();
      process.exit(130);
    });
  }
}

async function main() {
  console.log("--- bringing up test infrastructure ---");
  const upCode = await compose("up", "-d", "--wait", "--remove-orphans");
  if (upCode !== 0) {
    console.error("docker compose up failed; aborting.");
    await teardown();
    process.exit(upCode);
  }
  scheduleTeardown();

  console.log(`\nFEEDBACK_TEST_DATABASE_URL=${PG_URL}`);
  console.log(`REDIS_URL=${REDIS_URL}`);
  console.log("\n--- running pnpm -r test ---\n");

  const env = {
    ...process.env,
    FEEDBACK_TEST_DATABASE_URL: PG_URL,
    TEST_DATABASE_URL: PG_URL,
    FEEDBACK_TEST_REDIS_URL: REDIS_URL,
    TEST_REDIS_URL: REDIS_URL,
    REDIS_URL,
  };

  const isWindows = process.platform === "win32";
  const cmd = isWindows ? "pnpm.cmd" : "pnpm";
  const testCode = await run(cmd, ["-r", "test"], { cwd: repoRoot, env });

  await teardown();
  process.exit(testCode);
}

main().catch(async (err) => {
  console.error("integration runner failed:", err);
  await teardown();
  process.exit(1);
});
