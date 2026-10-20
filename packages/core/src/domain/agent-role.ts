export const AGENT_ROLES = [
  "correctness-scout",
  "security-scout",
  "test-gap-scout",
  "architecture-scout",
  "finding-verifier",
  "fix-agent",
] as const;

export type AgentRole = (typeof AGENT_ROLES)[number];
export type ScoutRole = Exclude<AgentRole, "finding-verifier" | "fix-agent">;

export function isReadOnlyRole(role: AgentRole): boolean {
  return role !== "fix-agent";
}
