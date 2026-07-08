import { describe, it, expect, vi, afterEach } from "vitest";
import * as render from "../src/providers/render.js";
import { registerTools } from "../src/tools/index.js";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, statusText: status === 200 ? "OK" : "Created" });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("Render provider", () => {
  it("lists services with bearer auth and cursor envelopes", async () => {
    const fetch = vi.fn().mockResolvedValue(
      json([
        {
          service: {
            id: "srv-123",
            name: "api",
            ownerId: "tea-123",
            type: "web_service",
            serviceDetails: { url: "https://api.onrender.com" },
          },
          cursor: "cur",
        },
      ]),
    );
    vi.stubGlobal("fetch", fetch);

    const services = await render.listServices("render-key", { ownerId: "tea-123", limit: 3 });

    expect(fetch).toHaveBeenCalledWith(
      "https://api.render.com/v1/services?ownerId=tea-123&limit=3",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({ Authorization: "Bearer render-key" }),
      }),
    );
    expect(services).toEqual([
      expect.objectContaining({
        id: "srv-123",
        name: "api",
        ownerId: "tea-123",
        type: "web_service",
        url: "https://api.onrender.com",
      }),
    ]);
  });

  it("lists and retrieves deploys", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(
        json([{ deploy: { id: "dep-1", status: "live", createdAt: "2026-07-08T00:00:00Z" } }]),
      )
      .mockResolvedValueOnce(json({ id: "dep-1", status: "live" }));
    vi.stubGlobal("fetch", fetch);

    await expect(render.listDeploys("render-key", "srv-123", 1)).resolves.toEqual([
      expect.objectContaining({ id: "dep-1", status: "live" }),
    ]);
    await expect(render.getDeploy("render-key", "srv-123", "dep-1")).resolves.toEqual(
      expect.objectContaining({ id: "dep-1", status: "live" }),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      1,
      "https://api.render.com/v1/services/srv-123/deploys?limit=1",
      expect.any(Object),
    );
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      "https://api.render.com/v1/services/srv-123/deploys/dep-1",
      expect.any(Object),
    );
  });

  it("fetches recent service logs without exposing secrets in query params", async () => {
    const fetch = vi.fn().mockResolvedValue(
      json({
        logs: [{ timestamp: "2026-07-08T00:00:00Z", message: "started", level: "info" }],
        hasMore: false,
      }),
    );
    vi.stubGlobal("fetch", fetch);

    const logs = await render.getServiceLogs("render-key", "srv-123", {
      ownerId: "tea-123",
      startTime: "2026-07-08T00:00:00Z",
      limit: 10,
    });

    expect(fetch.mock.calls[0]?.[0]).toBe(
      "https://api.render.com/v1/logs?ownerId=tea-123&resource=srv-123&startTime=2026-07-08T00%3A00%3A00Z&direction=backward&limit=10",
    );
    expect(logs.logs).toEqual([{ timestamp: "2026-07-08T00:00:00Z", message: "started", level: "info", type: undefined }]);
  });

  it("triggers deploys and sets env vars with JSON bodies", async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ id: "dep-1", status: "queued" }, 201))
      .mockResolvedValueOnce(json({ key: "API_URL", value: "https://example.com" }));
    vi.stubGlobal("fetch", fetch);

    await expect(render.triggerDeploy("render-key", "srv-123", { clearCache: true })).resolves.toEqual(
      expect.objectContaining({ id: "dep-1", status: "queued" }),
    );
    await render.setEnvVar("render-key", "srv-123", "API_URL", "https://example.com");

    expect(JSON.parse(fetch.mock.calls[0]?.[1]?.body as string)).toEqual({ clearCache: "clear" });
    expect(fetch.mock.calls[1]?.[0]).toBe(
      "https://api.render.com/v1/services/srv-123/env-vars/API_URL",
    );
    expect(JSON.parse(fetch.mock.calls[1]?.[1]?.body as string)).toEqual({
      value: "https://example.com",
    });
  });
});

describe("tool registration", () => {
  it("registers the Render tools and expected total tool count", () => {
    const tools: string[] = [];
    const server = {
      registerTool(name: string) {
        tools.push(name);
      },
    };

    registerTools(server as any, {} as any);

    expect(tools).toHaveLength(124);
    expect(tools).toEqual(
      expect.arrayContaining([
        "list_render_services",
        "get_render_service",
        "list_render_deploys",
        "get_render_deploy_logs",
        "create_render_deployment",
        "set_render_env_var",
      ]),
    );
  });
});
