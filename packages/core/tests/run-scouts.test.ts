import { describe, expect, it } from "vitest";

import { runScouts } from "../src/application/run-scouts.js";
import type { AgentProvider } from "../src/ports/agent-provider.js";

function provider(name: string, behavior: "ok" | "failed", concurrency?: { active: number; max: number }): AgentProvider {
  return {
    name,
    async runRole(request) {
      if (concurrency) {
        concurrency.active += 1;
        concurrency.max = Math.max(concurrency.max, concurrency.active);
        await new Promise((resolve) => setTimeout(resolve, 5));
        concurrency.active -= 1;
      }
      return {
        status: behavior === "ok" ? "completed" : "failed",
        role: request.role,
        provider: name,
        summary: behavior,
        findings: [],
        verifications: [],
        ...(behavior === "failed" ? { error: "provider failed" } : {}),
      };
    },
  };
}

const request = {
  sessionId: "s",
  round: 1,
  baseSha: "base",
  headSha: "head",
  changedFiles: ["src/app.ts"],
  diff: "diff",
};

describe("parallel scouts", () => {
  it("bounds concurrency and records a non-fatal scout failure", async () => {
    const counter = { active: 0, max: 0 };
    const result = await runScouts({
      ...request,
      assignments: [
        { role: "correctness-scout", provider: provider("a", "ok", counter), required: true },
        { role: "security-scout", provider: provider("b", "failed", counter), required: true },
        { role: "test-gap-scout", provider: provider("c", "ok", counter), required: false },
      ],
      concurrency: 2,
      timeoutMs: 100,
    });
    expect(counter.max).toBe(2);
    expect(result.blocked).toBe(false);
    expect(result.failures).toHaveLength(1);
  });

  it("blocks when every required scout fails", async () => {
    const result = await runScouts({
      ...request,
      assignments: [
        { role: "correctness-scout", provider: provider("a", "failed"), required: true },
        { role: "security-scout", provider: provider("b", "failed"), required: true },
      ],
      concurrency: 2,
      timeoutMs: 100,
    });
    expect(result.blocked).toBe(true);
  });
});
