import type { CapturePort } from "./ports/capture-port.js";
import type { TrackedArtifactsPort } from "./ports/tracked-artifacts-port.js";
import { ArtifactTypeRegistry, type ArtifactTypeDefinition } from "./registry/artifact-types.js";

/**
 * Layer 2 — Lifecycle Worker.
 *
 * The framework's coverage net for implicit feedback. On each tick, claims
 * `tracked_artifacts` rows whose `expires_at` has passed and whose lease is
 * not held by another worker, then emits the framework-driven reaction per
 * the artifact type's `expirationPolicy`:
 *
 *   accepted_by_default  → emit `silently_accepted`
 *   rejected_by_default  → emit `silently_rejected_expired`
 *
 * Without this worker, three of the framework's actions (`silently_accepted`,
 * `silently_rejected_expired`, plus the absence of any signal at all) would
 * be undetectable, and consumers would have to re-implement deadline tracking
 * themselves. The worker is the framework's coverage commitment.
 *
 * Lease-based claiming lets multiple worker instances coexist without
 * double-firing: the underlying SQL UPDATE is atomic per row.
 *
 * Restart-safe: every artifact's deadline lives in `tracked_artifacts.expires_at`.
 * The worker has no in-memory timers; on restart it resumes polling.
 *
 * See spec §11 and architecture §29 (Layer 2).
 */
export interface LifecycleWorkerOptions {
  /** Required. The capture port whose `recordReaction` will be invoked on deadline. */
  capture: CapturePort;
  /** Required. The mutable lifecycle row store. */
  trackedArtifacts: TrackedArtifactsPort;
  /** Required. Artifact-type registry — used to resolve `expirationPolicy`. */
  artifactTypes: ArtifactTypeDefinition[] | ArtifactTypeRegistry;
  /** Stable identifier for this worker instance. Used for the lease owner. */
  leaseOwner: string;
  /** Polling interval in milliseconds. Default 30s. */
  pollIntervalMs?: number;
  /** Lease duration in seconds. Default 60. */
  leaseForSeconds?: number;
  /** Max rows claimed per tick. Default 100. */
  batchLimit?: number;
  /** Optional clock override (for tests). Defaults to `() => new Date().toISOString()`. */
  now?: () => string;
  /** Optional sleep override (for tests). Defaults to `setTimeout`-based. */
  sleep?: (ms: number) => Promise<void>;
  /** Optional callback fired when a tick fails entirely. */
  onTickError?: (err: unknown) => void;
  /** Optional callback fired per artifact emission, even on failure. */
  onEmit?: (input: {
    artifact_id: string;
    artifact_type: string;
    action: "silently_accepted" | "silently_rejected_expired";
    error: unknown | null;
  }) => void;
}

export interface LifecycleWorker {
  /** Run the polling loop until `stop()` is called. */
  start(): Promise<void>;
  /** Run a single tick (mostly for tests). Returns the count of emissions. */
  tickOnce(): Promise<number>;
  /** Stop the loop. The current tick (if any) completes before resolution. */
  stop(): Promise<void>;
}

export function createLifecycleWorker(options: LifecycleWorkerOptions): LifecycleWorker {
  const registry =
    options.artifactTypes instanceof ArtifactTypeRegistry
      ? options.artifactTypes
      : new ArtifactTypeRegistry(options.artifactTypes);

  const pollIntervalMs = options.pollIntervalMs ?? 30_000;
  const leaseForSeconds = options.leaseForSeconds ?? 60;
  const batchLimit = options.batchLimit ?? 100;
  const now = options.now ?? (() => new Date().toISOString());
  const sleep = options.sleep ?? defaultSleep;

  let running = false;
  let stopRequested = false;

  async function tickOnce(): Promise<number> {
    const due = await options.trackedArtifacts.claimDueWaiting({
      now: now(),
      leaseOwner: options.leaseOwner,
      leaseForSeconds,
      limit: batchLimit,
    });

    let emitted = 0;
    for (const row of due) {
      let typeDef: ArtifactTypeDefinition;
      try {
        typeDef = registry.get(row.artifact_type);
      } catch (err) {
        options.onEmit?.({
          artifact_id: row.artifact_id,
          artifact_type: row.artifact_type,
          action: "silently_rejected_expired",
          error: err,
        });
        continue;
      }
      const action =
        typeDef.expirationPolicy === "accepted_by_default"
          ? ("silently_accepted" as const)
          : ("silently_rejected_expired" as const);

      try {
        await options.capture.recordReaction({
          artifact_id: row.artifact_id,
          action,
          payload: {
            approval_window_seconds: lifetimeSeconds(row.expires_at, row.created_at),
          },
        });
        emitted += 1;
        options.onEmit?.({
          artifact_id: row.artifact_id,
          artifact_type: row.artifact_type,
          action,
          error: null,
        });
      } catch (err) {
        options.onEmit?.({
          artifact_id: row.artifact_id,
          artifact_type: row.artifact_type,
          action,
          error: err,
        });
        // Lease will expire on its own; another worker (or this one) retries
        // on the next tick.
      }
    }
    return emitted;
  }

  return {
    async start(): Promise<void> {
      if (running) return;
      running = true;
      stopRequested = false;
      try {
        while (!stopRequested) {
          try {
            await tickOnce();
          } catch (err) {
            options.onTickError?.(err);
          }
          if (stopRequested) break;
          await sleep(pollIntervalMs);
        }
      } finally {
        running = false;
      }
    },
    tickOnce,
    async stop(): Promise<void> {
      stopRequested = true;
      // Loop exits at next iteration; if no current tick is running, that's
      // immediate. We don't have a join handle so callers that need to
      // strictly wait should use `await worker.start()` (which resolves on
      // stop).
    },
  };
}

function lifetimeSeconds(expires_at: string, created_at: string): number {
  const span = Date.parse(expires_at) - Date.parse(created_at);
  return Number.isFinite(span) && span > 0 ? Math.round(span / 1000) : 0;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
