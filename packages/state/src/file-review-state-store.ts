import { mkdir, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { ReviewSession } from "../../core/src/domain/review-session.js";
import type { ReviewStateStore } from "../../core/src/ports/review-state.js";
import { StoredReviewSessionSchema } from "./schema.js";

function validateSessionId(sessionId: string): void {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(sessionId)) {
    throw new Error("Invalid review session id");
  }
}

async function acquireLock(path: string): Promise<Awaited<ReturnType<typeof open>>> {
  const deadline = Date.now() + 5_000;
  while (true) {
    try {
      return await open(path, "wx", 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (Date.now() >= deadline) {
        throw new Error(`Timed out waiting for review state lock: ${path}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
}

export class FileReviewStateStore implements ReviewStateStore {
  readonly directory: string;

  constructor(cwd: string) {
    this.directory = join(cwd, ".workflow-hub", "state");
  }

  private path(sessionId: string): string {
    validateSessionId(sessionId);
    return join(this.directory, `${sessionId}.json`);
  }

  async load(sessionId: string): Promise<ReviewSession | undefined> {
    const path = this.path(sessionId);
    let source: string;
    try {
      source = await readFile(path, "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
    try {
      const stored = StoredReviewSessionSchema.parse(JSON.parse(source));
      return stored.session as ReviewSession;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Review state is corrupt or incompatible at ${path}. To recover, inspect and remove the file before restarting: ${reason}`,
        { cause: error },
      );
    }
  }

  async save(session: ReviewSession, expectedVersion: number): Promise<number> {
    await mkdir(this.directory, { recursive: true });
    const target = this.path(session.id);
    const lockPath = `${target}.lock`;
    const lock = await acquireLock(lockPath);
    try {
      const current = await this.load(session.id);
      const currentVersion = current?.version ?? 0;
      if (currentVersion !== expectedVersion || session.version !== expectedVersion) {
        throw new Error(
          `Review state version conflict: expected ${expectedVersion}, found ${currentVersion}`,
        );
      }
      const nextVersion = expectedVersion + 1;
      const next = { ...session, version: nextVersion };
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
      try {
        await writeFile(
          temporary,
          `${JSON.stringify({ schemaVersion: 1, session: next }, null, 2)}\n`,
          { encoding: "utf8", mode: 0o600 },
        );
        await rename(temporary, target);
      } catch (error) {
        await rm(temporary, { force: true });
        throw error;
      }
      return nextVersion;
    } finally {
      await lock.close();
      await rm(lockPath, { force: true });
    }
  }
}
