import { describe, expect, it } from "vitest";

import {
  beginReviewRound,
  createReviewSession,
  transitionReviewSession,
} from "../src/domain/review-session.js";
import { isReadOnlyRole } from "../src/domain/agent-role.js";

const start = {
  id: "session-1",
  baseRef: "origin/main",
  mergeBaseSha: "base-sha",
  headSha: "head-sha",
  maxRounds: 2,
  now: "2026-10-20T10:00:00.000Z",
};

describe("review session lifecycle", () => {
  it("moves through valid states and starts bounded rounds", () => {
    let session = createReviewSession(start);
    expect(session.state).toBe("pending");

    session = transitionReviewSession(session, "verifying", start.now);
    session = transitionReviewSession(session, "reviewing", start.now);
    session = beginReviewRound(session, {
      baseSha: "base-sha",
      headSha: "head-sha",
      scope: "merge-base",
      now: start.now,
    });

    expect(session.rounds).toHaveLength(1);
    expect(session.rounds[0]?.number).toBe(1);
  });

  it("rejects invalid transitions and changes to terminal sessions", () => {
    const pending = createReviewSession(start);
    expect(() => transitionReviewSession(pending, "passed", start.now)).toThrow(
      /invalid review session transition/i,
    );

    const blocked = transitionReviewSession(pending, "blocked", start.now);
    expect(() =>
      transitionReviewSession(blocked, "verifying", start.now),
    ).toThrow(/terminal/i);
  });

  it("enforces the configured round cap", () => {
    let session = transitionReviewSession(
      createReviewSession({ ...start, maxRounds: 1 }),
      "verifying",
      start.now,
    );
    session = transitionReviewSession(session, "reviewing", start.now);
    session = beginReviewRound(session, {
      baseSha: "base-sha",
      headSha: "head-sha",
      scope: "merge-base",
      now: start.now,
    });

    expect(() =>
      beginReviewRound(session, {
        baseSha: "head-sha",
        headSha: "next-sha",
        scope: "incremental",
        now: start.now,
      }),
    ).toThrow(/maximum review rounds/i);
  });

  it("keeps every review role read-only except the explicit fix agent", () => {
    expect(isReadOnlyRole("security-scout")).toBe(true);
    expect(isReadOnlyRole("finding-verifier")).toBe(true);
    expect(isReadOnlyRole("fix-agent")).toBe(false);
  });
});