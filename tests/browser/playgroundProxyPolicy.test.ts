import { describe, expect, it } from "vitest";
import {
  playgroundMcpProxyPath,
  playgroundMcpTransportProxyFor,
} from "../../playground/src/mcpProxyPolicy.ts";

describe("playground MCP proxy policy", () => {
  it("routes public HTTPS MCP targets through the playground transport proxy", () => {
    expect(playgroundMcpTransportProxyFor("https://mcp.deepwiki.com/mcp")).toBe(
      playgroundMcpProxyPath,
    );
    expect(playgroundMcpTransportProxyFor("https://mcp.stripe.com#ignored")).toBe(
      playgroundMcpProxyPath,
    );
    expect(playgroundMcpTransportProxyFor("https://mcp.example.com/mcp")).toBe(
      playgroundMcpProxyPath,
    );
  });

  it("leaves local, private, and non-HTTPS MCP targets direct", () => {
    expect(playgroundMcpTransportProxyFor("http://localhost:3000/mcp")).toBeUndefined();
    expect(playgroundMcpTransportProxyFor("https://localhost:3000/mcp")).toBeUndefined();
    expect(playgroundMcpTransportProxyFor("https://127.0.0.1/mcp")).toBeUndefined();
    expect(playgroundMcpTransportProxyFor("https://127.0.0.2/mcp")).toBeUndefined();
    expect(playgroundMcpTransportProxyFor("https://10.0.0.1/mcp")).toBeUndefined();
    expect(playgroundMcpTransportProxyFor("https://169.254.169.254/mcp")).toBeUndefined();
    expect(playgroundMcpTransportProxyFor("https://192.168.1.1/mcp")).toBeUndefined();
    expect(playgroundMcpTransportProxyFor("https://172.16.0.1/mcp")).toBeUndefined();
    expect(playgroundMcpTransportProxyFor("https://printer.local/mcp")).toBeUndefined();
    expect(playgroundMcpTransportProxyFor("https://[::1]/mcp")).toBeUndefined();
    expect(playgroundMcpTransportProxyFor("https://[fe80::1]/mcp")).toBeUndefined();
    expect(playgroundMcpTransportProxyFor("https://[::ffff:7f00:1]/mcp")).toBeUndefined();
    expect(playgroundMcpTransportProxyFor("ftp://mcp.example.com/mcp")).toBeUndefined();
  });
});
