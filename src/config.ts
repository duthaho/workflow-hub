import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  WorkflowConfigSchema,
  type WorkflowConfig,
} from "./contracts.js";

export async function loadWorkflowConfig(cwd: string): Promise<WorkflowConfig> {
  const path = join(cwd, "workflow-hub.json");
  let raw: string;

  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    throw new Error(`Unable to read ${path}`, { cause: error });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error("Invalid workflow-hub.json: malformed JSON", {
      cause: error,
    });
  }

  const result = WorkflowConfigSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`)
      .join("; ");
    throw new Error(`Invalid workflow-hub.json: ${details}`);
  }

  return result.data;
}
