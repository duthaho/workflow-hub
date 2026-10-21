import { describe, expect, it, vi } from "vitest";
import { publishGitHubCheck } from "../src/commands/github-check.js";
import { runCli } from "../src/cli.js";

describe("publishGitHubCheck", () => {
  it("requires a token unless a trusted client is injected", async () => {
    await expect(publishGitHubCheck({ owner: "o", repo: "r", token: undefined, headSha: "h", conclusion: "success", summary: "ok" })).rejects.toThrow(/GITHUB_TOKEN/);
  });
  it("publishes a completed policy check", async () => {
    const createCheck = vi.fn(async () => 42);
    await expect(publishGitHubCheck({ owner: "o", repo: "r", token: undefined, headSha: "h", conclusion: "failure", summary: "blocked", client: { createCheck } })).resolves.toBe(42);
    expect(createCheck).toHaveBeenCalledWith(expect.objectContaining({ headSha: "h", conclusion: "failure" }));
  });
  it("rejects malformed CLI policy-check arguments before publishing", async () => {
    const stderr = vi.fn();
    const exit = await runCli(["github-check", "--repo", "owner/repo", "--head", "sha", "--conclusion", "bad", "--summary", "x"], { cwd: "/repo", stdout: vi.fn(), stderr });
    expect(exit).toBe(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/conclusion/));
  });
});
