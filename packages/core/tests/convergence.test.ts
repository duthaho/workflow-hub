import { describe, expect, it } from "vitest";

import { planReviewRound } from "../src/application/plan-review-round.js";
import { reconcileRound } from "../src/application/reconcile-round.js";
import type { ReviewFinding } from "../src/domain/finding.js";
import type { ReviewSession } from "../src/domain/review-session.js";

function finding(fingerprint: string, state: ReviewFinding["state"] = "open"): ReviewFinding {
  return {
    fingerprint,
    state,
    severity: "high",
    confidence: 0.9,
    category: "correctness",
    defectClass: "bug",
    title: fingerprint,
    location: { path: "src/app.ts", startLine: 1, endLine: 1 },
    evidence: [{ role: "correctness-scout", provider: "codex", text: "evidence" }],
    supportingAgents: ["codex:correctness-scout"],
  };
}

function session(rounds: ReviewSession["rounds"]): ReviewSession {
  return {
    id: "s", version: 0, maxRounds: 3, state: "reviewing", baseRef: "origin/main",
    mergeBaseSha: "merge", headSha: "head", inputFingerprint: "inputs", rounds, knownFingerprints: [],
    createdAt: "now", updatedAt: "now",
  };
}

describe("review convergence", () => {
  it("reviews merge-base diff for rounds one and two, then incremental diff", () => {
    expect(planReviewRound(session([]), "h1")).toMatchObject({ baseSha: "merge", scope: "merge-base", number: 1 });
    const one = [{ number: 1, baseSha: "merge", headSha: "h1", scope: "merge-base" as const, startedAt: "now", findings: [], emittedFingerprints: [], scoutFailures: [] }];
    expect(planReviewRound(session(one), "h2")).toMatchObject({ baseSha: "merge", scope: "merge-base", number: 2 });
    const two = [...one, { ...one[0]!, number: 2, headSha: "h2" }];
    expect(planReviewRound(session(two), "h3")).toMatchObject({ baseSha: "h2", scope: "incremental", number: 3 });
  });

  it("suppresses persistent fingerprints, preserves unresolved findings, and reopens fixed findings", () => {
    const result = reconcileRound({
      previousFindings: [finding("persist"), finding("gone"), finding("reopen", "fixed")],
      currentFindings: [finding("persist"), finding("reopen"), finding("gone", "fixed")],
      roundNumber: 2,
      maxRounds: 3,
      previousHeadSha: "h1",
      currentHeadSha: "h2",
    });
    expect(result.emittedFindings.map((item) => item.fingerprint)).toEqual(["reopen"]);
    expect(result.findings.find((item) => item.fingerprint === "gone")?.state).toBe("fixed");
  });

  it("preserves low-severity findings without blocking convergence", () => {
    const low = { ...finding("low"), severity: "low" as const };
    const result = reconcileRound({
      previousFindings: [], currentFindings: [low], roundNumber: 1, maxRounds: 3,
      currentHeadSha: "head",
    });
    expect(result.outcome).toBe("passed");
    expect(result.findings).toEqual([expect.objectContaining({ fingerprint: "low", state: "open" })]);
    expect(result.emittedFindings).toHaveLength(1);
  });

  it("carries unresolved findings that are outside an incremental review scope", () => {
    const result = reconcileRound({
      previousFindings: [finding("outside")],
      currentFindings: [],
      roundNumber: 3,
      maxRounds: 4,
      previousHeadSha: "h2",
      currentHeadSha: "h3",
    });
    expect(result.findings).toEqual([
      expect.objectContaining({ fingerprint: "outside", state: "open" }),
    ]);
    expect(result.outcome).toBe("escalated");
  });

  it("escalates on no progress and at the round cap", () => {
    const noProgress = reconcileRound({
      previousFindings: [finding("same")], currentFindings: [finding("same")],
      roundNumber: 2, maxRounds: 3, previousHeadSha: "h1", currentHeadSha: "h1",
    });
    expect(noProgress.outcome).toBe("escalated");
    const capped = reconcileRound({
      previousFindings: [], currentFindings: [finding("new")],
      roundNumber: 3, maxRounds: 3, previousHeadSha: "h2", currentHeadSha: "h3",
    });
    expect(capped.outcome).toBe("escalated");
  });
});
