import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createReviewSession } from "../../core/src/domain/review-session.js";
import { FileReviewStateStore } from "../src/file-review-state-store.js";

describe("file review state store", () => {
  it("atomically persists and reloads versioned state", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "workflow-hub-state-"));
    const store = new FileReviewStateStore(cwd);
    const session = createReviewSession({
      id: "session-1", baseRef: "origin/main", mergeBaseSha: "base",
      headSha: "head", maxRounds: 3, now: "2026-10-20T00:00:00.000Z",
    });
    expect(await store.save(session, 0)).toBe(1);
    expect(await store.load("session-1")).toMatchObject({ id: "session-1", version: 1 });
    await expect(store.save(session, 0)).rejects.toThrow(/version conflict/i);
  });

  it("fails closed with recovery guidance for corrupt state", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "workflow-hub-state-"));
    const directory = join(cwd, ".workflow-hub", "state");
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "broken.json"), "not json");
    const store = new FileReviewStateStore(cwd);
    await expect(store.load("broken")).rejects.toThrow(/recover.*remove|remove.*recover/i);
  });

  it("rejects unsafe session identifiers", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "workflow-hub-state-"));
    const store = new FileReviewStateStore(cwd);
    await expect(store.load("../outside")).rejects.toThrow(/session id/i);
  });
});
