import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runReview } from "../src/review.js";
import type { CommandRunner } from "../src/verification.js";

const config = {
  schemaVersion: 1 as const,
  project: { name: "demo", profile: "node" as const },
  providers: {
    author: "codex" as const,
    reviewers: ["claude" as const],
  },
  commands: { verify: "npm test" },
  risk: { highRiskPaths: [".github/**"] },
  review: { maxRounds: 3, minimumConfidence: 0.8 },
};

describe("runReview", () => {
  it("runs a fresh read-only provider review and persists fingerprints", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "workflow-hub-review-"));
    await writeFile(join(cwd, "REVIEW.md"), "Focus on regressions.\n");
    const rawReport = {
      schemaVersion: 1,
      status: "completed",
      provider: "claude",
      baseRef: "origin/main",
      headSha: "abcdef1234567890",
      summary: "One issue found.",
      findings: [
        {
          severity: "high",
          confidence: 0.95,
          category: "correctness",
          path: "src/api.ts",
          startLine: 10,
          endLine: 10,
          title: "Missing validation",
          evidence: "Input reaches storage without validation.",
          rationale: "Malformed records can be stored.",
          remediation: "Validate before storage.",
        },
      ],
    };
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "abcdef1234567890\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "trusted policy from base\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({ structured_output: rawReport }),
        stderr: "",
      });

    const report = await runReview({
      cwd,
      config,
      provider: "claude",
      kind: "correctness",
      baseRef: "origin/main",
      runner,
    });

    expect(report.findings[0]?.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(runner.mock.calls[1]?.[0]).toBe("git");
    expect(runner.mock.calls[1]?.[1]).toEqual([
      "show",
      "origin/main:REVIEW.md",
    ]);
    expect(runner.mock.calls[2]?.[0]).toBe("claude");
    expect(runner.mock.calls[2]?.[1]).toContain("--restricted");
    expect(runner.mock.calls[2]?.[1].at(-1)).toContain(
      "trusted policy from base",
    );
    expect(runner.mock.calls[2]?.[1].at(-1)).not.toContain(
      "Focus on regressions.",
    );
    const persisted = JSON.parse(
      await readFile(
        join(cwd, ".workflow-hub/reports/correctness-claude.json"),
        "utf8",
      ),
    ) as typeof report;
    expect(persisted).toEqual(report);
  });

  it("fails closed when the provider reports that review was blocked", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "workflow-hub-review-"));
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "abcdef1234567890\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "trusted policy\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          structured_output: {
            schemaVersion: 1,
            status: "blocked",
            provider: "claude",
            baseRef: "origin/main",
            headSha: "abcdef1234567890",
            summary: "The sandbox could not inspect the diff.",
            findings: [],
          },
        }),
        stderr: "",
      });

    await expect(
      runReview({
        cwd,
        config,
        provider: "claude",
        kind: "correctness",
        baseRef: "origin/main",
        runner,
      }),
    ).rejects.toThrow(/review blocked.*sandbox could not inspect/i);
  });

  it("rejects provider metadata that does not match the invocation", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "workflow-hub-review-"));
    const runner = vi
      .fn<CommandRunner>()
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "abcdef1234567890\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: "trusted policy\n",
        stderr: "",
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: JSON.stringify({
          structured_output: {
            schemaVersion: 1,
            status: "completed",
            provider: "codex",
            baseRef: "origin/main",
            headSha: "abcdef1234567890",
            summary: "No findings.",
            findings: [],
          },
        }),
        stderr: "",
      });

    await expect(
      runReview({
        cwd,
        config,
        provider: "claude",
        kind: "security",
        baseRef: "origin/main",
        runner,
      }),
    ).rejects.toThrow(/provider metadata mismatch/i);
  });
});
