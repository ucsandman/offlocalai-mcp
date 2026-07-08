/**
 * Launch plans are local objects that track the launch tail through the
 * existing guarded tools. They never execute provider mutations and never
 * bypass guard, policy, or approvals.
 */

import type { ProviderId } from "../types.js";

export const LAUNCH_STACK_ITEMS = [
  "domain",
  "vercel",
  "neon",
  "stripe",
  "resend",
  "clerk",
  "upstash",
  "r2",
  "sentry",
  "posthog",
] as const;

export type LaunchStackItem = (typeof LAUNCH_STACK_ITEMS)[number];

export const STACK_ITEM_PROVIDER: Record<LaunchStackItem, ProviderId> = {
  domain: "namecheap",
  vercel: "vercel",
  neon: "neon",
  stripe: "stripe",
  resend: "resend",
  clerk: "clerk",
  upstash: "upstash",
  r2: "cloudflare_r2",
  sentry: "sentry",
  posthog: "posthog",
};

export type LaunchStepStatus = "pending" | "done" | "blocked-on-approval" | "failed";

export type RealityCheckKind =
  | "domain-owned"
  | "dns-points-at-app"
  | "provider-mapped"
  | "stripe-product-exists"
  | "stripe-price-exists"
  | "stripe-webhook-enabled"
  | "env-var-present"
  | "deployment-ready"
  | "email-domain-exists"
  | "email-domain-verified";

export interface RealityCheck {
  kind: RealityCheckKind;
  params?: Record<string, unknown>;
}

export interface LaunchStep {
  id: string;
  title: string;
  toolHint: string;
  provider: ProviderId;
  dependsOn: string[];
  status: LaunchStepStatus;
  realityCheck: RealityCheck;
  detail?: string;
}

export interface LaunchPlan {
  id: string;
  project: string;
  environment: string;
  declaredStack: LaunchStackItem[];
  domain?: string;
  steps: LaunchStep[];
  createdAt: string;
  updatedAt: string;
}

export interface LaunchCheckResult {
  id: string;
  status: "pass" | "fail" | "skipped";
  message: string;
  remediation?: string;
}
