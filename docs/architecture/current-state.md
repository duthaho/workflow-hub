# Current architecture baseline

## Provenance

- Repository: `https://github.com/duthaho/workflow-hub`
- Default branch: `main`
- Baseline commit: `844319b368f0d167390f49c8b327515c5c2b307a`
- Latest published release at baseline: `v0.1.0`
- Runtime: Node.js 22 or newer
- Package: `@duthaho/workflow-hub`

## Verified baseline

The following commands passed before the harness refactor began:

```bash
npm ci
npm run check
npm pack --dry-run
```

The baseline suite contains 46 passing tests. The package exposes the `workflow-hub` executable and includes compiled CLI, configuration, contracts, initializer, policy, provider, review, and verification modules.

## Existing control flow

```text
workflow-hub CLI
├── init -> writes project policy/config/workflow files
├── doctor -> validates config and lists required providers
├── verify -> executes one configured deterministic command
└── review
    ├── loads trusted config and REVIEW.md from the base ref
    ├── invokes exactly one Claude or Codex adapter
    ├── validates one structured report
    ├── adds deterministic finding fingerprints
    └── persists one local JSON report
```

## Existing strengths

- Provider-neutral configuration and finding schemas.
- Read-only, fresh-session Claude and Codex review invocation.
- Trusted base-ref configuration and policy loading.
- Deterministic verification command runner.
- Pure risk classification and merge-policy functions.
- Stable finding fingerprints.
- Fail-closed provider output validation.
- Project initializer and pinned GitHub Actions dependencies.

## Known limitations

- No orchestration across multiple agents or roles.
- No finding verifier or consensus stage.
- No author/fix/re-review loop.
- `review.maxRounds` is configuration only and does not control execution.
- No persistent review session or round state.
- No diff-only convergence behavior.
- No GitHub inline-comment lifecycle.
- No correctness/security check-run publication.
- Risk and merge policy are not connected to GitHub merge gates.
- No reviewer eval corpus or feedback metrics.
- Generated consumer workflows run deterministic verification only.

This document describes the implementation at the baseline commit; it is not a claim about later releases.
