import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import type { ReviewLoopCommand, ReviewLoopCommandInput } from "./review-loop.js";

export async function runDevelopCommand(
  input: Omit<ReviewLoopCommandInput, "fix" | "task"> & { taskPath: string },
  command: ReviewLoopCommand,
) {
  const taskPath = isAbsolute(input.taskPath)
    ? input.taskPath
    : resolve(input.cwd, input.taskPath);
  const task = (await readFile(taskPath, "utf8")).trim();
  if (!task) throw new Error("Development task file is empty");
  const { taskPath: _taskPath, ...reviewInput } = input;
  return command({ ...reviewInput, fix: true, task });
}
