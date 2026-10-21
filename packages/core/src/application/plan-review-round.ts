import type { ReviewSession } from "../domain/review-session.js";

export interface ReviewRoundPlan {
  number: number;
  baseSha: string;
  headSha: string;
  scope: "merge-base" | "incremental";
  suppressedFingerprints: string[];
}

export function planReviewRound(
  session: ReviewSession,
  currentHeadSha: string,
): ReviewRoundPlan {
  const number = session.rounds.length + 1;
  if (number > session.maxRounds) {
    throw new Error(`Maximum review rounds (${session.maxRounds}) reached`);
  }
  const previousRound = session.rounds.at(-1);
  const incremental = number >= 3;
  return {
    number,
    baseSha: incremental ? previousRound?.headSha ?? session.mergeBaseSha : session.mergeBaseSha,
    headSha: currentHeadSha,
    scope: incremental ? "incremental" : "merge-base",
    suppressedFingerprints: [...new Set(session.rounds.flatMap(
      (round) => round.findings.filter((finding) => finding.state !== "fixed").map((finding) => finding.fingerprint),
    ))].sort(),
  };
}
