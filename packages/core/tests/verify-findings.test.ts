import { describe, expect, it, vi } from "vitest";

import { verifyFindings } from "../src/application/verify-findings.js";
import type { ReviewFinding } from "../src/domain/finding.js";
import type { AgentProvider } from "../src/ports/agent-provider.js";

const finding: ReviewFinding = {
  fingerprint: "finding-1",
  state: "candidate",
  severity: "high",
  confidence: 0.9,
  category: "security",
  defectClass: "command-injection",
  symbol: "run",
  title: "Untrusted shell command",
  location: { path: "src/run.ts", startLine: 2, endLine: 3 },
  evidence: [{ role: "security-scout", provider: "codex", text: "input reaches shell" }],
  supportingAgents: ["codex:security-scout"],
};

function verifier(name: string, supported: boolean, classification = "introduced"): AgentProvider {
  return {
    name,
    runRole: vi.fn(async (request) => ({
      status: "completed" as const,
      role: request.role,
      provider: name,
      summary: "verified",
      findings: [],
      verifications: [{
        fingerprint: request.finding?.fingerprint ?? "",
        supported,
        confidence: 0.95,
        classification: classification as "introduced" | "pre_existing" | "style_only" | "unsupported",
        reason: "independent evidence",
      }],
    })),
  };
}

describe("finding verification", () => {
  it("requires independent verifier consensus before opening a finding", async () => {
    const sameProvider = verifier("codex", true);
    const independent = verifier("claude", true);
    const result = await verifyFindings({
      findings: [finding],
      verifiers: [sameProvider, independent],
      quorum: 1,
      minimumConfidence: 0.8, timeoutMs: 100,
      lineCounts: { "src/run.ts": 10 },
      context: { sessionId: "s", round: 1, baseSha: "base", headSha: "head", changedFiles: ["src/run.ts"], diff: "diff" },
    });
    expect(sameProvider.runRole).not.toHaveBeenCalled();
    expect(result.findings[0]?.state).toBe("open");
    expect(result.blocked).toBe(false);
  });

  it("dismisses unsupported findings", async () => {
    const result = await verifyFindings({
      findings: [finding],
      verifiers: [verifier("claude", false, "unsupported")],
      quorum: 1,
      minimumConfidence: 0.8, timeoutMs: 100,
      lineCounts: { "src/run.ts": 10 },
      context: { sessionId: "s", round: 1, baseSha: "base", headSha: "head", changedFiles: ["src/run.ts"], diff: "diff" },
    });
    expect(result.findings[0]?.state).toBe("dismissed_false_positive");
  });

  it("fails closed instead of dismissing an invalid finding location", async () => {
    const result = await verifyFindings({
      findings: [{ ...finding, location: { ...finding.location, startLine: 11, endLine: 11 } }],
      verifiers: [verifier("claude", true)], quorum: 1, minimumConfidence: 0.8, timeoutMs: 100,
      lineCounts: { "src/run.ts": 10 },
      context: { sessionId: "s", round: 1, baseSha: "base", headSha: "head", changedFiles: ["src/run.ts"], diff: "diff" },
    });
    expect(result.blocked).toBe(true);
    expect(result.findings[0]?.state).toBe("candidate");
  });

  it("fails closed when a finding has no nonblank evidence", async () => {
    for (const evidence of [[], [{ role: "security-scout" as const, provider: "codex", text: "   " }]]) {
      const result = await verifyFindings({
        findings: [{ ...finding, evidence }],
        verifiers: [verifier("claude", true)], quorum: 1, minimumConfidence: 0.8, timeoutMs: 100,
        lineCounts: { "src/run.ts": 10 },
        context: { sessionId: "s", round: 1, baseSha: "base", headSha: "head", changedFiles: ["src/run.ts"], diff: "diff" },
      });
      expect(result.blocked).toBe(true);
      expect(result.findings[0]?.state).toBe("candidate");
    }
  });

  it("counts at most one vote from each verifier invocation", async () => {
    const duplicateVerifier: AgentProvider = {
      ...verifier("claude", true),
      async runRole(request) {
        const vote = {
          fingerprint: request.finding?.fingerprint ?? "", supported: true,
          confidence: 0.95, classification: "introduced" as const, reason: "confirmed",
        };
        return {
          status: "completed", role: request.role, provider: "claude",
          summary: "duplicated", findings: [], verifications: [vote, vote],
        };
      },
    };
    const failedVerifier: AgentProvider = {
      name: "gemini",
      async runRole(request) {
        return { status: "failed", role: request.role, provider: "gemini", summary: "failed", findings: [], verifications: [], error: "offline" };
      },
    };
    const result = await verifyFindings({
      findings: [finding], verifiers: [duplicateVerifier, failedVerifier],
      quorum: 2, minimumConfidence: 0.8, timeoutMs: 100, lineCounts: { "src/run.ts": 10 },
      context: { sessionId: "s", round: 1, baseSha: "base", headSha: "head", changedFiles: ["src/run.ts"], diff: "diff" },
    });
    expect(result.blocked).toBe(true);
  });

  it("times out a verifier that never settles", async () => {
    const hanging: AgentProvider = {
      name: "claude",
      runRole: async () => new Promise(() => undefined),
    };
    const result = await verifyFindings({
      findings: [finding], verifiers: [hanging], quorum: 1,
      minimumConfidence: 0.8, timeoutMs: 5, lineCounts: { "src/run.ts": 10 },
      context: { sessionId: "s", round: 1, baseSha: "base", headSha: "head", changedFiles: ["src/run.ts"], diff: "diff" },
    });
    expect(result.blocked).toBe(true);
    expect(result.failures.join(" ")).toMatch(/failed|quorum/i);
  });

  it("fails closed when no independent verifier can produce a verdict", async () => {
    const result = await verifyFindings({
      findings: [finding],
      verifiers: [verifier("codex", true)],
      quorum: 1,
      minimumConfidence: 0.8, timeoutMs: 100,
      lineCounts: { "src/run.ts": 10 },
      context: { sessionId: "s", round: 1, baseSha: "base", headSha: "head", changedFiles: ["src/run.ts"], diff: "diff" },
    });
    expect(result.blocked).toBe(true);
  });
});
