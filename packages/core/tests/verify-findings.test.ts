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
      minimumConfidence: 0.8,
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
      minimumConfidence: 0.8,
      lineCounts: { "src/run.ts": 10 },
      context: { sessionId: "s", round: 1, baseSha: "base", headSha: "head", changedFiles: ["src/run.ts"], diff: "diff" },
    });
    expect(result.findings[0]?.state).toBe("dismissed_false_positive");
  });

  it("fails closed when no independent verifier can produce a verdict", async () => {
    const result = await verifyFindings({
      findings: [finding],
      verifiers: [verifier("codex", true)],
      quorum: 1,
      minimumConfidence: 0.8,
      lineCounts: { "src/run.ts": 10 },
      context: { sessionId: "s", round: 1, baseSha: "base", headSha: "head", changedFiles: ["src/run.ts"], diff: "diff" },
    });
    expect(result.blocked).toBe(true);
  });
});
