// Reference projections
export { approvalRateProjection, type ApprovalRateState } from "./projections/approval-rate.js";
export {
  createWhitelistExamplesProjection,
  type WhitelistExample,
  type WhitelistExamplesState,
  type WhitelistExamplesOptions,
} from "./projections/whitelist-examples.js";
export {
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
