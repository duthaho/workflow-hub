#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  ProviderNameSchema,
  ProjectProfileSchema,
} from "../../core/src/contracts.js";
import {
  loadWorkflowConfig,
  loadWorkflowConfigFromRef,
} from "./config.js";
import { initializeProject } from "./initialize.js";
import { runReview, type ReviewKind } from "./review.js";
import {
  defaultCommandRunner,
  runVerification,
  type CommandRunner,
} from "./verification.js";
import { runDevelopCommand } from "./commands/develop.js";
import { publishGitHubCheck } from "./commands/github-check.js";
import { publishGitHubMergePolicy } from "./commands/github-merge-policy.js";
import { runEvaluatorFile } from "./commands/eval.js";
import {
  runReviewLoopCommand,
  type ReviewLoopCommand,
} from "./commands/review-loop.js";

export interface CliContext {
  cwd: string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  runner?: CommandRunner;
  reviewLoopCommand?: ReviewLoopCommand;
}

const usage = `workflow-hub <command>

Commands:
  workflow-hub init --project <name> [--profile generic|node|python]
                    [--author claude|codex] [--reviewers claude,codex]
                    [--verify <command>] [--dry-run] [--force]
  workflow-hub verify
  workflow-hub doctor
  workflow-hub review --kind correctness|security [--provider claude|codex]
  workflow-hub review-loop [--base origin/main] [--depth quick|standard|deep]
                           [--session <id> | --resume <id>] [--fix]
  workflow-hub develop --task <path> [--author claude|codex]
                       [--reviewer claude|codex] [--max-rounds 3]
  workflow-hub github-check --repo <owner/repo> --head <sha>
                            --conclusion success|failure|neutral --summary <text>
  workflow-hub github-merge-policy --repo <owner/repo> --pr <number>
                            [--required-check <name,...>] [--security-check <name,...>]
  workflow-hub eval --input <corpus-and-results.json>
`;

