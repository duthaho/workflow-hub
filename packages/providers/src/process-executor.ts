import { spawn } from "node:child_process";

export interface ProviderProcessResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface ProviderProcessExecutor {
  run(command: string, args: string[], options: { cwd: string; stdin?: string; timeoutMs?: number }): Promise<ProviderProcessResult>;
}

export const defaultProviderProcessExecutor: ProviderProcessExecutor = {
  run(command, args, options) {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: options.cwd, shell: false, stdio: ["pipe", "pipe", "pipe"] });
      child.stdin.on("error", () => undefined);
      child.stdin.end(options.stdin ?? "");
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      const timer = options.timeoutMs === undefined ? undefined : setTimeout(() => {
        timedOut = true;
        child.kill("SIGTERM");
        const forceKill = setTimeout(() => child.kill("SIGKILL"), 1_000);
        forceKill.unref();
      }, options.timeoutMs);
      timer?.unref();
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => { stdout += chunk; });
      child.stderr.on("data", (chunk: string) => { stderr += chunk; });
      child.on("error", (error) => {
        if (timer !== undefined) clearTimeout(timer);
        reject(error);
      });
      child.on("close", (code) => {
        if (timer !== undefined) clearTimeout(timer);
        resolve({
          exitCode: timedOut ? 124 : (code ?? 1),
          stdout,
          stderr: timedOut ? `${stderr}\nProvider process timed out`.trim() : stderr,
        });
      });
    });
  },
};
