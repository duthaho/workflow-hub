import { z } from "zod";

import { AGENT_ROLES } from "../../core/src/domain/agent-role.js";

const EvidenceSchema = z.object({
  role: z.enum(AGENT_ROLES), provider: z.string(), text: z.string(),
});
const CandidateSchema = z.object({
  severity: z.enum(["low", "medium", "high", "critical"]),
  confidence: z.number().min(0).max(1), category: z.string(), defectClass: z.string(),
  symbol: z.string(), title: z.string(),
  location: z.object({ path: z.string(), startLine: z.number().int(), endLine: z.number().int() }),
  evidence: z.array(EvidenceSchema), classification: z.enum(["introduced", "pre_existing", "style_only", "unsupported"]),
  remediation: z.string(),
});
const VerificationSchema = z.object({
  fingerprint: z.string(), supported: z.boolean(),
  classification: z.enum(["introduced", "pre_existing", "style_only", "unsupported"]),
  confidence: z.number().min(0).max(1), reason: z.string(),
});
export const AgentRoleOutputSchema = z.object({
  status: z.enum(["completed", "blocked", "failed"]),
  role: z.enum(AGENT_ROLES), provider: z.string(), summary: z.string(),
  findings: z.array(CandidateSchema), verifications: z.array(VerificationSchema), error: z.string(),
});
export const agentRoleJsonSchema = z.toJSONSchema(AgentRoleOutputSchema, { target: "draft-7" });

export function parseAgentRoleOutput(value: unknown) {
  try {
    const parsed = AgentRoleOutputSchema.parse(value);
    return {
      ...parsed,
      findings: parsed.findings.map((finding) => ({
        ...finding,
        ...(finding.symbol ? { symbol: finding.symbol } : {}),
        ...(finding.remediation ? { remediation: finding.remediation } : {}),
      })),
      ...(parsed.error ? { error: parsed.error } : {}),
    };
  } catch (error) {
    throw new Error("Invalid provider role output", { cause: error });
  }
}
