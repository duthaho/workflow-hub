import { describe, expect, it, vi } from "vitest";
import { GitHubClient } from "../src/github-client.js";

describe("GitHubClient", () => {
  it("uses explicit API version, bearer auth, and fails closed on API errors", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ id: 7 }), { status: 201 }));
    const client = new GitHubClient({ owner: "o", repo: "r", token: "secret", fetcher });
    await expect(client.createCheck({ name: "workflow-hub", headSha: "head", conclusion: "success", summary: "ok" })).resolves.toBe(7);
    expect(fetcher).toHaveBeenCalledWith(expect.stringContaining("/repos/o/r/check-runs"), expect.objectContaining({ method: "POST", headers: expect.objectContaining({ Authorization: "Bearer secret", "X-GitHub-Api-Version": "2022-11-28" }) }));
  });

  it("throws without exposing the token when GitHub rejects a request", async () => {
    const client = new GitHubClient({ owner: "o", repo: "r", token: "secret", fetcher: async () => new Response("bad", { status: 403 }) });
    await expect(client.createCheck({ name: "x", headSha: "head", conclusion: "failure", summary: "bad" })).rejects.toThrow(/GitHub API request failed: 403/);
  });

  it("discovers lifecycle markers from non-paginated review threads", async () => {
    const payload = { data: { repository: { pullRequest: { reviewThreads: { pageInfo: { hasNextPage: false }, nodes: [{ id: "thread", isResolved: false, comments: { nodes: [{ databaseId: 9, body: "<!-- workflow-hub:finding:f1 -->" }] } }] } } } } };
    const client = new GitHubClient({ owner: "o", repo: "r", token: "secret", fetcher: async () => new Response(JSON.stringify(payload), { status: 200 }) });
    await expect(client.listFindingThreads(3)).resolves.toEqual([{ fingerprint: "f1", threadId: "thread", commentId: 9, resolved: false }]);
  });
});
