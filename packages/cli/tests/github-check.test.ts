import { describe, expect, it, vi } from "vitest";
import { publishGitHubCheck } from "../src/commands/github-check.js";

describe("publishGitHubCheck", () => {
  it("requires a token unless a trusted client is injected", async () => {
    await expect(publishGitHubCheck({ owner: "o", repo: "r", token: undefined, headSha: "h", conclusion: "success", summary: "ok" })).rejects.toThrow(/GITHUB_TOKEN/);
  });
  it("publishes a completed policy check", async () => {
    const createCheck = vi.fn(async () => 42);
    await expect(publishGitHubCheck({ owner: "o", repo: "r", token: undefined, headSha: "h", conclusion: "failure", summary: "blocked", client: { createCheck } })).resolves.toBe(42);
    expect(createCheck).toHaveBeenCalledWith(expect.objectContaining({ headSha: "h", conclusion: "failure" }));
  });
});
