/**
 * Wait until `predicate()` returns true, polling at `intervalMs` and
 * giving up at `timeoutMs`. Returns `true` if the predicate passed inside
 * the budget; `false` if it timed out.
 *
 * Used by conformance tests to await async event delivery. Replaces the
 * earlier fixed `setTimeout(50)` waits, which caused intermittent failures
 * on slow CI nodes.
 */
export async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  options: { timeoutMs?: number; intervalMs?: number } = {},
): Promise<boolean> {
  const timeoutMs = options.timeoutMs ?? 1500;
  const intervalMs = options.intervalMs ?? 10;
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  // One final check after the deadline so we do not race the very last tick.
  return (await predicate()) === true;
}
