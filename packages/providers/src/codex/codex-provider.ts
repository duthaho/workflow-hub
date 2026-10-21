import type { AgentRoleRequest } from "../../../core/src/ports/agent-provider.js";
import { RoleProvider } from "../role-provider.js";

export function defaultCodexBinary(platform = process.platform): string {
  return platform === "win32" ? "codex.cmd" : "codex";
}

export class CodexProvider extends RoleProvider {
  readonly name = "codex" as const;

  protected invocation(input: {
    request: AgentRoleRequest;
    prompt: string;
    schemaPath: string;
    outputPath: string;
  }) {
    return {
      command: this.binary ?? defaultCodexBinary(),
      args: [
        ...(input.request.role === "fix-agent" ? ["--ask-for-approval", "on-request"] : []),
        "exec",
        "--sandbox", input.request.role === "fix-agent" ? "workspace-write" : "read-only",
        "--ephemeral",
        "--ignore-user-config",
        "--output-schema", input.schemaPath,
        "--output-last-message", input.outputPath,
        "-",
      ],
      stdin: input.prompt,
      outputSource: "file" as const,
    };
  }
}
