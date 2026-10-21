import { readFile } from "node:fs/promises";
import { runEvalCorpus, summarizeEvaluatorFeedback, type EvalRun } from "../../../evals/src/index.js";

export async function runEvaluatorFile(path: string): Promise<{ scores: ReturnType<typeof runEvalCorpus>; feedback: ReturnType<typeof summarizeEvaluatorFeedback> }> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  if (typeof parsed !== "object" || parsed === null || typeof (parsed as { provider?: unknown }).provider !== "string" || !Array.isArray((parsed as { cases?: unknown }).cases)) throw new Error("eval input must contain provider and cases");
  const scores = runEvalCorpus(parsed as EvalRun);
  return { scores, feedback: summarizeEvaluatorFeedback(scores) };
}
