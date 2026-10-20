import type { ScoutRole } from "../domain/agent-role.js";
import type { CandidateFinding } from "../domain/finding.js";
import type { AgentProvider, AgentRoleResult } from "../ports/agent-provider.js";

export interface ScoutAssignment {
  role: ScoutRole;
  provider: AgentProvider;
  required: boolean;
}

export interface ScoutFailure {
  role: ScoutRole;
  provider: string;
  reason: string;
  required: boolean;
}

export interface ScoutRunResult {
  findings: CandidateFinding[];
  results: AgentRoleResult[];
  failures: ScoutFailure[];
  blocked: boolean;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Agent timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export async function runScouts(input: {
  sessionId: string;
  round: number;
  baseSha: string;
  headSha: string;
  changedFiles: string[];
  diff: string;
  assignments: ScoutAssignment[];
  concurrency: number;
  timeoutMs: number;
}): Promise<ScoutRunResult> {
  if (!Number.isInteger(input.concurrency) || input.concurrency < 1) {
    throw new Error("Scout concurrency must be a positive integer");
  }
  const outcomes: Array<AgentRoleResult | Error> = new Array(input.assignments.length);
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(input.concurrency, input.assignments.length) },
    async () => {
      while (cursor < input.assignments.length) {
        const index = cursor++;
        const assignment = input.assignments[index];
        if (!assignment) continue;
        try {
          outcomes[index] = await withTimeout(
            assignment.provider.runRole({
              sessionId: input.sessionId,
              round: input.round,
              role: assignment.role,
              baseSha: input.baseSha,
              headSha: input.headSha,
              changedFiles: input.changedFiles,
              diff: input.diff,
              readOnly: true,
            }),
            input.timeoutMs,
          );
        } catch (error) {
          outcomes[index] = error instanceof Error ? error : new Error(String(error));
        }
      }
    },
  );
  await Promise.all(workers);

  const results: AgentRoleResult[] = [];
  const failures: ScoutFailure[] = [];
  input.assignments.forEach((assignment, index) => {
    const outcome = outcomes[index];
    if (outcome instanceof Error || outcome?.status !== "completed") {
      failures.push({
        role: assignment.role,
        provider: assignment.provider.name,
        reason: outcome instanceof Error ? outcome.message : outcome?.error ?? outcome?.status ?? "missing result",
        required: assignment.required,
      });
    } else {
      results.push(outcome);
    }
  });

  const failedRequired = failures.filter((failure) => failure.required);
  return {
    results,
    failures,
    findings: results.flatMap((result) => result.findings),
    blocked: failedRequired.length > 0,
  };
}
