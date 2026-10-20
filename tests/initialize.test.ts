import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { initializeProject } from "../src/initialize.js";

describe("initializeProject", () => {
  it("installs the provider-neutral workflow and both provider adapters", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workflow-hub-init-"));

    const result = await initializeProject({
      cwd: directory,
      projectName: "demo-api",
      profile: "node",
      author: "claude",
      reviewers: ["codex"],
      verifyCommand: "npm run check",
    });

    expect(result.created).toContain("workflow-hub.json");
    expect(result.created).toContain("AGENTS.md");
    expect(result.created).toContain("CLAUDE.md");
    expect(result.created).toContain(".github/workflows/workflow-hub.yml");

    const config = JSON.parse(
      await readFile(join(directory, "workflow-hub.json"), "utf8"),
    ) as Record<string, unknown>;
    expect(config).toMatchObject({
      schemaVersion: 1,
      project: { name: "demo-api", profile: "node" },
      providers: { author: "claude", reviewers: ["codex"] },
      commands: { verify: "npm run check" },
    });

    const workflow = await readFile(
      join(directory, ".github/workflows/workflow-hub.yml"),
      "utf8",
    );
    expect(workflow).toContain("pull_request:");
    expect(workflow).toContain("merge_group:");
    expect(workflow).not.toContain("pull_request_target");
  });

  it("refuses to overwrite managed files without force", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workflow-hub-init-"));
    await writeFile(join(directory, "AGENTS.md"), "project-owned\n");

    await expect(
      initializeProject({
        cwd: directory,
        projectName: "demo-api",
        profile: "node",
        author: "codex",
        reviewers: ["claude"],
        verifyCommand: "npm test",
      }),
    ).rejects.toThrow(/already exist.*AGENTS\.md/i);

    expect(await readFile(join(directory, "AGENTS.md"), "utf8")).toBe(
      "project-owned\n",
    );
  });

  it("generates profile-specific bootstrap steps", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workflow-hub-init-"));
    await initializeProject({
      cwd: directory,
      projectName: "generic-demo",
      profile: "generic",
      author: "codex",
      reviewers: ["claude"],
      verifyCommand: "make check",
    });

    const workflow = await readFile(
      join(directory, ".github/workflows/workflow-hub.yml"),
      "utf8",
    );
    expect(workflow).not.toContain("npm ci");
    expect(workflow).toContain("workflow-hub verify");
  });

  it("supports a dry run without writing files", async () => {
    const directory = await mkdtemp(join(tmpdir(), "workflow-hub-init-"));
    const result = await initializeProject({
      cwd: directory,
      projectName: "demo-api",
      profile: "generic",
      author: "codex",
      reviewers: ["claude", "codex"],
      verifyCommand: "make check",
      dryRun: true,
    });

    expect(result.created).toEqual([]);
    expect(result.planned).toContain("workflow-hub.json");
    await expect(readFile(join(directory, "workflow-hub.json"))).rejects.toThrow();
  });
});
