/// <reference types="chrome" />

import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { McpActionResult, UseMcpOAuthOptions } from "../../../src/index.ts";
import { useMcp } from "../../../src/index.ts";
import {
  createMcpAppClientCapabilities,
  getMcpAppResourceUri,
  McpAppView,
} from "../../../src/apps.ts";

function readMcpUrl(): string {
  const url = new URL(window.location.href).searchParams.get("mcpUrl");
  if (!url) {
    throw new Error("Missing mcpUrl search parameter.");
  }

  return url;
}

function readOAuthOptions(): UseMcpOAuthOptions | undefined {
  const searchParams = new URL(window.location.href).searchParams;
  const clientId = searchParams.get("clientId");
  const metadataRedirectUri = searchParams.get("metadataRedirectUri");
  const redirectUrl = searchParams.get("redirectUrl");
  const oauth: UseMcpOAuthOptions = {
    ...(clientId ? { clientId } : {}),
    ...(metadataRedirectUri
      ? {
          clientMetadata: {
            redirect_uris: [metadataRedirectUri],
          },
        }
      : {}),
    ...(redirectUrl ? { redirectUrl } : {}),
  };

  if (Object.keys(oauth).length === 0) {
    return undefined;
  }

  return oauth;
}

function resultLabel(result: McpActionResult | null): string {
  if (!result) {
    return "";
  }

  return result.ok ? "ok" : result.reason;
}

function App() {
  const [lastAuthorizeResult, setLastAuthorizeResult] = useState<McpActionResult | null>(null);
  const [appResult, setAppResult] = useState("");
  const [appSawToken, setAppSawToken] = useState("");
  const renderApp = new URL(window.location.href).searchParams.get("renderApp") === "1";
  const mcp = useMcp({
    clientCapabilities: renderApp ? createMcpAppClientCapabilities() : undefined,
    oauth: readOAuthOptions(),
    url: readMcpUrl(),
  });
  const toolNames = mcp.tools.map((tool) => tool.name).join(",");
  const appTool = renderApp ? mcp.tools.find((tool) => getMcpAppResourceUri(tool)) : undefined;
  const appUri = appTool ? getMcpAppResourceUri(appTool) : undefined;

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (event.data?.type !== "extension-mcp-app-result") {
        return;
      }

      setAppResult(JSON.stringify(event.data.result));
      setAppSawToken(String(event.data.sawToken));
    };
    window.addEventListener("message", listener);

    return () => {
      window.removeEventListener("message", listener);
    };
  }, []);

  return (
    <section>
      <div id="status" data-status={mcp.status}>
        {mcp.status}
      </div>
      <div id="error">{mcp.error?.message ?? ""}</div>
      <div id="authorization-url">{mcp.authorizationUrl?.toString() ?? ""}</div>
      <div id="authorize-result">{resultLabel(lastAuthorizeResult)}</div>
      <div id="tools">{toolNames}</div>
      <div id="app-result">{appResult}</div>
      <div id="app-saw-token">{appSawToken}</div>
      <button
        id="authorize"
        type="button"
        disabled={mcp.status !== "pending_auth"}
        onClick={() => {
          void mcp.authorize().then(setLastAuthorizeResult);
        }}
      >
        Authorize
      </button>
      {renderApp && mcp.client && appUri ? (
        <McpAppView
          client={mcp.client}
          sandboxUrl={chrome.runtime.getURL("sandbox.html")}
          title="Extension MCP App"
          tools={mcp.tools}
          uri={appUri}
        />
      ) : null}
    </section>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("Missing root element.");
}

createRoot(root).render(<App />);
