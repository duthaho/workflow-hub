import { evaluateConsensus } from "../domain/consensus-policy.js";
import type { ReviewFinding } from "../domain/finding.js";
import type {
  AgentProvider,
  FindingVerificationResult,
} from "../ports/agent-provider.js";

export interface VerifyFindingsResult {
  findings: ReviewFinding[];
  failures: string[];
  blocked: boolean;
}

function providerNames(finding: ReviewFinding): Set<string> {
  return new Set(finding.supportingAgents.map((agent) => agent.split(":", 1)[0] ?? ""));
}

function validLocation(finding: ReviewFinding, lineCounts: Record<string, number>): boolean {
  const count = lineCounts[finding.location.path];
  return count !== undefined && finding.location.startLine >= 1 &&
    finding.location.endLine >= finding.location.startLine &&
    finding.location.endLine <= count;
}

function validEvidence(finding: ReviewFinding): boolean {
  return finding.evidence.length > 0 && finding.evidence.every(
    (evidence) => evidence.provider.trim() !== "" && evidence.text.trim() !== "",
  );
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Verifier timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error: unknown) => { clearTimeout(timer); reject(error); },
    );
  });
}

export async function verifyFindings(input: {
  findings: ReviewFinding[];
  verifiers: AgentProvider[];
  quorum: number;
  minimumConfidence: number;
  timeoutMs: number;
  lineCounts: Record<string, number>;
  context: {
    sessionId: string;
    round: number;
    baseSha: string;
    headSha: string;
    changedFiles: string[];
    diff: string;
  };
}): Promise<VerifyFindingsResult> {
  if (!Number.isInteger(input.quorum) || input.quorum < 1) {
    throw new Error("Verifier quorum must be a positive integer");
  }
  const findings: ReviewFinding[] = [];
  const failures: string[] = [];
  let blocked = false;

  for (const finding of input.findings) {
    if (!validEvidence(finding)) {
      blocked = true;
      findings.push(finding);
      failures.push(`${finding.fingerprint}: finding evidence is missing or blank`);
      continue;
    }
    if (!validLocation(finding, input.lineCounts)) {
      findings.push({ ...finding, state: "dismissed_false_positive" });
      failures.push(`${finding.fingerprint}: deterministic validation failed`);
      continue;
    }
    const originatingProviders = providerNames(finding);
    const crossProvider = input.verifiers.filter(
      (provider) => !originatingProviders.has(provider.name),
    );
    const freshSameProvider = input.verifiers.filter(
      (provider) =>
        originatingProviders.has(provider.name) &&
        provider.supportsIndependentSessions === true,
    );
    const independent = crossProvider.length >= input.quorum
      ? crossProvider
      : [...crossProvider, ...freshSameProvider];
    if (independent.length < input.quorum) {
      blocked = true;
      failures.push(`${finding.fingerprint}: insufficient independent verifiers`);
      findings.push(finding);
      continue;
    }

    const settled = await Promise.allSettled(independent.map((provider) =>
      withTimeout(provider.runRole({
        ...input.context,
        role: "finding-verifier",
        readOnly: true,
        timeoutMs: input.timeoutMs,
        finding,
      }), input.timeoutMs),
    ));
    const verifications: FindingVerificationResult[] = [];
    settled.forEach((outcome, index) => {
      const provider = independent[index];
      if (outcome.status === "rejected" || outcome.value.status !== "completed") {
        failures.push(`${finding.fingerprint}: verifier ${provider?.name ?? index} failed`);
        return;
      }
      const verification = outcome.value.verifications.find(
        (candidate) => candidate.fingerprint === finding.fingerprint,
      );
      if (verification !== undefined) verifications.push(verification);
    });
    if (verifications.length < input.quorum) {
      blocked = true;
      failures.push(`${finding.fingerprint}: verifier quorum unavailable`);
      findings.push(finding);
      continue;
    }
    const decision = evaluateConsensus(
      verifications,
      input.quorum,
      input.minimumConfidence,
    );
    findings.push({
      ...finding,
      state: decision.state,
      confidence: Math.max(finding.confidence, decision.confidence),
    });
  }

  return { findings, failures, blocked };
}
