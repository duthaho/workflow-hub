import type { Finding } from "./contracts.js";

export type RiskTier = "low" | "medium" | "high";

const riskRank: Record<RiskTier, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

function escapeRegexCharacter(character: string): string {
  return /[\\^$+?.()|{}\[\]]/.test(character) ? `\\${character}` : character;
}

export function matchPathPattern(path: string, pattern: string): boolean {
  let expression = "^";

  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index] ?? "";
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        expression += ".*";
        index += 1;
      } else {
        expression += "[^/]*";
      }
    } else {
      expression += escapeRegexCharacter(character);
    }
  }

  expression += "$";
  return new RegExp(expression).test(path.replace(/^\.\//, ""));
}

export interface RiskInput {
  changedPaths: string[];
  findingSeverities: Array<Finding["severity"]>;
  highRiskPaths: string[];
  modelRecommendation?: RiskTier;
}

export interface RiskClassification {
  tier: RiskTier;
  reasons: string[];
}

export function classifyRisk(input: RiskInput): RiskClassification {
  let tier: RiskTier = "low";
  const reasons: string[] = [];

  for (const path of input.changedPaths) {
    if (input.highRiskPaths.some((pattern) => matchPathPattern(path, pattern))) {
      tier = "high";
      reasons.push(`high-risk path: ${path}`);
    }
  }

  const severeFinding = input.findingSeverities.find(
    (severity) => severity === "critical" || severity === "high",
  );
  if (severeFinding !== undefined) {
    tier = "high";
    reasons.push(`${severeFinding} severity finding`);
  } else if (input.findingSeverities.includes("medium") && tier === "low") {
    tier = "medium";
    reasons.push("medium severity finding");
  }

  if (input.changedPaths.length > 20 && tier === "low") {
    tier = "medium";
    reasons.push(`broad change: ${input.changedPaths.length} files`);
  }

  if (
    input.modelRecommendation !== undefined &&
    riskRank[input.modelRecommendation] > riskRank[tier]
  ) {
    tier = input.modelRecommendation;
    reasons.push(`model raised risk to ${input.modelRecommendation}`);
  }

  if (reasons.length === 0) {
    reasons.push("no elevated deterministic risk signals");
  }

  return { tier, reasons };
}

export interface MergePolicyInput {
  tier: RiskTier;
  deterministicChecksPassed: boolean;
  securityChecksPassed: boolean;
  unresolvedFindings: number;
  ownerAttested: boolean;
  secondHumanApproved: boolean;
}

export interface MergePolicyDecision {
  allowed: boolean;
  blockers: string[];
}

export function evaluateMergePolicy(
  input: MergePolicyInput,
): MergePolicyDecision {
  const blockers: string[] = [];

  if (!input.deterministicChecksPassed) {
    blockers.push("deterministic checks failed");
  }
  if (!input.securityChecksPassed) {
    blockers.push("security checks failed");
  }
  if (input.unresolvedFindings > 0) {
    blockers.push(
      `${input.unresolvedFindings} review finding${input.unresolvedFindings === 1 ? " is" : "s are"} unresolved`,
    );
  }
  if (input.tier === "medium" && !input.ownerAttested) {
    blockers.push("owner attestation is required");
  }
  if (input.tier === "high" && !input.secondHumanApproved) {
    blockers.push("second human approval is required");
  }

  return { allowed: blockers.length === 0, blockers };
}
