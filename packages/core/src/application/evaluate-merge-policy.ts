import {
  classifyRisk,
  evaluateMergePolicy,
  type MergePolicyDecision,
  type RiskTier,
} from "../policy.js";

export interface CompletedCheck {
  name: string;
  conclusion: "success" | "failure" | "neutral" | "cancelled" | "skipped" | null;
}

export interface OperationalMergePolicyInput {
  changedPaths: readonly string[];
  highRiskPaths: readonly string[];
  checks: readonly CompletedCheck[];
  requiredDeterministicChecks: readonly string[];
  requiredSecurityChecks: readonly string[];
  requiredReviewPolicyCheck: string;
  unresolvedFindings: number;
  ownerAttested: boolean;
  secondHumanApproved: boolean;
}

export interface OperationalMergePolicyDecision extends MergePolicyDecision {
  tier: RiskTier;
}

function requiredChecksPassed(
  checks: readonly CompletedCheck[],
  names: readonly string[],
): { passed: boolean; blockers: string[] } {
  const blockers = names
    .filter((name) => !checks.some((check) => check.name === name && check.conclusion === "success"))
    .map((name) => `required check ${name} is missing or did not succeed`);
  return { passed: blockers.length === 0, blockers };
}

export function evaluateOperationalMergePolicy(
  input: OperationalMergePolicyInput,
): OperationalMergePolicyDecision {
  const deterministic = requiredChecksPassed(input.checks, input.requiredDeterministicChecks);
  const security = requiredChecksPassed(input.checks, [
    ...input.requiredSecurityChecks,
    input.requiredReviewPolicyCheck,
  ]);
  const risk = classifyRisk({
    changedPaths: [...input.changedPaths],
    findingSeverities: [],
    highRiskPaths: [...input.highRiskPaths],
  });
  const decision = evaluateMergePolicy({
    tier: risk.tier,
    deterministicChecksPassed: deterministic.passed,
    securityChecksPassed: security.passed,
    unresolvedFindings: input.unresolvedFindings,
    ownerAttested: input.ownerAttested,
    secondHumanApproved: input.secondHumanApproved,
  });

  return {
    allowed: decision.allowed,
    tier: risk.tier,
    blockers: [...deterministic.blockers, ...security.blockers, ...decision.blockers.filter(
      (blocker) => blocker !== "deterministic checks failed" && blocker !== "security checks failed",
    )],
  };
}