function optionValue(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${name} requires a value`);
  }
  return value;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function defaultVerifyCommand(profile: string): string {
  if (profile === "node") return "npm test";
  if (profile === "python") return "python -m pytest";
  return "make check";
}

async function handleInit(args: string[], context: CliContext): Promise<number> {
  const projectName = optionValue(args, "--project");
  if (!projectName) throw new Error("init requires --project <name>");

  const profile = ProjectProfileSchema.parse(
    optionValue(args, "--profile") ?? "generic",
  );
  const author = ProviderNameSchema.parse(
    optionValue(args, "--author") ?? "claude",
  );
  const reviewers = (optionValue(args, "--reviewers") ?? "codex")
    .split(",")
    .map((provider) => ProviderNameSchema.parse(provider.trim()));
  const verifyCommand =
    optionValue(args, "--verify") ?? defaultVerifyCommand(profile);

  const result = await initializeProject({
    cwd: context.cwd,
    projectName,
    profile,
    author,
    reviewers,
    verifyCommand,
    force: hasFlag(args, "--force"),
    dryRun: hasFlag(args, "--dry-run"),
  });

  if (hasFlag(args, "--dry-run")) {
    context.stdout(`Planned ${result.planned.length} managed files.`);
  } else {
    context.stdout(`Initialized ${result.created.length} managed files.`);
  }
  return 0;
}

async function handleDoctor(context: CliContext): Promise<number> {
  const config = await loadWorkflowConfig(context.cwd);
  const providers = new Set([
    config.providers.author,
    ...config.providers.reviewers,
  ]);
  context.stdout(
    `Configuration valid. Required providers: ${[...providers].join(", ")}.`,
  );
  return 0;
}

async function handleReview(
  args: string[],
  context: CliContext,
): Promise<number> {
  const kindValue = optionValue(args, "--kind");
  if (kindValue !== "correctness" && kindValue !== "security") {
    throw new Error("review requires --kind correctness|security");
  }
  const kind: ReviewKind = kindValue;
  const baseRef = optionValue(args, "--base") ?? "origin/main";
  const runner = context.runner ?? defaultCommandRunner;
  const config = await loadWorkflowConfigFromRef(context.cwd, baseRef, runner);
  const provider = ProviderNameSchema.parse(
    optionValue(args, "--provider") ?? config.providers.reviewers[0],
  );
  const report = await runReview({
    cwd: context.cwd,
    config,
    provider,
    kind,
    baseRef,
    runner,
  });
  const actionable = report.findings.filter(
    (finding) =>
      finding.confidence >= config.review.minimumConfidence &&
      finding.severity !== "low",
  );
  context.stdout(
    `${provider} ${kind} review: ${report.findings.length} finding(s), ${actionable.length} actionable.`,
  );
  return actionable.length === 0 ? 0 : 2;
}

function parseDepth(value: string | undefined): "quick" | "standard" | "deep" {
  const depth = value ?? "standard";
  if (depth !== "quick" && depth !== "standard" && depth !== "deep") {
    throw new Error("--depth must be quick, standard, or deep");
  }
  return depth;
}

function loopExitCode(outcome: "passed" | "actionable" | "blocked" | "escalated"): number {
  if (outcome === "passed") return 0;
  if (outcome === "blocked") return 1;
  return 2;
}

async function handleReviewLoop(
  args: string[],
  context: CliContext,
  develop: boolean,
): Promise<number> {
  const baseRef = optionValue(args, "--base") ?? "origin/main";
  const runner = context.runner ?? defaultCommandRunner;
  let config = await loadWorkflowConfigFromRef(context.cwd, baseRef, runner);
  if (develop) {
    const author = ProviderNameSchema.parse(optionValue(args, "--author") ?? config.providers.author);
    const reviewer = ProviderNameSchema.parse(optionValue(args, "--reviewer") ?? config.providers.reviewers[0]);
    const roundsValue = optionValue(args, "--max-rounds");
    const maxRounds = roundsValue === undefined ? config.review.maxRounds : Number(roundsValue);
    if (!Number.isInteger(maxRounds) || maxRounds < 1 || maxRounds > 10) {
      throw new Error("--max-rounds must be an integer between 1 and 10");
    }
    config = {
      ...config,
      providers: { author, reviewers: [reviewer] },
      review: { ...config.review, maxRounds },
    };
  }
  const command = context.reviewLoopCommand ?? runReviewLoopCommand;
  const sessionId = optionValue(args, "--session");
  const resume = optionValue(args, "--resume");
  if (sessionId !== undefined && resume !== undefined) {
    throw new Error("Use either --session or --resume, not both");
  }
  const common = {
    cwd: context.cwd,
    config,
    baseRef,
    depth: parseDepth(optionValue(args, "--depth")),
    runner,
    ...(sessionId === undefined ? {} : { sessionId }),
    ...(resume === undefined ? {} : { resume }),
  } as const;
  const result = develop
    ? await runDevelopCommand(
        {
          ...common,
          taskPath: optionValue(args, "--task") ?? (() => { throw new Error("develop requires --task <path>"); })(),
        },
        command,
      )
    : await command({ ...common, fix: hasFlag(args, "--fix") });
  context.stdout(JSON.stringify({
    outcome: result.outcome,
    sessionId: result.session.id,
    state: result.session.state,
    rounds: result.session.rounds.length,
    risk: result.risk.tier,
  }));
  return loopExitCode(result.outcome);
}

async function handleEval(args: string[], context: CliContext): Promise<number> {
  const input = optionValue(args, "--input");
  if (!input) throw new Error("eval requires --input <corpus-and-results.json>");
  context.stdout(JSON.stringify(await runEvaluatorFile(input)));
  return 0;
}

async function handleGitHubMergePolicy(args: string[], context: CliContext): Promise<number> {
  const repo = optionValue(args, "--repo");
  const pullNumber = Number(optionValue(args, "--pr"));
  if (!repo || !Number.isInteger(pullNumber) || pullNumber < 1) throw new Error("github-merge-policy requires --repo and a positive --pr");
  const [owner, name, ...extra] = repo.split("/");
  if (!owner || !name || extra.length > 0) throw new Error("--repo must be owner/repo");
  const csv = (value: string | undefined, defaults: string[]): string[] => (value ?? defaults.join(",")).split(",").map((entry) => entry.trim()).filter(Boolean);
  const result = await publishGitHubMergePolicy({
    owner,
    repo: name,
    pullNumber,
    token: process.env.GITHUB_TOKEN,
    highRiskPaths: [".github/**", "**/auth/**", "**/migrations/**"],
    requiredDeterministicChecks: csv(optionValue(args, "--required-check"), ["test-node-22", "test-node-24"]),
    requiredSecurityChecks: csv(optionValue(args, "--security-check"), ["CodeQL"]),
  });
  context.stdout(JSON.stringify(result));
  return result.allowed ? 0 : 2;
}

async function handleGitHubCheck(args: string[], context: CliContext): Promise<number> {
  const repo = optionValue(args, "--repo");
  const headSha = optionValue(args, "--head");
  const summary = optionValue(args, "--summary");
  const conclusion = optionValue(args, "--conclusion");
  if (!repo || !headSha || !summary || !conclusion) throw new Error("github-check requires --repo, --head, --conclusion, and --summary");
  const [owner, name, ...extra] = repo.split("/");
  if (!owner || !name || extra.length > 0) throw new Error("--repo must be owner/repo");
  if (conclusion !== "success" && conclusion !== "failure" && conclusion !== "neutral") throw new Error("--conclusion must be success, failure, or neutral");
  const id = await publishGitHubCheck({ owner, repo: name, token: process.env.GITHUB_TOKEN, headSha, conclusion, summary });
  context.stdout(JSON.stringify({ checkRunId: id, conclusion }));
  return conclusion === "failure" ? 2 : 0;
}

export async function runCli(
  args: string[],
  context: CliContext = {
    cwd: process.cwd(),
    stdout: console.log,
    stderr: console.error,
  },
): Promise<number> {
  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    context.stdout(usage);
    return 0;
  }

  try {
    switch (args[0]) {
      case "init":
        return await handleInit(args.slice(1), context);
      case "verify": {
        const config = await loadWorkflowConfig(context.cwd);
        await runVerification(config, {
          cwd: context.cwd,
          ...(context.runner ? { runner: context.runner } : {}),
        });
        context.stdout("Verification passed.");
        return 0;
      }
      case "doctor":
        return await handleDoctor(context);
      case "review":
        return await handleReview(args.slice(1), context);
      case "review-loop":
        return await handleReviewLoop(args.slice(1), context, false);
      case "develop":
        return await handleReviewLoop(args.slice(1), context, true);
      case "github-check":
        return await handleGitHubCheck(args.slice(1), context);
      case "github-merge-policy":
        return await handleGitHubMergePolicy(args.slice(1), context);
      case "eval":
        return await handleEval(args.slice(1), context);
      default:
        throw new Error(`Unknown command: ${args[0]}`);
    }
  } catch (error) {
    context.stderr(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

export function isDirectExecution(
  moduleUrl: string,
  argvPath: string | undefined,
): boolean {
  if (argvPath === undefined) {
    return false;
  }
  try {
    return realpathSync(fileURLToPath(moduleUrl)) === realpathSync(argvPath);
  } catch {
    return false;
  }
}

if (isDirectExecution(import.meta.url, process.argv[1])) {
  process.exitCode = await runCli(process.argv.slice(2));
}
