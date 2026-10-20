import { spawn } from "node:child_process";

export interface ProviderProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProviderProcessExecutor {
  run(command: string, args: string[], options: { cwd: string; stdin?: string }): Promise<ProviderProcessResult>;
}

export const defaultProviderProcessExecutor: ProviderProcessExecutor = {
  run(command, args, options) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: options.cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] });
      child.stdin.on("error", () => undefined);
      child.stdin.end(options.stdin ?? "");
      let stdout = "";
      let stderr = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.on("data", (chunk: string) => { stderr += chunk; });
      child.on("error", reject);
      child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
    });
  },
};
