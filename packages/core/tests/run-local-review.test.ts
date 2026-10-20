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
      sessionId: "session-1", baseRef: "origin/main", maxRounds: 3,
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

  it("escalates unresolved findings at maxRounds", async () => {
    const repoState = { head: "h1" };
    const result = await runLocalReview({
      sessionId: "session-2", baseRef: "origin/main", maxRounds: 1,
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

  it("fails closed when an independent required security scout is not configured", async () => {
    const repoState = { head: "h1" };
    const result = await runLocalReview({
      sessionId: "session-3", baseRef: "origin/main", maxRounds: 3,
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
});
