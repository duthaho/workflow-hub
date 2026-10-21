import type { ExistingFindingThread } from "./finding-sync.js";

export type CheckConclusion = "success" | "failure" | "neutral";

export class GitHubClient {
  constructor(private readonly input: { owner: string; repo: string; token: string; fetcher?: typeof fetch }) {}

  private async request(path: string, init: RequestInit): Promise<Response> {
    const response = await (this.input.fetcher ?? fetch)(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${this.input.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        ...init.headers,
      },
    });
    if (!response.ok) throw new Error(`GitHub API request failed: ${response.status}`);
    return response;
  }

  async listFindingThreads(pullNumber: number): Promise<ExistingFindingThread[]> {
    const query = "query($owner:String!,$repo:String!,$number:Int!){repository(owner:$owner,name:$repo){pullRequest(number:$number){reviewThreads(first:100){pageInfo{hasNextPage} nodes{id isResolved comments(first:100){nodes{databaseId body}}}}}}}";
    const response = await this.request("/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query, variables: { owner: this.input.owner, repo: this.input.repo, number: pullNumber } }) });
    const payload: any = await response.json();
    const threads = payload?.data?.repository?.pullRequest?.reviewThreads;
    if (payload?.errors || !threads || threads.pageInfo?.hasNextPage === true || !Array.isArray(threads.nodes)) throw new Error("GitHub GraphQL review thread discovery was incomplete");
    const result: ExistingFindingThread[] = [];
    for (const thread of threads.nodes) {
      const comment = thread?.comments?.nodes?.find((node: any) => typeof node?.body === "string" && /<!-- workflow-hub:finding:([^ >]+) -->/.test(node.body));
      const match = typeof comment?.body === "string" ? /<!-- workflow-hub:finding:([^ >]+) -->/.exec(comment.body) : null;
      if (typeof thread?.id !== "string" || typeof thread?.isResolved !== "boolean" || typeof comment?.databaseId !== "number" || !match?.[1]) continue;
      result.push({ fingerprint: match[1], threadId: thread.id, commentId: comment.databaseId, resolved: thread.isResolved });
    }
    return result;
  }

  async createReviewComment(input: { pullNumber: number; commitSha: string; path: string; line: number; body: string }): Promise<void> {
    await this.request(`/repos/${encodeURIComponent(this.input.owner)}/${encodeURIComponent(this.input.repo)}/pulls/${input.pullNumber}/comments`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body: input.body, commit_id: input.commitSha, path: input.path, line: input.line, side: "RIGHT" }),
    });
  }

  async updateReviewComment(input: { commentId: number; body: string }): Promise<void> {
    await this.request(`/repos/${encodeURIComponent(this.input.owner)}/${encodeURIComponent(this.input.repo)}/pulls/comments/${input.commentId}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ body: input.body }),
    });
  }

  async resolveReviewThread(threadId: string): Promise<void> {
    const response = await this.request("/graphql", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: "mutation($thread:ID!){resolveReviewThread(input:{threadId:$thread}){thread{id}}}", variables: { thread: threadId } }) });
    const data: unknown = await response.json();
    if (typeof data !== "object" || data === null || "errors" in data) throw new Error("GitHub GraphQL response was invalid");
  }

  async createCheck(input: { name: string; headSha: string; conclusion: CheckConclusion; summary: string }): Promise<number> {
    const response = await this.request(`/repos/${encodeURIComponent(this.input.owner)}/${encodeURIComponent(this.input.repo)}/check-runs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: input.name, head_sha: input.headSha, status: "completed", conclusion: input.conclusion, output: { title: input.name, summary: input.summary } }),
    });
    const data: unknown = await response.json();
    if (typeof data !== "object" || data === null || typeof (data as { id?: unknown }).id !== "number") throw new Error("GitHub API returned an invalid check run");
    return (data as { id: number }).id;
  }
}
