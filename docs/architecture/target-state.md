# Target architecture: AI development and review harness

## Product boundary

`workflow-hub` is a provider-neutral AI development and code-review harness. It owns local review orchestration, provider role execution, review state, GitHub finding lifecycle, risk-scaled merge policy, and evaluator workflows. Consumer repositories keep their own build, test, deployment, and application code.

The separate `workflow-hub-demo` repository is an acceptance consumer, not part of the framework implementation.

## Modular monolith

```text
CLI / GitHub Action
        |
        v
Application orchestration
├── local development loop
├── PR review controller
├── finding verification
├── convergence controller
└── merge-policy evaluator
        |
        v
Pure domain
├── review session and rounds
├── findings and dispositions
├── consensus policy
├── risk and review depth
└── merge decision
        |
        v
Ports
├── agent provider
├── repository
├── verification
├── review state
└── pull request
        |
        v
Adapters
├── Claude Code
├── OpenAI Codex
├── Git and command execution
├── versioned file state
└── GitHub REST API / check runs / comments
```

## Dependency rules

1. Domain code imports no filesystem, process, HTTP, GitHub, provider SDK, or CLI module.
2. Application code depends on domain and ports, never concrete adapters.
3. Provider, state, GitHub, and command execution packages implement ports.
4. CLI and GitHub Action are composition roots.
5. Review policies and project configuration are loaded from the trusted base revision.
6. Pull-request content and repository files are treated as untrusted data.

## Package boundaries

- `packages/core`: domain, application services, and ports.
- `packages/providers`: Claude and Codex role adapters.
- `packages/github`: PR intent, comments, checks, approvals, and ruleset adapters.
- `packages/state`: versioned review-state implementations.
- `packages/cli`: command handlers and dependency composition.
- `packages/evals`: eval case schema, runner, and scoring.

The root package remains the installable `@duthaho/workflow-hub` distribution during the migration. Internal workspace packages remain private until an independent public package boundary is justified.

## Review lifecycle

```text
verify
-> classify risk and select depth
-> run parallel scouts
-> deterministic evidence/location validation
-> independent finding verification and quorum
-> deduplicate/reconcile findings
-> persist exact reviewed SHA and round
-> publish local or GitHub result
-> fix and re-verify when explicitly enabled
-> diff-only re-review
-> pass or escalate at the round cap
```

## Security boundaries

- Reviewer and verifier roles are read-only and ephemeral.
- Hosted PR review never executes pull-request code with provider credentials.
- Fix roles require explicit local authorization and a clean/disposable worktree.
- Candidate findings are not published before validation and consensus.
- Check success is bound to the exact reviewed head SHA.
- State writes use schema versions and optimistic concurrency.

## Release target

`v0.2.0` is complete only after a released artifact drives a real consumer PR through deterministic checks, multi-agent correctness/security review, inline finding reconciliation, verified fixes, risk-scaled approval, and merge-policy success.
