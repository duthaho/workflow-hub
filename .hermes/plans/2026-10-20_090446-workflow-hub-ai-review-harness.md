# Workflow Hub AI Review Harness Implementation Plan

> **For Hermes:** Implement this plan phase-by-phase with test-driven development. Complete and verify one phase before starting the next. Use a fresh independent agent review on every phase PR.

**Goal:** Evolve `duthaho/workflow-hub` from a collection of review CLI primitives into a provider-neutral AI development and code-review harness implementing continuous local review, multi-agent finding verification, GitHub finding lifecycle, blocking merge policy, convergence controls, evaluation, and operational rollback guidance.

**Architecture:** Keep one repository and evolve it as a TypeScript modular monolith. Pure domain and application orchestration live in `packages/core`; Claude/Codex execution lives behind provider ports; GitHub comments/checks live behind pull-request ports; CLI and GitHub Action are interfaces. State is explicit and versioned so review rounds converge and can resume. The separate `workflow-hub-demo` repository remains the end-to-end consumer and acceptance environment.

**Tech Stack:** Node.js 22+, TypeScript, Zod, Vitest, npm workspaces, Claude Code CLI, OpenAI Codex CLI, GitHub REST API/`gh`, GitHub Actions, JSON state and eval fixtures.

---

## Delivery rules

1. Each phase uses a dedicated branch and pull request.
2. Behavioral work follows RED → GREEN → REFACTOR.
3. Every commit must pass focused tests; every phase must pass `npm run check` and `git diff --check`.
4. Agent execution defaults to read-only. Workspace-write is allowed only for an explicit author/fix role in a disposable or clean worktree.
5. Repository files, diffs, PR text, comments, and model output are untrusted data.
6. Review policy and merge policy are loaded from the trusted base ref.
7. Candidate findings never become GitHub comments before deterministic validation and verifier consensus.
8. Review rounds are capped. The harness must fail closed or escalate, never loop indefinitely.
9. Each phase is reviewed by a fresh provider session that did not author the change.
10. No phase is called complete until its real CLI/GitHub path is exercised, not only unit-tested.

## Target repository structure

```text
workflow-hub/
├── packages/
│   ├── core/
│   │   └── src/
│   │       ├── domain/
│   │       ├── application/
│   │       └── ports/
│   ├── providers/
│   │   └── src/{claude,codex}/
│   ├── github/
│   │   └── src/
│   ├── state/
│   │   └── src/
│   ├── cli/
│   │   └── src/
│   └── evals/
│       └── src/
├── action/
├── templates/
├── evals/cases/
├── tests/end-to-end/
└── workflow-hub.json
```

During migration, compatibility re-export files may remain under `src/`. They must be removed or explicitly documented before `v0.2.0`.

---

# Phase 0: Baseline, package boundaries, and compatibility

**Outcome:** Establish workspaces and architecture boundaries without changing existing CLI behavior.

### Task 0.1: Capture baseline and provenance

**Files:**
- Create: `docs/architecture/current-state.md`
- Create: `docs/architecture/target-state.md`

**Steps:**
1. Record repository URL, default branch, current commit, release, current commands, and known limitations.
2. Document the existing execution path `CLI -> verification/review -> provider`.
3. Document the target modular architecture and dependency direction.
4. Run `npm ci && npm run check && npm pack --dry-run`.
5. Commit: `docs: define AI review harness architecture`.

### Task 0.2: Introduce npm workspaces

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `packages/*/package.json`
- Create: `packages/*/tsconfig.json`
- Modify: `tsconfig.json`
- Modify: `tsconfig.build.json`

**TDD/verification:**
1. Add an architecture test that resolves every workspace package and verifies package exports.
2. Run it and confirm failure before workspaces exist.
3. Add workspace manifests and TypeScript project references.
4. Keep root scripts `build`, `typecheck`, `test`, and `check` working.
5. Verify the packed CLI still exposes `workflow-hub`.
6. Commit: `refactor: establish harness workspace boundaries`.

### Task 0.3: Move existing primitives behind compatibility exports

**Files:**
- Move contracts/policy/verification to `packages/core/src/`.
- Move provider invocation to `packages/providers/src/`.
- Move CLI to `packages/cli/src/`.
- Keep temporary re-exports in `src/` if required by package consumers.
- Update tests to import public package entry points.

