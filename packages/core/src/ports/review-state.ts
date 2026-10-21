import type { ReviewSession } from "../domain/review-session.js";

export interface ReviewStateStore {
  load(sessionId: string): Promise<ReviewSession | undefined>;
  save(session: ReviewSession, expectedVersion: number): Promise<number>;
}
