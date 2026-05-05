import { describe, it, expect } from "vitest";
import { classifyEditDiff } from "../src/index.js";

describe("classifyEditDiff", () => {
  it("returns ['other'] when nothing matches", () => {
    expect(classifyEditDiff("foo bar baz qux", "foo bar baz qux")).toEqual(["other"]);
  });

  it("detects reduce_length when edited is < 70% of original length", () => {
    const original = "This is a fairly long sentence that needs trimming for clarity.";
    const edited = "Short.";
    const labels = classifyEditDiff(original, edited);
    expect(labels).toContain("reduce_length");
  });

  it("detects increase_length when edited is > 150% of original length", () => {
    const original = "Short.";
    const edited =
      "This is a much longer expansion of the original short sentence with more context.";
    const labels = classifyEditDiff(original, edited);
    expect(labels).toContain("increase_length");
  });

  it("detects remove_formality", () => {
    const original = "Dear Sir, I hope this email finds you well. Kind regards.";
    const edited = "Hey, just checking in. Thanks.";
    const labels = classifyEditDiff(original, edited);
    expect(labels).toContain("remove_formality");
  });

  it("detects add_formality", () => {
    const original = "Hey, can you do this?";
    const edited = "Dear sir, pursuant to our discussion, please find attached the request.";
    const labels = classifyEditDiff(original, edited);
    expect(labels).toContain("add_formality");
  });

  it("detects add_warmth", () => {
    const original = "Got your email.";
    const edited = "Great to hear from you! Really appreciate the update.";
    const labels = classifyEditDiff(original, edited);
    expect(labels).toContain("add_warmth");
  });

  it("detects strengthen_tone", () => {
    const original = "Maybe we could possibly look at this when convenient.";
    const edited = "We need to address this by end of week. Non-negotiable.";
    const labels = classifyEditDiff(original, edited);
    expect(labels).toContain("strengthen_tone");
  });

  it("detects soften_tone", () => {
    const original = "We need to do this. It's non-negotiable. By end of day.";
    const edited = "It would be great if we could look at this together when you have time.";
    const labels = classifyEditDiff(original, edited);
    expect(labels).toContain("soften_tone");
  });

  it("detects add_deadline when temporal references appear", () => {
    const original = "Please review this proposal at your convenience.";
    const edited = "Please review this proposal by end of day Friday.";
    const labels = classifyEditDiff(original, edited);
    expect(labels).toContain("add_deadline");
  });

  it("detects remove_deadline", () => {
    const original = "Please review this by Monday.";
    const edited = "Please review this proposal at your earliest convenience.";
    const labels = classifyEditDiff(original, edited);
    expect(labels).toContain("remove_deadline");
  });

  it("detects add_call_to_action", () => {
    const original = "I'm sharing this report.";
    const edited = "I'm sharing this report. Can you confirm receipt? Let me know your thoughts.";
    const labels = classifyEditDiff(original, edited);
    expect(labels).toContain("add_call_to_action");
  });

  it("detects change_greeting when first line differs", () => {
    const original = "Dear Mr. Smith\n\nThank you for your message.";
    const edited = "Hi John\n\nThank you for your message.";
    const labels = classifyEditDiff(original, edited);
    expect(labels).toContain("change_greeting");
  });

  it("detects change_closing when last non-empty line differs", () => {
    const original = "Thank you for your time.\n\nKind regards";
    const edited = "Thank you for your time.\n\nCheers";
    const labels = classifyEditDiff(original, edited);
    expect(labels).toContain("change_closing");
  });

  it("returns multiple labels when multiple heuristics fire", () => {
    const original =
      "Dear Sir or Madam,\n\nI hope this email finds you well. " +
      "Pursuant to our discussion, please find attached the proposal you requested.\n\n" +
      "Kind regards,\nBabak";
    const edited = "Hey,\n\nFiles attached. Need feedback by Friday.\n\nThanks,\nBabak";
    const labels = classifyEditDiff(original, edited);
    expect(labels).toContain("remove_formality");
    expect(labels).toContain("reduce_length");
    expect(labels).toContain("add_deadline");
    expect(labels).toContain("change_greeting");
  });

  it("is deterministic: same inputs produce same labels", () => {
    const a = "Dear Sir, please review.";
    const b = "Hey, take a look.";
    const r1 = classifyEditDiff(a, b);
    const r2 = classifyEditDiff(a, b);
    expect(r1).toEqual(r2);
  });

  it("does not crash on empty strings", () => {
    expect(classifyEditDiff("", "")).toBeDefined();
    expect(classifyEditDiff("", "new content")).toBeDefined();
    expect(classifyEditDiff("old content", "")).toBeDefined();
  });
});
