import type { CandidateFinding, ReviewFinding } from "../domain/finding.js";

function normalizeText(value: string | undefined): string {
  return (value ?? "").trim().replaceAll(/\s+/g, " ").toLowerCase();
}

function normalizePath(value: string): string {
  const path = value.trim().replaceAll("\\", "/").replace(/^\.\//, "");
  if (!path || path.startsWith("/") || path.split("/").includes("..")) {
    throw new Error(`Finding path is outside repository: ${value}`);
  }
  return path;
}

function fnv1a64(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

export function semanticFindingFingerprint(
  finding: CandidateFinding,
): string {
  return fnv1a64([
    normalizePath(finding.location.path),
    normalizeText(finding.category),
    normalizeText(finding.defectClass),
    normalizeText(finding.symbol),
    normalizeText(finding.title),
  ].join("\n"));
}

function evidenceKey(evidence: CandidateFinding["evidence"][number]): string {
  return `${evidence.provider}:${evidence.role}:${normalizeText(evidence.text)}`;
}

export function deduplicateFindings(
  candidates: CandidateFinding[],
  lineCounts: Record<string, number>,
): ReviewFinding[] {
  const deduplicated = new Map<string, ReviewFinding>();

  for (const candidate of candidates) {
    const path = normalizePath(candidate.location.path);
    const lineCount = lineCounts[path];
    const { startLine, endLine } = candidate.location;
    if (
      lineCount === undefined ||
      !Number.isInteger(startLine) ||
      !Number.isInteger(endLine) ||
      startLine < 1 ||
      endLine < startLine ||
      endLine > lineCount
    ) {
      throw new Error(`Invalid finding line range for ${path}`);
    }

    const normalized = { ...candidate, location: { ...candidate.location, path } };
    const fingerprint = semanticFindingFingerprint(normalized);
    const existing = deduplicated.get(fingerprint);
    const evidence = existing
      ? [...existing.evidence, ...candidate.evidence]
      : [...candidate.evidence];
    const uniqueEvidence = [...new Map(evidence.map((item) => [evidenceKey(item), item])).values()];
    const supportingAgents = [...new Set(uniqueEvidence.map(
      (item) => `${item.provider}:${item.role}`,
    ))].sort();

    deduplicated.set(fingerprint, {
      ...normalized,
      fingerprint,
      state: "candidate",
      evidence: uniqueEvidence,
      supportingAgents,
      confidence: Math.max(existing?.confidence ?? 0, candidate.confidence),
    });
  }

  return [...deduplicated.values()].sort((left, right) =>
    left.fingerprint.localeCompare(right.fingerprint),
  );
}
