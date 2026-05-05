import {
  runEventStoreConformance,
  runProjectionStoreConformance,
  runEventBusConformance,
  runDedupeStoreConformance,
} from "@llm-feedback-middleware/adapter-conformance";
import { createInMemoryEventStore } from "../src/event-store.js";
import { createInMemoryProjectionStore } from "../src/projection-store.js";
import { createInMemoryEventBus } from "../src/event-bus.js";
import { createInMemoryDedupeStore } from "../src/dedupe-store.js";

runEventStoreConformance({
  name: "InMemoryEventStore",
  factory: () => createInMemoryEventStore(),
});

runProjectionStoreConformance({
  name: "InMemoryProjectionStore",
  factory: () => createInMemoryProjectionStore(),
});

runEventBusConformance({
  name: "InMemoryEventBus",
  factory: () => createInMemoryEventBus(),
});

runDedupeStoreConformance({
  name: "InMemoryDedupeStore",
  factory: () => createInMemoryDedupeStore(),
});
