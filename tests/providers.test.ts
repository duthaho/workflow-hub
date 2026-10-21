import { describe, expect, it } from "vitest";

import {
  buildProviderInvocation,
  extractStructuredReport,
  reviewReportJsonSchema,
} from "../src/providers.js";

describe("buildProviderInvocation", () => {
  const options = {
    baseRef: "origin/main",
    headSha: "abc1234",
    schemaPath: "/tmp/review.schema.json",
    outputPath: "/tmp/review.output.json",
    prompt: "Review the diff and return only schema-valid findings.",
  };

  it("builds a non-interactive, read-only Claude invocation", () => {
    const invocation = buildProviderInvocation("claude", options);

    expect(invocation.command).toBe("claude");
    expect(invocation.args).toContain("--print");
    expect(invocation.args).toContain("--restricted");
    expect(invocation.args).toContain("--permission-mode");
    expect(invocation.args).toContain("plan");
    expect(invocation.args).toContain("--json-schema");
    expect(invocation.args).toContain("--no-session-persistence");
    expect(invocation.args).not.toContain("--dangerously-skip-permissions");
  });

  it("builds an ephemeral, read-only Codex invocation", () => {
    const invocation = buildProviderInvocation("codex", options);

    expect(invocation.command).toBe("codex");
    const windowsInvocation = buildProviderInvocation("codex", options, "win32");
    expect(windowsInvocation.command).toBe("cmd.exe");
    expect(windowsInvocation.args.slice(0, 4)).toEqual(["/d", "/s", "/c", "codex.cmd"]);
    expect(invocation.args.slice(0, 2)).toEqual(["exec", "--sandbox"]);
    expect(invocation.args).toContain("read-only");
    expect(invocation.args).toContain("--ephemeral");
    expect(invocation.args).toContain("--output-schema");
    expect(invocation.args).toContain("--output-last-message");
    expect(invocation.args).not.toContain(
      "--dangerously-bypass-approvals-and-sandbox",
    );
  });
});

describe("reviewReportJsonSchema", () => {
  it("uses a strict provider schema without controller-owned fingerprints", () => {
    const schema = reviewReportJsonSchema as unknown as {
      properties: {
        findings: {
          items: { properties: Record<string, unknown>; required: string[] };
        };
      };
    };
    const finding = schema.properties.findings.items;
    expect(finding.properties).not.toHaveProperty("fingerprint");
    expect(finding.required.sort()).toEqual(
      Object.keys(finding.properties).sort(),
    );
  });
});

describe("extractStructuredReport", () => {
  const report = {
    schemaVersion: 1,
    status: "completed",
    provider: "claude",
    baseRef: "origin/main",
    headSha: "abc1234",
    summary: "No actionable findings.",
    findings: [],
  };

  it("unwraps Claude structured output", () => {
    expect(
      extractStructuredReport(
        "claude",
        JSON.stringify({
          type: "result",
          structured_output: report,
          session_id: "secret-session-id",
        }),
      ),
    ).toEqual(report);
  });

  it("accepts Codex's schema-constrained final message", () => {
    expect(extractStructuredReport("codex", JSON.stringify(report))).toEqual(
      report,
    );
  });

  it("fails closed when Claude omits structured output", () => {
    expect(() =>
      extractStructuredReport(
        "claude",
        JSON.stringify({ type: "result", result: "No issues" }),
      ),
    ).toThrow(/structured_output/i);
  });
});
