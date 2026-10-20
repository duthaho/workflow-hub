import {
  WorkflowConfigSchema,
  type WorkflowConfig,
} from "./contracts.js";

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

export async function runVerification(
  configInput: WorkflowConfig | unknown,
  options: { cwd: string; runner: CommandRunner },
): Promise<CommandResult> {
  const config = WorkflowConfigSchema.parse(configInput);
  const result = await options.runner(config.commands.verify, [], {
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
  options: { cwd: string; runner: CommandRunner },
): Promise<string[]> {
  const runOptions: RunCommandOptions = {
    cwd: options.cwd,
    shell: false,
    inheritStdio: false,
  };
  const mergeBase = await options.runner(
    "git",
    ["merge-base", baseRef, "HEAD"],
    runOptions,
  );
  if (mergeBase.exitCode !== 0 || !mergeBase.stdout.trim()) {
    throw new Error(
      `Unable to calculate merge base for ${baseRef}: ${mergeBase.stderr.trim()}`,
    );
  }

  const diff = await options.runner(
    "git",
    ["diff", "--name-only", "-z", mergeBase.stdout.trim(), "HEAD"],
    runOptions,
  );
  if (diff.exitCode !== 0) {
    throw new Error(`Unable to list changed files: ${diff.stderr.trim()}`);
  }

  return diff.stdout.split("\0").filter((path) => path.length > 0);
}