**Verification:**
- Existing 46+ tests remain green.
- Existing CLI smoke test via installed tarball passes.
- No domain module imports provider, GitHub, filesystem, child-process, or HTTP modules.
- Commit: `refactor: move primitives into modular harness packages`.

**Phase 0 acceptance:** No user-visible behavior regression; package boundaries are enforced by tests.

---

# Phase 1: Core orchestration and local continuous review

**Outcome:** A local harness can run deterministic verification, parallel scouts, finding verification, bounded fix/re-review rounds, and resumable state.

### Task 1.1: Model agent roles and review lifecycle

**Files:**
- Create: `packages/core/src/domain/agent-role.ts`
- Create: `packages/core/src/domain/finding.ts`
- Create: `packages/core/src/domain/review-session.ts`
- Create: `packages/core/src/domain/review-round.ts`
- Test: `packages/core/tests/review-session.test.ts`

**Domain contracts:**
- Roles: `correctness-scout`, `security-scout`, `test-gap-scout`, `architecture-scout`, `finding-verifier`, `fix-agent`.
- Finding states: `candidate`, `open`, `fixed`, `dismissed_false_positive`, `dismissed_intentional`, `pre_existing`.
- Session states: `pending`, `verifying`, `reviewing`, `fixing`, `passed`, `escalated`, `blocked`.
- Every transition validates current state and round cap.

**TDD:**
1. Write tests for valid transitions, invalid transitions, terminal states, and round cap.
2. Run focused tests and confirm RED.
3. Implement pure state transitions.
4. Run focused tests and confirm GREEN.
5. Commit: `feat: model bounded review sessions`.

### Task 1.2: Define orchestration ports

**Files:**
- Create: `packages/core/src/ports/agent-provider.ts`
- Create: `packages/core/src/ports/repository.ts`
- Create: `packages/core/src/ports/review-state.ts`
- Create: `packages/core/src/ports/verification.ts`
- Create: `packages/core/src/ports/pull-request.ts`
- Test: `packages/core/tests/port-contracts.test.ts`

**Contracts:**
- `AgentProvider.runRole(request): AgentRoleResult`.
- `RepositoryPort` resolves SHAs, merge base, changed files, diff, and diff between review rounds.
- `ReviewStateStore` uses optimistic `expectedVersion` writes.
- `VerificationPort` returns structured checks, duration, command, and evidence.
- `PullRequestPort` provides intent and publishes findings/checks without leaking GitHub details into core.

**Verification:** Type-level contract tests and fake implementations pass.

### Task 1.3: Implement semantic finding identity and deduplication

**Files:**
- Create: `packages/core/src/application/deduplicate-findings.ts`
- Modify: finding contract to separate stable identity from current location.
- Test: `packages/core/tests/deduplicate-findings.test.ts`

**Rules:**
- Identity excludes volatile line numbers.
- Normalize path, category, defect class, symbol/context, and title.
- Preserve all supporting agents and evidence.
- Reject paths outside the repository and line ranges outside the current file.

**TDD cases:** shifted lines retain identity; different symbols do not collapse; duplicate scouts merge evidence.

### Task 1.4: Implement parallel scout execution

**Files:**
- Create: `packages/core/src/application/run-scouts.ts`
- Test: `packages/core/tests/run-scouts.test.ts`

**Behavior:**
- Select roles from review depth and risk.
- Run configured agents concurrently with bounded concurrency and per-agent timeout.
- A single failed scout is recorded; all required scouts failing blocks the round.
- Aggregate candidate findings deterministically.

### Task 1.5: Implement finding verifier and consensus policy

**Files:**
- Create: `packages/core/src/application/verify-findings.ts`
- Create: `packages/core/src/domain/consensus-policy.ts`
- Test: `packages/core/tests/verify-findings.test.ts`

**Behavior:**
- Deterministically validate location and evidence first.
- Send each surviving candidate to independent verifier agents.
- Require configurable quorum and confidence.
- Classify `introduced`, `pre_existing`, `style_only`, or `unsupported`.
- Only `introduced` actionable findings become open findings.

### Task 1.6: Implement convergence controller

**Files:**
- Create: `packages/core/src/application/plan-review-round.ts`
- Create: `packages/core/src/application/reconcile-round.ts`
- Test: `packages/core/tests/convergence.test.ts`

