import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadWorkflowConfig } from "../src/config.js";
import {
  listChangedFiles,
  runVerification,
  type CommandRunner,
} from "../src/verification.js";

const validConfig = {
  schemaVersion: 1,
  project: { name: "demo", profile: "node" },
  providers: { author: "claude", reviewers: ["codex"] },
  commands: { verify: "npm run check" },
};

describe("loadWorkflowConfig", () => {
  it("loads and validates workflow-hub.json", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "workflow-hub-config-"));
    await writeFile(
      join(cwd, "workflow-hub.json"),
      JSON.stringify(validConfig),
    );

    await expect(loadWorkflowConfig(cwd)).resolves.toMatchObject(validConfig);
  });

  it("reports an actionable error for an invalid config", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "workflow-hub-config-"));
    await writeFile(join(cwd, "workflow-hub.json"), "{}\n");

    await expect(loadWorkflowConfig(cwd)).rejects.toThrow(
      /invalid workflow-hub\.json/i,
    );
  });
});

describe("runVerification", () => {
  it("runs the configured command in the project root", async () => {
    const runner = vi.fn<CommandRunner>().mockResolvedValue({
      exitCode: 0,
      stdout: "ok",
      stderr: "",
    });

    const result = await runVerification(validConfig, {
      cwd: "/project",
      runner,
    });

    expect(runner).toHaveBeenCalledWith("npm run check", [], {
      cwd: "/project",
      shell: true,
      inheritStdio: true,
    });
    expect(result.exitCode).toBe(0);
  });

  it("fails when deterministic verification fails", async () => {
    const runner = vi.fn<CommandRunner>().mockResolvedValue({
      exitCode: 2,
      stdout: "",
      stderr: "tests failed",
    });

    await expect(
      runVerification(validConfig, { cwd: "/project", runner }),
    ).rejects.toThrow(/verification failed.*exit code 2/i);
  });
});

describe("listChangedFiles", () => {
  it("uses a merge base and NUL-delimited paths", async () => {
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "base-sha\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "src/a.ts\0docs/file with spaces.md\0",
        stderr: "",
      });

    await expect(
      listChangedFiles("origin/main", { cwd: "/project", runner }),
    ).resolves.toEqual(["src/a.ts", "docs/file with spaces.md"]);

    expect(runner).toHaveBeenNthCalledWith(
      1,
      "git",
      ["merge-base", "origin/main", "HEAD"],
      expect.objectContaining({ cwd: "/project", shell: false }),
    );
    expect(runner).toHaveBeenNthCalledWith(
      2,
      "git",
      ["diff", "--name-only", "-z", "base-sha", "HEAD"],
      expect.objectContaining({ cwd: "/project", shell: false }),
    );
  });
});
