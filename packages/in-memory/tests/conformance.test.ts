import {
  runEventStoreConformance,
  runProjectionStoreConformance,
  runEventBusConformance,
  runDedupeStoreConformance,
  runOutboxConformance,
  runActionabilityRulesConformance,
  runTrackedArtifactsConformance,
  runActionabilityDecisionsConformance,
} from "@ai-feedback-middleware/adapter-conformance";
import { createInMemoryEventStore } from "../src/event-store.js";
import { createInMemoryProjectionStore } from "../src/projection-store.js";
import { createInMemoryEventBus } from "../src/event-bus.js";
import { createInMemoryDedupeStore } from "../src/dedupe-store.js";
import { createInMemoryOutbox } from "../src/outbox.js";
import { createInMemoryActionabilityRulesStore } from "../src/actionability-rules.js";
import { createInMemoryTrackedArtifactsStore } from "../src/tracked-artifacts.js";
import { createInMemoryActionabilityDecisionsStore } from "../src/actionability-decisions.js";

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

runOutboxConformance({
  name: "InMemoryOutbox",
  factory: () => createInMemoryOutbox(),
});

runActionabilityRulesConformance({
  name: "InMemoryActionabilityRulesStore",
  factory: () => createInMemoryActionabilityRulesStore(),
});

runTrackedArtifactsConformance({
  name: "InMemoryTrackedArtifactsStore",
  factory: () => createInMemoryTrackedArtifactsStore(),
});

runActionabilityDecisionsConformance({
  name: "InMemoryActionabilityDecisionsStore",
  factory: () => createInMemoryActionabilityDecisionsStore(),
});