**Rules:**
- Rounds 1–2 review the merge-base diff.
- Round 3+ reviews only the previous reviewed SHA to current HEAD.
- Never re-emit a known fingerprint unless it reopens after being fixed.
- Stop at configured `maxRounds` and return `escalated`.
- Detect no-progress rounds and escalate early.

### Task 1.7: Implement versioned file state store

**Files:**
- Create: `packages/state/src/file-review-state-store.ts`
- Create: `packages/state/src/schema.ts`
- Test: `packages/state/tests/file-review-state-store.test.ts`

**Behavior:**
- Store state under `.workflow-hub/state/`.
- Atomic write via temporary file and rename.
- Optimistic concurrency using state version.
- Corrupt or incompatible state fails closed with recovery guidance.
- Runtime state remains ignored by Git.

### Task 1.8: Adapt Claude and Codex to role requests

**Files:**
- Create: `packages/providers/src/claude/claude-provider.ts`
- Create: `packages/providers/src/codex/codex-provider.ts`
- Create: `packages/providers/src/prompts.ts`
- Test: `packages/providers/tests/provider-contract.test.ts`

**Behavior:**
- Reviewer/verifier roles are read-only and ephemeral.
- Fix-agent role is a separate explicit capability; never enabled for hosted PR review.
- Provider metadata, role, diff range, and output schema must match request.
- Cross-provider assignments are configuration, not hard-coded.

### Task 1.9: Build local review orchestrator

**Files:**
- Create: `packages/core/src/application/run-local-review.ts`
- Test: `packages/core/tests/run-local-review.test.ts`

**Flow:**
1. Load trusted policy.
2. Verify project.
3. Classify initial risk.
4. Run scouts and verifiers.
5. Persist round.
6. Return pass, actionable findings, blocked, or escalated.
7. On explicit `--fix`, invoke fix agent in a clean worktree, re-run verification, and continue.

### Task 1.10: Expose local CLI commands

**Files:**
- Modify: `packages/cli/src/cli.ts`
- Create: `packages/cli/src/commands/review-loop.ts`
- Create: `packages/cli/src/commands/develop.ts`
- Test: `packages/cli/tests/review-loop.test.ts`

**Commands:**
```bash
workflow-hub review-loop --base origin/main --depth standard
workflow-hub develop --task task.md --author claude --reviewer codex --max-rounds 3
workflow-hub review-loop --resume <session-id>
```

**Phase 1 acceptance:**
- A fake-provider integration test demonstrates verify → scouts → verifier quorum → fix → diff-only re-review → pass.
- A real disposable demo branch is reviewed by Codex/Claude with persisted state and no repeated findings.
- Maximum rounds and escalation are proven.

---

# Phase 2: GitHub PR review and finding lifecycle

**Outcome:** Every configured PR receives correctness and security review; verified findings become synchronized inline threads and required checks.

### Task 2.1: Model PR intent and GitHub publication contracts

**Files:**
- Create: `packages/github/src/github-pull-request-port.ts`
- Create: `packages/github/src/contracts.ts`
- Test: `packages/github/tests/contracts.test.ts`

**Intent fields:** title, body, linked issues, testing evidence, risk declaration, revert plan, base/head SHA.

### Task 2.2: Implement GitHub API adapter

**Files:**
- Create: `packages/github/src/github-client.ts`
- Create: `packages/github/src/pull-request-reader.ts`
- Test: `packages/github/tests/github-client.test.ts`

**Rules:** explicit repository/PR scope, pagination, retry only idempotent reads, no token logging.

### Task 2.3: Implement inline comment reconciliation

**Files:**
- Create: `packages/github/src/finding-comment.ts`
- Create: `packages/github/src/reconcile-comments.ts`
- Test: `packages/github/tests/reconcile-comments.test.ts`

**Marker:** `<!-- workflow-hub:finding:<fingerprint> -->`.

**Behavior:** create, update, avoid duplicates, mark fixed, reopen, preserve human dismissal, and reject stale head SHA writes.

### Task 2.4: Implement finding disposition commands

**Files:**
- Create: `packages/cli/src/commands/dismiss-finding.ts`
- Create: `packages/github/src/disposition-store.ts`
- Test: disposition transition tests.

**Required reason:** false positive or intentional behavior. Dismissal is immutable audit metadata attached to the finding.

### Task 2.5: Publish correctness and security check runs

**Files:**
- Create: `packages/github/src/check-runs.ts`
- Test: `packages/github/tests/check-runs.test.ts`

**Checks:**
- `workflow-hub / correctness`
- `workflow-hub / security`

