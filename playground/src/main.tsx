import { StrictMode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  McpOAuthCallback,
  MCP_OAUTH_CALLBACK_CHANNEL,
  useMcp,
  type McpActionResult,
  type McpAuthDiagnostics,
  type McpOAuthCallbackMessage,
  type UseMcpOptions,
  type UseMcpResult,
  type UseMcpStatus,
} from "../../src/index.ts";
import {
  createMcpAppClientCapabilities,
  getMcpAppResourceUri,
  McpAppView,
} from "../../src/apps.ts";
import { playgroundMcpTransportProxyFor } from "./mcpProxyPolicy.ts";
import "./styles.css";

type AuthMode = "auto" | "bearer" | "manual-oauth";

type Preset = {
  authMode: AuthMode;
  id: string;
  name: string;
  proxyNote?: string;
  tag: string;
  url: string;
};

type ConnectionDraft = {
  authMode: AuthMode;
  bearerToken: string;
  clientMetadataDocumentEnabled: boolean;
  clientId: string;
  presetId: string;
  proxyEnabled: boolean;
  redirectUrl: string;
  scope: string;
  url: string;
};

type StepState = "pending" | "active" | "done" | "skipped" | "error";

type DiscoveryStep = {
  detail?: string;
  id: string;
  label: string;
  state: StepState;
};

type VerdictFact = { label: string; mono?: boolean; value: string };

const defaultRedirectUrl = `${window.location.origin}/oauth/callback`;

const presets: Preset[] = [
  {
    authMode: "auto",
    id: "canva",
    name: "Canva",
    proxyNote:
      "Canva is a hosted remote MCP server. OAuth stays in the browser; MCP transport goes through the playground proxy route.",
    tag: "Remote OAuth",
    url: "https://mcp.canva.com/mcp",
  },
  {
    authMode: "auto",
    id: "deepwiki",
    name: "DeepWiki",
    proxyNote:
      "DeepWiki is a public no-auth server; the demo still routes transport through the proxy so the request path is visible.",
    tag: "No auth",
    url: "https://mcp.deepwiki.com/mcp",
  },
  {
    authMode: "auto",
    id: "linear-dcr",
    name: "Linear",
    proxyNote:
      "Linear OAuth stays in the browser; only MCP transport POSTs are forwarded through the proxy server route.",
    tag: "OAuth",
    url: "https://mcp.linear.app/mcp",
  },
  {
    authMode: "bearer",
    id: "firecrawl-bearer",
    name: "Firecrawl",
    proxyNote:
      "Bearer-token transports often cannot be called directly from a browser app, so the demo forwards MCP POSTs server-side.",
    tag: "Bearer",
    url: "https://mcp.firecrawl.dev/v2/mcp",
  },
  {
    authMode: "auto",
    id: "stripe",
    name: "Stripe",
    proxyNote:
      "Stripe's MCP endpoint does not expose browser CORS for transport requests, so this demo uses the proxy server route.",
    tag: "OAuth",
    url: "https://mcp.stripe.com",
  },
  {
    authMode: "auto",
    id: "gmail-manual",
    name: "Gmail MCP",
    proxyNote:
      "Local HTTP development URLs stay direct; the playground only proxies public HTTPS MCP targets.",
    tag: "OAuth",
    url: "http://localhost:3000/mcp",
  },
];

const repositoryUrl = "https://github.com/WebMCP-org/use-mcp-react";
const workerSourceUrl = `${repositoryUrl}/blob/main/playground/worker/index.ts`;
const proxyDocsUrl = `${repositoryUrl}/blob/main/docs/reference/transport-proxy-mode.md`;
const clientMetadataDocumentPath = "/.well-known/oauth-client-metadata.json";

const statusLabels: Record<UseMcpStatus, string> = {
  authenticating: "Authenticating",
  connecting: "Connecting",
  failed: "Failed",
  idle: "Idle",
  loading: "Loading catalog",
  pending_auth: "Awaiting credentials",
  ready: "Ready",
  reconnecting: "Reconnecting",
};

export function App() {
  if (window.location.pathname === "/oauth/callback") {
    return <McpOAuthCallback />;
  }

  return <PlaygroundPage />;
}

