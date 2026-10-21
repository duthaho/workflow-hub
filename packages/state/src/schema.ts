import { z } from "zod";

const AgentRoleSchema = z.enum([
  "correctness-scout", "security-scout", "test-gap-scout",
  "architecture-scout", "finding-verifier", "fix-agent",
]);

const FindingSchema = z.object({
  fingerprint: z.string().min(1),
  state: z.enum(["candidate", "open", "fixed", "dismissed_false_positive", "dismissed_intentional", "pre_existing"]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  confidence: z.number().min(0).max(1),
  category: z.string(),
  defectClass: z.string(),
  symbol: z.string().optional(),
  title: z.string(),
  location: z.object({ path: z.string(), startLine: z.number().int().positive(), endLine: z.number().int().positive() }),
  evidence: z.array(z.object({ role: AgentRoleSchema, provider: z.string(), text: z.string() })),
  supportingAgents: z.array(z.string()),
  classification: z.enum(["introduced", "pre_existing", "style_only", "unsupported"]).optional(),
  remediation: z.string().optional(),
});

const ReviewRoundSchema = z.object({
  number: z.number().int().positive(),
  baseSha: z.string(),
  headSha: z.string(),
  scope: z.enum(["merge-base", "incremental"]),
  startedAt: z.string(),
  completedAt: z.string().optional(),
  findings: z.array(FindingSchema),
  emittedFingerprints: z.array(z.string()),
  scoutFailures: z.array(z.string()),
});

export const ReviewSessionSchema = z.object({
  id: z.string().min(1),
  version: z.number().int().nonnegative(),
  state: z.enum(["pending", "verifying", "reviewing", "fixing", "passed", "escalated", "blocked"]),
  baseRef: z.string(),
  mergeBaseSha: z.string(),
  headSha: z.string(),
  maxRounds: z.number().int().positive(),
  inputFingerprint: z.string().min(1),
  rounds: z.array(ReviewRoundSchema),
  knownFingerprints: z.array(z.string()),
  createdAt: z.string(),
  updatedAt: z.string(),
  blockedReason: z.string().optional(),
});

export const StoredReviewSessionSchema = z.object({
  schemaVersion: z.literal(1),
  session: ReviewSessionSchema,
});
