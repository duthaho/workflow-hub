import { createHash } from "node:crypto";

import { z } from "zod";

export const ProviderNameSchema = z.enum(["claude", "codex"]);
export type ProviderName = z.infer<typeof ProviderNameSchema>;

export const WorkflowConfigSchema = z.object({
  schemaVersion: z.literal(1),
  project: z.object({
    name: z.string().trim().min(1),
    profile: z.enum(["generic", "node", "python"]),
  }),
  providers: z.object({
    author: ProviderNameSchema,
    reviewers: z.array(ProviderNameSchema).min(1),
  }),
  commands: z.object({
    verify: z.string().trim().min(1),
  }),
  risk: z.object({
    highRiskPaths: z.array(z.string().trim().min(1)),
  }),
  review: z
    .object({
      maxRounds: z.number().int().min(1).max(10).default(3),
      minimumConfidence: z.number().min(0).max(1).default(0.8),
    })
    .default({ maxRounds: 3, minimumConfidence: 0.8 }),
});
export type WorkflowConfig = z.infer<typeof WorkflowConfigSchema>;

export const FindingSchema = z
  .object({
    severity: z.enum(["critical", "high", "medium", "low"]),
    confidence: z.number().min(0).max(1),
    category: z.string().trim().min(1),
    path: z.string().trim().min(1),
    startLine: z.number().int().positive(),
    endLine: z.number().int().positive(),
    title: z.string().trim().min(1),
    evidence: z.string().trim().min(1),
    rationale: z.string().trim().min(1),
    remediation: z.string().trim().min(1),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  })
  .refine((finding) => finding.endLine >= finding.startLine, {
    message: "endLine must be greater than or equal to startLine",
    path: ["endLine"],
  });
export type Finding = z.infer<typeof FindingSchema>;

export const ReviewReportSchema = z.object({
  schemaVersion: z.literal(1),
  provider: ProviderNameSchema,
  baseRef: z.string().trim().min(1),
  headSha: z.string().trim().min(7),
  summary: z.string().trim().min(1),
  findings: z.array(FindingSchema),
});
export type ReviewReport = z.infer<typeof ReviewReportSchema>;

function normalizeFingerprintText(value: string): string {
  return value.trim().replaceAll(/\s+/g, " ").toLowerCase();
}

function normalizePath(value: string): string {
  return value.trim().replace(/^\.\//, "");
}

export function createFindingFingerprint(
  finding: Pick<
    Finding,
    "category" | "path" | "startLine" | "endLine" | "title"
  >,
): string {
  const identity = [
    normalizePath(finding.path),
    finding.startLine,
    finding.endLine,
    normalizeFingerprintText(finding.category),
    normalizeFingerprintText(finding.title),
  ].join("\n");

  return createHash("sha256").update(identity).digest("hex");
}

export function parseReviewReport(output: string): ReviewReport {
  try {
    const raw: unknown = JSON.parse(output);
    const parsed = ReviewReportSchema.parse(raw);
    const findings = parsed.findings.map((finding) => ({
      ...finding,
      fingerprint: finding.fingerprint ?? createFindingFingerprint(finding),
    }));

    return ReviewReportSchema.parse({ ...parsed, findings });
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid provider output: ${reason}`, { cause: error });
  }
}
