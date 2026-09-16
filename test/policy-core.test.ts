import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  capabilityLabel,
  defaultDecision,
  effectIsExecutable,
  evaluatePolicy,
  resolveContextFrom,
  resolveEnvironmentFrom,
  resolveProjectFrom,
  resourceLabelOf,
  type RegistryState,
} from "../src/policy-core.js";
import * as policy from "../src/policy.js";
import type { ActionContext, Environment, Project, ProviderMapping } from "../src/types.js";

// A two-environment registry in `.offlocal/state.json` shape. Plain data, the
// way a runtime enforcement adapter would get it out of JSON.parse.
const ACME: Project = {
  id: "prj_acme",
  workspaceId: "ws_1",
  name: "Acme CRM",
  slug: "acme-crm",
  createdAt: "2026-01-01T00:00:00.000Z",
};

const STAGING: Environment = {
  id: "env_staging",
  projectId: "prj_acme",
  name: "staging",
  kind: "staging",
  isProduction: false,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const PRODUCTION: Environment = {
  id: "env_prod",
  projectId: "prj_acme",
  name: "production",
  kind: "production",
  isProduction: true,
  createdAt: "2026-01-01T00:00:00.000Z",
};

const PROD_VERCEL: ProviderMapping = {
  id: "map_prod_vercel",
  projectId: "prj_acme",
  environmentId: "env_prod",
  provider: "vercel",
  resource: { provider: "vercel", projectId: "prj_1", projectName: "acme-crm-prod" },
  createdAt: "2026-01-01T00:00:00.000Z",
};

function registry(overrides: Partial<RegistryState> = {}): RegistryState {
  return {
    version: 1,
    workspaces: [{ id: "ws_1", name: "default", createdAt: "2026-01-01T00:00:00.000Z" }],
    projects: [ACME],
    environments: [STAGING, PRODUCTION],
    connections: [],
    mappings: [PROD_VERCEL],
    policyRules: [],
    pendingApprovals: [],
    ...overrides,
  };
}

function actionOn(environment: Environment, capability: ActionContext["capability"]): ActionContext {
  return {
    project: ACME,
    environment,
    provider: "vercel",
    capability,
    tool: "Bash",
    summary: `${capability} via Bash`,
  };
}

describe("@offlocal/mcp/policy library entry", () => {
  it("re-exports the same function objects as src/policy.ts", () => {
    expect(evaluatePolicy).toBe(policy.evaluatePolicy);
    expect(defaultDecision).toBe(policy.defaultDecision);
    expect(capabilityLabel).toBe(policy.capabilityLabel);
    expect(effectIsExecutable).toBe(policy.effectIsExecutable);
  });

  it("keeps the shipped defaults through the entry point", () => {
    expect(defaultDecision(actionOn(PRODUCTION, "read")).effect).toBe("allow");
    expect(defaultDecision(actionOn(STAGING, "write")).effect).toBe("allow");
    expect(defaultDecision(actionOn(PRODUCTION, "deploy")).effect).toBe("approval_required");
    expect(defaultDecision(actionOn(STAGING, "destructive_sql")).effect).toBe("block");
    expect(defaultDecision(actionOn(STAGING, "delete")).effect).toBe("block");
    expect(defaultDecision({ ...actionOn(STAGING, "write"), live: true }).effect).toBe(
      "approval_required",
    );
    expect(effectIsExecutable("allow")).toBe(true);
    expect(effectIsExecutable("approval_required")).toBe(false);
  });

  it("clamps a purchase that an explicit allow rule would have un-gated", () => {
    const rules = [
      {
        id: "rule_allow_all",
        priority: 500,
        effect: "allow" as const,
        match: {},
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const decision = evaluatePolicy(rules, actionOn(STAGING, "purchase"));
    expect(decision.effect).toBe("approval_required");
    expect(decision.source).toBe("clamp:purchase");
  });
});

describe("resolveContextFrom — registry resolution from a state snapshot", () => {
  it("returns null when the registry names no project or no environment", () => {
    expect(resolveContextFrom({})).toBeNull();
    expect(resolveContextFrom(registry({ projects: [] }))).toBeNull();
    expect(resolveContextFrom(registry({ environments: [] }))).toBeNull();
  });

  it("fails CLOSED to production when nothing is selected and several environments exist", () => {
    const ctx = resolveContextFrom(registry());
    expect(ctx?.environment.name).toBe("production");
    expect(ctx?.fellBackToProduction).toBe(true);
  });

  it("does not claim a production fallback when the environment was chosen", () => {
    const pinned = resolveContextFrom(registry(), { environment: "staging" });
    expect(pinned?.environment.name).toBe("staging");
    expect(pinned?.fellBackToProduction).toBe(false);

    const selected = resolveContextFrom(registry({ selectedEnvironmentId: "env_prod" }));
    expect(selected?.environment.name).toBe("production");
    expect(selected?.fellBackToProduction).toBe(false);

    const only = resolveContextFrom(registry({ environments: [PRODUCTION] }));
    expect(only?.environment.name).toBe("production");
    expect(only?.fellBackToProduction).toBe(false);
  });

  it("resolves the mapped provider and a human resource label", () => {
    const ctx = resolveContextFrom(registry());
    expect(ctx?.mappedProvider).toBe("vercel");
    expect(ctx?.resourceLabel).toBe("acme-crm-prod");

    const unmapped = resolveContextFrom(registry({ mappings: [] }));
    expect(unmapped?.mappedProvider).toBe("github");
    expect(unmapped?.resourceLabel).toBeUndefined();

    expect(resourceLabelOf({ provider: "github", owner: "acme", repo: "acme-crm" })).toBe(
      "acme/acme-crm",
    );
    expect(resourceLabelOf({ provider: "stripe", mode: "live" })).toBe("live");
    expect(resourceLabelOf(undefined)).toBeUndefined();
  });

  it("honours selectedProjectId and explicit refs, and returns null for an unknown ref", () => {
    const two = registry({
      projects: [
        { ...ACME, id: "prj_other", slug: "other-app" },
        ACME,
      ],
      selectedProjectId: "prj_acme",
    });
    expect(resolveProjectFrom(two)?.slug).toBe("acme-crm");
    expect(resolveProjectFrom(two, "other-app")?.id).toBe("prj_other");
    expect(resolveProjectFrom(two, "nope")).toBeNull();
    expect(resolveEnvironmentFrom(registry(), ACME, "nope")).toBeNull();
  });

  it("feeds evaluatePolicy end to end: a production deploy needs approval", () => {
    const ctx = resolveContextFrom(registry())!;
    const decision = evaluatePolicy(ctx.rules, {
      project: ctx.project,
      environment: ctx.environment,
      provider: ctx.mappedProvider,
      capability: "deploy",
      tool: "Bash",
      summary: "deploy via Bash: vercel deploy --prod",
      resourceLabel: ctx.resourceLabel,
    });
    expect(decision.effect).toBe("approval_required");
    expect(decision.source).toBe("default:production_write");
  });
});

// The reusability claim is only worth something if it is checked. A runtime
// import of node:fs, ./storage.js or anything else would make the entry point
// unusable inside a hook, a CI job or a browser.
describe("policy core purity", () => {
  const RUNTIME_IMPORT = /^\s*import\s+(?!type\b)[^;]*?from\s+["']([^"']+)["']/gm;

  function runtimeImportsOf(relative: string): string[] {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    return [...source.matchAll(RUNTIME_IMPORT)].map((m) => m[1]!);
  }

  it("imports nothing at runtime but ./policy.js, which imports only types", () => {
    const entry = runtimeImportsOf("../src/policy-core.ts");
    const engine = runtimeImportsOf("../src/policy.ts");
    // L2: the verdict carries the volume it processed.
    expect(entry.length, `scanned src/policy-core.ts, runtime imports=${entry.length}`).toBe(1);
    expect(entry).toEqual(["./policy.js"]);
    expect(engine, `scanned src/policy.ts, runtime imports=${engine.length}`).toEqual([]);
  });

  it("the scanner it uses actually catches a runtime import (L1)", () => {
    const planted = [
      ...`import { readFileSync } from "node:fs";\nimport type { X } from "./x.js";\n`.matchAll(
        RUNTIME_IMPORT,
      ),
    ].map((m) => m[1]!);
    expect(planted).toEqual(["node:fs"]);
  });
});
