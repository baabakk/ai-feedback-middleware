import type { DedupeStorePort } from "@ai-feedback-middleware/core";

/**
 * In-memory dedupe store with TTL-based expiry. Keys auto-expire when
 * checked after their TTL has passed (lazy cleanup). For tests and small
 * single-process deployments.
 */
export function createInMemoryDedupeStore(): DedupeStorePort {
  const seen = new Map<string, number>(); // key -> expiresAtMs

  function isExpired(expiresAt: number): boolean {
    return Date.now() >= expiresAt;
  }

  return {
    async seen(key: string): Promise<boolean> {
      const expiresAt = seen.get(key);
      if (expiresAt === undefined) return false;
      if (isExpired(expiresAt)) {
        seen.delete(key);
        return false;
      }
      return true;
    },

    async mark(key: string, ttlMs: number): Promise<void> {
      seen.set(key, Date.now() + ttlMs);
    },
  };
}
