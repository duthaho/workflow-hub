import type { WorkflowConfig } from "../../../core/src/contracts.js";
import { runLocalReview, type LocalReviewResult, type RunLocalReviewOptions } from "../../../core/src/application/run-local-review.js";
import type { AgentProvider } from "../../../core/src/ports/agent-provider.js";
import type { RepositoryPort } from "../../../core/src/ports/repository.js";
import type { VerificationPort } from "../../../core/src/ports/verification.js";
import { ClaudeProvider } from "../../../providers/src/claude/claude-provider.js";
import { CodexProvider } from "../../../providers/src/codex/codex-provider.js";
import { FileReviewStateStore } from "../../../state/src/file-review-state-store.js";
import { runVerification, type CommandRunner } from "../verification.js";

export interface ReviewLoopCommandInput {
  cwd: string;
  config: WorkflowConfig;
  baseRef: string;
  depth: "quick" | "standard" | "deep";
  fix: boolean;
  sessionId?: string;
  resume?: string;
  task?: string;
  runner?: CommandRunner;
}

export type ReviewLoopCommand = (input: ReviewLoopCommandInput) => Promise<LocalReviewResult>;

class GitRepository implements RepositoryPort {
  constructor(private readonly cwd: string, private readonly runner: CommandRunner) {}

  private async git(args: string[]): Promise<string> {
    const result = await this.runner("git", args, { cwd: this.cwd, shell: false, inheritStdio: false });
    if (result.exitCode !== 0) throw new Error(`git ${args[0] ?? "command"} failed: ${result.stderr.trim()}`);
    return result.stdout;
  }

  async resolveRef(ref: string) { return (await this.git(["rev-parse", ref])).trim(); }
  async mergeBase(baseRef: string, headRef: string) { return (await this.git(["merge-base", baseRef, headRef])).trim(); }
  async changedFiles(baseSha: string, headSha: string) {
    return (await this.git(["diff", "--name-only", "-z", baseSha, headSha])).split("\0").filter(Boolean);
  }
  async diff(baseSha: string, headSha: string) {
    return this.git(["diff", "--no-ext-diff", "--unified=80", baseSha, headSha]);
  }
  async fileLineCount(path: string, ref: string) {
    const result = await this.runner("git", ["show", `${ref}:${path}`], { cwd: this.cwd, shell: false, inheritStdio: false });
    if (result.exitCode !== 0) return undefined;
    if (result.stdout.length === 0) return 0;
    return result.stdout.split("\n").length - (result.stdout.endsWith("\n") ? 1 : 0);
  }
}

function provider(name: "claude" | "codex", cwd: string, allowFix = false): AgentProvider {
  return name === "claude"
    ? new ClaudeProvider({ cwd, allowFix })
    : new CodexProvider({ cwd, allowFix });
}

export const runReviewLoopCommand: ReviewLoopCommand = async (input) => {
  const runner = input.runner;
  if (!runner) throw new Error("Review loop requires a command runner");
  const repository = new GitRepository(input.cwd, runner);
  const headSha = await repository.resolveRef("HEAD");
  const sessionId = input.resume ?? input.sessionId ?? `local-${headSha.slice(0, 12)}`;
  const primaryReviewer = input.config.providers.reviewers[0];
  if (!primaryReviewer) throw new Error("At least one reviewer is required");
  const securityReviewer = input.config.providers.reviewers[1] ?? primaryReviewer;
  const reviewerProviders = new Map<string, AgentProvider>();
  for (const name of [input.config.providers.author, ...input.config.providers.reviewers]) {
    reviewerProviders.set(name, provider(name, input.cwd));
  }
  const getProvider = (name: "claude" | "codex") => reviewerProviders.get(name)!;
  const verification: VerificationPort = {
    async verify() {
      const started = Date.now();
      try {
        const result = await runVerification(input.config, { cwd: input.cwd, runner });
        return {
          status: "passed",
          durationMs: Date.now() - started,
          checks: [{ name: "project verification", command: input.config.commands.verify, status: "passed", durationMs: Date.now() - started, evidence: result.stdout }],
        } as const;
      } catch (error) {
        return {
          status: "failed",
          durationMs: Date.now() - started,
          checks: [{ name: "project verification", command: input.config.commands.verify, status: "failed", durationMs: Date.now() - started }],
          reason: error instanceof Error ? error.message : String(error),
        } as const;
      }
    },
  };
  const options: RunLocalReviewOptions = {
    sessionId,
    baseRef: input.baseRef,
    maxRounds: input.config.review.maxRounds,
    highRiskPaths: input.config.risk.highRiskPaths,
    depth: input.depth,
    fix: input.fix,
    repository,
    verification,
    stateStore: new FileReviewStateStore(input.cwd),
    scouts: [
      { role: "correctness-scout", provider: getProvider(primaryReviewer), required: true },
      { role: "security-scout", provider: getProvider(securityReviewer), required: true },
      { role: "test-gap-scout", provider: getProvider(primaryReviewer), required: false },
      { role: "architecture-scout", provider: getProvider(primaryReviewer), required: false },
    ],
    verifiers: [...reviewerProviders.values()],
    ...(input.fix ? { fixProvider: provider(input.config.providers.author, input.cwd, true) } : {}),
    concurrency: 2,
    timeoutMs: 10 * 60 * 1000,
    quorum: 1,
    minimumConfidence: input.config.review.minimumConfidence,
    ...(input.task === undefined ? {} : { task: input.task }),
  };
  return runLocalReview(options);
};
