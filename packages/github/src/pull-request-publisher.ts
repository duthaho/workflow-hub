import type { ReviewFinding } from "../../core/src/domain/finding.js";
import { planFindingThreadSync, type ExistingFindingThread } from "./finding-sync.js";
import { GitHubClient } from "./github-client.js";

export class GitHubPullRequestPublisher {
  constructor(private readonly input: { client: GitHubClient; pullNumber: number; reviewedSha: string }) {}

  async publish(findings: ReviewFinding[], existing: ExistingFindingThread[]): Promise<void> {
    const actions = planFindingThreadSync({ findings, existing, commitSha: this.input.reviewedSha });
    for (const action of actions) {
      if (action.kind === "create") await this.input.client.createReviewComment({ pullNumber: this.input.pullNumber, commitSha: this.input.reviewedSha, path: action.path, line: action.line, body: action.body });
      else if (action.kind === "update") await this.input.client.updateReviewComment({ commentId: action.commentId, body: action.body });
      else await this.input.client.resolveReviewThread(action.threadId);
    }
  }
}
