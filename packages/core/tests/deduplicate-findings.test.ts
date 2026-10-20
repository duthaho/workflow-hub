import { describe, expect, it } from "vitest";

import { deduplicateFindings } from "../src/application/deduplicate-findings.js";
import type { CandidateFinding } from "../src/domain/finding.js";

function candidate(overrides: Partial<CandidateFinding> = {}): CandidateFinding {
  return {
    severity: "high",
    confidence: 0.9,
    category: "correctness",
    defectClass: "null-dereference",
    symbol: "loadTask",
    title: "Missing task can be dereferenced",
    location: { path: "src/tasks.ts", startLine: 10, endLine: 12 },
    evidence: [{ role: "correctness-scout", provider: "codex", text: "task is optional" }],
    ...overrides,
  };
}

describe("semantic finding identity", () => {
  it("keeps identity stable when line numbers shift", () => {
    const first = deduplicateFindings([candidate()], { "src/tasks.ts": 100 });
    const shifted = deduplicateFindings([
      candidate({ location: { path: "./src/tasks.ts", startLine: 30, endLine: 32 } }),
    ], { "src/tasks.ts": 100 });
    expect(shifted[0]?.fingerprint).toBe(first[0]?.fingerprint);
  });

  it("does not collapse findings for different symbols", () => {
    const findings = deduplicateFindings([
      candidate(),
      candidate({ symbol: "saveTask" }),
    ], { "src/tasks.ts": 100 });
    expect(findings).toHaveLength(2);
  });

  it("merges duplicate evidence and supporting agents", () => {
    const findings = deduplicateFindings([
      candidate(),
      candidate({
        evidence: [{ role: "security-scout", provider: "claude", text: "same unsafe path" }],
      }),
    ], { "src/tasks.ts": 100 });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.evidence).toHaveLength(2);
    expect(findings[0]?.supportingAgents).toEqual([
      "claude:security-scout",
      "codex:correctness-scout",
    ]);
  });

  it("rejects paths outside the repository and impossible line ranges", () => {
    expect(() => deduplicateFindings([
      candidate({ location: { path: "../secret", startLine: 1, endLine: 1 } }),
    ], {})).toThrow(/outside repository/i);
    expect(() => deduplicateFindings([
      candidate({ location: { path: "src/tasks.ts", startLine: 90, endLine: 101 } }),
    ], { "src/tasks.ts": 100 })).toThrow(/line range/i);
  });
});
