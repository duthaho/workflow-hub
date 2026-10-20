import { spawn } from "node:child_process";

import {
  listChangedFiles as listChangedFilesCore,
  runVerification as runVerificationCore,
  type CommandResult,
  type CommandRunner,
  type RunCommandOptions,
} from "../../core/src/verification.js";
import type { WorkflowConfig } from "../../core/src/contracts.js";

export type { CommandResult, CommandRunner, RunCommandOptions };

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

export function runVerification(
  configInput: WorkflowConfig | unknown,
  options: { cwd: string; runner?: CommandRunner },
): Promise<CommandResult> {
  return runVerificationCore(configInput, {
    cwd: options.cwd,
    runner: options.runner ?? defaultCommandRunner,
  });
}

export function listChangedFiles(
  baseRef: string,
  options: { cwd: string; runner?: CommandRunner },
): Promise<string[]> {
  return listChangedFilesCore(baseRef, {
    cwd: options.cwd,
    runner: options.runner ?? defaultCommandRunner,
  });
}
