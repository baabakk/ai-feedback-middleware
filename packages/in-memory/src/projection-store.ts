import type { ProjectionStorePort } from "@llm-feedback-middleware/core";

export function createInMemoryProjectionStore(): ProjectionStorePort {
  // projection_name -> key -> { state, eventId }
  const data = new Map<string, Map<string, { state: unknown; eventId: string }>>();
  const checkpoints = new Map<string, string>();

  function bucket(name: string): Map<string, { state: unknown; eventId: string }> {
    let map = data.get(name);
    if (!map) {
      map = new Map();
      data.set(name, map);
    }
    return map;
  }

  return {
    async get<T = unknown>(projectionName: string, key: string): Promise<T | null> {
      const entry = data.get(projectionName)?.get(key);
      return (entry?.state ?? null) as T | null;
    },

    async put<T = unknown>(
      projectionName: string,
      key: string,
      state: T,
      eventId: string,
    ): Promise<void> {
      bucket(projectionName).set(key, { state, eventId });
    },

    async list<T = unknown>(
      projectionName: string,
      _filter: unknown,
      pageSize: number,
    ): Promise<T[]> {
      const map = data.get(projectionName);
      if (!map) return [];
      return Array.from(map.values())
        .slice(0, pageSize)
        .map((entry) => entry.state as T);
    },

    async checkpoint(projectionName: string): Promise<string | null> {
      return checkpoints.get(projectionName) ?? null;
    },

    async setCheckpoint(projectionName: string, eventId: string): Promise<void> {
      checkpoints.set(projectionName, eventId);
    },

    async truncate(projectionName: string): Promise<void> {
      data.delete(projectionName);
      checkpoints.delete(projectionName);
    },
  };
}
