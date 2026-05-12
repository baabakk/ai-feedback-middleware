/**
 * @deprecated Use `capture-port.ts` instead. The v1 `FeedbackPort` exposed
 * a unified `capture()` method that 2.1 splits into four
 * (`captureArtifact` / `recordReaction` / `cancelArtifact` /
 * `recordCompetitiveSelection`). This module re-exports the new types under
 * their old names so consumer imports continue resolving during the
 * v0.2.x → v0.3.x bump.
 */
export type { CapturePort as FeedbackPort, RebuildResult, Unsubscribe } from "./capture-port.js";
