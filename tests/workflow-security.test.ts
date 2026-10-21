import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

describe("agent review workflow trust boundary", () => {
  it("never executes pull-request code with provider credentials", async () => {
    const workflow = await readFile(".github/workflows/agent-review.yml", "utf8");

    expect(workflow).not.toContain("- run: npm ci");
    expect(workflow).not.toContain("- run: npm run build");
    expect(workflow).toContain(
      "npm install --global github:duthaho/workflow-hub#v0.1.0",
    );
    expect(workflow).toContain("run: workflow-hub review");
    expect(workflow).not.toMatch(
      /^    env:\n      (?:ANTHROPIC|OPENAI)_API_KEY:/m,
    );
    expect(workflow).toMatch(
      /- name: Run .* review\n        env:\n          (?:ANTHROPIC|OPENAI)_API_KEY:/,
    );
  });

  it("publishes policy status from workflow_run without checking out PR code", async () => {
    const workflow = await readFile(".github/workflows/review-policy.yml", "utf8");
    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain("checks: write");
    expect(workflow).not.toContain("actions/checkout");
    expect(workflow).not.toContain("ANTHROPIC_API_KEY");
    expect(workflow).not.toContain("OPENAI_API_KEY");
  });

  it("evaluates merge policy only from trusted default-branch code", async () => {
    const workflow = await readFile(".github/workflows/merge-policy.yml", "utf8");
    expect(workflow).toContain("workflow_run:");
    expect(workflow).toContain("checks: write");
    expect(workflow).toContain("pull-requests: read");
    expect(workflow).toContain("ref: ${{ github.event.repository.default_branch }}");
    expect(workflow).toContain("npm ci --ignore-scripts");
    expect(workflow).toContain("github-merge-policy");
    expect(workflow).not.toContain("ANTHROPIC_API_KEY");
    expect(workflow).not.toContain("OPENAI_API_KEY");
  });
});
