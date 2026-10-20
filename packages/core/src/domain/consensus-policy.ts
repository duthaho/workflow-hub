import type { FindingState } from "./finding.js";
import type { FindingVerificationResult } from "../ports/agent-provider.js";

export interface ConsensusDecision {
  state: FindingState;
  confidence: number;
}

export function evaluateConsensus(
  verifications: FindingVerificationResult[],
  quorum: number,
  minimumConfidence: number,
): ConsensusDecision {
  const supported = verifications.filter(
    (item) => item.supported && item.confidence >= minimumConfidence,
  );
  const confidence = supported.length === 0
    ? 0
    : supported.reduce((sum, item) => sum + item.confidence, 0) / supported.length;
  const introduced = supported.filter((item) => item.classification === "introduced");
  if (introduced.length >= quorum) return { state: "open", confidence };
  const preExisting = supported.filter((item) => item.classification === "pre_existing");
  if (preExisting.length >= quorum) return { state: "pre_existing", confidence };
  return { state: "dismissed_false_positive", confidence };
}