function PlaygroundPage() {
  const [draft, setDraft] = useState<ConnectionDraft>(() => draftFromPreset(presets[0]));
  const [actionError, setActionError] = useState<string | null>(null);
  const [callbackError, setCallbackError] = useState<string | null>(null);
  const handledCallbackKeyRef = useRef<string | null>(null);
  const mcp = useMcp({ enabled: false, url: null });

  const reportActionResult = useCallback((result: McpActionResult) => {
    setActionError(formatActionResult(result));
  }, []);

  useEffect(() => {
    const finishFromMessage = (message: McpOAuthCallbackMessage) => {
      if (mcp.status !== "pending_auth" && mcp.status !== "authenticating") {
        return;
      }

      if (message.error) {
        setCallbackError(message.errorDescription ?? message.error);
        return;
      }

      if (!message.code) {
        setCallbackError("OAuth callback did not include a code.");
        return;
      }
      if (!message.state) {
        setCallbackError("OAuth callback did not include a state.");
        return;
      }

      const callbackKey = `${message.state}:${message.code}`;
      if (handledCallbackKeyRef.current === callbackKey) {
        return;
      }
      handledCallbackKeyRef.current = callbackKey;

      setCallbackError(null);
      void mcp.finishAuthorization(message.code, message.state).then(reportActionResult);
    };

    const handleCallback = (event: MessageEvent<unknown>) => {
      if (event.origin !== window.location.origin || !isOAuthCallbackMessage(event.data)) {
        return;
      }

      finishFromMessage(event.data);
    };
    const channel = new BroadcastChannel(MCP_OAUTH_CALLBACK_CHANNEL);
    channel.onmessage = (event) => {
      if (isOAuthCallbackMessage(event.data)) {
        finishFromMessage(event.data);
      }
    };

    window.addEventListener("message", handleCallback);

    return () => {
      channel.close();
      window.removeEventListener("message", handleCallback);
    };
  }, [mcp, reportActionResult]);

  const resolvedUrl = draft.url.trim();
  const canConnect = canConnectDraft(draft, resolvedUrl);
  const isBusy = isBusyStatus(mcp.status);

  const connectionOptions = useMemo(
    () => createConnectionOptions(draft, resolvedUrl),
    [draft, resolvedUrl],
  );

  const connect = useCallback(() => {
    setActionError(null);
    setCallbackError(null);
    handledCallbackKeyRef.current = null;
    void mcp.connect(connectionOptions).then(reportActionResult);
  }, [connectionOptions, mcp, reportActionResult]);

  const reconnect = useCallback(
    (overrides?: Partial<UseMcpOptions> & { openPopup?: boolean }) => {
      setActionError(null);
      setCallbackError(null);
      handledCallbackKeyRef.current = null;
      const { openPopup, ...optionOverrides } = overrides ?? {};
      void mcp
        .reconnect({
          ...connectionOptions,
          ...optionOverrides,
          ...(openPopup ? { authorizationTarget: "popup" as const } : {}),
        })
        .then(reportActionResult);
    },
    [connectionOptions, mcp, reportActionResult],
  );

  const reauthorize = useCallback(() => {
    setActionError(null);
    setCallbackError(null);
    handledCallbackKeyRef.current = null;
    void mcp
      .reauthorize({ ...connectionOptions, authorizationTarget: "popup" })
      .then(reportActionResult);
  }, [connectionOptions, mcp, reportActionResult]);

  const authorize = useCallback(() => {
    setActionError(null);
    void mcp.authorize({ target: "popup" }).then(reportActionResult);
  }, [mcp, reportActionResult]);

  const choosePreset = (preset: Preset) => {
    setActionError(null);
    setCallbackError(null);
    handledCallbackKeyRef.current = null;
    setDraft(draftFromPreset(preset));
    void mcp.connect({ enabled: false, url: null });
  };

  const submitBearer = useCallback(
    (token: string) => {
      const trimmed = token.trim();
      if (!trimmed) return;
      setDraft((current) => ({ ...current, authMode: "bearer", bearerToken: trimmed }));
      reconnect({ bearerToken: trimmed });
    },
    [reconnect],
  );

  const submitClientId = useCallback(
    (clientId: string) => {
      const trimmed = clientId.trim();
      if (!trimmed) return;
      setDraft((current) => ({ ...current, authMode: "manual-oauth", clientId: trimmed }));
      reconnect({
        oauth: {
          clientId: trimmed,
          clientMetadata: defaultClientMetadata(draft.redirectUrl, draft.scope.trim()),
          redirectUrl: draft.redirectUrl,
        },
        openPopup: true,
      });
    },
    [draft.redirectUrl, draft.scope, reconnect],
  );

  const hasBearerOverride = draft.authMode === "bearer" && Boolean(draft.bearerToken.trim());
  const hasStarted = mcp.status !== "idle";
  const hasProfile = mcp.serverProfile !== null;
  const showResult = hasStarted && (mcp.status === "failed" || !hasProfile);

  return (
    <main className="page">
      <Header />

      <section className="try-block" aria-label="Connect to an MCP server">
        <UrlBar
          canConnect={canConnect}
          isBusy={isBusy}
          onChange={(url) => setDraft({ ...draft, url })}
          onConnect={connect}
          value={draft.url}
        />
        <PresetPills onSelect={choosePreset} selectedId={draft.presetId} />
        <ProxyToggle
          enabled={draft.proxyEnabled}
          onChange={(proxyEnabled) => setDraft({ ...draft, proxyEnabled })}
          selectedId={draft.presetId}
          url={resolvedUrl}
        />
        <ClientMetadataDocumentToggle
          enabled={draft.clientMetadataDocumentEnabled}
          onChange={(clientMetadataDocumentEnabled) =>
            setDraft({ ...draft, clientMetadataDocumentEnabled })
          }
          url={resolvedUrl}
        />
        <OverrideDisclosure
          draft={draft}
          forceOpen={draft.authMode !== "auto"}
          setDraft={setDraft}
        />
        {actionError || callbackError ? (
          <p className="inline-error" role="alert">
            {actionError ?? callbackError}
          </p>
        ) : null}
      </section>

      {showResult ? (
        <ResultPanel
          authorize={authorize}
          draft={draft}
          hasBearerOverride={hasBearerOverride}
          mcp={mcp}
          onSubmitBearer={submitBearer}
          onSubmitClientId={submitClientId}
          resolvedUrl={resolvedUrl}
        />
      ) : !hasStarted ? (
        <EmptyHint />
      ) : null}

      {hasProfile ? (
        <ConnectionProof
          mcp={mcp}
          onForget={() => void mcp.forget()}
          onReauthorize={reauthorize}
          onReconnect={() => reconnect()}
        />
      ) : null}

      <Footer />
    </main>
  );
}

function Header() {
  return (
    <header className="page-header">
      <div className="header-topline">
        <h1>use-mcp-react</h1>
        <a className="github-link" href={repositoryUrl} rel="noreferrer" target="_blank">
          <GithubIcon />
          <span>GitHub</span>
        </a>
      </div>
      <p>
        The hook detects an MCP server&rsquo;s auth requirement and tells your app what UI to
        render.
      </p>
      <nav aria-label="Code links" className="header-links">
        <a href={workerSourceUrl} rel="noreferrer" target="_blank">
          Proxy route code
        </a>
        <a href={proxyDocsUrl} rel="noreferrer" target="_blank">
          Proxy setup docs
        </a>
      </nav>
    </header>
  );
}

function GithubIcon() {
  return (
    <svg aria-hidden="true" className="github-icon" focusable="false" viewBox="0 0 16 16">
      <path
        d="M8 0.2a8 8 0 0 0-2.53 15.59c0.4 0.07 0.55-0.17 0.55-0.39v-1.36c-2.24 0.49-2.71-1.08-2.71-1.08-0.36-0.93-0.89-1.18-0.89-1.18-0.73-0.5 0.06-0.49 0.06-0.49 0.81 0.06 1.23 0.83 1.23 0.83 0.72 1.23 1.88 0.88 2.34 0.67 0.07-0.52 0.28-0.88 0.51-1.08-1.79-0.2-3.67-0.89-3.67-3.98 0-0.88 0.31-1.6 0.83-2.16-0.08-0.2-0.36-1.02 0.08-2.13 0 0 0.68-0.22 2.2 0.83A7.6 7.6 0 0 1 8 3.51c0.68 0 1.36 0.09 2 0.27 1.52-1.05 2.2-0.83 2.2-0.83 0.44 1.11 0.16 1.93 0.08 2.13 0.52 0.56 0.83 1.28 0.83 2.16 0 3.09-1.88 3.77-3.67 3.97 0.29 0.25 0.54 0.74 0.54 1.49v2.7c0 0.22 0.15 0.46 0.55 0.39A8 8 0 0 0 8 0.2Z"
        fill="currentColor"
      />
    </svg>
  );
}

