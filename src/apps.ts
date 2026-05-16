import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  AppBridge,
  buildAllowAttribute,
  getToolUiResourceUri,
  isToolVisibilityModelOnly,
  PostMessageTransport,
  RESOURCE_MIME_TYPE,
  RESOURCE_URI_META_KEY,
} from "@modelcontextprotocol/ext-apps/app-bridge";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import type { ClientCapabilities } from "@modelcontextprotocol/sdk/types.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { createElement, useEffect, useLayoutEffect, useRef, useState } from "react";

export const MCP_APP_EXTENSION_ID = "io.modelcontextprotocol/ui";
export const MCP_APP_RESOURCE_MIME_TYPE = RESOURCE_MIME_TYPE;
export const MCP_APP_RESOURCE_URI_META_KEY = RESOURCE_URI_META_KEY;

export function createMcpAppClientCapabilities(): ClientCapabilities {
  return {
    extensions: {
      [MCP_APP_EXTENSION_ID]: {
        mimeTypes: [MCP_APP_RESOURCE_MIME_TYPE],
      },
    },
  };
}

export function getMcpAppResourceUri(tool: Tool): string | undefined {
  return getToolUiResourceUri(tool);
}

export type McpAppResource = {
  html: string;
  metadata?: McpAppResourceMetadata;
  mimeType: typeof MCP_APP_RESOURCE_MIME_TYPE;
  uri: string;
};

type McpAppResourceMetadata = Record<string, unknown> & {
  csp?: McpAppResourceCsp;
  domain?: string;
  permissions?: McpAppResourcePermissions;
  prefersBorder?: boolean;
};

type McpAppResourceCsp = {
  baseUriDomains?: string[];
  connectDomains?: string[];
  frameDomains?: string[];
  resourceDomains?: string[];
};

type McpAppResourcePermissions = {
  camera?: Record<string, never>;
  clipboardWrite?: Record<string, never>;
  geolocation?: Record<string, never>;
  microphone?: Record<string, never>;
};

type McpAppSandboxResourceReadyParams = {
  csp?: McpAppResourceCsp;
  html: string;
  permissions?: McpAppResourcePermissions;
  sandbox?: string;
};

type McpAppViewState =
  | {
      status: "loading";
    }
  | {
      resource: McpAppResource;
      status: "ready";
    }
  | {
      error: unknown;
      status: "error";
    };

type ActiveMcpAppBridge = {
  teardown: () => Promise<void>;
};

export type McpAppViewProps = {
  client: Client;
  className?: string;
  sandbox?: string;
  sandboxUrl?: string;
  title?: string;
  tools?: readonly Tool[];
  uri: string;
};

