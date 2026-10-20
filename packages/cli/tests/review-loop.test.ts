import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runCli } from "../src/cli.js";
import type { ReviewLoopCommand } from "../src/commands/review-loop.js";

const config = {
  schemaVersion: 1,
  project: { name: "demo", profile: "node" },
  providers: { author: "claude", reviewers: ["codex"] },
  commands: { verify: "npm run check" },
  risk: { highRiskPaths: [] },
  review: { maxRounds: 3, minimumConfidence: 0.8 },
} as const;

function result(outcome: "passed" | "actionable" = "passed") {
  return {
    outcome,
    risk: { tier: "low" as const, reasons: ["none"] },
    session: {
      id: "session-1", version: 1, state: outcome === "passed" ? "passed" as const : "reviewing" as const,
      baseRef: "origin/main", mergeBaseSha: "base", headSha: "head", maxRounds: 3,
      rounds: [], knownFingerprints: [], createdAt: "now", updatedAt: "now",
    },
  };
}

function runner() {
  return vi.fn(async () => ({ exitCode: 0, stdout: JSON.stringify(config), stderr: "" }));
}

describe("review-loop CLI", () => {
  it("loads trusted config and invokes the local review loop", async () => {
    const command: ReviewLoopCommand = vi.fn(async () => result());
    const stdout = vi.fn();
    const exitCode = await runCli(
      ["review-loop", "--base", "origin/main", "--depth", "standard", "--session", "session-1"],
      { cwd: "/repo", stdout, stderr: vi.fn(), runner: runner(), reviewLoopCommand: command },
    );
    expect(exitCode).toBe(0);
    expect(command).toHaveBeenCalledWith(expect.objectContaining({ baseRef: "origin/main", depth: "standard", sessionId: "session-1" }));
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining('"outcome":"passed"'));
  });

  it("maps develop options and task content to an explicit fix loop", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "workflow-hub-develop-"));
    await writeFile(join(cwd, "task.md"), "Implement safe parsing");
    const command: ReviewLoopCommand = vi.fn(async () => result("actionable"));
    const exitCode = await runCli(
      ["develop", "--task", "task.md", "--author", "codex", "--reviewer", "claude", "--max-rounds", "2"],
      { cwd, stdout: vi.fn(), stderr: vi.fn(), runner: runner(), reviewLoopCommand: command },
    );
    expect(exitCode).toBe(2);
    expect(command).toHaveBeenCalledWith(expect.objectContaining({
      fix: true, task: "Implement safe parsing",
      config: expect.objectContaining({
        providers: { author: "codex", reviewers: ["claude"] },
        review: { maxRounds: 2, minimumConfidence: 0.8 },
      }),
    }));
  });
});
