import type { Transaction } from "./event-store-port.js";

/**
 * Generic key/value store for projection state.
 *
 * One adapter handles all projections via projection_name. Each projection
 * owns its own keyspace within the store.
 */
export interface ProjectionStorePort {
  /** Get the current state for a (projection, key) pair. Returns null if not present. */
  get<T = unknown>(projectionName: string, key: string, tx?: Transaction): Promise<T | null>;

  /** Put state for a (projection, key) pair, recording the event_id that produced it. */
  put<T = unknown>(
    projectionName: string,
    key: string,
    state: T,
    eventId: string,
    tx?: Transaction,
  ): Promise<void>;

  /** List state entries for a projection, with an opaque filter and page size. */
  list<T = unknown>(projectionName: string, filter: unknown, pageSize: number): Promise<T[]>;

  /** Read the current checkpoint (last event_id processed) for a projection. */
  checkpoint(projectionName: string): Promise<string | null>;

  /** Set the checkpoint for a projection. */
  setCheckpoint(projectionName: string, eventId: string): Promise<void>;

  /** Truncate all state for a projection (used during rebuild). */
  truncate(projectionName: string): Promise<void>;
}
