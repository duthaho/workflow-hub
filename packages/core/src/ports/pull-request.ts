import type { ReviewFinding } from "../domain/finding.js";

export interface PullRequestIntent {
  title: string;
  body: string;
  baseSha: string;
  headSha: string;
  linkedIssues: string[];
  testingEvidence?: string;
}

export interface PullRequestPort {
  readIntent(): Promise<PullRequestIntent>;
  publishFindings(findings: ReviewFinding[], reviewedSha: string): Promise<void>;
  publishCheck(input: {
    name: string;
    status: "success" | "failure" | "neutral";
    reviewedSha: string;
    summary: string;
  }): Promise<void>;
}
