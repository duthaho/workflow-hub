import { describe, expect, it } from "vitest";

import {
  FindingSchema,
  ReviewReportSchema,
  WorkflowConfigSchema,
  createFindingFingerprint,
  parseReviewReport,
} from "../src/contracts.js";

describe("WorkflowConfigSchema", () => {
  it("accepts a provider-neutral dual-provider configuration", () => {
    const result = WorkflowConfigSchema.parse({
      schemaVersion: 1,
      project: { name: "orders-api", profile: "node" },
      providers: {
        author: "claude",
        reviewers: ["codex"],
      },
      commands: {
        verify: "npm run check",
      },
      risk: {
        highRiskPaths: [".github/**", "src/auth/**"],
      },
    });

    expect(result.providers.reviewers).toEqual(["codex"]);
    expect(result.review.maxRounds).toBe(3);
    expect(result.review.minimumConfidence).toBe(0.8);
  });

  it("rejects a configuration without a deterministic verify command", () => {
    expect(() =>
      WorkflowConfigSchema.parse({
        schemaVersion: 1,
        project: { name: "orders-api", profile: "node" },
        providers: { author: "claude", reviewers: ["codex"] },
        commands: {},
        risk: { highRiskPaths: [] },
      }),
    ).toThrow();
  });
});

describe("FindingSchema", () => {
  const finding = {
    severity: "high",
    confidence: 0.92,
    category: "security",
    path: "src/auth/token.ts",
    startLine: 14,
    endLine: 18,
    title: "Token is logged",
    evidence: "logger.info({ token })",
    rationale: "Credentials can leak to log storage.",
    remediation: "Remove the token field or redact it.",
  } as const;

  it("accepts an actionable, evidenced finding", () => {
    expect(FindingSchema.parse(finding)).toMatchObject(finding);
  });

  it("rejects findings without evidence", () => {
    expect(() => FindingSchema.parse({ ...finding, evidence: "" })).toThrow();
  });

  it("creates a stable fingerprint independent of cosmetic casing and spacing", () => {
    const first = createFindingFingerprint(finding);
    const second = createFindingFingerprint({
      ...finding,
      title: "  TOKEN   IS LOGGED ",
      path: "./src/auth/token.ts",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("parseReviewReport", () => {
  it("parses a valid provider report and fills fingerprints", () => {
    const report = parseReviewReport(
      JSON.stringify({
        schemaVersion: 1,
        provider: "codex",
        baseRef: "origin/main",
        headSha: "abc1234",
        summary: "One security issue.",
        findings: [
          {
            severity: "high",
            confidence: 0.92,
            category: "security",
            path: "src/auth/token.ts",
            startLine: 14,
            endLine: 18,
            title: "Token is logged",
            evidence: "logger.info({ token })",
            rationale: "Credentials can leak to log storage.",
            remediation: "Remove the token field or redact it.",
          },
        ],
      }),
    );

    expect(ReviewReportSchema.parse(report)).toEqual(report);
    expect(report.findings[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  });

  it("fails closed when provider output is not valid JSON", () => {
    expect(() => parseReviewReport("No issues found")).toThrow(
      /invalid provider output/i,
    );
  });

  it("fails closed when a report silently omits required evidence", () => {
    expect(() =>
      parseReviewReport(
        JSON.stringify({
          schemaVersion: 1,
          provider: "claude",
          baseRef: "main",
          headSha: "abc1234",
          summary: "Looks fine.",
          findings: [
            {
              severity: "low",
              confidence: 0.4,
              category: "correctness",
              path: "src/index.ts",
              startLine: 1,
              endLine: 1,
              title: "Maybe wrong",
              rationale: "Unsure.",
              remediation: "Inspect it.",
            },
          ],
        }),
      ),
    ).toThrow(/invalid provider output/i);
  });
});
