export type DashclawDecision = "allow" | "block" | "require_approval";

export interface DashclawConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
  mode: "authoritative";
}

export interface DashclawGuardPayload {
  action_type: string;
  // agent_id + declared_goal are what DashClaw's ?record=true path requires to
  // create a real, operator-approvable action row (instead of a bare guard
  // decision whose act_gd_* id has no /api/actions presence).
  agent_id: string;
  agent_name: string;
  declared_goal: string;
  systems_touched: string[];
  reversible: boolean;
  risk_score: number;
  metadata: Record<string, unknown>;
}

/** Operator-approval state of a recorded DashClaw action. */
export type DashclawApprovalState = "pending" | "approved" | "denied";

export interface DashclawGuardDecision {
  decision: DashclawDecision;
  reason: string;
  decisionId?: string;
  actionId?: string;
  verificationStatus?: string;
  signals?: unknown;
  raw: unknown;
}

export interface DashclawOutcomeInput {
  actionId: string;
  status: "success" | "error" | "not_executed";
  durationMs: number;
  summary: string;
  metadata: Record<string, unknown>;
  errorMessage?: string;
}

export interface DashclawStatusReport {
  configured: boolean;
  baseUrl?: string;
  mode: "authoritative";
  reachable: boolean;
  error?: string;
}
