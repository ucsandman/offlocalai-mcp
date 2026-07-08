import { describe, expect, it } from "vitest";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerTools } from "../src/tools/index.js";
import { freshStore } from "./helpers.js";

describe("launch tool registration", () => {
  it("registers the four launch tools unconditionally", () => {
    const tools: string[] = [];
    const recorder = {
      registerTool: (name: string) => {
        tools.push(name);
      },
      registerResource: () => undefined,
    } as unknown as McpServer;

    registerTools(recorder, freshStore());

    expect(tools).toEqual(
      expect.arrayContaining(["create_launch", "get_launch_status", "preflight_launch", "verify_launch"]),
    );
  });
});
