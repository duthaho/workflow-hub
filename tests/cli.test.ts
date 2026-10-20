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
