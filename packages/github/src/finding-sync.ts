import { isActionableReviewFinding, type ReviewFinding } from "../../core/src/domain/finding.js";

export interface ExistingFindingThread {
  fingerprint: string;
  threadId: string;
  commentId: number;
  resolved: boolean;
}

export type FindingThreadAction =
  | { kind: "create"; fingerprint: string; path: string; line: number; body: string }
  | { kind: "update"; fingerprint: string; threadId: string; commentId: number; body: string }
  | { kind: "resolve"; fingerprint: string; threadId: string };

function marker(fingerprint: string): string {
  return `<!-- workflow-hub:finding:${fingerprint} -->`;
}

function body(finding: ReviewFinding, commitSha: string): string {
  const evidence = finding.evidence.map((item) => `- ${item.provider}/${item.role}: ${item.text}`).join("\n");
  return `${marker(finding.fingerprint)}\n**${finding.severity.toUpperCase()}** — ${finding.title}\n\n${evidence}\n\nReviewed commit: \`${commitSha}\`${finding.remediation === undefined ? "" : `\n\nRemediation: ${finding.remediation}`}`;
}

export function planFindingThreadSync(input: {
  findings: ReviewFinding[];
  existing: ExistingFindingThread[];
  commitSha: string;
}): FindingThreadAction[] {
  const existing = new Map(input.existing.map((thread) => [thread.fingerprint, thread]));
  const actions: FindingThreadAction[] = [];
  for (const finding of input.findings) {
    const thread = existing.get(finding.fingerprint);
    if (isActionableReviewFinding(finding)) {
      if (thread === undefined) actions.push({ kind: "create", fingerprint: finding.fingerprint, path: finding.location.path, line: finding.location.endLine, body: body(finding, input.commitSha) });
      else actions.push({ kind: "update", fingerprint: finding.fingerprint, threadId: thread.threadId, commentId: thread.commentId, body: body(finding, input.commitSha) });
    } else if (thread !== undefined && !thread.resolved) {
      actions.push({ kind: "resolve", fingerprint: finding.fingerprint, threadId: thread.threadId });
    }
  }
  return actions;
}
