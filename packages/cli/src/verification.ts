import { spawn } from "node:child_process";

import {
  WorkflowConfigSchema,
  type WorkflowConfig,
} from "../../core/src/contracts.js";

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface RunCommandOptions {
  cwd: string;
  shell: boolean;
  inheritStdio: boolean;
}

export type CommandRunner = (
  command: string,
  args: string[],
  options: RunCommandOptions,
) => Promise<CommandResult>;

export const defaultCommandRunner: CommandRunner = (
  command,
  args,
  options,
) =>
  new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      shell: options.shell,
      stdio: options.inheritStdio ? "inherit" : ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr?.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ exitCode: code ?? 1, stdout, stderr });
    });
  });

export async function runVerification(
  configInput: WorkflowConfig | unknown,
  options: { cwd: string; runner?: CommandRunner },
): Promise<CommandResult> {
  const config = WorkflowConfigSchema.parse(configInput);
  const runner = options.runner ?? defaultCommandRunner;
  const result = await runner(config.commands.verify, [], {
    cwd: options.cwd,
    shell: true,
    inheritStdio: true,
  });

  if (result.exitCode !== 0) {
    throw new Error(
      `Verification failed with exit code ${result.exitCode}${result.stderr ? `: ${result.stderr}` : ""}`,
    );
  }

  return result;
}

export async function listChangedFiles(
  baseRef: string,
  options: { cwd: string; runner?: CommandRunner },
): Promise<string[]> {
  const runner = options.runner ?? defaultCommandRunner;
  const runOptions: RunCommandOptions = {
    cwd: options.cwd,
    shell: false,
    inheritStdio: false,
  };
  const mergeBase = await runner(
    "git",
    ["merge-base", baseRef, "HEAD"],
    runOptions,
  );
  if (mergeBase.exitCode !== 0 || !mergeBase.stdout.trim()) {
    throw new Error(
      `Unable to calculate merge base for ${baseRef}: ${mergeBase.stderr.trim()}`,
    );
  }

  const diff = await runner(
    "git",
    ["diff", "--name-only", "-z", mergeBase.stdout.trim(), "HEAD"],
    runOptions,
  );
  if (diff.exitCode !== 0) {
    throw new Error(`Unable to list changed files: ${diff.stderr.trim()}`);
  }

  return diff.stdout.split("\0").filter((path) => path.length > 0);
}
