import { mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import { isDirectExecution, runCli } from "../src/cli.js";

describe("isDirectExecution", () => {
  it("recognizes an npm-style symlinked executable", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workflow-hub-bin-"));
    const target = join(directory, "dist-cli.js");
    const link = join(directory, "workflow-hub");
    await writeFile(target, "#!/usr/bin/env node\n");
    await symlink(target, link);

    expect(isDirectExecution(pathToFileURL(target).href, link)).toBe(true);
  });
});

describe("runCli", () => {
  it("initializes a project from explicit provider options", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "workflow-hub-cli-"));
    const stdout = vi.fn();
    const stderr = vi.fn();

    const exitCode = await runCli(
      [
        "init",
        "--project",
        "demo-api",
        "--profile",
        "node",
        "--author",
        "codex",
        "--reviewers",
        "claude",
        "--verify",
        "npm run check",
      ],
      { cwd, stdout, stderr },
    );

    expect(exitCode).toBe(0);
    expect(stdout).toHaveBeenCalledWith(expect.stringMatching(/initialized/i));
    expect(stderr).not.toHaveBeenCalled();
  });

  it("uses the base branch confidence policy for review gating", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "workflow-hub-cli-"));
    const untrustedConfig = {
      schemaVersion: 1,
      project: { name: "demo", profile: "node" },
      providers: { author: "codex", reviewers: ["claude"] },
      commands: { verify: "npm run check" },
      review: { maxRounds: 3, minimumConfidence: 1 },
    };
    const trustedConfig = {
      ...untrustedConfig,
      review: { maxRounds: 3, minimumConfidence: 0.8 },
    };
    await writeFile(
      join(cwd, "workflow-hub.json"),
      JSON.stringify(untrustedConfig),
    );
    const runner = vi
      .fn()
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify(trustedConfig),
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "abcdef1234567890\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "trusted policy\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          structured_output: {
            schemaVersion: 1,
            status: "completed",
            provider: "claude",
            baseRef: "origin/main",
            headSha: "abcdef1234567890",
            summary: "One actionable finding.",
            findings: [
              {
                severity: "high",
                confidence: 0.9,
                category: "security",
                path: "src/api.ts",
                startLine: 1,
                endLine: 1,
                title: "Unsafe input",
                evidence: "Untrusted input reaches a command.",
                rationale: "This permits command injection.",
                remediation: "Use an argument array.",
              },
            ],
          },
        }),
        stderr: "",
      });

    const exitCode = await runCli(
      ["review", "--provider", "claude", "--kind", "security"],
      { cwd, stdout: vi.fn(), stderr: vi.fn(), runner },
    );

    expect(exitCode).toBe(2);
    expect(runner).toHaveBeenNthCalledWith(
      1,
      "git",
      ["show", "origin/main:workflow-hub.json"],
      expect.objectContaining({ cwd }),
    );
  });

  it("prints usage without mutating the project", async () => {
    const stdout = vi.fn();
    const exitCode = await runCli(["--help"], {
      cwd: "/unused",
      stdout,
      stderr: vi.fn(),
    });

    expect(exitCode).toBe(0);
    expect(stdout).toHaveBeenCalledWith(expect.stringContaining("workflow-hub init"));
  });

  it("fails with an actionable message for unknown commands", async () => {
    const stderr = vi.fn();
    const exitCode = await runCli(["unknown"], {
      cwd: "/unused",
      stdout: vi.fn(),
      stderr,
    });

    expect(exitCode).toBe(1);
    expect(stderr).toHaveBeenCalledWith(expect.stringMatching(/unknown command/i));
  });
});
