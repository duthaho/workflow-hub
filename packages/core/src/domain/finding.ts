import type { AgentRole } from "./agent-role.js";

export type FindingState =
  | "candidate"
  | "open"
  | "fixed"
  | "dismissed_false_positive"
  | "dismissed_intentional"
  | "pre_existing";

export type FindingClassification =
  | "introduced"
  | "pre_existing"
  | "style_only"
  | "unsupported";

export interface FindingLocation {
  path: string;
  startLine: number;
  endLine: number;
}

export interface FindingEvidence {
  role: AgentRole;
  provider: string;
  text: string;
}

export interface ReviewFinding {
  fingerprint: string;
  state: FindingState;
  severity: "low" | "medium" | "high" | "critical";
  confidence: number;
  category: string;
  defectClass: string;
  symbol?: string;
  title: string;
  location: FindingLocation;
  evidence: FindingEvidence[];
  supportingAgents: string[];
  classification?: FindingClassification;
  remediation?: string;
}

export type CandidateFinding = Omit<
  ReviewFinding,
  "fingerprint" | "state" | "supportingAgents"
> & {
  fingerprint?: string;
  state?: "candidate";
  supportingAgents?: string[];
};
