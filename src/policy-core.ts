import {
  capabilityLabel,
  defaultDecision,
  effectIsExecutable,
  evaluatePolicy,
} from "./policy.js";
import type {
  ActionContext,
  Capability,
  Environment,
  EnvironmentKind,
  OfflocalState,
  PolicyDecision,
  PolicyEffect,
  PolicyRule,
  Project,
  ProviderId,
  ProviderMapping,
  ProviderResource,
} from "./types.js";

/**
 * offlocal policy core — the pure, transport-independent entry point.
 *
 * Published as `@offlocal/mcp/policy` (see package.json `exports`). Everything
 * here is a function over plain data: same arguments in, same verdict out, no
 * clock, no file, no network, no MCP server, no `Store`. The MCP tools in
 * `src/tools/` are one caller; a runtime enforcement adapter (a Claude Code Mod,
 * a CI job, an HTTP route) is another, and both get identical decisions.
 *
 * INVARIANT, checkable by grep rather than by comment: this module's runtime
 * import graph is `./policy.js` and nothing else — no `node:` builtin, no
 * `./storage.js`, no `Store`. `src/policy.ts` imports types only, and type
 * imports are erased. `test/policy-core.test.ts` asserts it.
 *
 * WHY THIS FILE EXISTS AND NOT `src/index.ts`: `src/index.ts` is the stdio MCP
 * server binary — it calls `main()` at module scope and connects a transport, so
 * importing it as a library would start a server. The library entry has to be a
 * separate module.
 */

export {
  capabilityLabel,
  defaultDecision,
  effectIsExecutable,
  evaluatePolicy,
};

export type {
  ActionContext,
  Capability,
  Environment,
  EnvironmentKind,
  OfflocalState,
  PolicyDecision,
  PolicyEffect,
  PolicyRule,
  Project,
  ProviderId,
  ProviderMapping,
  ProviderResource,
};

/**
 * The parsed contents of `.offlocal/state.json` as a READ-ONLY registry.
 *
 * Every field is optional because a caller outside this package hands over
 * whatever `JSON.parse` returned, possibly written by an older or newer build.
 * A resolver that throws on a missing field is a guard that is off.
 *
 * `selectedEnvironmentId` is NOT written by this package today (see
 * `OfflocalState` in src/types.ts — only `selectedProjectId` is persisted). It is
 * read here so a future selection, or a host that pins an environment itself,
 * resolves without a new resolver. Absent it, resolution falls back to
 * production; see `resolveContextFrom`.
 */
export type RegistryState = Partial<OfflocalState> & {
  selectedEnvironmentId?: string;
};

/** Everything a policy decision needs, resolved from a registry snapshot. */
export interface ResolvedContext {
  project: Project;
  environment: Environment;
  /** Every environment of the resolved project, in registry order. */
  environments: Environment[];
  mapping: ProviderMapping | null;
  /** Provider of the resolved mapping; `"github"` when the environment has none. */
  mappedProvider: ProviderId;
  resourceLabel?: string;
  /** Rules for `evaluatePolicy`; `[]` when the registry carries none. */
  rules: PolicyRule[];
  /**
   * True when no environment was named, the project has more than one, and this
   * resolver picked production. The caller should say so out loud — the verdict
   * is the strict one, and the operator may have meant staging.
   */
  fellBackToProduction: boolean;
}

/** Human-readable label for a mapped provider resource, for audit lines. */
export function resourceLabelOf(resource?: ProviderResource): string | undefined {
  if (!resource) return undefined;
  switch (resource.provider) {
    case "github":
      return `${resource.owner}/${resource.repo}`;
    case "vercel":
      return resource.projectName ?? resource.projectId;
    case "supabase":
      return resource.projectRef;
    case "stripe":
      return resource.mode;
    case "railway":
      return resource.serviceId ?? resource.projectId;
    case "render":
      return resource.serviceName ?? resource.serviceId;
    default:
      return undefined;
  }
}

