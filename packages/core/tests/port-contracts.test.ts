import { expect, it } from "vitest";

import type { AgentProvider } from "../src/ports/agent-provider.js";
import type { RepositoryPort } from "../src/ports/repository.js";
import type { ReviewStateStore } from "../src/ports/review-state.js";
import type { VerificationPort } from "../src/ports/verification.js";

it("supports deterministic fake orchestration ports", async () => {
  const provider: AgentProvider = {
    name: "fake",
    runRole: async (request) => ({
      status: "completed",
      role: request.role,
      provider: "fake",
      summary: "ok",
      findings: [],
      verifications: [],
    }),
  };
  const repository: RepositoryPort = {
    resolveRef: async () => "sha",
    mergeBase: async () => "base",
    changedFiles: async () => ["src/app.ts"],
    diff: async () => "diff",
    fileLineCount: async () => 20,
  };
  const verification: VerificationPort = {
    verify: async () => ({ status: "passed", checks: [], durationMs: 1 }),
  };
  const saves: number[] = [];
  const store: ReviewStateStore = {
    load: async () => undefined,
    save: async (_session, expectedVersion) => {
      saves.push(expectedVersion);
      return 1;
    },
  };

  expect((await provider.runRole({
    sessionId: "s",
    round: 1,
    role: "correctness-scout",
    baseSha: "base",
    headSha: "head",
    changedFiles: [],
    diff: "",
    readOnly: true,
  })).status).toBe("completed");
  expect(await repository.fileLineCount("src/app.ts", "sha")).toBe(20);
  expect((await verification.verify()).status).toBe("passed");
  await store.save({} as never, 0);
  expect(saves).toEqual([0]);
});
