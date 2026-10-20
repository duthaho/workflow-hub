import { deduplicateFindings } from "./deduplicate-findings.js";
import { planReviewRound } from "./plan-review-round.js";
import { reconcileRound } from "./reconcile-round.js";
import { runScouts, type ScoutAssignment } from "./run-scouts.js";
import { verifyFindings } from "./verify-findings.js";
import {
  beginReviewRound,
  createReviewSession,
  transitionReviewSession,
  type ReviewSession,
} from "../domain/review-session.js";
import { classifyRisk, type RiskClassification } from "../policy.js";
import type { AgentProvider } from "../ports/agent-provider.js";
import type { RepositoryPort } from "../ports/repository.js";
import type { ReviewStateStore } from "../ports/review-state.js";
import type { VerificationPort } from "../ports/verification.js";

export type LocalReviewOutcome = "passed" | "actionable" | "blocked" | "escalated";

export interface LocalReviewResult {
  outcome: LocalReviewOutcome;
  session: ReviewSession;
  risk: RiskClassification;
}

export interface RunLocalReviewOptions {
  sessionId: string;
  baseRef: string;
  maxRounds: number;
  highRiskPaths: string[];
  depth: "quick" | "standard" | "deep";
  fix: boolean;
  repository: RepositoryPort;
  verification: VerificationPort;
  stateStore: ReviewStateStore;
  scouts: ScoutAssignment[];
  verifiers: AgentProvider[];
  fixProvider?: AgentProvider;
  concurrency: number;
  timeoutMs: number;
  quorum: number;
  minimumConfidence: number;
  task?: string;
  now?: () => string;
}

async function persist(store: ReviewStateStore, session: ReviewSession): Promise<ReviewSession> {
  const version = await store.save(session, session.version);
  return { ...session, version };
}

function outcomeForState(state: ReviewSession["state"]): LocalReviewOutcome | undefined {
  if (state === "passed" || state === "blocked" || state === "escalated") return state;
  return undefined;
}

function selectScouts(
  assignments: ScoutAssignment[],
  depth: RunLocalReviewOptions["depth"],
  risk: RiskClassification,
): ScoutAssignment[] {
  if (depth === "deep" || risk.tier === "high") return assignments;
  const roles = depth === "standard"
    ? new Set(["correctness-scout", "security-scout", "test-gap-scout"])
    : new Set(["correctness-scout", "security-scout"]);
  return assignments.filter((assignment) => roles.has(assignment.role));
}