/**
 * Pure counterpart of `resolveProject` (src/resolve.ts:12-31), reading a state
 * snapshot instead of a `Store`.
 *
 * DEVIATION from src/resolve.ts, deliberate: returns `null` where the Store
 * version throws. An MCP tool can throw — the model reads the error and retries
 * with an explicit `project`. A runtime enforcement adapter has no such retry;
 * it has a tool call that is about to run. `null` lets the caller decide, and
 * `decide()`-style callers treat "no registry" as "not governed here".
 */
export function resolveProjectFrom(state: RegistryState, projectRef?: string): Project | null {
  const projects = state.projects ?? [];
  if (projectRef) {
    return projects.find((p) => p.id === projectRef || p.slug === projectRef) ?? null;
  }
  if (state.selectedProjectId) {
    const selected = projects.find((p) => p.id === state.selectedProjectId);
    if (selected) return selected;
  }
  return projects[0] ?? null;
}

/**
 * Pure counterpart of `resolveEnvironment` (src/resolve.ts:33-55).
 *
 * DEVIATION, deliberate and load-bearing: `resolveEnvironment` THROWS when a
 * project has more than one environment and the caller named none ("specify
 * which"). Every MCP tool call names its environment, so throwing is right
 * there. A runtime adapter intercepting `Bash("vercel deploy --prod")` has no
 * such argument. So this resolver fails CLOSED: with nothing selected it takes
 * the production environment. Being wrong here costs an approval prompt; being
 * wrong the other way costs production.
 *
 * Ported from the prototype's A5 registry resolution
 * (C:\Projects\claude-mods-rnd\prototypes\prodguard\hooks\policy-core.ts:805-840,
 * `resolveContextFrom`), which is itself a port of this package's resolve.ts.
 */
export function resolveEnvironmentFrom(
  state: RegistryState,
  project: Project,
  envRef?: string,
): Environment | null {
  const envs = (state.environments ?? []).filter((e) => e.projectId === project.id);
  if (!envs.length) return null;
  if (envRef) {
    return envs.find((e) => e.id === envRef || e.name === envRef) ?? null;
  }
  if (state.selectedEnvironmentId) {
    const selected = envs.find((e) => e.id === state.selectedEnvironmentId);
    if (selected) return selected;
  }
  return envs.find((e) => e.isProduction === true) ?? envs[0]!;
}

/** Optional pins for {@link resolveContextFrom}; both accept an id, name or slug. */
export interface ResolveContextOptions {
  project?: string;
  environment?: string;
  /** Prefer a mapping for this provider when the environment has several. */
  provider?: ProviderId;
}

/**
 * Resolve a whole decision context from a `.offlocal/state.json` snapshot.
 *
 * Pure: the caller does the reading. Returns `null` when the registry names no
 * project, or the resolved project has no environments — "this repo is not
 * governed by offlocal", which a caller must not confuse with "allowed".
 *
 * Port of the prototype's A5 `resolveContextFrom`
 * (C:\Projects\claude-mods-rnd\prototypes\prodguard\hooks\policy-core.ts:805-840),
 * typed and given explicit project/environment/provider pins.
 */
// WIRE-DARK[consumer: a runtime enforcement adapter (claude-mods-rnd/prototypes/prodguard) imports @offlocal/mcp/policy; wired when prodguard leaves shadow]
export function resolveContextFrom(
  state: RegistryState,
  options: ResolveContextOptions = {},
): ResolvedContext | null {
  const project = resolveProjectFrom(state, options.project);
  if (!project) return null;

  const environments = (state.environments ?? []).filter((e) => e.projectId === project.id);
  const environment = resolveEnvironmentFrom(state, project, options.environment);
  if (!environment) return null;

  const forEnvironment = (state.mappings ?? []).filter(
    (m) => m.environmentId === environment.id,
  );
  const mapping =
    (options.provider
      ? forEnvironment.find((m) => m.provider === options.provider)
      : undefined) ??
    forEnvironment[0] ??
    null;

  return {
    project,
    environment,
    environments,
    mapping,
    mappedProvider: mapping?.provider ?? options.provider ?? "github",
    resourceLabel: resourceLabelOf(mapping?.resource),
    rules: state.policyRules ?? [],
    fellBackToProduction:
      !options.environment &&
      !state.selectedEnvironmentId &&
      environment.isProduction === true &&
      environments.length > 1,
  };
}
