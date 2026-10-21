import { describe, expect, it, vi } from "vitest";
import { publishGitHubMergePolicy } from "../src/commands/github-merge-policy.js";

describe("publishGitHubMergePolicy", () => {
  it("fails closed and publishes a failure check when a required gate is absent", async () => {
    const createCheck = vi.fn(async () => 99);
    const result = await publishGitHubMergePolicy({
      owner: "o", repo: "r", pullNumber: 4, token: undefined,
      highRiskPaths: [".github/**"], requiredDeterministicChecks: ["CI"], requiredSecurityChecks: ["CodeQL"],
      client: {
        getMergePolicySnapshot: async () => ({ headSha: "a".repeat(40), changedPaths: ["src/a.ts"], checks: [{ name: "CI", conclusion: "success" }], ownerAttested: false, secondHumanApproved: false }),
        listFindingThreads: async () => [],
        createCheck,
      },
    });

    expect(result).toMatchObject({ allowed: false, tier: "low", checkRunId: 99 });
    expect(result.blockers).toContain("required check CodeQL is missing or did not succeed");
    expect(createCheck).toHaveBeenCalledWith(expect.objectContaining({ name: "workflow-hub / merge-policy", conclusion: "failure", headSha: "a".repeat(40) }));
  });
});
