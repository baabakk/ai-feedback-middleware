# Writing a custom adapter

Bring the framework to a storage system or transport it does not yet
support. The pattern is the same for every port: implement the contract,
run the conformance suite, ship.

## Steps

1. **Pick the port.** `EventStorePort`, `ProjectionStorePort`,
   `EventBusPort`, `OutboxPort`, `DedupeStorePort`, or
   `InferenceRulesPort`.
2. **Read the port file** in
   [`packages/core/src/ports/`](../../packages/core/src/ports/) for the
   exact methods, optional fields, and behavioral contracts.
3. **Set up the package.**
   ```bash
   mkdir -p packages/myadapter/src packages/myadapter/tests
   ```
   Mirror the structure of one of the reference adapters
   ([`packages/postgres/`](../../packages/postgres/) is the most complete
   example).
4. **Write the implementation.** Keep it focused on the port contract.
   Resist the temptation to add convenience methods that the port does
   not require - they are technical debt.
5. **Wire the conformance suite into your tests.**

   ```typescript
   import { runEventStoreConformance } from "@llm-feedback-middleware/adapter-conformance";
   import { createMyAdapter } from "../src/index.js";

   runEventStoreConformance({
     name: "MyAdapter",
     factory: async () =>
       createMyAdapter({
         /* ... */
       }),
     cleanup: async (a) => {
       /* ... */
     },
   });
   ```

6. **Implement the optional methods you can.** `readStreamSince`,
   `subscribeGroup`, etc. are optional but the framework uses them for
   important paths (`loadHistory`, consumer groups). Implementing them
   makes your adapter a first-class citizen.
7. **Declare your `SubscribeCapabilities`** if you ship an `EventBusPort`
   adapter. List exactly the `deliveryMode` and `fromPosition` values
   your transport supports. The framework's
   `assertSupportedSubscribeOptions` will throw early on mismatches.
8. **Add error callbacks.** Both reference adapters expose `onError`
   options that fire on parse failures, handler throws, polling errors,
   etc. Mirror the pattern; silent failures cost everyone hours later.
9. **Document the package** with a README covering install, options,
   capabilities, and any caveats specific to your transport.

## What "passes conformance" means

Each suite is a `describe(...)` block of vitest tests. If every test
passes against your adapter, the framework considers your adapter
interchangeable with the in-memory and Postgres reference
implementations.

The suites are deliberately minimal: they test the contract, not the
underlying technology. If your tests depend on transport-specific
behavior (replication latency, message ordering across partitions),
write them in addition to the conformance suite, not instead of it.

## Recommended publishing path

If you intend to publish your adapter:

- Use the `@llm-feedback-middleware-community/<name>` npm scope (planned;
  ping the maintainers on GitHub Discussions for inclusion).
- Match the framework's TypeScript strictness, ESM-only output, and
  `engines.node >= 18` claim.
- Add your adapter to the framework's
  [`docs/adapters/`](.) folder via PR so consumers can find it.

## Versioning

Adapters version independently. Pin a specific minor version of
`@llm-feedback-middleware/core` as a peer dependency to declare the
contract version your adapter targets.

## Common pitfalls

- **Lying about capabilities.** Declaring `at-least-once` on a transport
  that is actually best-effort is the worst kind of bug because it only
  surfaces under failure. If you are not sure, declare the lower
  guarantee.
- **Treating the conformance suite as optional.** It is the difference
  between "I think this works" and "this is a drop-in replacement."
- **Owning external resources.** Adapters should accept clients/pools as
  parameters, not construct them. Lifecycle is the consumer's
  responsibility.
- **Losing partition ordering.** Within a partition, events must be
  strictly ordered. Across partitions, ordering is per-store. Get this
  wrong and projections will be silently off.
