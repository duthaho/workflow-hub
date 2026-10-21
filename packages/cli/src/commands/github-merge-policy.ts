import { evaluateOperationalMergePolicy } from "../../../core/src/application/evaluate-merge-policy.js";
import { GitHubClient } from "../../../github/src/github-client.js";

export interface MergePolicyClient {
  getMergePolicySnapshot(pullNumber: number): ReturnType<GitHubClient["getMergePolicySnapshot"]>;
  listFindingThreads(pullNumber: number): ReturnType<GitHubClient["listFindingThreads"]>;
  createCheck(input: { name: string; headSha: string; conclusion: "success" | "failure"; summary: string }): Promise<number>;
}

export async function publishGitHubMergePolicy(input: {
  owner: string;
  repo: string;
  pullNumber: number;
  token: string | undefined;
  highRiskPaths: readonly string[];
  requiredDeterministicChecks: readonly string[];
  requiredSecurityChecks: readonly string[];
  client?: MergePolicyClient;
}): Promise<{ allowed: boolean; tier: "low" | "medium" | "high"; blockers: string[]; checkRunId: number }> {
  if (!input.token && !input.client) throw new Error("GITHUB_TOKEN is required to evaluate GitHub merge policy");
  const client: MergePolicyClient = input.client ?? new GitHubClient({ owner: input.owner, repo: input.repo, token: input.token! });
  const [snapshot, threads] = await Promise.all([
    client.getMergePolicySnapshot(input.pullNumber),
    client.listFindingThreads(input.pullNumber),
  ]);
  const decision = evaluateOperationalMergePolicy({
    ...snapshot,
    highRiskPaths: input.highRiskPaths,
    requiredDeterministicChecks: input.requiredDeterministicChecks,
    requiredSecurityChecks: input.requiredSecurityChecks,
    requiredReviewPolicyCheck: "workflow-hub / review-policy",
    unresolvedFindings: threads.filter((thread) => !thread.resolved).length,
  });
  const summary = decision.allowed
    ? `Merge policy passed at ${decision.tier} risk.`
    : `Merge policy blocked at ${decision.tier} risk: ${decision.blockers.join("; ")}`;
  const checkRunId = await client.createCheck({
    name: "workflow-hub / merge-policy",
    headSha: snapshot.headSha,
    conclusion: decision.allowed ? "success" : "failure",
    summary,
  });
  return { ...decision, checkRunId };
}