Each check reports reviewed SHA, rounds, agent roles, open findings, blocked reasons, and artifact link. A stale SHA cannot produce success.

### Task 2.6: Build PR review controller

**Files:**
- Create: `packages/core/src/application/run-pr-review.ts`
- Create: `packages/cli/src/commands/pr-review.ts`
- Test: `tests/integration/pr-review-controller.test.ts`

**Command:**
```bash
workflow-hub pr-review --repo owner/repo --pr 42
```

Correctness and security pipelines run independently and both fail closed.

### Task 2.7: Ship trusted GitHub Action

**Files:**
- Create: `action/action.yml`
- Create: `action/dist/index.js`
- Create: `templates/github/workflow-hub-review.yml`
- Modify initializer templates.
- Test: generated-repository integration test.

**Security:** controller code is loaded from a pinned release; PR code is treated only as review input; provider secrets exist only in review steps; fork PR policy is explicit.

### Task 2.8: End-to-end PR lifecycle in demo

**Acceptance scenario:**
1. Open PR with seeded correctness and security defect.
2. GitHub review posts verified inline findings.
3. Required checks fail.
4. Push fixing commit.
5. Diff-only re-review marks comments fixed.
6. Both checks pass.
7. No duplicate comments are created.

**Phase 2 acceptance:** Real `workflow-hub-demo` PR demonstrates the entire scenario with API read-back evidence.

---

# Phase 3: Risk-scaled merge policy

**Outcome:** A single required merge-policy check combines deterministic checks, review state, risk, ownership, and human approvals.

### Task 3.1: Expand deterministic risk signals

**Files:**
- Modify: `packages/core/src/domain/risk.ts`
- Test: `packages/core/tests/risk.test.ts`

**Signals:** high-risk paths, file count, line count, workflow/auth/migration changes, public API changes, dependency changes, model escalation, rollback absence.

### Task 3.2: Define Quick/Standard/Deep policy

**Files:**
- Create: `packages/core/src/domain/review-depth.ts`
- Modify config schema and generated config.
- Test mapping from risk to role counts, verifier quorum, and required human approval.

### Task 3.3: Load CODEOWNERS and approval state

**Files:**
- Create: `packages/github/src/approvals.ts`
- Create: `packages/github/src/codeowners.ts`
- Test parsing and approval edge cases.

### Task 3.4: Operationalize merge policy

**Files:**
- Create: `packages/core/src/application/evaluate-pr-merge.ts`
- Create: `packages/github/src/merge-policy-check.ts`
- Test: `tests/integration/merge-policy.test.ts`

**Required check:** `workflow-hub / merge-policy`.

**Rules:**
- All tiers require deterministic, correctness, security, and zero unresolved actionable findings.
- Medium requires owner attestation.
- High requires independent human approval and code-owner approval.
- Stale approval is dismissed after relevant changes.

### Task 3.5: Generate repository ruleset guidance and doctor checks

`doctor --github` verifies required checks and branch rules through GitHub read APIs; it never mutates rules without an explicit setup command.

**Phase 3 acceptance:** Docs-only, normal feature, and auth/CI PR fixtures produce different review depth and approval gates; real demo high-risk PR is blocked until approval.

---

# Phase 4: Evaluation and learning loop

**Outcome:** Reviewer changes are measured against incident/revert fixtures and finding noise.

### Task 4.1: Define eval case format

**Files:**
- Create: `packages/evals/src/schema.ts`
- Create: `evals/cases/example-*`
- Test schema validation.

Each case includes base, buggy patch, expected defect class/location, optional fix, provenance, and risk.

### Task 4.2: Build isolated eval runner

**Files:**
- Create: `packages/evals/src/run-eval.ts`
- Create: `packages/cli/src/commands/eval.ts`
- Test deterministic fixtures and provider fakes.

**Command:** `workflow-hub eval --suite incidents --provider codex`.

### Task 4.3: Score findings

Metrics: recall, precision proxy, unsupported finding rate, duplicate rate, harmful suggestion count, rounds-to-pass, duration, and estimated token/cost metadata when available.

### Task 4.4: Capture finding disposition metrics

Export anonymized local/GitHub disposition summaries. Never upload repository code or secrets.

### Task 4.5: Add nightly regression workflow

Run deterministic fixture tests nightly. Live provider evals require explicit repository configuration and budget caps.

