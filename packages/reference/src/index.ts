// Reference projections
export { approvalRateProjection, type ApprovalRateState } from "./projections/approval-rate.js";
export {
  createApprovedExamplesProjection,
  type ApprovedExample,
  type ApprovedExamplesState,
  type ApprovedExamplesOptions,
  // Deprecated v1 aliases
  createWhitelistExamplesProjection,
  type WhitelistExample,
  type WhitelistExamplesState,
  type WhitelistExamplesOptions,
} from "./projections/whitelist-examples.js";
export {
  createRemovedPhrasesProjection,
  type RemovedPhrase,
  type RemovedPhrasesState,
  type RemovedPhrasesOptions,
  // Deprecated v1 aliases
  createBlacklistPhrasesProjection,
  type BlacklistPhrase,
  type BlacklistPhrasesState,
  type BlacklistPhrasesOptions,
} from "./projections/blacklist-phrases.js";

// Reference capture adapters
export {
  createHttpButtonCaptureAdapter,
  type HttpButtonClickPayload,
} from "./capture-adapters/http-button.js";
export {
  createWebhookCaptureAdapter,
  type WebhookCaptureOptions,
} from "./capture-adapters/webhook.js";
