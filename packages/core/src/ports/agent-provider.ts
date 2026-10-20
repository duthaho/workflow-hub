import type { AgentRole } from "../domain/agent-role.js";
import type {
  CandidateFinding,
  FindingClassification,
  ReviewFinding,
} from "../domain/finding.js";

export interface AgentRoleRequest {
  sessionId: string;
  round: number;
  role: AgentRole;
  baseSha: string;
  headSha: string;
  changedFiles: string[];
  diff: string;
  readOnly: boolean;
  candidates?: CandidateFinding[];
  finding?: ReviewFinding;
  task?: string;
}

export interface FindingVerificationResult {
  fingerprint: string;
  supported: boolean;
  classification: FindingClassification;
  confidence: number;
  reason: string;
}

export interface AgentRoleResult {
  status: "completed" | "blocked" | "failed";
  role: AgentRole;
  provider: string;
  summary: string;
  findings: CandidateFinding[];
  verifications: FindingVerificationResult[];
  error?: string;
}

export interface AgentProvider {
  readonly name: string;
  runRole(request: AgentRoleRequest): Promise<AgentRoleResult>;
}
