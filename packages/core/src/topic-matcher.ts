/**
 * Shared topic-pattern matcher used by every event-bus adapter.
 *
 * The framework defines two wildcards over dot-segmented topics:
 *
 * - `*` — matches exactly one segment.
 * - `>` — matches one-or-more remaining segments (NATS-style "tail" wildcard).
 *
 * Both wildcards must occupy a whole segment. `foo.*.baz` is valid;
 * `foo.b*r.baz` is treated as a literal segment match (no partial wildcards).
 *
 * `#` is accepted as a synonym for `>` for compatibility with MQTT-flavored
 * mental models, but the framework's documented form is `>`.
 *
 * Examples:
 *
 *   matchesTopic("feedback.>", "feedback.draft.email")        // true
 *   matchesTopic("feedback.*.email", "feedback.draft.email")  // true
 *   matchesTopic("feedback.*", "feedback.draft")              // true
 *   matchesTopic("feedback.*", "feedback.draft.email")        // false (* is single-segment)
 *   matchesTopic("foo", "foo")                                // true
 *
 * **Invariants:**
 * 1. The matcher is pure and deterministic. No I/O, no clocks, no random.
 * 2. Adapters must ground their wildcard semantics in this function so that
 *    swapping bus implementations does not change which events a subscriber
 *    receives.
 *
 * Adapters whose underlying transport has stricter or weaker matching (e.g.
 * Redis PSUBSCRIBE has a single `*` glob with no segment awareness) should
 * subscribe at the transport with the broadest pattern that still includes
 * everything `matchesTopic` would accept, then re-filter via this function
 * before invoking the consumer's handler. See the redis-pubsub adapter for
 * the canonical implementation of this pattern.
 */
export function matchesTopic(pattern: string, topic: string): boolean {
  if (pattern === topic) return true;
  // Whole-pattern tail wildcards: match any non-empty topic.
  if (pattern === ">" || pattern === "#") return topic.length > 0;
  const pSegs = pattern.split(".");
  const tSegs = topic.split(".");
  for (let i = 0; i < pSegs.length; i++) {
    const p = pSegs[i];
    if (p === ">" || p === "#") {
      // Tail wildcard: NATS-style "one or more remaining" semantics.
      // Matches when at least one un-consumed segment remains in the topic.
      return tSegs.length > i;
    }
    if (p === "*") {
      if (tSegs[i] === undefined) return false;
      continue;
    }
    if (p !== tSegs[i]) return false;
  }
  return pSegs.length === tSegs.length;
}
