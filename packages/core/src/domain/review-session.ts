import type { ReviewRound } from "./review-round.js";

export type ReviewSessionState =
  | "pending"
  | "verifying"
  | "reviewing"
  | "fixing"
  | "passed"
  | "escalated"
  | "blocked";

export interface ReviewSession {
  id: string;
  version: number;
  state: ReviewSessionState;
  baseRef: string;
  mergeBaseSha: string;
  headSha: string;
  maxRounds: number;
  rounds: ReviewRound[];
  knownFingerprints: string[];
  createdAt: string;
  updatedAt: string;
  blockedReason?: string;
}

const terminal = new Set<ReviewSessionState>(["passed", "escalated", "blocked"]);
const transitions: Record<ReviewSessionState, ReviewSessionState[]> = {
  pending: ["verifying", "fixing", "blocked"],
  verifying: ["reviewing", "blocked"],
  reviewing: ["fixing", "passed", "escalated", "blocked"],
  fixing: ["verifying", "blocked", "escalated"],
  passed: [],
  escalated: [],
  blocked: [],
};

export function createReviewSession(input: {
  id: string;
  baseRef: string;
  mergeBaseSha: string;
  headSha: string;
  maxRounds: number;
  now: string;
}): ReviewSession {
  if (!Number.isInteger(input.maxRounds) || input.maxRounds < 1) {
    throw new Error("maxRounds must be a positive integer");
  }
  return {
    id: input.id,
    version: 0,
    state: "pending",
    baseRef: input.baseRef,
    mergeBaseSha: input.mergeBaseSha,
    headSha: input.headSha,
    maxRounds: input.maxRounds,
    rounds: [],
    knownFingerprints: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function transitionReviewSession(
  session: ReviewSession,
  next: ReviewSessionState,
  now: string,
  blockedReason?: string,
): ReviewSession {
  if (terminal.has(session.state)) {
    throw new Error(`Review session is terminal: ${session.state}`);
  }
  if (!transitions[session.state].includes(next)) {
    throw new Error(`Invalid review session transition: ${session.state} -> ${next}`);
  }
  return {
    ...session,
    state: next,
    updatedAt: now,
    ...(blockedReason === undefined ? {} : { blockedReason }),
  };
}

export function beginReviewRound(
  session: ReviewSession,
  input: {
    baseSha: string;
    headSha: string;
    scope: ReviewRound["scope"];
    now: string;
  },
): ReviewSession {
  if (session.state !== "reviewing") {
    throw new Error("A review round requires the reviewing state");
  }
  if (session.rounds.length >= session.maxRounds) {
    throw new Error("Maximum review rounds reached");
  }
  const round: ReviewRound = {
    number: session.rounds.length + 1,
    baseSha: input.baseSha,
    headSha: input.headSha,
    scope: input.scope,
    startedAt: input.now,
    findings: [],
    emittedFingerprints: [],
    scoutFailures: [],
  };
  return { ...session, headSha: input.headSha, rounds: [...session.rounds, round], updatedAt: input.now };
}
