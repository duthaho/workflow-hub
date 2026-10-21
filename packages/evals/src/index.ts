export type EvalSeverity = "low" | "medium" | "high" | "critical";

export interface EvalFinding {
  fingerprint: string;
  severity: EvalSeverity;
}

export interface EvalCase {
  id: string;
  expected: readonly EvalFinding[];
  actual: readonly EvalFinding[];
}

export interface EvalScore {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  missedCritical: number;
  precision: number;
  recall: number;
}

export function scoreEvalCase(input: EvalCase): EvalScore {
  const expected = new Map(input.expected.map((finding) => [finding.fingerprint, finding]));
  const actual = new Map(input.actual.map((finding) => [finding.fingerprint, finding]));
  const truePositives = [...actual.keys()].filter((fingerprint) => expected.has(fingerprint)).length;
  const falsePositives = actual.size - truePositives;
  const falseNegatives = expected.size - truePositives;
  const missedCritical = [...expected.values()].filter((finding) => finding.severity === "critical" && !actual.has(finding.fingerprint)).length;
  return {
    truePositives,
    falsePositives,
    falseNegatives,
    missedCritical,
    precision: actual.size === 0 ? 0 : truePositives / actual.size,
    recall: expected.size === 0 ? 1 : truePositives / expected.size,
  };
}

export interface EvalRun {
  provider: string;
  cases: ReadonlyArray<Omit<EvalCase, "actual"> & { actual: readonly EvalFinding[] }>;
}

function uniqueFindings(findings: readonly EvalFinding[], label: string): void {
  const fingerprints = new Set<string>();
  for (const finding of findings) {
    if (!finding.fingerprint || fingerprints.has(finding.fingerprint)) throw new Error(`${label} contains duplicate or empty finding fingerprints`);
    fingerprints.add(finding.fingerprint);
  }
}

export function runEvalCorpus(input: EvalRun): Array<{ caseId: string; provider: string; score: EvalScore }> {
  const caseIds = new Set<string>();
  return input.cases.map((evalCase) => {
    if (!evalCase.id || caseIds.has(evalCase.id)) throw new Error("eval corpus contains duplicate or empty case ids");
    caseIds.add(evalCase.id);
    uniqueFindings(evalCase.expected, `eval case ${evalCase.id} expected`);
    uniqueFindings(evalCase.actual, `eval case ${evalCase.id} actual`);
    return { caseId: evalCase.id, provider: input.provider, score: scoreEvalCase(evalCase) };
  });
}

export function summarizeEvaluatorFeedback(input: ReadonlyArray<{ provider: string; score: Pick<EvalScore, "truePositives" | "falsePositives" | "falseNegatives" | "missedCritical"> }>): { provider: string; cases: number; precision: number; recall: number; missedCritical: number }[] | { provider: string; cases: number; precision: number; recall: number; missedCritical: number } {
  const providers = new Map<string, { cases: number; truePositives: number; falsePositives: number; falseNegatives: number; missedCritical: number }>();
  for (const entry of input) {
    const metric = providers.get(entry.provider) ?? { cases: 0, truePositives: 0, falsePositives: 0, falseNegatives: 0, missedCritical: 0 };
    metric.cases += 1; metric.truePositives += entry.score.truePositives; metric.falsePositives += entry.score.falsePositives; metric.falseNegatives += entry.score.falseNegatives; metric.missedCritical += entry.score.missedCritical;
    providers.set(entry.provider, metric);
  }
  const output = [...providers.entries()].map(([provider, metric]) => ({ provider, cases: metric.cases, precision: metric.truePositives / (metric.truePositives + metric.falsePositives || 1), recall: metric.truePositives / (metric.truePositives + metric.falseNegatives || 1), missedCritical: metric.missedCritical }));
  return output.length === 1 ? output[0]! : output;
}
