import { describe, it, expect } from "vitest";
import { matchesTopic } from "../src/topic-matcher.js";

describe("matchesTopic", () => {
  describe("exact matches", () => {
    it("matches identical literal topics", () => {
      expect(matchesTopic("foo.bar.baz", "foo.bar.baz")).toBe(true);
    });

    it("rejects different literal topics", () => {
      expect(matchesTopic("foo.bar.baz", "foo.bar.qux")).toBe(false);
    });

    it("rejects different segment counts", () => {
      expect(matchesTopic("foo.bar", "foo.bar.baz")).toBe(false);
      expect(matchesTopic("foo.bar.baz", "foo.bar")).toBe(false);
    });
  });

  describe("single-segment wildcard `*`", () => {
    it("matches one segment", () => {
      expect(matchesTopic("feedback.*", "feedback.draft")).toBe(true);
    });

    it("does not match across multiple segments", () => {
      expect(matchesTopic("feedback.*", "feedback.draft.email")).toBe(false);
    });

    it("matches in the middle of a pattern", () => {
      expect(matchesTopic("feedback.*.email", "feedback.draft.email")).toBe(true);
    });

    it("does not match if the corresponding topic segment is missing", () => {
      expect(matchesTopic("feedback.*", "feedback")).toBe(false);
    });
  });

  describe("tail wildcard `>`", () => {
    it("matches one or more remaining segments", () => {
      expect(matchesTopic("feedback.>", "feedback.draft.email")).toBe(true);
      expect(matchesTopic("feedback.>", "feedback.draft.email.thread")).toBe(true);
    });

    it("matches a single remaining segment", () => {
      expect(matchesTopic("feedback.>", "feedback.draft")).toBe(true);
    });

    it("matches everything as a whole-pattern wildcard", () => {
      expect(matchesTopic(">", "anything.at.all")).toBe(true);
    });

    it("treats `#` as a synonym for `>`", () => {
      expect(matchesTopic("feedback.#", "feedback.draft.email")).toBe(true);
      expect(matchesTopic("#", "anything.at.all")).toBe(true);
    });
  });

  describe("combined wildcards", () => {
    it("supports `*` followed by `>`", () => {
      expect(matchesTopic("feedback.*.>", "feedback.draft.email.thread")).toBe(true);
    });

    it("rejects a `*` followed by `>` when there is nothing after the *", () => {
      expect(matchesTopic("feedback.*.>", "feedback.draft")).toBe(false);
    });
  });

  describe("partial-segment wildcards (not supported)", () => {
    it("treats `b*r` as a literal segment, not a wildcard", () => {
      expect(matchesTopic("foo.b*r.baz", "foo.bar.baz")).toBe(false);
      expect(matchesTopic("foo.b*r.baz", "foo.b*r.baz")).toBe(true);
    });
  });
});
