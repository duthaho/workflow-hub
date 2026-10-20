import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { WorkflowConfig } from "../../core/src/contracts.js";
import { runCli } from "../src/cli.js";
import {
  buildReviewInputFingerprint,
  GitRepository,
  resolveProviderBinary,
  type ReviewLoopCommand,
} from "../src/commands/review-loop.js";
import { defaultCommandRunner } from "../src/verification.js";

const config: WorkflowConfig = {
  schemaVersion: 1,
  project: { name: "demo", profile: "node" },
  providers: { author: "claude", reviewers: ["codex"] },
  commands: { verify: "npm run check" },
  risk: { highRiskPaths: [] },
  review: { maxRounds: 3, minimumConfidence: 0.8 },
};

function result(outcome: "passed" | "actionable" = "passed") {
  return {
    outcome,
    risk: { tier: "low" as const, reasons: ["none"] },
    session: {
      id: "session-1", version: 1, state: outcome === "passed" ? "passed" as const : "reviewing" as const,
      baseRef: "origin/main", mergeBaseSha: "base", headSha: "head", maxRounds: 3,
      inputFingerprint: "inputs",
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
        review: expect.objectContaining({ maxRounds: 2 }),
      }),
    }));
  });

  it("resolves explicit provider executables from the environment", () => {
    const environment = {
      WORKFLOW_HUB_CODEX_BIN: "/opt/tools/codex",
      WORKFLOW_HUB_CLAUDE_BIN: "/opt/tools/claude",
    };
    expect(resolveProviderBinary("codex", environment)).toBe("/opt/tools/codex");
    expect(resolveProviderBinary("claude", environment)).toBe("/opt/tools/claude");
    expect(resolveProviderBinary("codex", {})).toBeUndefined();
  });

  it("binds session identity to task and review policy inputs", () => {
    const first = buildReviewInputFingerprint({
      config,
      depth: "standard",
      fix: true,
      task: "task one",
    });
    expect(buildReviewInputFingerprint({
      config,
      depth: "standard",
      fix: true,
      task: "task two",
    })).not.toBe(first);
    expect(buildReviewInputFingerprint({
      config,
      depth: "quick",
      fix: true,
      task: "task one",
    })).not.toBe(first);
  });

  it("captures tracked and untracked worktree changes in a review snapshot", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "workflow-hub-snapshot-"));
    const run = async (command: string, args: string[]) => {
      const value = await defaultCommandRunner(command, args, {
        cwd, shell: false, inheritStdio: false,
      });
      if (value.exitCode !== 0) throw new Error(value.stderr);
      return value.stdout.trim();
    };
    await run("git", ["init"]);
    await run("git", ["config", "user.name", "Test"]);
    await run("git", ["config", "user.email", "test@example.com"]);
    await writeFile(join(cwd, "tracked.txt"), "before\n");
    await run("git", ["add", "."]);
    await run("git", ["commit", "-m", "base"]);
    const base = await run("git", ["rev-parse", "HEAD"]);
    await writeFile(join(cwd, "tracked.txt"), "after\n");
    await writeFile(join(cwd, "new.txt"), "new file\n");

    const repository = new GitRepository(cwd, defaultCommandRunner);
    const snapshot = await repository.resolveRef("HEAD");
    expect(snapshot).not.toBe(base);
    await expect(repository.changedFiles(base, snapshot)).resolves.toEqual([
      "new.txt", "tracked.txt",
    ]);
    const diff = await repository.diff(base, snapshot);
    expect(diff).toContain("after");
    expect(diff).toContain("new file");
  });
});
