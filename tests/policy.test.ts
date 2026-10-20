import { describe, expect, it } from "vitest";

import {
  classifyRisk,
  evaluateMergePolicy,
  matchPathPattern,
} from "../src/policy.js";

describe("matchPathPattern", () => {
  it.each([
    [".github/workflows/review.yml", ".github/**"],
    ["src/auth/token.ts", "src/auth/**"],
    ["package-lock.json", "*-lock.json"],
  ])("matches %s against %s", (path, pattern) => {
    expect(matchPathPattern(path, pattern)).toBe(true);
  });

  it("matches globstar directories at repository root", () => {
    expect(matchPathPattern("auth/token.ts", "**/auth/**")).toBe(true);
    expect(matchPathPattern("src/auth/token.ts", "**/auth/**")).toBe(true);
  });

  it("does not overmatch a path prefix", () => {
    expect(matchPathPattern("src/author/name.ts", "src/auth/**")).toBe(false);
  });
});

describe("classifyRisk", () => {
  const highRiskPaths = [
    ".github/**",
    "src/auth/**",
    "scripts/release/**",
    "workflow-hub.json",
  ];

  it("classifies protected paths as high risk", () => {
    expect(
      classifyRisk({
        changedPaths: ["src/auth/token.ts"],
        findingSeverities: [],
        highRiskPaths,
      }),
    ).toMatchObject({ tier: "high", reasons: ["high-risk path: src/auth/token.ts"] });
  });

  it("classifies critical and high findings as high risk", () => {
    expect(
      classifyRisk({
        changedPaths: ["src/index.ts"],
        findingSeverities: ["high"],
        highRiskPaths,
      }).tier,
    ).toBe("high");
  });

  it("classifies medium findings and broad changes as medium risk", () => {
    expect(
      classifyRisk({
        changedPaths: ["src/index.ts"],
        findingSeverities: ["medium"],
        highRiskPaths,
      }).tier,
    ).toBe("medium");

    expect(
      classifyRisk({
        changedPaths: Array.from({ length: 21 }, (_, index) => `src/${index}.ts`),
        findingSeverities: [],
        highRiskPaths,
      }).tier,
    ).toBe("medium");
  });

  it("never allows a model recommendation to lower deterministic risk", () => {
    expect(
      classifyRisk({
        changedPaths: [".github/workflows/ci.yml"],
        findingSeverities: [],
        highRiskPaths,
        modelRecommendation: "low",
      }).tier,
    ).toBe("high");
  });

  it("allows a model recommendation to raise risk", () => {
    expect(
      classifyRisk({
        changedPaths: ["docs/usage.md"],
        findingSeverities: [],
        highRiskPaths,
        modelRecommendation: "medium",
      }).tier,
    ).toBe("medium");
  });
});

describe("evaluateMergePolicy", () => {
  const base = {
    deterministicChecksPassed: true,
    securityChecksPassed: true,
    unresolvedFindings: 0,
    ownerAttested: false,
    secondHumanApproved: false,
  };

  it("allows low-risk changes after automated gates", () => {
    expect(evaluateMergePolicy({ ...base, tier: "low" })).toEqual({
      allowed: true,
      blockers: [],
    });
  });

  it("requires owner attestation for medium risk", () => {
    expect(evaluateMergePolicy({ ...base, tier: "medium" })).toMatchObject({
      allowed: false,
      blockers: ["owner attestation is required"],
    });
  });

  it("requires a second human for high risk", () => {
    expect(
      evaluateMergePolicy({
        ...base,
        tier: "high",
        ownerAttested: true,
      }),
    ).toMatchObject({
      allowed: false,
      blockers: ["second human approval is required"],
    });
  });

  it("blocks every tier on failed checks or unresolved findings", () => {
    const decision = evaluateMergePolicy({
      ...base,
      tier: "low",
      deterministicChecksPassed: false,
      unresolvedFindings: 2,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.blockers).toEqual([
      "deterministic checks failed",
      "2 review findings are unresolved",
    ]);
  });
});
