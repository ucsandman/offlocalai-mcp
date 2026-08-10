import { dashclawConfigFromEnv, dashclawFetch } from "./client.js";
import type { DashclawApprovalState, DashclawOutcomeInput, DashclawStatusReport } from "./types.js";

const DENIED_ACTION_STATUSES = new Set(["failed", "denied", "rejected", "expired", "cancelled", "canceled"]);

/**
 * Operator-approval state of a recorded DashClaw action (the gate-drainer
 * rule): approved means an operator identity is stamped on the action AND the
 * action left pending_approval without landing in a denied status. Approvals
 * without approved_by (e.g. API-key writes) never release the gate.
 */
export async function fetchDashclawActionApproval(actionId: string): Promise<DashclawApprovalState> {
  const raw = await dashclawFetch<Record<string, unknown>>(`/api/actions/${encodeURIComponent(actionId)}`);
  const action = (typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>).action : undefined) as
    | Record<string, unknown>
    | undefined;
  const status = typeof action?.status === "string" ? action.status : "";
  const approvedBy = action?.approved_by;
  if (DENIED_ACTION_STATUSES.has(status)) return "denied";
  if (status === "pending_approval") return "pending";
  if (typeof approvedBy === "string" && approvedBy.length > 0) return "approved";
  return "pending";
}

export async function dashclawStatusReport(): Promise<DashclawStatusReport> {
  let config;
  try {
    config = dashclawConfigFromEnv();
  } catch (err) {
    return {
      configured: false,
      mode: "authoritative",
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }

  try {
    try {
      await dashclawFetch("/api/doctor");
    } catch {
      await dashclawFetch("/api/agents");
    }
    return { configured: true, baseUrl: config.baseUrl, mode: config.mode, reachable: true };
  } catch (err) {
    return {
      configured: true,
      baseUrl: config.baseUrl,
      mode: config.mode,
      reachable: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export function dashclawRecentDecisionsFetch(query: { project?: string; environment?: string; limit?: number }) {
  return dashclawFetch("/api/guard/decisions", {
    query: {
      project: query.project,
      environment: query.environment,
      limit: query.limit === undefined ? undefined : String(query.limit),
    },
  });
}

const WIRE_STATUS: Record<DashclawOutcomeInput["status"], string | undefined> = {
  success: "completed",
  error: "failed",
  not_executed: undefined,
};

export async function recordDashclawOutcome(input: DashclawOutcomeInput): Promise<boolean> {
  const wireStatus = WIRE_STATUS[input.status];
  if (!wireStatus) return false;
  await dashclawFetch(`/api/actions/${encodeURIComponent(input.actionId)}/outcome`, {
    method: "POST",
    body: {
      status: wireStatus,
      duration_ms: input.durationMs,
      summary: input.summary,
      metadata: input.metadata,
      error_message: input.errorMessage,
    },
  });
  return true;
}
