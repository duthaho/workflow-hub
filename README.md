# workflow-hub

Provider-neutral workflow framework for building and reviewing software with Claude Code and Codex.

## Status

Initial implementation is in progress. The first release will provide:

- deterministic verification before AI review;
- fresh-context correctness and security reviewers;
- Claude Code and Codex provider adapters;
- risk-based merge policy;
- reusable GitHub repository templates;
- structured, deduplicated review findings.

## Development

Requires Node.js 22 or newer.

```bash
npm ci
npm run check
```

## License

MIT
