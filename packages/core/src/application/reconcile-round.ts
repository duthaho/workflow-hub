import { isActionableReviewFinding, type ReviewFinding } from "../domain/finding.js";

export interface ReconcileRoundResult {
  findings: ReviewFinding[];
  emittedFindings: ReviewFinding[];
  outcome: "passed" | "actionable" | "escalated";
  noProgress: boolean;
}

function openFingerprints(findings: ReviewFinding[]): string[] {
  return findings.filter(isActionableReviewFinding)
    .map((finding) => finding.fingerprint).sort();
}

export function reconcileRound(input: {
  previousFindings: ReviewFinding[];
  currentFindings: ReviewFinding[];
  reviewedPaths?: string[];
  roundNumber: number;
  maxRounds: number;
  previousHeadSha?: string;
  currentHeadSha: string;
}): ReconcileRoundResult {
  const previous = new Map(input.previousFindings.map((finding) => [finding.fingerprint, finding]));
  const current = new Map(input.currentFindings.map((finding) => [finding.fingerprint, finding]));
  const findings = [...input.currentFindings];
  const emittedFindings = input.currentFindings.filter((finding) => {
    if (finding.state !== "open") return false;
    const prior = previous.get(finding.fingerprint);
    return prior === undefined || prior.state === "fixed";
  });

  for (const prior of input.previousFindings) {
    if (prior.state === "open" && !current.has(prior.fingerprint)) {
      const withinScope = input.reviewedPaths === undefined || input.reviewedPaths.includes(prior.location.path);
      findings.push(withinScope ? { ...prior, state: "fixed" } : prior);
    } else if (!current.has(prior.fingerprint) && prior.state !== "open") {
      findings.push(prior);
    }
  }

  findings.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  emittedFindings.sort((left, right) => left.fingerprint.localeCompare(right.fingerprint));
  const previousOpen = openFingerprints(input.previousFindings);
  const currentOpen = openFingerprints(findings);
  const noProgress = previousOpen.length > 0 &&
    previousOpen.length === currentOpen.length &&
    previousOpen.every((fingerprint, index) => fingerprint === currentOpen[index]);

  const outcome = currentOpen.length === 0
    ? "passed"
    : noProgress || input.roundNumber >= input.maxRounds
      ? "escalated"
      : "actionable";
  return { findings, emittedFindings, outcome, noProgress };
}
