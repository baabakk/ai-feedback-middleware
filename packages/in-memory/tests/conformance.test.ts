import {
  runEventStoreConformance,
  runProjectionStoreConformance,
} from "@llm-feedback-middleware/adapter-conformance";
import { createInMemoryEventStore } from "../src/event-store.js";
import { createInMemoryProjectionStore } from "../src/projection-store.js";

runEventStoreConformance({
  name: "InMemoryEventStore",
  factory: () => createInMemoryEventStore(),
});

runProjectionStoreConformance({
  name: "InMemoryProjectionStore",
  factory: () => createInMemoryProjectionStore(),
});
