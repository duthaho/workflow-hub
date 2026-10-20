#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { ProviderNameSchema, ProjectProfileSchema } from "./contracts.js";
import { loadWorkflowConfig } from "./config.js";
import { initializeProject } from "./initialize.js";
import { runReview, type ReviewKind } from "./review.js";
import {
  runVerification,
  type CommandRunner,
} from "./verification.js";

export interface CliContext {
  cwd: string;
  stdout: (message: string) => void;
  stderr: (message: string) => void;
  runner?: CommandRunner;
}

const usage = `workflow-hub <command>

Commands:
  workflow-hub init --project <name> [--profile generic|node|python]
                    [--author claude|codex] [--reviewers claude,codex]
                    [--verify <command>] [--dry-run] [--force]
  workflow-hub verify
  workflow-hub doctor
  workflow-hub review --kind correctness|security [--provider claude|codex]
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
  const config = await loadWorkflowConfig(context.cwd);
  const provider = ProviderNameSchema.parse(
    optionValue(args, "--provider") ?? config.providers.reviewers[0],
  );
  const baseRef = optionValue(args, "--base") ?? "origin/main";
  const report = await runReview({
    cwd: context.cwd,
    config,
    provider,
    kind,
    baseRef,
    ...(context.runner ? { runner: context.runner } : {}),
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
