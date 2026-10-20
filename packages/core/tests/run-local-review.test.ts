import { describe, expect, it, vi } from "vitest";

import { runLocalReview } from "../src/application/run-local-review.js";
import type { CandidateFinding } from "../src/domain/finding.js";
import type { AgentProvider } from "../src/ports/agent-provider.js";
import type { RepositoryPort } from "../src/ports/repository.js";
import type { ReviewStateStore } from "../src/ports/review-state.js";
import type { VerificationPort } from "../src/ports/verification.js";

const candidate: CandidateFinding = {
  severity: "high", confidence: 0.95, category: "correctness", defectClass: "null-dereference",
  symbol: "load", title: "Missing value", location: { path: "src/app.ts", startLine: 2, endLine: 2 },
  evidence: [{ role: "correctness-scout", provider: "codex", text: "undefined is dereferenced" }],
};

class MemoryStore implements ReviewStateStore {
  value: Awaited<ReturnType<ReviewStateStore["load"]>>;
  async load() { return this.value; }
  async save(session: NonNullable<typeof this.value>, expectedVersion: number) {
    if ((this.value?.version ?? 0) !== expectedVersion) throw new Error("version conflict");
    this.value = { ...session, version: expectedVersion + 1 };
    return expectedVersion + 1;
  }
}

function provider(name: string, role: "scout" | "verifier" | "fix", repository?: { head: string }): AgentProvider {
  return {
    name,
    async runRole(request) {
      if (role === "fix") {
        if (repository) repository.head = "h2";
        return { status: "completed", role: request.role, provider: name, summary: "fixed", findings: [], verifications: [] };
      }
      if (role === "verifier") {
        return { status: "completed", role: request.role, provider: name, summary: "verified", findings: [], verifications: [{ fingerprint: request.finding?.fingerprint ?? "", supported: true, classification: "introduced", confidence: 0.99, reason: "confirmed" }] };
      }
      return { status: "completed", role: request.role, provider: name, summary: "scouted", findings: repository?.head === "h1" ? [candidate] : [], verifications: [] };
    },
  };
}

function repository(state: { head: string }): RepositoryPort {
  return {
    async resolveRef(ref) { return ref === "HEAD" ? state.head : "base"; },
    async mergeBase() { return "base"; },
    async changedFiles() { return ["src/app.ts"]; },
    async diff(base, head) { return `${base}..${head}`; },
    async fileLineCount() { return 10; },
  };
}

const verification: VerificationPort = {
  verify: vi.fn(async () => ({ status: "passed" as const, checks: [], durationMs: 1 })),
};

