# `.offlocal/state.json` — the read contract

Written for whoever builds the *next* thing that needs to know which environment
a command points at. This server is one reader of that file. It is not the only
one it is allowed to have.

## 1. Why this doc exists

`src/policy.ts` answers "is this allowed?" from `capability × environment kind ×
provider × live-flag`. It never looks at a tool name, and it never looks at a
shell command. That makes it reusable — but only if something else can build the
context it takes, and today the only builder is this server's own MCP tools,
which run *after* the model has already decided to call a tool.

A **runtime enforcement adapter** — a Claude Code Mod on `tool.call`, a CI job, a
pre-commit hook, an HTTP route — sits earlier than that. It has a command and no
context. `.offlocal/state.json` is the context. This doc is the promise that it
may read it.

The pure entry point for exactly this is published as `@offlocal/mcp/policy`
(`src/policy-core.ts`): `resolveContextFrom(state)` turns a parsed snapshot into
a `ResolvedContext`, and `evaluatePolicy(rules, ctx)` turns that into a verdict.
Neither touches a disk, a socket or a `Store`.

## 2. Where the file is

`offlocalHome()` (`src/paths.ts`):

1. `OFFLOCAL_HOME` env var, when set and non-empty — points **at** the
   `.offlocal` directory itself, absolute or relative to cwd.
2. otherwise `<cwd>/.offlocal`

State is `<home>/state.json`. Local-first by design: the registry lives next to
the project the agent works in, so "which project am I in" is answered by the
working directory rather than by a login.

## 3. Fields a reader may rely on

Source of truth for the shapes is `OfflocalState` in `src/types.ts`. A reader
should treat every field as optional — the file on disk may have been written by
an older or newer build than the reader.

| Field | Shape | What a reader does with it |
|---|---|---|
| `version` | `1` | Refuse a version higher than you understand. |
| `projects[]` | `{id, workspaceId, name, slug, description?, createdAt}` | The unit a human names. `slug` is the stable handle. |
| `environments[]` | `{id, projectId, name, kind, isProduction, createdAt}` | The thing policy actually reasons about. |
| `connections[]` | `{provider, auth:{kind:"env", envVar}, ...}` | **Never a secret** — `auth.envVar` is the *name* of an env var. The token is read at call time and never persisted. |
| `mappings[]` | `{id, projectId, environmentId, provider, connectionId?, resource}` | Binds one environment to one concrete provider resource (`acme/acme-crm`, a Vercel project, `stripe: {mode:"live"}`). |
| `policyRules[]` | `{id, priority, effect, match{...}, description?, createdAt}` | Pass straight to `evaluatePolicy` as the first argument. Highest `priority` match wins; unset `match` fields are wildcards. |
| `pendingApprovals[]` | approval lifecycle rows | Written by this server. A read-only adapter should not interpret them as grants. |
| `selectedProjectId` | `string?` | The project selected by `select_project`. Used when the caller names none. |

`selectedEnvironmentId` is **not written today**. `resolveContextFrom` reads it
if present so a future selection needs no new resolver, and falls back as below
when it is absent.

### Environment kinds

`EnvironmentKind` is `"development" | "staging" | "production"`
(`src/types.ts`). `isProduction` is the convenience flag derived from
`kind === "production"` at write time.

**The `isProduction` rule for a reader:** an environment is production when
`isProduction === true` **or** `kind === "production"`. Check both, take either.
They are written together, and the cost of them disagreeing on disk is a
production write treated as a staging write.

### Fail closed to production

`resolveEnvironment` in `src/resolve.ts` *throws* when a project has several
environments and the caller named none. That is right for an MCP tool: every
tool call carries an `environment` argument, and the model reads the error and
retries.

A runtime adapter has no such argument and no such retry — it has a command that
is about to run. So the pure resolver fails **closed**:

1. an environment named by the caller, else
2. `selectedEnvironmentId`, else
3. the first environment with `isProduction === true`, else
4. the first environment of the project.

When step 3 picks production and the project had more than one environment,
`ResolvedContext.fellBackToProduction` is `true`. Say so in the prompt you show a
human: the verdict is the strict one and they may have meant staging.

Being wrong here costs an approval prompt. Being wrong the other way costs
production.

### When there is no context at all

`resolveContextFrom` returns `null` when the registry names no project, or the
resolved project has no environments. `null` means **"this repo is not governed
by offlocal"**, which is not the same as "allowed". An adapter decides its own
posture for that case and should say which one it chose.

## 4. What a reader must not do

- **Do not write to it.** `Store` (`src/storage.ts`) owns the file and writes it
  atomically via a temp file plus rename. A second writer loses data.
- **Do not expect a secret.** There are none in this file, by design. A
  connection names an env var; the value never lands on disk.
- **Do not treat a missing file as permission.** No file means no registry,
  which means no evidence either way.
- **Do not re-implement the defaults.** They live in `defaultDecision`
  (`src/policy.ts`): purchases always need approval, destructive SQL and deletes
  are blocked everywhere, live writes need approval regardless of environment,
  production mutations need approval, non-production writes are allowed. Import
  them instead — a second copy drifts, and the copy that drifts is the one
  running in front of production.

## 5. Shape of a reader

```js
import { readFileSync } from "node:fs";
import { evaluatePolicy, resolveContextFrom } from "@offlocal/mcp/policy";

const state = JSON.parse(readFileSync(".offlocal/state.json", "utf8"));
const ctx = resolveContextFrom(state);          // null → not governed here
if (ctx) {
  const decision = evaluatePolicy(ctx.rules, {
    project: ctx.project,
    environment: ctx.environment,
    provider: ctx.mappedProvider,
    capability: "deploy",                       // derived by the adapter
    tool: "Bash",
    summary: "deploy via Bash: vercel deploy --prod",
    resourceLabel: ctx.resourceLabel,
  });
  // decision.effect → "allow" | "approval_required" | "block"
}
```

The I/O is the caller's, all of it, on purpose.
