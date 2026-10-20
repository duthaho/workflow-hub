import { z } from "zod";

import { ReviewReportSchema, type ProviderName } from "./contracts.js";

export interface ProviderInvocationOptions {
  baseRef: string;
  headSha: string;
  schemaPath: string;
  outputPath: string;
  prompt: string;
}

export interface ProviderInvocation {
  command: "claude" | "codex";
  args: string[];
  outputSource: "stdout" | "file";
}

function buildProviderReportJsonSchema(): z.core.JSONSchema.JSONSchema {
  const schema = structuredClone(
    z.toJSONSchema(ReviewReportSchema, { target: "draft-7" }),
  ) as z.core.JSONSchema.JSONSchema & {
    properties?: Record<string, unknown>;
  };
  const findings = schema.properties?.findings as
    | { items?: { properties?: Record<string, unknown>; required?: string[] } }
    | undefined;
  const finding = findings?.items;
  if (!finding?.properties) {
    throw new Error("Unable to generate provider review JSON schema");
  }
  delete finding.properties.fingerprint;
  finding.required = Object.keys(finding.properties);
  return schema;
}

export const reviewReportJsonSchema = buildProviderReportJsonSchema();

export function buildProviderInvocation(
  provider: ProviderName,
  options: ProviderInvocationOptions,
): ProviderInvocation {
  if (provider === "claude") {
    return {
      command: "claude",
      args: [
        "--print",
        "--restricted",
        "--permission-mode",
        "plan",
        "--permission-prompts",
        "none",
        "--tools",
        "Read,Grep,Glob,Bash(git diff *),Bash(git status *),Bash(git log *)",
        "--output-format",
        "json",
        "--json-schema",
        JSON.stringify(reviewReportJsonSchema),
        "--max-turns",
        "12",
        "--no-session-persistence",
        options.prompt,
      ],
      outputSource: "stdout",
    };
  }

  return {
    command: "codex",
    args: [
      "exec",
      "--sandbox",
      "read-only",
      "--ephemeral",
      "--ignore-user-config",
      "--output-schema",
      options.schemaPath,
      "--output-last-message",
      options.outputPath,
      options.prompt,
    ],
    outputSource: "file",
  };
}

const ClaudeEnvelopeSchema = z.object({
  structured_output: z.unknown(),
});

export function extractStructuredReport(
  provider: ProviderName,
  output: string,
): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch (error) {
    throw new Error(`Invalid ${provider} JSON output`, { cause: error });
  }

  if (provider === "claude") {
    const envelope = ClaudeEnvelopeSchema.safeParse(parsed);
    if (!envelope.success) {
      throw new Error("Claude output did not contain structured_output");
    }
    return envelope.data.structured_output;
  }

  return parsed;
}
