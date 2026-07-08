import { describe, expect, it } from "vitest";
import { evaluateRealityCheck, type ProviderReads } from "../src/launch/checks.js";
import { createLaunchPlan } from "../src/launch/index.js";
import { freshStore, seedAcme } from "./helpers.js";

function okRead(data: unknown): any {
  return {
    status: "ok",
    policy_decision: "allow",
    executed: true,
    project: "acme-crm",
    environment: "production",
    provider: "vercel",
    action: "read",
    reason: "test",
    data,
  };
}

function fakeReads(overrides: Partial<ProviderReads> = {}): ProviderReads {
  const empty = async () => okRead([]);
  return {
    namecheapDomains: empty,
    dnsRecords: async () => okRead([]),
    vercelDeployments: empty,
    vercelEnvVarNames: empty,
    stripeProducts: empty,
    stripePrices: empty,
    stripeWebhooks: empty,
    resendDomains: empty,
    neonProjects: empty,
    upstashRedisDatabases: empty,
    r2Buckets: empty,
    sentryProjects: empty,
    posthogProjects: empty,
    clerkDomains: empty,
    probeUrl: async (url: string) => ({ reachable: true, detail: `${url} answered HTTP 200.` }),
    ...overrides,
  };
}

async function evalDnsAddress(address: string) {
  const store = freshStore();
  seedAcme(store);
  const plan = createLaunchPlan(store, {
    project: "acme-crm",
    environment: "production",
    declared_stack: ["domain", "vercel"],
    domain: "acme.com",
  });
  const step = { realityCheck: { kind: "dns-points-at-app", params: { domain: "acme.com" } } } as never;
  return evaluateRealityCheck(
    store,
    plan,
    step,
    fakeReads({ dnsRecords: async () => okRead([{ name: "www", type: "CNAME", address }]) }),
  );
}

describe("launch dns-points-at-app host matching", () => {
  it("rejects a look-alike host that a bare endsWith would accept", async () => {
    const result = await evalDnsAddress("evilvercel-dns.com");
    expect(result.satisfied).toBe(false);
  });

  it("accepts legitimate Vercel DNS targets", async () => {
    await expect(evalDnsAddress("cname.vercel-dns.com")).resolves.toMatchObject({ satisfied: true });
    await expect(evalDnsAddress("76.76.21.21")).resolves.toMatchObject({ satisfied: true });
  });
});
