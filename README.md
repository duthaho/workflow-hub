# workflow-hub

Reusable, provider-neutral development and code-review workflow for **Claude Code** and **OpenAI Codex**.

`workflow-hub` turns the same review contract into local commands, GitHub checks, structured reports, and project templates. Claude Code and Codex are adapters; deterministic tests and explicit policy remain the source of truth.

## Why

AI code review is useful only when it is repeatable and bounded. This project separates:

1. deterministic verification,
2. correctness review,
3. security review,
4. risk classification,
5. human approval for high-risk changes.

An agent never approves its own output. A review finding is valid only when it follows the shared JSON schema and cites a concrete file and line range.

## Requirements

- Node.js 22 or newer
- Git
- At least one review provider:
  - [Claude Code](https://docs.anthropic.com/en/docs/claude-code), authenticated with a subscription session or `ANTHROPIC_API_KEY`
  - [Codex CLI](https://github.com/openai/codex), authenticated with a ChatGPT session or `OPENAI_API_KEY`

## Quick start

Run from the target project:

```bash
npx @duthaho/workflow-hub@0.1.0 init \
  --project my-service \
  --profile node \
  --author claude \
  --reviewers codex \
  --verify "npm run check"
```

Inspect the generated files before committing:

```bash
workflow-hub doctor
workflow-hub verify
workflow-hub review --provider codex --kind correctness --base origin/main
workflow-hub review --provider claude --kind security --base origin/main
```

Use `--dry-run` with `init` to list changes without writing. Existing files are never overwritten unless `--force` is supplied.

## Generated project contract

```text
workflow-hub.json
AGENTS.md
CLAUDE.md                         # when Claude is configured
REVIEW.md
.workflow-hub/
  prompts/
    correctness.md
    security.md
  reports/                        # ignored runtime output
.github/
  pull_request_template.md
  workflows/workflow-hub.yml
```

`workflow-hub.json` is provider-neutral:

```json
{
  "schemaVersion": 1,
  "project": { "name": "my-service", "profile": "node" },
  "providers": { "author": "claude", "reviewers": ["codex"] },
  "commands": { "verify": "npm run check" },
  "risk": {
    "highRiskPaths": [".github/**", "**/auth/**", "**/migrations/**"]
  },
  "review": { "maxRounds": 3, "minimumConfidence": 0.8 }
}
```

## CLI

### `workflow-hub init`

Creates the workflow contract and a profile-specific GitHub Actions workflow. Profiles:

- `node`: Node 22 and `npm ci`
- `python`: Node for the CLI plus Python 3.13 for the project
- `generic`: only Node for the CLI; the configured verify command owns project setup

### `workflow-hub verify`

Runs the exact deterministic command declared in `workflow-hub.json`. A non-zero child exit fails closed.

### `workflow-hub review`

Runs a provider in a fresh, read-only session:

- Claude Code: print mode, restricted permission mode, allowlisted read/git commands, JSON schema output
- Codex: `exec`, read-only sandbox, ephemeral session, ignored user config, JSON schema output

Reports are validated before being written to `.workflow-hub/reports/`. Invalid JSON, metadata mismatches, missing evidence, and provider failures fail closed. Findings receive stable SHA-256 fingerprints for deduplication.

### `workflow-hub doctor`

Validates project configuration and reports the required providers. Provider authentication diagnostics will be expanded before the stable release.

## Review result contract

Every finding contains:

- severity and confidence,
- category,
- file and line range,
- title,
- concrete evidence,
- rationale,
- remediation,
- deterministic fingerprint.

Low-confidence and low-severity findings can be reported without blocking. Medium, high, and critical findings above the configured confidence threshold return exit code `2` from the review command.

## GitHub Actions

This repository ships three workflows:

- `CI`: tests Node 22 and 24, builds, and validates the npm package
- `CodeQL`: deterministic JavaScript/TypeScript security analysis
- `Agent Review`: opt-in Claude or Codex review

Third-party actions are pinned to commit SHAs. The AI workflow is disabled until repository variable `WORKFLOW_HUB_AI_REVIEW=enabled` and the relevant provider secret are configured. Fork PRs must not receive provider secrets.

Recommended `main` ruleset:

- require pull requests,
- require CI and CodeQL,
- require conversation resolution,
- require code-owner approval for high-risk paths,
- block force pushes and deletion,
- use merge queue where available.

## Architecture

```text
CLI
 ├── config parser (Zod, fail closed)
 ├── initializer (additive writes, dry-run, force guard)
 ├── deterministic verification runner
 ├── risk and merge policy
 └── review orchestrator
      ├── Claude adapter
      ├── Codex adapter
      └── shared structured report schema
```

Design patterns:

- **Ports and adapters:** orchestration depends on a provider invocation contract, not a model vendor.
- **Policy as code:** risk and merge decisions are deterministic functions with unit tests.
- **Fresh-context review:** implementation and review sessions do not share conversation state.
- **Fail closed:** malformed provider output and failed checks never become a passing review.
- **Least privilege:** review adapters use read-only/restricted modes and GitHub workflows default to `contents: read`.
- **Cross-provider review:** projects can assign Claude as author and Codex as reviewer, or the reverse.

## Security boundaries

Code and diffs under review are untrusted data. Provider prompts explicitly reject instructions found in repository content. Hosted review must not use `pull_request_target` with provider secrets. Deterministic CI and human approval remain mandatory for high-risk changes.

## Development

```bash
npm ci
npm run check
```

The suite follows RED → GREEN → REFACTOR. See `AGENTS.md` and `REVIEW.md`.

## Status

`0.1.0` is the first working MVP. Remaining work before stable release includes GitHub comment synchronization, merge-policy status checks, metrics, and broader project profiles.

## License

MIT
