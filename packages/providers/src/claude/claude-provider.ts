import type { AgentRoleRequest } from "../../../core/src/ports/agent-provider.js";
import { RoleProvider } from "../role-provider.js";
import { agentRoleJsonSchema } from "../role-output.js";

export class ClaudeProvider extends RoleProvider {
  readonly name = "claude" as const;

  protected invocation(input: {
    request: AgentRoleRequest;
    prompt: string;
    schemaPath: string;
    outputPath: string;
  }) {
    const fix = input.request.role === "fix-agent";
    return {
      command: this.binary ?? "claude",
      args: [
        "--print",
        "--restricted",
        "--permission-mode", fix ? "acceptEdits" : "plan",
        "--permission-prompts", "none",
        "--tools", fix ? "Read,Grep,Glob,Edit,Write,Bash(git diff *),Bash(git status *)" : "",
        "--output-format", "json",
        "--json-schema", JSON.stringify(agentRoleJsonSchema),
        "--max-turns", "12",
        "--no-session-persistence",
        input.prompt,
      ],
      outputSource: "stdout" as const,
    };
  }
}
