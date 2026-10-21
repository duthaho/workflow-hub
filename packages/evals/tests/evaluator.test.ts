import { describe, expect, it } from "vitest";
import { runEvalCorpus, scoreEvalCase, summarizeEvaluatorFeedback } from "../src/index.js";

describe("reviewer evaluator", () => {
  it("scores precision, recall, and missed critical findings deterministically", () => {
    const score = scoreEvalCase({
      id: "auth-regression",
      expected: [
        { fingerprint: "critical-auth", severity: "critical" },
        { fingerprint: "medium-error", severity: "medium" },
      ],
      actual: [
        { fingerprint: "critical-auth", severity: "critical" },
        { fingerprint: "invented", severity: "low" },
      ],
    });

    expect(score).toMatchObject({ truePositives: 1, falsePositives: 1, falseNegatives: 1, precision: 0.5, recall: 0.5, missedCritical: 0 });
  });

  it("rejects malformed corpora rather than silently deduplicating them", () => {
    expect(() => runEvalCorpus({ provider: "codex", cases: [{ id: "x", expected: [{ fingerprint: "same", severity: "high" }, { fingerprint: "same", severity: "high" }], actual: [] }] })).toThrow(/duplicate/);
  });

  it("aggregates provider feedback without hiding a critical miss", () => {
    expect(summarizeEvaluatorFeedback([
      { provider: "codex", score: { truePositives: 1, falsePositives: 0, falseNegatives: 0, missedCritical: 0 } },
      { provider: "codex", score: { truePositives: 0, falsePositives: 1, falseNegatives: 1, missedCritical: 1 } },
    ])).toEqual({ provider: "codex", cases: 2, precision: 0.5, recall: 0.5, missedCritical: 1 });
  });
});
