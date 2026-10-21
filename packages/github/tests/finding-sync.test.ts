import { describe, expect, it } from "vitest";

import { planFindingThreadSync } from "../src/finding-sync.js";
import type { ReviewFinding } from "../../core/src/domain/finding.js";

const finding = (fingerprint: string, state: ReviewFinding["state"] = "open"): ReviewFinding => ({
  fingerprint, state, severity: "high", confidence: 0.9, category: "correctness",
  defectClass: "null-dereference", title: "Guard nullable input",
  location: { path: "src/app.ts", startLine: 4, endLine: 4 },
  evidence: [{ role: "correctness-scout", provider: "codex", text: "value can be null" }],
  supportingAgents: ["codex:correctness-scout"], remediation: "Add a guard.",
});

describe("finding thread sync", () => {
  it("creates an inline thread only for a new actionable finding", () => {
    expect(planFindingThreadSync({ findings: [finding("new")], existing: [], commitSha: "head" })).toEqual([
      expect.objectContaining({ kind: "create", fingerprint: "new", path: "src/app.ts", line: 4 }),
    ]);
  });

  it("updates a persisted finding instead of duplicating it and resolves closed lifecycles", () => {
    const plan = planFindingThreadSync({
      findings: [finding("open"), finding("fixed", "fixed")], commitSha: "head",
      existing: [{ fingerprint: "open", threadId: "t1", resolved: false }, { fingerprint: "fixed", threadId: "t2", resolved: false }],
    });
    expect(plan).toEqual([
      expect.objectContaining({ kind: "update", threadId: "t1" }),
      { kind: "resolve", fingerprint: "fixed", threadId: "t2" },
    ]);
  });

  it("does not publish low severity findings as blocking inline threads", () => {
    expect(planFindingThreadSync({ findings: [{ ...finding("low"), severity: "low" }], existing: [], commitSha: "head" })).toEqual([]);
  });
});