**Phase 4 acceptance:** A deliberately weakened reviewer prompt causes an eval regression and a non-zero command/check result.

---

# Phase 5: Operational safety, release, and adoption

**Outcome:** The harness supports safe merge, rollback guidance, observable ownership, and stable distribution.

### Task 5.1: Add revert and rollout contract

Modify PR template/config to require testing, risk, owner, rollout, and one-step revert instructions. High-risk changes cannot pass merge policy without them.

### Task 5.2: Add post-merge hooks

Define provider-neutral hooks for deployment marker, health signal, incident/revert event, and feature-flag reference. Do not implement a hosted monitoring service.

### Task 5.3: Add incident-to-eval command

`workflow-hub eval import-incident` creates a redacted local eval skeleton from a merge/revert pair and requires human confirmation of expected finding.

### Task 5.4: Validate merge queue compatibility

Ensure workflows listen to `merge_group`, use exact queue SHAs, and never reuse stale PR success.

### Task 5.5: Harden packaging and releases

- Remove broken Git-source installation path.
- Publish installable GitHub release tarball with checksum.
- Verify package installation in a clean Node 22 environment.
- Generate/update migration notes from `v0.1.x`.

### Task 5.6: Rewrite documentation

**Files:**
- Modify: `README.md`
- Create: `docs/local-development-loop.md`
- Create: `docs/github-review-lifecycle.md`
- Create: `docs/security-model.md`
- Create: `docs/evals.md`
- Create: `docs/adoption.md`

Documentation must distinguish implemented behavior from roadmap.

### Task 5.7: Full end-to-end release proof

1. Install released artifact into a clean repository.
2. Initialize workflow.
3. Implement a feature through local author/reviewer loop.
4. Open real PR.
5. Produce and resolve a real finding.
6. Exercise low- and high-risk merge policies.
7. Merge through required checks.
8. Run HTTP/application smoke test.
9. Create release and verify assets/checks through GitHub API.

**Phase 5 acceptance:** Release `v0.2.0` has reproducible install, complete docs, green eval baseline, and a linked demo PR proving the lifecycle.

---

# Global testing strategy

## Unit tests
- Domain transitions and invariants.
- Risk/depth/consensus/merge policies.
- Finding identity and reconciliation.
- Round planning and convergence.

## Contract tests
- Claude and Codex role adapters.
- GitHub port and state-store implementations.
- Generated templates and action inputs.

## Integration tests
- Fake agents + real Git repository.
- Fake GitHub API + real controller.
- Resume after process interruption.
- Concurrent state update conflict.

## End-to-end tests
- Disposable local repository.
- Real provider review in a disposable clone.
- Real `workflow-hub-demo` PR and GitHub check/comment lifecycle.

## Required commands per phase

```bash
npm ci
npm run typecheck
npm test
npm run build
npm pack --dry-run
git diff --check
```

For phase PRs:

```bash
gh pr checks <number> --watch
gh pr view <number> --json state,mergeStateStatus,statusCheckRollup
```

---

# Risks and mitigations

- **Agent loops:** hard round cap, no-progress detection, explicit escalation.
- **False positives:** verifier quorum, deterministic evidence validation, disposition metrics.
- **Prompt injection:** trusted base policy, read-only review, repository content treated as data.
- **Secret exposure:** never execute PR code with provider secrets; trusted controller release only.
- **Duplicate comments:** stable markers and reconciliation tests.
- **Stale review success:** bind every check and report to exact head SHA.
- **Corrupt state:** versioned schema, atomic writes, optimistic concurrency, fail closed.
- **Provider lock-in:** all orchestration depends on ports and role contracts.
- **Cost explosion:** depth policy, bounded concurrency, timeouts, round cap, budget metadata.
- **Premature service split:** remain a modular monolith until a hosted multi-tenant control plane has an independent lifecycle.

# Definition of done

The project solves the original problem only when all of the following are true:

- Local work is verified and independently reviewed before PR creation.
- Every configured PR receives correctness and security review.
- Multiple agents discover and independently verify findings.
- Findings have persistent lifecycle and appear as non-duplicated inline threads.
- Open actionable findings block merge and clear after verified fixes.
- Review depth and human approval scale with risk.
- Review converges through round caps, diff-only re-review, and no-repeat policy.
- Incidents/reverts can become eval cases and reviewer regressions are measurable.
- A released artifact and real consumer PR prove the complete path.