describe("local review orchestration", () => {
  it("runs verify, scouts, independent verification, fix, diff re-review, and passes", async () => {
    const repoState = { head: "h1" };
    const store = new MemoryStore();
    const result = await runLocalReview({
      sessionId: "session-1", baseRef: "origin/main", maxRounds: 3, inputFingerprint: "inputs",
      highRiskPaths: [], depth: "standard", fix: true,
      repository: repository(repoState), verification, stateStore: store,
      scouts: [
        { role: "correctness-scout", provider: provider("codex", "scout", repoState), required: true },
        { role: "security-scout", provider: provider("codex", "scout", repoState), required: true },
      ],
      verifiers: [provider("claude", "verifier")], fixProvider: provider("author", "fix", repoState),
      concurrency: 2, timeoutMs: 100, quorum: 1, minimumConfidence: 0.8,
      now: () => "2026-10-20T00:00:00.000Z",
    });
    expect(result.outcome).toBe("passed");
    expect(result.session.rounds).toHaveLength(2);
    expect(result.session.rounds[0]?.emittedFingerprints).toHaveLength(1);
    expect(result.session.rounds[1]?.emittedFingerprints).toHaveLength(0);
    expect(verification.verify).toHaveBeenCalledTimes(2);
  });

  it("executes an explicit develop task before verification and review", async () => {
    const events: string[] = [];
    const repoState = { head: "h1" };
    const fixProvider: AgentProvider = {
      name: "author",
      async runRole(request) {
        events.push("fix");
        repoState.head = "h2";
        expect(request.task).toContain("Implement requested feature");
        return { status: "completed", role: request.role, provider: "author", summary: "done", findings: [], verifications: [] };
      },
    };
    const cleanScout: AgentProvider = {
      name: "codex",
      async runRole(request) {
        events.push(request.role);
        return { status: "completed", role: request.role, provider: "codex", summary: "clean", findings: [], verifications: [] };
      },
    };
    const result = await runLocalReview({
      sessionId: "session-task", baseRef: "origin/main", maxRounds: 3, inputFingerprint: "inputs",
      highRiskPaths: [], depth: "quick", fix: true, task: "Implement requested feature",
      repository: repository(repoState),
      verification: { async verify() { events.push("verify"); return { status: "passed", checks: [], durationMs: 1 }; } },
      stateStore: new MemoryStore(),
      scouts: [
        { role: "correctness-scout", provider: cleanScout, required: true },
        { role: "security-scout", provider: cleanScout, required: true },
      ],
      verifiers: [provider("claude", "verifier")], fixProvider,
      concurrency: 2, timeoutMs: 100, quorum: 1, minimumConfidence: 0.8,
      now: () => "2026-10-20T00:00:00.000Z",
    });
    expect(result.outcome).toBe("passed");
    expect(events[0]).toBe("fix");
    expect(events[1]).toBe("verify");
  });

  it("escalates unresolved findings at maxRounds", async () => {
    const repoState = { head: "h1" };
    const result = await runLocalReview({
      sessionId: "session-2", baseRef: "origin/main", maxRounds: 1, inputFingerprint: "inputs",
      highRiskPaths: [], depth: "standard", fix: false,
      repository: repository(repoState), verification, stateStore: new MemoryStore(),
      scouts: [
        { role: "correctness-scout", provider: provider("codex", "scout", repoState), required: true },
        { role: "security-scout", provider: provider("codex", "scout", repoState), required: true },
      ],
      verifiers: [provider("claude", "verifier")],
      concurrency: 1, timeoutMs: 100, quorum: 1, minimumConfidence: 0.8,
      now: () => "2026-10-20T00:00:00.000Z",
    });
    expect(result.outcome).toBe("escalated");
  });

  it("resumes deterministic verification before starting a new review round", async () => {
    for (const rounds of [
      [],
      [{
        number: 1, baseSha: "base", headSha: "h1", scope: "merge-base" as const,
        startedAt: "now", completedAt: "now", findings: [], emittedFingerprints: [], scoutFailures: [],
      }],
    ]) {
      const store = new MemoryStore();
      store.value = {
        id: `verifying-${rounds.length}`, version: 2, state: "verifying",
        baseRef: "origin/main", mergeBaseSha: "base", headSha: "h1", maxRounds: 3,
        inputFingerprint: "inputs",
        rounds, knownFingerprints: [], createdAt: "now", updatedAt: "now",
      };
      const verify = vi.fn(async () => ({ status: "passed" as const, checks: [], durationMs: 1 }));
      const cleanScout = provider("codex", "scout", { head: "h2" });
      const result = await runLocalReview({
        sessionId: store.value.id, baseRef: "origin/main", maxRounds: 3, inputFingerprint: "inputs",
        highRiskPaths: [], depth: "quick", fix: false,
        repository: repository({ head: "h1" }), verification: { verify }, stateStore: store,
        scouts: [
          { role: "correctness-scout", provider: cleanScout, required: true },
          { role: "security-scout", provider: cleanScout, required: true },
        ],
        verifiers: [provider("claude", "verifier")],
        concurrency: 2, timeoutMs: 100, quorum: 1, minimumConfidence: 0.8,
        now: () => "2026-10-20T00:00:00.000Z",
      });
      expect(result.outcome).toBe("passed");
      expect(verify).toHaveBeenCalledOnce();
    }
  });

  it("reverifies and rereviews a changed snapshot when resuming", async () => {
    const events: string[] = [];
    const session = {
      id: "changed-review", version: 1, state: "reviewing" as const,
      baseRef: "origin/main", mergeBaseSha: "base", headSha: "h1", maxRounds: 3,
        inputFingerprint: "inputs",
      knownFingerprints: [],
      rounds: [{
        number: 1, baseSha: "base", headSha: "h1", scope: "merge-base" as const,
        changedFiles: ["app.ts"], findings: [], scoutFailures: [], emittedFingerprints: [],
        startedAt: "2026-10-20T00:00:00.000Z", completedAt: "2026-10-20T00:00:00.000Z",
      }],
      createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z",
    };
    const store = new MemoryStore();
    store.value = session;
    const result = await runLocalReview({
      sessionId: "changed-review", baseRef: "origin/main", maxRounds: 3, inputFingerprint: "inputs",
      highRiskPaths: [], depth: "standard", fix: false,
      repository: repository({ head: "h2" }),
      stateStore: store,
      verification: { verify: async () => { events.push("verify"); return { status: "passed", checks: [], durationMs: 1 }; } },
      scouts: [
        { role: "correctness-scout", provider: {
          name: "codex",
          async runRole(request: Parameters<AgentProvider["runRole"]>[0]) {
            events.push("scout");
            return { status: "completed", role: request.role, provider: "codex", summary: "clean", findings: [], verifications: [] };
          },
        }, required: true },
        { role: "security-scout", provider: provider("codex", "scout", { head: "h2" }), required: true },
      ],
      verifiers: [], concurrency: 2, timeoutMs: 100, quorum: 1, minimumConfidence: 0.8,
      now: () => "2026-10-20T00:00:00.000Z",
    });
    expect(result.outcome).toBe("passed");
    expect(events).toEqual(["verify", "scout"]);
  });

  it("rejects cached terminal sessions when the head or base input changed", async () => {
    const terminalSession = {
      id: "cached", version: 1, state: "passed" as const,
      baseRef: "origin/main", mergeBaseSha: "base", headSha: "h1", maxRounds: 3,
        inputFingerprint: "inputs",
      rounds: [], knownFingerprints: [], createdAt: "now", updatedAt: "now",
    };
    const changedHead = new MemoryStore();
    changedHead.value = terminalSession;
    const common = {
      sessionId: "cached", maxRounds: 3, inputFingerprint: "inputs", highRiskPaths: [], depth: "quick" as const,
      fix: false, verification, scouts: [], verifiers: [], concurrency: 1,
      timeoutMs: 100, quorum: 1, minimumConfidence: 0.8,
    };
    await expect(runLocalReview({
      ...common,
      baseRef: "origin/main",
      repository: repository({ head: "h2" }),
      stateStore: changedHead,
    })).rejects.toThrow(/does not match.*head|head.*does not match/i);

    const changedBase = new MemoryStore();
    changedBase.value = terminalSession;
    await expect(runLocalReview({
      ...common,
      baseRef: "origin/release",
      repository: repository({ head: "h1" }),
      stateStore: changedBase,
    })).rejects.toThrow(/does not match.*base|base.*does not match/i);

    const changedInputs = new MemoryStore();
    changedInputs.value = terminalSession;
    await expect(runLocalReview({
      ...common,
      inputFingerprint: "different-inputs",
      baseRef: "origin/main",
      repository: repository({ head: "h1" }),
      stateStore: changedInputs,
    })).rejects.toThrow(/does not match.*input|input.*does not match/i);
  });

  it("fails closed when an independent required security scout is not configured", async () => {
    const repoState = { head: "h1" };
    const result = await runLocalReview({
      sessionId: "session-3", baseRef: "origin/main", maxRounds: 3, inputFingerprint: "inputs",
      highRiskPaths: [], depth: "standard", fix: false,
      repository: repository(repoState), verification, stateStore: new MemoryStore(),
      scouts: [{ role: "correctness-scout", provider: provider("codex", "scout", repoState), required: true }],
      verifiers: [provider("claude", "verifier")],
      concurrency: 1, timeoutMs: 100, quorum: 1, minimumConfidence: 0.8,
      now: () => "2026-10-20T00:00:00.000Z",
    });
    expect(result.outcome).toBe("blocked");
    expect(result.session.blockedReason).toMatch(/security scout/i);
  });

  it("persists required scout failure evidence before blocking", async () => {
    const repoState = { head: "h1" };
    const failedSecurity: AgentProvider = {
      name: "codex",
      async runRole(request) {
        return {
          status: "failed",
          role: request.role,
          provider: "codex",
          summary: "unavailable",
          findings: [],
          verifications: [],
          error: "codex executable was not found",
        };
      },
    };
    const result = await runLocalReview({
      sessionId: "session-4", baseRef: "origin/main", maxRounds: 3, inputFingerprint: "inputs",
      highRiskPaths: [], depth: "quick", fix: false,
      repository: repository(repoState), verification, stateStore: new MemoryStore(),
      scouts: [
        { role: "correctness-scout", provider: provider("codex", "scout", repoState), required: true },
        { role: "security-scout", provider: failedSecurity, required: true },
      ],
      verifiers: [provider("claude", "verifier")],
      concurrency: 2, timeoutMs: 100, quorum: 1, minimumConfidence: 0.8,
      now: () => "2026-10-20T00:00:00.000Z",
    });
    expect(result.outcome).toBe("blocked");
    expect(result.session.rounds[0]?.scoutFailures).toEqual([
      "codex/security-scout: codex executable was not found",
    ]);
    expect(result.session.blockedReason).toContain("codex executable was not found");
  });
});
