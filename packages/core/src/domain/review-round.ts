import type { ReviewFinding } from "./finding.js";

export interface ReviewRound {
  number: number;
  baseSha: string;
  headSha: string;
  scope: "merge-base" | "incremental";
  startedAt: string;
  completedAt?: string;
  findings: ReviewFinding[];
  emittedFingerprints: string[];
  scoutFailures: string[];
}