export async function runLocalReview(options: RunLocalReviewOptions): Promise<LocalReviewResult> {
  const now = options.now ?? (() => new Date().toISOString());
  let session = await options.stateStore.load(options.sessionId);
  const resumed = session !== undefined;
  if (session === undefined) {
    const headSha = await options.repository.resolveRef("HEAD");
    const mergeBaseSha = await options.repository.mergeBase(options.baseRef, headSha);
    session = createReviewSession({
      id: options.sessionId,
      baseRef: options.baseRef,
      mergeBaseSha,
      headSha,
      maxRounds: options.maxRounds,
      now: now(),
    });
    session = await persist(options.stateStore, session);
  }
  const terminalOutcome = outcomeForState(session.state);
  if (resumed) {
    if (session.baseRef !== options.baseRef) {
      throw new Error(`Review session does not match requested base: ${session.baseRef} != ${options.baseRef}`);
    }
    if (session.maxRounds !== options.maxRounds) {
      throw new Error(`Review session does not match maxRounds: ${session.maxRounds} != ${options.maxRounds}`);
    }
    const currentHead = await options.repository.resolveRef("HEAD");
    const currentMergeBase = await options.repository.mergeBase(options.baseRef, currentHead);
    if (currentMergeBase !== session.mergeBaseSha) {
      throw new Error("Review session does not match the current merge base");
    }
    if (terminalOutcome !== undefined && currentHead !== session.headSha) {
      throw new Error("Review session does not match the current head");
    }
  }
  const initialPaths = await options.repository.changedFiles(session.mergeBaseSha, session.headSha);
  let risk = classifyRisk({ changedPaths: initialPaths, findingSeverities: [], highRiskPaths: options.highRiskPaths });
  if (terminalOutcome) return { outcome: terminalOutcome, session, risk };
  const configuredScouts = selectScouts(options.scouts, options.depth, risk);
  if (!configuredScouts.some(
    (assignment) => assignment.role === "security-scout" && assignment.required,
  )) {
    session = transitionReviewSession(
      session,
      "blocked",
      now(),
      "A required independent security scout is not configured",
    );
    session = await persist(options.stateStore, session);
    return { outcome: "blocked", session, risk };
  }

  const verifyProject = async (): Promise<boolean> => {
    const result = await options.verification.verify();
    if (result.status !== "passed") {
      session = transitionReviewSession(session!, "blocked", now(), result.reason ?? "Deterministic verification failed");
      session = await persist(options.stateStore, session);
      return false;
    }
    return true;
  };

  const applyFix = async (initialTask = false): Promise<boolean> => {
    if (!options.fixProvider) {
      session = transitionReviewSession(session!, "blocked", now(), "Fix requested but no fix provider is configured");
      session = await persist(options.stateStore, session);
      return false;
    }
    const open = session!.rounds.at(-1)?.findings.filter((finding) => finding.state === "open") ?? [];
    session = transitionReviewSession(session!, "fixing", now());
    session = await persist(options.stateStore, session);
    try {
      const headSha = await options.repository.resolveRef("HEAD");
      const fixTask = initialTask
        ? options.task
        : `Fix these verified findings: ${JSON.stringify(open)}`;
      await options.fixProvider.runRole({
        sessionId: session.id,
        round: session.rounds.length,
        role: "fix-agent",
        baseSha: session.mergeBaseSha,
        headSha,
        changedFiles: await options.repository.changedFiles(session.mergeBaseSha, headSha),
        diff: await options.repository.diff(session.mergeBaseSha, headSha),
        readOnly: false,
        ...(fixTask === undefined ? {} : { task: fixTask }),
      });
    } catch (error) {
      session = transitionReviewSession(
        session, "blocked", now(),
        `Fix agent failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      session = await persist(options.stateStore, session);
      return false;
    }
    session = transitionReviewSession(session, "verifying", now());
    session = await persist(options.stateStore, session);
    if (!(await verifyProject())) return false;
    session = transitionReviewSession(session, "reviewing", now());
    session = await persist(options.stateStore, session);
    return true;
  };

  if (session.state === "pending" && options.task !== undefined) {
    if (!options.fix) {
      session = transitionReviewSession(session, "blocked", now(), "An explicit development task requires fix mode");
      session = await persist(options.stateStore, session);
      return { outcome: "blocked", session, risk };
    }
    if (!(await applyFix(true))) return { outcome: "blocked", session, risk };
  }

  if (session.state === "pending") {
    session = transitionReviewSession(session, "verifying", now());
    session = await persist(options.stateStore, session);
    if (!(await verifyProject())) return { outcome: "blocked", session, risk };
    session = transitionReviewSession(session, "reviewing", now());
    session = await persist(options.stateStore, session);
  } else if (session.state === "verifying") {
    if (!(await verifyProject())) return { outcome: "blocked", session, risk };
    session = transitionReviewSession(session, "reviewing", now());
    session = await persist(options.stateStore, session);
  } else if (session.state === "reviewing" && session.rounds.at(-1)?.findings.some((finding) => finding.state === "open")) {
    if (!options.fix) return { outcome: "actionable", session, risk };
    if (!(await applyFix())) return { outcome: "blocked", session, risk };
  } else if (session.state === "fixing") {
    throw new Error("Cannot resume a session interrupted during fix; inspect the worktree and start a new session");
  }

  while (session.rounds.length < session.maxRounds) {
    const headSha = await options.repository.resolveRef("HEAD");
    const plan = planReviewRound(session, headSha);
    const changedFiles = await options.repository.changedFiles(plan.baseSha, headSha);
    const diff = await options.repository.diff(plan.baseSha, headSha);
    risk = classifyRisk({ changedPaths: changedFiles, findingSeverities: [], highRiskPaths: options.highRiskPaths });
    const previousFindings = session.rounds.at(-1)?.findings ?? [];
    session = beginReviewRound(session, { baseSha: plan.baseSha, headSha, scope: plan.scope, now: now() });

    const scouts = await runScouts({
      sessionId: session.id,
      round: plan.number,
      baseSha: plan.baseSha,
      headSha,
      changedFiles,
      diff,
      assignments: selectScouts(options.scouts, options.depth, risk),
      concurrency: options.concurrency,
      timeoutMs: options.timeoutMs,
    });
    if (scouts.blocked) {
      const failureMessages = scouts.failures
        .filter((failure) => failure.required)
        .map((failure) => `${failure.provider}/${failure.role}: ${failure.reason}`);
      const rounds = [...session.rounds];
      const currentRound = rounds.at(-1)!;
      rounds[rounds.length - 1] = {
        ...currentRound,
        completedAt: now(),
        scoutFailures: failureMessages,
      };
      session = { ...session, rounds, updatedAt: now() };
      session = transitionReviewSession(
        session,
        "blocked",
        now(),
        `Required review scout failed: ${failureMessages.join("; ")}`,
      );
      session = await persist(options.stateStore, session);
      return { outcome: "blocked", session, risk };
    }

    const lineCounts: Record<string, number> = {};
    for (const path of changedFiles) {
      const count = await options.repository.fileLineCount(path, headSha);
      if (count !== undefined) lineCounts[path] = count;
    }
    let candidates;
    try {
      candidates = deduplicateFindings(scouts.findings, lineCounts);
    } catch (error) {
      session = transitionReviewSession(
        session, "blocked", now(),
        `Scout produced invalid finding data: ${error instanceof Error ? error.message : String(error)}`,
      );
      session = await persist(options.stateStore, session);
      return { outcome: "blocked", session, risk };
    }
    const verified = await verifyFindings({
      findings: candidates,
      verifiers: options.verifiers,
      quorum: options.quorum,
      minimumConfidence: options.minimumConfidence,
      lineCounts,
      context: { sessionId: session.id, round: plan.number, baseSha: plan.baseSha, headSha, changedFiles, diff },
    });
    if (verified.blocked) {
      session = transitionReviewSession(session, "blocked", now(), verified.failures.join("; "));
      session = await persist(options.stateStore, session);
      return { outcome: "blocked", session, risk };
    }

    const previousHeadSha = session.rounds.at(-2)?.headSha;
    const reconciled = reconcileRound({
      previousFindings,
      currentFindings: verified.findings,
      reviewedPaths: changedFiles,
      roundNumber: plan.number,
      maxRounds: session.maxRounds,
      ...(previousHeadSha === undefined ? {} : { previousHeadSha }),
      currentHeadSha: headSha,
    });
    const rounds = [...session.rounds];
    const currentRound = rounds.at(-1)!;
    rounds[rounds.length - 1] = {
      ...currentRound,
      completedAt: now(),
      findings: reconciled.findings,
      emittedFingerprints: reconciled.emittedFindings.map((finding) => finding.fingerprint),
      scoutFailures: scouts.failures.map((failure) => `${failure.provider}/${failure.role}: ${failure.reason}`),
    };
    session = {
      ...session,
      rounds,
      headSha,
      knownFingerprints: [...new Set([...session.knownFingerprints, ...reconciled.findings.map((finding) => finding.fingerprint)])].sort(),
      updatedAt: now(),
    };
    risk = classifyRisk({
      changedPaths: changedFiles,
      findingSeverities: reconciled.findings.filter((finding) => finding.state === "open").map((finding) => finding.severity),
      highRiskPaths: options.highRiskPaths,
    });

    if (reconciled.outcome === "passed") {
      session = transitionReviewSession(session, "passed", now());
      session = await persist(options.stateStore, session);
      return { outcome: "passed", session, risk };
    }
    if (reconciled.outcome === "escalated") {
      session = transitionReviewSession(session, "escalated", now());
      session = await persist(options.stateStore, session);
      return { outcome: "escalated", session, risk };
    }
    session = await persist(options.stateStore, session);
    if (!options.fix) return { outcome: "actionable", session, risk };
    if (!(await applyFix())) return { outcome: "blocked", session, risk };
  }

  session = transitionReviewSession(session, "escalated", now());
  session = await persist(options.stateStore, session);
  return { outcome: "escalated", session, risk };
}
