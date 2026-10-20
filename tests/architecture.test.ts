import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

interface PackageManifest {
  name?: string;
  private?: boolean;
  workspaces?: string[];
  exports?: Record<string, string>;
  bin?: Record<string, string>;
}

const packages = ["core", "providers", "github", "state", "cli", "evals"];

async function manifest(path: string): Promise<PackageManifest> {
  return JSON.parse(await readFile(path, "utf8")) as PackageManifest;
}

async function typescriptFiles(path: string): Promise<string[]> {
  const entries = await readdir(path, { recursive: true });
  return entries
    .filter((entry) => entry.endsWith(".ts"))
    .map((entry) => join(path, entry));
}

describe("workspace architecture", () => {
  it("declares every harness package as a private workspace", async () => {
    const root = await manifest("package.json");
    expect(root.workspaces).toEqual(["packages/*"]);
    expect(root.bin).toEqual({
      "workflow-hub": "./dist/packages/cli/src/cli.js",
    });

    for (const packageName of packages) {
      const child = await manifest(`packages/${packageName}/package.json`);
      expect(child.name).toBe(`@workflow-hub/${packageName}`);
      expect(child.private).toBe(true);
      expect(child.exports).toEqual({ ".": "./src/index.ts" });
    }
  });

  it("keeps core independent from infrastructure and provider modules", async () => {
    const files = await typescriptFiles("packages/core/src");
    expect(files.length).toBeGreaterThan(0);
    const forbidden = /(?:node:(?:fs|child_process|http)|@workflow-hub\/(?:providers|github|state|cli|evals))/;

    for (const file of files) {
      const source = await readFile(file, "utf8");
      expect(source, file).not.toMatch(forbidden);
    }
  });
});