function UrlBar({
  canConnect,
  isBusy,
  onChange,
  onConnect,
  value,
}: {
  canConnect: boolean;
  isBusy: boolean;
  onChange: (url: string) => void;
  onConnect: () => void;
  value: string;
}) {
  return (
    <form
      className="url-bar"
      onSubmit={(event) => {
        event.preventDefault();
        if (canConnect && !isBusy) onConnect();
      }}
    >
      <label className="url-label" htmlFor="mcp-url">
        MCP URL
      </label>
      <div className="url-row">
        <input
          autoComplete="off"
          className="url-input"
          id="mcp-url"
          onChange={(event) => onChange(event.target.value)}
          placeholder="https://mcp.example.com/mcp"
          spellCheck={false}
          value={value}
        />
        <button className="primary" disabled={!canConnect || isBusy} type="submit">
          {isBusy ? "Connecting…" : "Connect"}
        </button>
      </div>
    </form>
  );
}

function PresetPills({
  onSelect,
  selectedId,
}: {
  onSelect: (preset: Preset) => void;
  selectedId: string;
}) {
  return (
    <section className="preset-section" aria-label="Preset MCP servers">
      <div className="preset-pills" role="group">
        <span className="preset-pills-label">Try</span>
        {presets.map((preset) => (
          <button
            aria-pressed={preset.id === selectedId}
            className={preset.id === selectedId ? "preset-pill active" : "preset-pill"}
            key={preset.id}
            onClick={() => onSelect(preset)}
            type="button"
          >
            <span className="preset-pill-name">{preset.name}</span>
            <span className="preset-pill-tag">{preset.tag}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

function ProxyToggle({
  enabled,
  onChange,
  selectedId,
  url,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  selectedId: string;
  url: string;
}) {
  const proxyPath = playgroundMcpTransportProxyFor(url);
  const canProxy = Boolean(proxyPath);
  const selectedPreset = presets.find((preset) => preset.id === selectedId) ?? presets[0];
  const showStripeDirectNote = selectedPreset.id === "stripe" && canProxy && !enabled;

  return (
    <section className="proxy-mode" aria-label="Proxy mode">
      <div className="proxy-toggle-card">
        <div>
          <strong>Transport proxy</strong>
          <p>
            {canProxy
              ? enabled
                ? "On: MCP transport POSTs go through the proxy server route."
                : "Off: the browser calls the MCP transport directly."
              : "Unavailable for this URL. The playground only proxies public HTTPS MCP targets."}
          </p>
        </div>
        <label className="switch">
          <input
            checked={enabled && canProxy}
            disabled={!canProxy}
            onChange={(event) => onChange(event.target.checked)}
            type="checkbox"
          />
          <span className="switch-track" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
          <span className="switch-label">{enabled && canProxy ? "On" : "Off"}</span>
        </label>
      </div>

      {canProxy && enabled ? (
        <div className="proxy-explainer">
          <strong>
            Proxy route: <code>{proxyPath}</code>
          </strong>
          <p>
            {selectedPreset.proxyNote} OAuth discovery, registration, token exchange, and refresh
            stay in the browser; the proxy server route forwards only MCP transport requests with{" "}
            <code>x-mcp-target-url</code>.
          </p>
          <div className="proxy-links">
            <a href={workerSourceUrl} rel="noreferrer" target="_blank">
              <GithubIcon />
              <span>View proxy code</span>
            </a>
            <a href={proxyDocsUrl} rel="noreferrer" target="_blank">
              Proxy docs
            </a>
          </div>
        </div>
      ) : null}

      {showStripeDirectNote ? (
        <p className="proxy-direct-note" role="note">
          Stripe requires a proxy for browser apps because its MCP transport endpoint does not
          expose CORS. Turn the proxy on before connecting.
        </p>
      ) : null}
    </section>
  );
}

function ClientMetadataDocumentToggle({
  enabled,
  onChange,
  url,
}: {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  url: string;
}) {
  const canUseClientMetadataDocument =
    typeof window !== "undefined" &&
    window.location.protocol === "https:" &&
    normalizeHttpsUrl(url) !== null;

  return (
    <section className="proxy-mode" aria-label="Client ID Metadata Document mode">
      <div className="proxy-toggle-card">
        <div>
          <strong>Client ID Metadata Document</strong>
          <p>
            {canUseClientMetadataDocument
              ? enabled
                ? "On: the app publishes a client metadata document URL and passes it as the OAuth client id."
                : "Off: the hook falls back to the server's default OAuth registration strategy."
              : "Available on the deployed HTTPS playground for public HTTPS MCP URLs."}
          </p>
        </div>
        <label className="switch">
          <input
            checked={enabled && canUseClientMetadataDocument}
            disabled={!canUseClientMetadataDocument}
            onChange={(event) => onChange(event.target.checked)}
            type="checkbox"
          />
          <span className="switch-track" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
          <span className="switch-label">
            {enabled && canUseClientMetadataDocument ? "On" : "Off"}
          </span>
        </label>
      </div>

      {enabled && canUseClientMetadataDocument ? (
        <div className="proxy-explainer">
          <strong>
            Metadata route: <code>{clientMetadataDocumentPath}</code>
          </strong>
          <p>
            This route serves public OAuth client metadata for the playground. When the server
            advertises CIMD support, the hook can use this URL instead of dynamic registration.
          </p>
          <div className="proxy-links">
            <a href={workerSourceUrl} rel="noreferrer" target="_blank">
              <GithubIcon />
              <span>View route code</span>
            </a>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function OverrideDisclosure({
  draft,
  forceOpen,
  setDraft,
}: {
  draft: ConnectionDraft;
  forceOpen: boolean;
  setDraft: (draft: ConnectionDraft) => void;
}) {
  const [open, setOpen] = useState(forceOpen);

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  return (
    <details
      className="override"
      onToggle={(event) => setOpen(event.currentTarget.open)}
      open={open}
    >
      <summary>Override detected auth</summary>
      <div className="override-fields">
        <label className="field">
          <span>Auth mode</span>
          <select
            onChange={(event) => setDraft({ ...draft, authMode: event.target.value as AuthMode })}
            value={draft.authMode}
          >
            <option value="auto">Auto — let the library infer</option>
            <option value="bearer">Bearer / API key</option>
            <option value="manual-oauth">Manual OAuth client id</option>
          </select>
        </label>
        {draft.authMode === "bearer" ? (
          <label className="field">
            <span>Bearer token</span>
            <input
              autoComplete="off"
              onChange={(event) => setDraft({ ...draft, bearerToken: event.target.value })}
              placeholder="fc-..., sk-..., or provider token"
              spellCheck={false}
              type="password"
              value={draft.bearerToken}
            />
          </label>
        ) : null}
        {draft.authMode === "manual-oauth" ? (
          <>
            <label className="field">
              <span>OAuth client id</span>
              <input
                onChange={(event) => setDraft({ ...draft, clientId: event.target.value })}
                placeholder="e.g. Google Cloud OAuth client id"
                spellCheck={false}
                value={draft.clientId}
              />
            </label>
            <label className="field">
              <span>Redirect URL</span>
              <input
                onChange={(event) => setDraft({ ...draft, redirectUrl: event.target.value })}
                spellCheck={false}
                value={draft.redirectUrl}
              />
            </label>
            <label className="field">
              <span>Scope (optional)</span>
              <input
                onChange={(event) => setDraft({ ...draft, scope: event.target.value })}
                placeholder="space-separated"
                spellCheck={false}
                value={draft.scope}
              />
            </label>
          </>
        ) : null}
      </div>
    </details>
  );
}

function EmptyHint() {
  return (
    <p className="empty-hint">
      Pick a preset or paste an MCP URL above to detect the auth requirement.
    </p>
  );
}

function ResultPanel({
  authorize,
  draft,
  hasBearerOverride,
  mcp,
  onSubmitBearer,
  onSubmitClientId,
  resolvedUrl,
}: {
  authorize: () => void;
  draft: ConnectionDraft;
  hasBearerOverride: boolean;
  mcp: UseMcpResult;
  onSubmitBearer: (token: string) => void;
  onSubmitClientId: (clientId: string) => void;
  resolvedUrl: string;
}) {
  const verdict = classifyVerdict(mcp);
  const facts = verdictFacts(mcp);
  const steps = buildDiscoverySteps(mcp, resolvedUrl, hasBearerOverride);
  const snippet = pickCodeSnippet(mcp);
  const diagnostics =
    mcp.authDiagnostics && hasAnyDiagnostics(mcp.authDiagnostics) ? mcp.authDiagnostics : null;

  return (
    <section
      aria-label="Inference output"
      className={`result-card verdict-card verdict-${verdict.tone}`}
    >
      <header className="result-head">
        <h2>{verdict.title}</h2>
        <p>{verdict.summary}</p>
      </header>

      <div className="render-card">
        <RenderThisBody
          authorize={authorize}
          draft={draft}
          mcp={mcp}
          onSubmitBearer={onSubmitBearer}
          onSubmitClientId={onSubmitClientId}
        />
      </div>

      <div className="result-disclosures">
        {facts.length > 0 || diagnostics ? (
          <details className="more">
            <summary>Detection details</summary>
            {facts.length > 0 ? (
              <dl className="verdict-facts">
                {facts.map((fact) => (
                  <Fact key={fact.label} label={fact.label} mono={fact.mono} value={fact.value} />
                ))}
              </dl>
            ) : null}
            {diagnostics ? <DiagnosticsBody diagnostics={diagnostics} /> : null}
          </details>
        ) : null}

        <details className="more">
          <summary>Discovery timeline</summary>
          <ol className="discovery-steps">
            {steps.map((step) => (
              <li className={`discovery-step ${step.state}`} key={step.id}>
                <span aria-hidden="true" className="discovery-bullet" />
                <div className="discovery-step-body">
                  <strong>{step.label}</strong>
                  {step.detail ? <span className="discovery-detail">{step.detail}</span> : null}
                </div>
                <span className={`discovery-tag ${step.state}`}>{stepStateLabel(step.state)}</span>
              </li>
            ))}
          </ol>
        </details>

        <details className="more">
          <summary>React snippet — {snippet.title}</summary>
          <pre className="code-block">
            <code>{snippet.body}</code>
          </pre>
        </details>
      </div>
    </section>
  );
}

function RenderThisBody({
  authorize,
  draft,
  mcp,
  onSubmitBearer,
  onSubmitClientId,
}: {
  authorize: () => void;
  draft: ConnectionDraft;
  mcp: UseMcpResult;
  onSubmitBearer: (token: string) => void;
  onSubmitClientId: (clientId: string) => void;
}) {
  if (mcp.status === "connecting" || mcp.status === "loading" || mcp.status === "reconnecting") {
    return (
      <div className="render-loading">
        <span aria-hidden="true" className="spinner" />
        <span>{statusLabels[mcp.status]}…</span>
      </div>
    );
  }

  if (mcp.status === "ready") {
    return (
      <div className="render-ready">
        <span aria-hidden="true" className="render-check">
          ✓
        </span>
        <div>
          <strong>Connected.</strong>
          <p>No auth UI needed.</p>
        </div>
      </div>
    );
  }

  if (mcp.status === "failed") {
    return (
      <div className="render-failed">
        <strong>Connection failed.</strong>
        <p>{mcp.error?.message ?? "The hook reported a failure before classifying auth."}</p>
      </div>
    );
  }

  const requirement = mcp.authRequirement;

  if (requirement?.type === "oauth") {
    const strategyLabel = oauthRegistrationStrategyLabel(
      mcp.authDiagnostics?.registrationStrategy,
      requirement.supportsDynamicClientRegistration,
      requirement.supportsClientMetadataDocument,
    );

    return (
      <div className="render-oauth">
        <button className="primary" onClick={authorize} type="button">
          Authorize with OAuth
        </button>
        <p>PKCE + {strategyLabel}.</p>
      </div>
    );
  }

  if (requirement?.type === "bearer") {
    return <BearerForm initialValue={draft.bearerToken} onSubmit={onSubmitBearer} />;
  }

  if (requirement?.type === "manual_oauth_client") {
    return <ClientIdForm initialValue={draft.clientId} onSubmit={onSubmitClientId} />;
  }

  return (
    <div className="render-idle">
      <p>Waiting for discovery to complete…</p>
    </div>
  );
}

function BearerForm({
  initialValue,
  onSubmit,
}: {
  initialValue: string;
  onSubmit: (token: string) => void;
}) {
  return (
    <CredentialForm
      buttonLabel="Connect"
      id="render-bearer"
      initialValue={initialValue}
      inputProps={{ autoComplete: "off", type: "password" }}
      label="API key / Bearer token"
      onSubmit={onSubmit}
      placeholder="paste token"
    />
  );
}

function ClientIdForm({
  initialValue,
  onSubmit,
}: {
  initialValue: string;
  onSubmit: (clientId: string) => void;
}) {
  return (
    <CredentialForm
      buttonLabel="Authorize"
      id="render-client-id"
      initialValue={initialValue}
      label="OAuth client id"
      onSubmit={onSubmit}
      placeholder="client id from the auth server"
    />
  );
}

function CredentialForm({
  buttonLabel,
  id,
  initialValue,
  inputProps = {},
  label,
  onSubmit,
  placeholder,
}: {
  buttonLabel: string;
  id: string;
  initialValue: string;
  inputProps?: Pick<React.InputHTMLAttributes<HTMLInputElement>, "autoComplete" | "type">;
  label: string;
  onSubmit: (value: string) => void;
  placeholder: string;
}) {
  const [value, setValue] = useState(initialValue);

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  return (
    <form
      className="render-form"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit(value);
      }}
    >
      <label htmlFor={id}>{label}</label>
      <input
        {...inputProps}
        id={id}
        onChange={(event) => setValue(event.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        value={value}
      />
      <button className="primary" disabled={!value.trim()} type="submit">
        {buttonLabel}
      </button>
    </form>
  );
}

function DiagnosticsBody({ diagnostics }: { diagnostics: McpAuthDiagnostics }) {
  return (
    <dl className="verdict-facts diagnostics-list">
      {diagnostics.issuer ? <Fact label="issuer" value={diagnostics.issuer} /> : null}
      {diagnostics.resourceMetadataUrl ? (
        <Fact label="resource md" value={diagnostics.resourceMetadataUrl} />
      ) : null}
      {diagnostics.authorizationServerMetadataUrl ? (
        <Fact label="as md" value={diagnostics.authorizationServerMetadataUrl} />
      ) : null}
      {diagnostics.registrationStrategy ? (
        <Fact label="registration" value={diagnostics.registrationStrategy} mono />
      ) : null}
      {diagnostics.scopes && diagnostics.scopes.length > 0 ? (
        <Fact label="scopes" value={diagnostics.scopes.join(", ")} />
      ) : null}
    </dl>
  );
}

function ConnectionProof({
  mcp,
  onForget,
  onReauthorize,
  onReconnect,
}: {
  mcp: UseMcpResult;
  onForget: () => void;
  onReauthorize: () => void;
  onReconnect: () => void;
}) {
  const profile = mcp.serverProfile;
  if (!profile) return null;

  const serverName =
    profile.initialize?.serverInfo?.title ??
    profile.initialize?.serverInfo?.name ??
    "Connected MCP server";
  const capabilities = Object.entries(profile.initialize?.capabilities ?? {})
    .filter(([, value]) => Boolean(value))
    .map(([key]) => key);
  const isReady = mcp.status === "ready";
  const catalogSummary = formatCatalogSummary(mcp);

  return (
    <section aria-label="Connection proof of life" className="proof">
      <header className="proof-header">
        <div className="proof-identity">
          <h2>{serverName}</h2>
          <p className="proof-meta">
            <span className="proof-url">{profile.url}</span>
            {profile.initialize?.serverInfo?.version
              ? ` · v${profile.initialize.serverInfo.version}`
              : ""}
          </p>
        </div>
        <div className="proof-actions">
          <button onClick={onReconnect} type="button">
            Reconnect
          </button>
          <button onClick={onReauthorize} type="button">
            Reauthorize
          </button>
          <button onClick={onForget} type="button">
            Forget
          </button>
        </div>
      </header>

      <dl className="proof-facts">
        <Fact label="status" value={statusLabels[mcp.status]} mono />
        <Fact label="protocol" value={profile.initialize?.protocolVersion ?? "—"} mono />
        <Fact
          label="transport"
          value={`${profile.transport.kind} · ${profile.transport.sessionMode}`}
          mono
        />
        <Fact label="auth mode" value={profile.auth.mode} mono />
        <Fact label="capabilities" value={capabilities.length ? capabilities.join(", ") : "none"} />
        <Fact
          label="catalog"
          value={
            isReady && mcp.catalogStatus === "partial"
              ? "partial — some lists failed"
              : mcp.catalogStatus
          }
          mono
        />
      </dl>

      {profile.initialize?.instructions ? (
        <p className="proof-instructions">{profile.initialize.instructions}</p>
      ) : null}

      <McpAppsProof mcp={mcp} />

      <details className="more">
        <summary>Catalog{catalogSummary ? ` — ${catalogSummary}` : ""}</summary>
        <CatalogList
          prompts={mcp.prompts.map((prompt) => ({
            description: prompt.description,
            name: prompt.name,
          }))}
          resources={mcp.resources.map((resource) => ({
            description: resource.description,
            name: resource.name,
          }))}
          templates={mcp.resourceTemplates.map((template) => ({
            description: template.description,
            name: template.name ?? template.uriTemplate,
          }))}
          tools={mcp.tools.map((tool) => ({
            description: tool.description,
            name: tool.title ?? tool.name,
          }))}
        />
      </details>

      <details className="more">
        <summary>Raw serverProfile JSON</summary>
        <pre className="proof-raw">{JSON.stringify(profile, null, 2)}</pre>
      </details>
    </section>
  );
}

function McpAppsProof({ mcp }: { mcp: UseMcpResult }) {
  const appTools = useMemo(
    () =>
      mcp.tools
        .map((tool) => {
          const uri = getMcpAppResourceUri(tool);
          return uri
            ? {
                name: tool.title ?? tool.name,
                tool,
                uri,
              }
            : null;
        })
        .filter((tool): tool is NonNullable<typeof tool> => tool !== null),
    [mcp.tools],
  );
  const [selectedUri, setSelectedUri] = useState<string | undefined>();

  const selectedApp = appTools.find((tool) => tool.uri === selectedUri) ?? appTools[0] ?? undefined;

  useEffect(() => {
    if (selectedUri && !appTools.some((tool) => tool.uri === selectedUri)) {
      setSelectedUri(undefined);
    }
  }, [appTools, selectedUri]);

  if (!mcp.client || !selectedApp) {
    return null;
  }

  return (
    <section aria-label="MCP Apps" className="mcp-apps-proof">
      <header className="mcp-apps-proof-header">
        <div>
          <h3>MCP Apps</h3>
          <p>
            Rendering <code>{selectedApp.uri}</code> through the connected MCP client.
          </p>
        </div>
        {appTools.length > 1 ? (
          <div className="mcp-app-picker" role="group">
            {appTools.map((appTool) => (
              <button
                aria-pressed={appTool.uri === selectedApp.uri}
                key={appTool.uri}
                onClick={() => setSelectedUri(appTool.uri)}
                type="button"
              >
                {appTool.name}
              </button>
            ))}
          </div>
        ) : null}
      </header>
      <McpAppView
        className="mcp-app-frame"
        client={mcp.client}
        title={`${selectedApp.name} MCP App`}
        tools={mcp.tools}
        uri={selectedApp.uri}
      />
    </section>
  );
}

type CatalogEntry = {
  description?: string;
  name: string;
};

function CatalogList({
  prompts,
  resources,
  templates,
  tools,
}: {
  prompts: CatalogEntry[];
  resources: CatalogEntry[];
  templates: CatalogEntry[];
  tools: CatalogEntry[];
}) {
  const columns: { items: CatalogEntry[]; title: string }[] = [
    { items: tools, title: "Tools" },
    { items: resources, title: "Resources" },
    { items: templates, title: "Templates" },
    { items: prompts, title: "Prompts" },
  ];

  return (
    <div className="catalog-grid">
      {columns.map((column) => (
        <CatalogColumn entries={column.items} key={column.title} title={column.title} />
      ))}
    </div>
  );
}

function CatalogColumn({ entries, title }: { entries: CatalogEntry[]; title: string }) {
  const visible = entries.slice(0, 25);
  const remaining = entries.length - visible.length;

  return (
    <section className="catalog-column">
      <h3>
        {title}
        <span className="catalog-count">{entries.length}</span>
      </h3>
      {visible.length === 0 ? (
        <p className="catalog-empty">Empty</p>
      ) : (
        <ul>
          {visible.map((entry) => (
            <li key={entry.name}>
              <strong>{entry.name}</strong>
              {entry.description ? <span>{entry.description}</span> : null}
            </li>
          ))}
          {remaining > 0 ? <li className="catalog-more">+{remaining} more</li> : null}
        </ul>
      )}
    </section>
  );
}

function Fact({ label, mono, value }: { label: string; mono?: boolean; value: string }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd className={mono ? "mono" : undefined}>{value}</dd>
    </div>
  );
}

function Footer() {
  return (
    <footer className="page-footer">
      <p>
        Remote presets use the proxy server route for MCP transport; OAuth stays in the browser.{" "}
        <a href={workerSourceUrl} rel="noreferrer" target="_blank">
          View the code
        </a>
        .
      </p>
    </footer>
  );
}

function verdictFacts(mcp: UseMcpResult): VerdictFact[] {
  const requirement = mcp.authRequirement;
  const profile = mcp.serverProfile;
  const facts: VerdictFact[] = [];

  if (requirement === null) {
    facts.push({ label: "type", mono: true, value: profile?.auth.mode === "none" ? "null" : "—" });
  } else {
    facts.push({ label: "type", mono: true, value: `"${requirement.type}"` });
  }

  if (requirement?.type === "oauth") {
    facts.push(
      {
        label: "DCR",
        value: requirement.supportsDynamicClientRegistration ? "yes" : "no",
      },
      {
        label: "CIMD",
        value: requirement.supportsClientMetadataDocument ? "yes" : "no",
      },
      { label: "issuer", value: requirement.issuer ?? "—" },
      { label: "scopes", value: formatScopes(requirement.scopes) },
    );
  } else if (requirement?.type === "bearer") {
    facts.push(
      { label: "realm", value: requirement.realm ?? "—" },
      { label: "scopes", value: formatScopes(requirement.scopes) },
      { label: "reason", mono: true, value: requirement.reason },
    );
  } else if (requirement?.type === "manual_oauth_client") {
    facts.push(
      { label: "issuer", value: requirement.issuer ?? "—" },
      { label: "reason", mono: true, value: requirement.reason },
      { label: "fields", mono: true, value: requirement.suggestedFields.join(", ") },
    );
  }

  return facts;
}

function hasAnyDiagnostics(diagnostics: McpAuthDiagnostics): boolean {
  return Boolean(
    diagnostics.issuer ||
    diagnostics.resourceMetadataUrl ||
    diagnostics.authorizationServerMetadataUrl ||
    diagnostics.registrationStrategy ||
    (diagnostics.scopes && diagnostics.scopes.length > 0),
  );
}

function formatCatalogSummary(mcp: UseMcpResult): string {
  const parts: string[] = [];
  if (mcp.tools.length) parts.push(`${mcp.tools.length} tool${mcp.tools.length === 1 ? "" : "s"}`);
  if (mcp.resources.length) {
    parts.push(`${mcp.resources.length} resource${mcp.resources.length === 1 ? "" : "s"}`);
  }
  if (mcp.resourceTemplates.length) {
    parts.push(
      `${mcp.resourceTemplates.length} template${mcp.resourceTemplates.length === 1 ? "" : "s"}`,
    );
  }
  if (mcp.prompts.length) {
    parts.push(`${mcp.prompts.length} prompt${mcp.prompts.length === 1 ? "" : "s"}`);
  }
  return parts.join(" · ");
}

function buildDiscoverySteps(
  mcp: UseMcpResult,
  resolvedUrl: string,
  hasBearerOverride: boolean,
): DiscoveryStep[] {
  const {
    authDiagnostics: diag,
    authRequirement: req,
    error,
    serverProfile: profile,
    status,
  } = mcp;
  const hasStarted = status !== "idle" && resolvedUrl.length > 0;
  const noAuthSucceeded = profile?.auth.mode === "none" || (status === "ready" && req === null);
  const failedEarly = status === "failed" && !profile && !diag;

  const reachStep: DiscoveryStep = {
    detail: resolvedUrl || undefined,
    id: "endpoint",
    label: "Reach endpoint",
    state: !resolvedUrl
      ? "pending"
      : status === "idle"
        ? "pending"
        : status === "connecting" && !diag && !profile
          ? "active"
          : failedEarly
            ? "error"
            : "done",
  };

  let probeState: StepState = "pending";
  let probeDetail: string | undefined;
  if (!hasStarted) {
    probeState = "pending";
  } else if (hasBearerOverride) {
    probeState = "skipped";
    probeDetail = "Bearer token supplied — OAuth discovery skipped";
  } else if (status === "connecting" && !diag && !req && !profile) {
    probeState = "active";
  } else if (noAuthSucceeded) {
    probeState = "done";
    probeDetail = "Server accepted the unauthenticated request";
  } else if (req?.type === "bearer") {
    probeState = "done";
    probeDetail = "Server returned 401 — Bearer scheme, no MCP OAuth metadata";
  } else if (req || diag) {
    probeState = "done";
    probeDetail = "Server returned 401 — auth required";
  } else if (failedEarly) {
    probeState = "error";
    probeDetail = error?.message ?? "Probe failed before classification";
  }

  let resourceState: StepState = "pending";
  let resourceDetail: string | undefined;
  if (hasBearerOverride) {
    resourceState = "skipped";
  } else if (req?.type === "bearer") {
    resourceState = "skipped";
    resourceDetail = "No /.well-known/oauth-protected-resource advertised";
  } else if (noAuthSucceeded) {
    resourceState = "skipped";
    resourceDetail = "No auth required";
  } else if (diag?.resourceMetadataUrl) {
    resourceState = "done";
    resourceDetail = diag.resourceMetadataUrl;
  } else if (
    diag?.authorizationServerMetadataUrl ||
    diag?.registrationStrategy ||
    req?.type === "manual_oauth_client"
  ) {
    resourceState = "skipped";
    resourceDetail = "Server didn't advertise Protected Resource Metadata";
  } else if (probeState === "done") {
    resourceState = "active";
  }

  let asState: StepState = "pending";
  let asDetail: string | undefined;
  if (hasBearerOverride) {
    asState = "skipped";
  } else if (req?.type === "bearer") {
    asState = "skipped";
  } else if (noAuthSucceeded) {
    asState = "skipped";
  } else if (diag?.authorizationServerMetadataUrl) {
    asState = "done";
    asDetail = diag.issuer ?? diag.authorizationServerMetadataUrl;
  } else if (req?.type === "manual_oauth_client" && req.issuer) {
    asState = "done";
    asDetail = req.issuer;
  } else if (resourceState === "done") {
    asState = "active";
  }

  let strategyState: StepState = "pending";
  let strategyDetail: string | undefined;
  if (hasBearerOverride) {
    strategyState = "skipped";
  } else if (req?.type === "bearer") {
    strategyState = "skipped";
  } else if (noAuthSucceeded) {
    strategyState = "skipped";
  } else if (req?.type === "manual_oauth_client") {
    strategyState = "done";
    strategyDetail = "Manual client id required (DCR + CIMD unavailable)";
  } else if (diag?.registrationStrategy) {
    strategyState = "done";
    strategyDetail = registrationStrategyLabel(diag.registrationStrategy);
  } else if (asState === "done") {
    strategyState = "active";
  }

  return [
    reachStep,
    { detail: probeDetail, id: "probe", label: "No-auth probe", state: probeState },
    {
      detail: resourceDetail,
      id: "resource-metadata",
      label: "Resource metadata",
      state: resourceState,
    },
    {
      detail: asDetail,
      id: "authorization-server",
      label: "Authorization server",
      state: asState,
    },
    { detail: strategyDetail, id: "strategy", label: "Pick strategy", state: strategyState },
  ];
}

function registrationStrategyLabel(
  strategy: NonNullable<McpAuthDiagnostics["registrationStrategy"]>,
): string {
  switch (strategy) {
    case "client_id":
      return "Pre-registered client id";
    case "client_metadata_url":
      return "Client ID Metadata Document";
    case "dynamic_client_registration":
      return "Dynamic Client Registration";
  }
}

function oauthRegistrationStrategyLabel(
  strategy: McpAuthDiagnostics["registrationStrategy"] | undefined,
  supportsDynamicClientRegistration: boolean,
  supportsClientMetadataDocument: boolean,
): string {
  if (strategy === "client_id") {
    return "pre-registered client id";
  }
  if (strategy === "client_metadata_url") {
    return "Client ID Metadata Document";
  }
  if (strategy === "dynamic_client_registration") {
    return "Dynamic Client Registration";
  }
  if (supportsDynamicClientRegistration) {
    return "Dynamic Client Registration";
  }
  if (supportsClientMetadataDocument) {
    return "Client ID Metadata Document";
  }

  return "pre-registered client id";
}

function stepStateLabel(state: StepState): string {
  switch (state) {
    case "pending":
      return "Pending";
    case "active":
      return "In flight";
    case "done":
      return "Done";
    case "skipped":
      return "Skipped";
    case "error":
      return "Error";
  }
}

type VerdictTone = "open" | "oauth" | "bearer" | "manual" | "unknown" | "failed";

function classifyVerdict(mcp: UseMcpResult): {
  summary: string;
  title: string;
  tone: VerdictTone;
} {
  if (mcp.status === "failed") {
    return {
      summary: mcp.error?.message ?? "Discovery failed before producing a verdict.",
      title: "Discovery failed",
      tone: "failed",
    };
  }

  if (mcp.authRequirement?.type === "oauth") {
    return {
      summary: "OAuth 2.1 with PKCE. Show an authorize button.",
      title: "OAuth required",
      tone: "oauth",
    };
  }

  if (mcp.authRequirement?.type === "bearer") {
    return {
      summary: "Bearer / API key. Collect a token from the user.",
      title: "Bearer token required",
      tone: "bearer",
    };
  }

  if (mcp.authRequirement?.type === "manual_oauth_client") {
    return {
      summary: "OAuth without DCR or CIMD. Ask for a pre-registered client id.",
      title: "Manual OAuth client id",
      tone: "manual",
    };
  }

  if (mcp.serverProfile?.auth.mode === "none" || mcp.status === "ready") {
    return {
      summary: "Server accepts unauthenticated requests.",
      title: "No auth required",
      tone: "open",
    };
  }

  return {
    summary: "Probing the endpoint…",
    title: "Working…",
    tone: "unknown",
  };
}

function pickCodeSnippet(mcp: UseMcpResult): { body: string; title: string } {
  if (mcp.status === "ready" || mcp.authRequirement === null) {
    return {
      body: `const mcp = useMcp({ url });

if (mcp.status === "ready") {
  return <App client={mcp.client} tools={mcp.tools} />;
}`,
      title: "No auth branch",
    };
  }

  if (mcp.authRequirement?.type === "oauth") {
    return {
      body: `if (mcp.authRequirement?.type === "oauth") {
  return (
    <button
      onClick={() => mcp.authorize({ target: "popup" })}
    >
      Authorize
    </button>
  );
}`,
      title: "OAuth branch",
    };
  }

  if (mcp.authRequirement?.type === "bearer") {
    return {
      body: `if (mcp.authRequirement?.type === "bearer") {
  return (
    <ApiKeyForm
      onSubmit={(bearerToken) =>
        mcp.reconnect({ bearerToken })
      }
    />
  );
}`,
      title: "Bearer branch",
    };
  }

  return {
    body: `if (mcp.authRequirement?.type === "manual_oauth_client") {
  return (
    <ClientIdForm
      onSubmit={(clientId) =>
        mcp.reconnect({
          oauth: { clientId },
          authorizationTarget: "popup",
        })
      }
    />
  );
}`,
    title: "Manual OAuth branch",
  };
}

function draftFromPreset(preset: Preset): ConnectionDraft {
  return {
    authMode: preset.authMode,
    bearerToken: "",
    clientMetadataDocumentEnabled: false,
    clientId: "",
    presetId: preset.id,
    proxyEnabled: true,
    redirectUrl: defaultRedirectUrl,
    scope: "",
    url: preset.url,
  };
}

function createConnectionOptions(draft: ConnectionDraft, resolvedUrl: string): UseMcpOptions {
  const oauth = createOAuthOptions(draft);

  return {
    ...(draft.authMode === "bearer" && draft.bearerToken.trim()
      ? { bearerToken: draft.bearerToken.trim() }
      : {}),
    clientCapabilities: createMcpAppClientCapabilities(),
    enabled: Boolean(resolvedUrl),
    ...(oauth ? { oauth } : {}),
    ...appOwnedTransportProxyOptions(resolvedUrl, draft.proxyEnabled),
    url: resolvedUrl || null,
  };
}

function appOwnedTransportProxyOptions(
  resolvedUrl: string,
  proxyEnabled: boolean,
): Pick<UseMcpOptions, "transportProxy"> {
  if (!proxyEnabled) {
    return {};
  }

  const transportProxy = playgroundMcpTransportProxyFor(resolvedUrl);

  if (transportProxy) {
    return { transportProxy };
  }

  return {};
}

function createOAuthOptions(draft: ConnectionDraft): UseMcpOptions["oauth"] | undefined {
  if (draft.clientMetadataDocumentEnabled) {
    return {
      clientMetadata: defaultClientMetadata(draft.redirectUrl, draft.scope.trim()),
      ...(window.location.protocol === "https:"
        ? { clientMetadataUrl: `${window.location.origin}${clientMetadataDocumentPath}` }
        : {}),
      redirectUrl: draft.redirectUrl,
    };
  }

  if (draft.authMode === "manual-oauth") {
    const clientId = draft.clientId.trim();
    const scope = draft.scope.trim();

    return {
      ...(clientId ? { clientId } : {}),
      clientMetadata: defaultClientMetadata(draft.redirectUrl, scope),
      redirectUrl: draft.redirectUrl,
    };
  }

  return undefined;
}

function normalizeHttpsUrl(url: string): URL | null {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

function defaultClientMetadata(redirectUrl: string, scope: string) {
  return {
    client_name: "use-mcp-react playground",
    grant_types: ["authorization_code", "refresh_token"],
    redirect_uris: [redirectUrl],
    response_types: ["code"],
    ...(scope ? { scope } : {}),
    token_endpoint_auth_method: "none",
  };
}

function canConnectDraft(draft: ConnectionDraft, resolvedUrl: string): boolean {
  if (!resolvedUrl) return false;
  if (draft.authMode === "bearer") return Boolean(draft.bearerToken.trim());
  if (draft.authMode === "manual-oauth") return Boolean(draft.clientId.trim());
  return true;
}

function isBusyStatus(status: UseMcpStatus): boolean {
  return (
    status === "connecting" ||
    status === "authenticating" ||
    status === "loading" ||
    status === "reconnecting"
  );
}

function formatScopes(scopes: string[] | undefined): string {
  if (!scopes || scopes.length === 0) return "—";
  return scopes.join(" ");
}

function isOAuthCallbackMessage(value: unknown): value is McpOAuthCallbackMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    value.type === "use-mcp-react:oauth-callback"
  );
}

function formatActionResult(result: McpActionResult): string | null {
  if (result.ok) return null;
  if (result.reason === "failed") return result.error.message;
  return result.reason.replaceAll("_", " ");
}

const rootElement = document.getElementById("root");
if (rootElement) {
  const root = window.__USE_MCP_REACT_PLAYGROUND_ROOT__ ?? createRoot(rootElement);
  window.__USE_MCP_REACT_PLAYGROUND_ROOT__ = root;
  root.render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

declare global {
  interface Window {
    __USE_MCP_REACT_PLAYGROUND_ROOT__?: Root;
  }
}
