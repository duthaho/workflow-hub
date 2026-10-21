import type { ExistingFindingThread } from "./finding-sync.js";

export type CheckConclusion = "success" | "failure" | "neutral";
type MergePolicyCheckConclusion = CheckConclusion | "cancelled" | "skipped" | null;

function isMergePolicyCheckConclusion(value: unknown): value is MergePolicyCheckConclusion {
  return value === "success" || value === "failure" || value === "neutral" || value === "cancelled" || value === "skipped" || value === null;
}

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

  async getMergePolicySnapshot(pullNumber: number): Promise<{
    headSha: string;
    changedPaths: string[];
    checks: Array<{ name: string; conclusion: "success" | "failure" | "neutral" | "cancelled" | "skipped" | null }>;
    ownerAttested: boolean;
    secondHumanApproved: boolean;
  }> {
    if (!Number.isInteger(pullNumber) || pullNumber < 1) throw new Error("pull number must be a positive integer");
    const prefix = `/repos/${encodeURIComponent(this.input.owner)}/${encodeURIComponent(this.input.repo)}`;
    const pullResponse = await this.request(`${prefix}/pulls/${pullNumber}`, { method: "GET" });
    const pull: unknown = await pullResponse.json();
    const headSha = typeof (pull as { head?: { sha?: unknown } })?.head?.sha === "string"
      ? (pull as { head: { sha: string } }).head.sha : undefined;
    const author = typeof (pull as { user?: { login?: unknown } })?.user?.login === "string"
      ? (pull as { user: { login: string } }).user.login : undefined;
    const labels = (pull as { labels?: unknown })?.labels;
    if (!headSha || !author || !Array.isArray(labels) || !labels.every((label) => typeof (label as { name?: unknown })?.name === "string")) {
      throw new Error("GitHub pull request response was invalid");
    }

    const filesResponse = await this.request(`${prefix}/pulls/${pullNumber}/files?per_page=100`, { method: "GET" });
    const files: unknown = await filesResponse.json();
    if (filesResponse.headers.get("link")?.includes('rel="next"') || !Array.isArray(files) || !files.every((file) => typeof (file as { filename?: unknown })?.filename === "string")) {
      throw new Error("GitHub pull request file pagination was incomplete");
    }

    const checksResponse = await this.request(`${prefix}/commits/${encodeURIComponent(headSha)}/check-runs?per_page=100`, { method: "GET" });
    const checksPayload: unknown = await checksResponse.json();
    const checkRuns = (checksPayload as { check_runs?: unknown })?.check_runs;
    const totalCount = (checksPayload as { total_count?: unknown })?.total_count;
    if (checksResponse.headers.get("link")?.includes('rel="next"') || !Array.isArray(checkRuns) || typeof totalCount !== "number" || totalCount !== checkRuns.length || !checkRuns.every((check) => typeof (check as { name?: unknown })?.name === "string" && isMergePolicyCheckConclusion((check as { conclusion?: unknown }).conclusion ?? null))) {
      throw new Error("GitHub check-run pagination or response was incomplete");
    }

    const reviewsResponse = await this.request(`${prefix}/pulls/${pullNumber}/reviews?per_page=100`, { method: "GET" });
    const reviews: unknown = await reviewsResponse.json();
    if (reviewsResponse.headers.get("link")?.includes('rel="next"') || !Array.isArray(reviews) || !reviews.every((review) => typeof (review as { id?: unknown; user?: { login?: unknown }; state?: unknown })?.id === "number" && typeof (review as { user?: { login?: unknown } })?.user?.login === "string" && typeof (review as { state?: unknown }).state === "string")) {
      throw new Error("GitHub review pagination or response was incomplete");
    }
    const latestReviewByUser = new Map<string, { id: number; state: string }>();
    for (const review of reviews as Array<{ id: number; user: { login: string }; state: string }>) {
      const previous = latestReviewByUser.get(review.user.login);
      if (previous === undefined || review.id > previous.id) latestReviewByUser.set(review.user.login, { id: review.id, state: review.state });
    }
    const approvers = new Set([...latestReviewByUser.entries()].filter(([login, review]) => login !== author && review.state === "APPROVED").map(([login]) => login));

    return {
      headSha,
      changedPaths: files.map((file) => (file as { filename: string }).filename),
      checks: checkRuns.map((check) => ({ name: (check as { name: string }).name, conclusion: ((check as { conclusion?: "success" | "failure" | "neutral" | "cancelled" | "skipped" | null }).conclusion ?? null) })),
      ownerAttested: labels.some((label) => (label as { name: string }).name === "workflow-hub:owner-attested"),
      secondHumanApproved: approvers.size >= 1,
    };
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
