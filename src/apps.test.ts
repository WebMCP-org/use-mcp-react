import { describe, expect, it } from "vitest";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { getMcpAppResourceUri } from "./apps.js";

describe("MCP Apps helpers", () => {
  it("discovers the upstream nested MCP Apps resource URI metadata", () => {
    const tool: Tool = {
      _meta: {
        ui: {
          resourceUri: "ui://weather/view.html",
        },
      },
      inputSchema: {
        type: "object",
      },
      name: "show-weather",
    };

    expect(getMcpAppResourceUri(tool)).toBe("ui://weather/view.html");
  });

  it("discovers the deprecated flat MCP Apps resource URI metadata", () => {
    const tool: Tool = {
      _meta: {
        "ui/resourceUri": "ui://legacy/view.html",
      },
      inputSchema: {
        type: "object",
      },
      name: "show-legacy-weather",
    };

    expect(getMcpAppResourceUri(tool)).toBe("ui://legacy/view.html");
  });

  it("rejects invalid MCP Apps resource URI metadata using upstream validation", () => {
    const tool: Tool = {
      _meta: {
        ui: {
          resourceUri: "https://example.test/view.html",
        },
      },
      inputSchema: {
        type: "object",
      },
      name: "show-invalid-weather",
    };

    expect(() => getMcpAppResourceUri(tool)).toThrow("Invalid UI resource URI");
  });
});
