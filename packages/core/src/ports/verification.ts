export interface VerificationCheck {
  name: string;
  command: string;
  status: "passed" | "failed";
  durationMs: number;
  evidence?: string;
}

export interface VerificationResult {
  status: "passed" | "failed" | "blocked";
  checks: VerificationCheck[];
  durationMs: number;
  reason?: string;
}

export interface VerificationPort {
  verify(): Promise<VerificationResult>;
}
