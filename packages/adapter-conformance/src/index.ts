export {
  runEventStoreConformance,
  type EventStoreConformanceOptions,
} from "./event-store-conformance.js";
export {
  runProjectionStoreConformance,
  type ProjectionStoreConformanceOptions,
} from "./projection-store-conformance.js";
export {
  runEventBusConformance,
  type EventBusConformanceOptions,
} from "./event-bus-conformance.js";
export {
  runDedupeStoreConformance,
  type DedupeStoreConformanceOptions,
} from "./dedupe-store-conformance.js";
export { makeEvent, collect } from "./test-fixtures.js";
