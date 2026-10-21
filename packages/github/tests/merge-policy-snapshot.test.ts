import { describe, expect, it } from "vitest";
import { GitHubClient } from "../src/github-client.js";

describe("GitHubClient.getMergePolicySnapshot", () => {
  it("collects one complete PR snapshot and rejects incomplete pagination", async () => {
    const responses = [
      { head: { sha: "a".repeat(40) }, user: { login: "author" }, labels: [{ name: "workflow-hub:owner-attested" }] },
      [{ filename: "src/service.ts" }],
      { total_count: 2, check_runs: [{ name: "CI", conclusion: "success" }, { name: "CodeQL", conclusion: "success" }] },
      [{ id: 1, user: { login: "reviewer" }, state: "APPROVED" }],
    ];
    const fetcher = async () => new Response(JSON.stringify(responses.shift()), { status: 200 });
    const client = new GitHubClient({ owner: "o", repo: "r", token: "secret", fetcher });

    await expect(client.getMergePolicySnapshot(7)).resolves.toEqual({
      headSha: "a".repeat(40),
      changedPaths: ["src/service.ts"],
      checks: [{ name: "CI", conclusion: "success" }, { name: "CodeQL", conclusion: "success" }],
      ownerAttested: true,
      secondHumanApproved: true,
    });
  });

  it("does not count a superseded approval", async () => {
    const responses = [
      { head: { sha: "a".repeat(40) }, user: { login: "author" }, labels: [] },
      [],
      { total_count: 0, check_runs: [] },
      [
        { id: 1, user: { login: "reviewer" }, state: "APPROVED" },
        { id: 2, user: { login: "reviewer" }, state: "CHANGES_REQUESTED" },
      ],
    ];
    const client = new GitHubClient({ owner: "o", repo: "r", token: "secret", fetcher: async () => new Response(JSON.stringify(responses.shift()), { status: 200 }) });
    await expect(client.getMergePolicySnapshot(7)).resolves.toMatchObject({ secondHumanApproved: false });
  });

  it("fails closed when GitHub indicates another page of changed files or checks", async () => {
    const responses = [
      { head: { sha: "a".repeat(40) }, user: { login: "author" }, labels: [] },
      [{ filename: "src/service.ts" }],
    ];
    const fetcher = async () => new Response(JSON.stringify(responses.shift()), {
      status: 200,
      headers: { Link: '<https://api.github.com/next>; rel="next"' },
    });
    const client = new GitHubClient({ owner: "o", repo: "r", token: "secret", fetcher });

    await expect(client.getMergePolicySnapshot(7)).rejects.toThrow(/pagination/);
  });
});
