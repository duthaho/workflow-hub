import { describe, expect, it } from "vitest";
import { evaluateOperationalMergePolicy } from "../src/application/evaluate-merge-policy.js";

describe("evaluateOperationalMergePolicy", () => {
  const base = {
    changedPaths: ["src/service.ts"],
    highRiskPaths: [".github/**", "**/auth/**"],
    checks: [
      { name: "test-node-22", conclusion: "success" },
      { name: "test-node-24", conclusion: "success" },
      { name: "CodeQL", conclusion: "success" },
      { name: "workflow-hub / review-policy", conclusion: "success" },
    ],
    requiredDeterministicChecks: ["test-node-22", "test-node-24"],
    requiredSecurityChecks: ["CodeQL"],
    requiredReviewPolicyCheck: "workflow-hub / review-policy",
    unresolvedFindings: 0,
    ownerAttested: false,
    secondHumanApproved: false,
  } as const;

  it("allows a low-risk pull request only when every required named check succeeded", () => {
    expect(evaluateOperationalMergePolicy(base)).toEqual({
      allowed: true,
      tier: "low",
      blockers: [],
    });
  });

  it("fails closed when a required check is missing or neutral", () => {
    const result = evaluateOperationalMergePolicy({
      ...base,
      checks: base.checks.filter((check) => check.name !== "test-node-24"),
    });

    expect(result.allowed).toBe(false);
    expect(result.blockers).toContain("required check test-node-24 is missing or did not succeed");
  });

  it("requires an owner attestation on a medium-risk pull request", () => {
    const result = evaluateOperationalMergePolicy({
      ...base,
      changedPaths: Array.from({ length: 21 }, (_, index) => `src/file-${index}.ts`),
    });

    expect(result).toMatchObject({
      allowed: false,
      tier: "medium",
      blockers: ["owner attestation is required"],
    });
  });

  it("requires both attestations for high-risk pull requests", () => {
    const result = evaluateOperationalMergePolicy({
      ...base,
      changedPaths: [".github/workflows/release.yml"],
    });

    expect(result.tier).toBe("high");
    expect(result.blockers).toEqual(["second human approval is required"]);
  });
});
