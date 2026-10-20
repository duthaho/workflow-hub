import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

export function buildReviewInputFingerprint(input: Pick<
  ReviewLoopCommandInput,
  "config" | "depth" | "fix" | "task"
>): string {
  const taskDigest = createHash("sha256").update(input.task ?? "").digest("hex");
  const identity = {
    taskDigest,
    depth: input.depth,
    author: input.config.providers.author,
    reviewers: input.config.providers.reviewers,
    verifyCommand: input.config.commands.verify,
    highRiskPaths: [...input.config.risk.highRiskPaths].sort(),
    maxRounds: input.config.review.maxRounds,
    minimumConfidence: input.config.review.minimumConfidence,
    quorum: 1,
    concurrency: 2,
    timeoutMs: 10 * 60 * 1000,
  };
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

export class GitRepository implements RepositoryPort {
  constructor(private readonly cwd: string, private readonly runner: CommandRunner) {}

  private async git(args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
    const result = await this.runner("git", args, {
      cwd: this.cwd,
      shell: false,
      inheritStdio: false,
      ...(env === undefined ? {} : { env }),
    });
    if (result.exitCode !== 0) throw new Error(`git ${args[0] ?? "command"} failed: ${result.stderr.trim()}`);
    return result.stdout;
  }

  async resolveRef(ref: string) {
    if (ref !== "HEAD") return (await this.git(["rev-parse", ref])).trim();
    const head = (await this.git(["rev-parse", "HEAD"])).trim();
    const status = await this.git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
    if (status.length === 0) return head;

    const directory = await mkdtemp(join(tmpdir(), "workflow-hub-index-"));
    const env = {
      ...process.env,
      GIT_INDEX_FILE: join(directory, "index"),
      GIT_AUTHOR_NAME: "workflow-hub",
      GIT_AUTHOR_EMAIL: "workflow-hub@localhost",
      GIT_COMMITTER_NAME: "workflow-hub",
      GIT_COMMITTER_EMAIL: "workflow-hub@localhost",
      GIT_AUTHOR_DATE: "1970-01-01T00:00:00Z",
      GIT_COMMITTER_DATE: "1970-01-01T00:00:00Z",
    };
    try {
      await this.git(["read-tree", head], env);
      await this.git(["add", "-A"], env);
      const tree = (await this.git(["write-tree"], env)).trim();
      return (await this.git(
        ["commit-tree", tree, "-p", head, "-m", "workflow-hub worktree snapshot"],
        env,
      )).trim();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
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

export function resolveProviderBinary(
  name: "claude" | "codex",
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined {
  return environment[name === "claude" ? "WORKFLOW_HUB_CLAUDE_BIN" : "WORKFLOW_HUB_CODEX_BIN"];
}

function provider(name: "claude" | "codex", cwd: string, allowFix = false): AgentProvider {
  const binary = resolveProviderBinary(name);
  const options = {
    cwd,
    allowFix,
    ...(binary === undefined ? {} : { binary }),
  };
  return name === "claude"
    ? new ClaudeProvider(options)
    : new CodexProvider(options);
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
    inputFingerprint: buildReviewInputFingerprint(input),
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