export function McpAppView({
  client,
  className,
  sandbox = "allow-scripts",
  sandboxUrl,
  title = "MCP App",
  tools = [],
  uri,
}: McpAppViewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const activeBridgeRef = useRef<ActiveMcpAppBridge | undefined>(undefined);
  const toolsRef = useRef(tools);
  const [loadedSrc, setLoadedSrc] = useState<string | undefined>();
  const [state, setState] = useState<McpAppViewState>({ status: "loading" });
  const iframeSrc =
    state.status === "ready"
      ? (sandboxUrl ?? createHtmlDataUrl(state.resource.html))
      : "about:blank";

  useEffect(() => {
    toolsRef.current = tools;
  }, [tools]);

  useEffect(() => {
    let cancelled = false;
    if (!activeBridgeRef.current) {
      setLoadedSrc(undefined);
      setState({ status: "loading" });
    }

    void readMcpAppResource(client, uri).then(
      async (resource) => {
        await activeBridgeRef.current?.teardown();

        if (!cancelled) {
          setLoadedSrc(undefined);
          setState({ resource, status: "ready" });
        }
      },
      async (error: unknown) => {
        await activeBridgeRef.current?.teardown();

        if (!cancelled) {
          setLoadedSrc(undefined);
          setState({ error, status: "error" });
        }
      },
    );

    return () => {
      cancelled = true;
    };
  }, [client, uri]);

  useLayoutEffect(() => {
    if (state.status !== "ready" || loadedSrc !== iframeSrc) {
      return;
    }

    const contentWindow = iframeRef.current?.contentWindow;
    if (!contentWindow) {
      return;
    }

    let disposed = false;
    const bridge = new AppBridge(
      null,
      { name: "use-mcp-react", version: "0.0.0" },
      {
        serverTools: client.getServerCapabilities()?.tools ? {} : undefined,
      },
    );
    bridge.oncalltool = (params, extra) =>
      isAppCallableTool(params.name, toolsRef.current)
        ? client.request({ method: "tools/call", params }, CallToolResultSchema, {
            signal: extra.signal,
          })
        : Promise.reject(new Error(`MCP App is not allowed to call tool ${params.name}.`));

    const transport = new PostMessageTransport(contentWindow, contentWindow);
    const activeBridge: ActiveMcpAppBridge = {
      teardown: async () => {
        if (disposed) {
          return;
        }

        disposed = true;
        await bridge.teardownResource({}, { timeout: 1_000 }).catch(() => undefined);
        void transport.close();
      },
    };
    activeBridgeRef.current = activeBridge;

    void bridge.connect(transport).catch((error: unknown) => {
      if (!disposed) {
        setState({ error, status: "error" });
      }
    });
    if (sandboxUrl) {
      const resourceReadyParams: McpAppSandboxResourceReadyParams = {
        html: state.resource.html,
        sandbox,
      };
      if (state.resource.metadata?.csp) {
        resourceReadyParams.csp = state.resource.metadata.csp;
      }
      if (state.resource.metadata?.permissions) {
        resourceReadyParams.permissions = state.resource.metadata.permissions;
      }
      void bridge.sendSandboxResourceReady(resourceReadyParams);
    }

    return () => {
      if (activeBridgeRef.current === activeBridge) {
        activeBridgeRef.current = undefined;
      }
      void activeBridge.teardown();
    };
  }, [client, iframeSrc, loadedSrc, sandbox, sandboxUrl, state]);

  if (state.status === "error") {
    return createElement(
      "div",
      { role: "alert" },
      state.error instanceof Error ? state.error.message : String(state.error),
    );
  }

  return createElement("iframe", {
    allow:
      state.status === "ready" ? buildAllowAttribute(state.resource.metadata?.permissions) : "",
    className,
    key: sandboxUrl ? `${sandboxUrl}:${uri}` : undefined,
    onLoad: (event) => setLoadedSrc(event.currentTarget.getAttribute("src") ?? undefined),
    ref: iframeRef,
    sandbox,
    src: iframeSrc,
    title,
  });
}

export async function readMcpAppResource(client: Client, uri: string): Promise<McpAppResource> {
  const resource = await client.readResource({ uri });
  if (resource.contents.length !== 1) {
    throw new Error(`Expected one MCP App resource content for ${uri}.`);
  }

  const content = resource.contents[0];
  if (!content) {
    throw new Error(`MCP App resource ${uri} did not return content.`);
  }

  if (content.mimeType !== MCP_APP_RESOURCE_MIME_TYPE) {
    throw new Error(
      `Expected MCP App resource ${uri} to use MIME type ${MCP_APP_RESOURCE_MIME_TYPE}.`,
    );
  }

  const html = readResourceHtml(content, content.uri);
  const metadata = readUiMetadata(content._meta);

  return {
    html,
    ...(metadata ? { metadata } : {}),
    mimeType: MCP_APP_RESOURCE_MIME_TYPE,
    uri: content.uri,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readResourceHtml(content: { blob?: string; text?: string }, uri?: string): string {
  if (typeof content.text === "string") {
    return content.text;
  }

  if (typeof content.blob === "string") {
    return decodeBase64Utf8(content.blob);
  }

  throw new Error(`MCP App resource ${uri ?? "content"} did not include text or blob HTML.`);
}

function readUiMetadata(
  meta: Record<string, unknown> | undefined,
): McpAppResourceMetadata | undefined {
  const uiMeta = meta?.ui;
  return isRecord(uiMeta) ? (uiMeta as McpAppResourceMetadata) : undefined;
}

function isAppCallableTool(name: string, tools: readonly Tool[]): boolean {
  const tool = tools.find((candidate) => candidate.name === name);
  return tool !== undefined && !isToolVisibilityModelOnly(tool);
}

function createHtmlDataUrl(html: string): string {
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

function decodeBase64Utf8(value: string): string {
  const binary = globalThis.atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
