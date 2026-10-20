import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
  AgentProvider,
  AgentRoleRequest,
  AgentRoleResult,
} from "../../core/src/ports/agent-provider.js";
import { buildRolePrompt } from "./prompts.js";
import {
  defaultProviderProcessExecutor,
  type ProviderProcessExecutor,
} from "./process-executor.js";
import { agentRoleJsonSchema, parseAgentRoleOutput } from "./role-output.js";

export interface RoleProviderOptions {
  cwd: string;
  executor?: ProviderProcessExecutor;
  allowFix?: boolean;
}

export abstract class RoleProvider implements AgentProvider {
  abstract readonly name: "claude" | "codex";
  readonly supportsIndependentSessions = true;
  protected readonly cwd: string;
  protected readonly executor: ProviderProcessExecutor;
  protected readonly allowFix: boolean;

  constructor(options: RoleProviderOptions) {
    this.cwd = options.cwd;
    this.executor = options.executor ?? defaultProviderProcessExecutor;
    this.allowFix = options.allowFix ?? false;
  }

  protected abstract invocation(input: {
    request: AgentRoleRequest;
    prompt: string;
    schemaPath: string;
    outputPath: string;
  }): { command: string; args: string[]; outputSource: "stdout" | "file" };

  async runRole(request: AgentRoleRequest): Promise<AgentRoleResult> {
    const isFix = request.role === "fix-agent";
    if (isFix && !this.allowFix) throw new Error("Fix agent is disabled");
    if (!isFix && !request.readOnly) throw new Error("Review and verifier roles must be read-only");
    const directory = await mkdtemp(join(tmpdir(), `workflow-hub-${this.name}-`));
    const schemaPath = join(directory, "role.schema.json");
    const outputPath = join(directory, "role.output.json");
    try {
      await writeFile(schemaPath, `${JSON.stringify(agentRoleJsonSchema, null, 2)}\n`, "utf8");
      const invocation = this.invocation({
        request,
        prompt: buildRolePrompt(this.name, request),
        schemaPath,
        outputPath,
      });
      const process = await this.executor.run(invocation.command, invocation.args, { cwd: this.cwd });
      if (process.exitCode !== 0) {
        throw new Error(`${this.name} ${request.role} failed with exit code ${process.exitCode}: ${process.stderr.trim()}`);
      }
      const raw = invocation.outputSource === "stdout"
        ? process.stdout
        : await readFile(outputPath, "utf8");
      let value: unknown;
      try {
        const parsed: unknown = JSON.parse(raw);
        value = this.name === "claude" && typeof parsed === "object" && parsed !== null && "structured_output" in parsed
          ? (parsed as { structured_output: unknown }).structured_output
          : parsed;
      } catch (error) {
        throw new Error("Invalid provider role output", { cause: error });
      }
      const result = parseAgentRoleOutput(value);
      if (result.provider !== this.name || result.role !== request.role) {
        throw new Error(`Provider role metadata mismatch: expected ${this.name}/${request.role}, received ${result.provider}/${result.role}`);
      }
      if (result.status !== "completed") {
        throw new Error(`${this.name} ${request.role} was ${result.status}: ${result.error || result.summary}`);
      }
      return result;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}
