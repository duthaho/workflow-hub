import { GitHubClient, type CheckConclusion } from "../../../github/src/github-client.js";

export async function publishGitHubCheck(input: {
  owner: string;
  repo: string;
  token: string | undefined;
  headSha: string;
  conclusion: CheckConclusion;
  summary: string;
  client?: Pick<GitHubClient, "createCheck">;
}): Promise<number> {
  if (!input.token && input.client === undefined) throw new Error("GITHUB_TOKEN is required to publish a GitHub check");
  const client = input.client ?? new GitHubClient({ owner: input.owner, repo: input.repo, token: input.token! });
  return client.createCheck({ name: "workflow-hub / review-policy", headSha: input.headSha, conclusion: input.conclusion, summary: input.summary });
}
