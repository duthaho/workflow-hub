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
});
