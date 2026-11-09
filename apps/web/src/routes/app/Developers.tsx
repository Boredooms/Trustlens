import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Plug } from "lucide-react";
import { browserDeviceName, connectExtension, detectExtension, type ExtensionPresence } from "@/lib/extension";
import { qk } from "@/lib/query/keys";
import { cn } from "@/lib/utils/cn";
import { PageHeader } from "@/components/layout/PageHeader";
import { StatusPill } from "@/components/domain/Badges";
import { PairedDevices } from "@/components/domain/PairedDevices";
import { UsagePanel } from "@/components/domain/UsagePanel";
import { CopyButton, TimeText } from "@/components/domain/Text";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Input } from "@/components/ui/Field";
import { Modal } from "@/components/ui/Overlay";
import { SkeletonRows } from "@/components/ui/Skeleton";
import { EmptyState, ErrorState } from "@/components/ui/States";
import { Table, Td, Th, Tr } from "@/components/ui/Table";
import {
  useApiKeys,
  useCreateApiKey,
  usePairExtension,
  useRevokeApiKey,
} from "@/lib/query/hooks";
import { listData } from "@/lib/api/endpoints";
import type { ApiKey, ApiKeyCreated, PairingCode } from "@/lib/api/types";

// AUTHENTICATION_AUTHORIZATION.md §6.2 — default new key: assess:read + scan:write.
const SCOPES = [
  ["assess:read", "Assess and read scans"],
  ["scan:write", "Start scans"],
  ["reports:write", "Submit reports"],
  ["identity:read", "Verify identity, read public profiles"],
  ["payments:read", "Verify payees"],
  ["investigations:read", "Read investigations"],
  ["investigations:write", "Start investigations"],
] as const;

function CreateKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const create = useCreateApiKey();
  const [name, setName] = useState("");
  const [scopes, setScopes] = useState<string[]>(["assess:read", "scan:write"]);
  const [stored, setStored] = useState(false);
  const [touched, setTouched] = useState(false);
  const created: ApiKeyCreated | undefined = create.data;
  const nameError = name.trim().length < 2 ? "Give the key a name of at least 2 characters." : null;
  const scopeError = scopes.length === 0 ? "Choose at least one scope." : null;

  const close = (o: boolean) => {
    if (!o && created && !stored) return; // the secret is shown once; require acknowledgement
    onOpenChange(o);
    if (!o) {
      create.reset();
      setName("");
      setStored(false);
      setTouched(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={close}
      dismissable={!created || stored}
      title={created ? "Store this key now" : "Create API key"}
      description={created ? "This is the only time the secret is shown. TrustLens stores only a hash." : "Keys are for servers. Never put one in a browser bundle."}
      footer={
        created ? (
          <Button variant="primary" disabled={!stored} onClick={() => close(false)}>
            Done
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={create.isPending}
              onClick={() => {
                setTouched(true);
                if (nameError || scopeError) return;
                create.mutate({ name: name.trim(), scopes });
              }}
            >
              Create key
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div className="flex flex-col gap-4">
          <div className="rounded-md border border-border bg-surface-secondary p-3">
            <p className="break-all font-mono text-sm">{created.secret}</p>
            <div className="mt-2 flex justify-end">
              <CopyButton value={created.secret} label="Copy secret" />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={stored} onChange={(e) => setStored(e.target.checked)} className="h-4 w-4" />
            I have stored this secret somewhere safe
          </label>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          <Field label="Name" required error={touched ? nameError : null} help="For example: checkout server.">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <fieldset>
            <legend className="text-xs font-medium">Scopes</legend>
            <ul className="mt-2 flex flex-col gap-2">
              {SCOPES.map(([s, label]) => (
                <li key={s}>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="h-4 w-4"
                      checked={scopes.includes(s)}
                      onChange={(e) => setScopes((prev) => (e.target.checked ? [...prev, s] : prev.filter((x) => x !== s)))}
                    />
                    <span className="font-mono text-xs">{s}</span>
                    <span className="text-muted-strong">{label}</span>
                  </label>
                </li>
              ))}
            </ul>
            {touched && scopeError ? <p className="mt-2 text-xs text-danger">{scopeError}</p> : null}
          </fieldset>
          {create.isError ? <ErrorState error={create.error} title="The key was not created" compact /> : null}
        </div>
      )}
    </Modal>
  );
}

function RevokeKeyDialog({ apiKey, onClose }: { apiKey: ApiKey | null; onClose: () => void }) {
  const revoke = useRevokeApiKey();
  return (
    <Modal
      open={apiKey !== null}
      onOpenChange={(o) => {
        if (!o) {
          revoke.reset();
          onClose();
        }
      }}
      dismissable={!revoke.isPending}
      title="Revoke this key?"
      description={
        apiKey
          ? `Requests signed with ${apiKey.prefix}… stop working immediately. This cannot be undone.`
          : undefined
      }
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={revoke.isPending}>
            Keep key
          </Button>
          <Button
            variant="danger"
            loading={revoke.isPending}
            onClick={() => apiKey && revoke.mutate(apiKey.id, { onSuccess: onClose })}
          >
            Revoke key
          </Button>
        </>
      }
    >
      {revoke.isError ? <ErrorState error={revoke.error} title="The key was not revoked" compact /> : <p className="text-sm">{apiKey?.name}</p>}
    </Modal>
  );
}

function ApiKeys() {
  const q = useApiKeys();
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);
  const rows = listData(q.data);
  return (
    <Card
      title={
        <span className="flex items-center gap-2">
          <KeyRound aria-hidden className="h-4 w-4" strokeWidth={1.5} />
          API keys
        </span>
      }
      actions={
        <Button size="sm" variant="primary" onClick={() => setCreating(true)}>
          Create key
        </Button>
      }
      bodyClassName="p-0"
    >
      {q.isPending ? (
        <div className="p-5">
          <SkeletonRows rows={2} label="Loading API keys" />
        </div>
      ) : q.isError ? (
        <ErrorState className="m-5" error={q.error} title="We could not load API keys" onRetry={() => void q.refetch()} retrying={q.isFetching} />
      ) : rows.length === 0 ? (
        <EmptyState className="px-5" title="No API keys" description="Create a key to call /assess from your server or the TrustLens SDK." />
      ) : (
        <Table caption="API keys">
          <thead>
            <tr>
              <Th>Name</Th>
              <Th>Prefix</Th>
              <Th className="hidden lg:table-cell">Scopes</Th>
              <Th className="hidden md:table-cell">Last used</Th>
              <Th align="right">
                <span className="sr-only">Actions</span>
              </Th>
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => (
              <Tr key={k.id}>
                <Td>{k.name}</Td>
                <Td className="font-mono text-xs">{k.prefix}</Td>
                <Td className="hidden font-mono text-xs text-muted-strong lg:table-cell">{k.scopes.join(", ")}</Td>
                <Td className="hidden text-muted-strong md:table-cell">
                  <TimeText iso={k.last_used_at} />
                </Td>
                <Td align="right">
                  {k.revoked_at ? (
                    <StatusPill status="revoked" />
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => setRevoking(k)}>
                      Revoke
                    </Button>
                  )}
                </Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      <CreateKeyDialog open={creating} onOpenChange={setCreating} />
      <RevokeKeyDialog apiKey={revoking} onClose={() => setRevoking(null)} />
    </Card>
  );
}

function useCountdown(expiresAt: string | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [expiresAt]);
  if (!expiresAt) return 0;
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - now) / 1000));
}

function PairingCodeView({ code }: { code: PairingCode }) {
  // Prefer the server's absolute expiry; fall back to expires_in from receipt.
  const [fallbackExpiry] = useState(() => new Date(Date.now() + code.expires_in * 1000).toISOString());
  const left = useCountdown(code.expires_at || fallbackExpiry);
  const mm = String(Math.floor(left / 60)).padStart(2, "0");
  const ss = String(left % 60).padStart(2, "0");
  return (
    <div className="flex flex-col gap-3 rounded-md border border-border bg-surface-secondary p-5">
      <p className="text-xs text-muted">Enter this code in the extension popup (“Have a code? Enter it instead”)</p>
      <p className="font-mono tabular text-4xl font-medium tracking-widest" aria-live="polite">
        {left > 0 ? code.code : "Expired"}
      </p>
      <p className="font-mono tabular text-sm text-muted-strong" aria-live="off">
        {left > 0 ? `Expires in ${mm}:${ss}` : "This code expired. Generate a new one."}
      </p>
      {left > 0 ? <CopyButton value={code.code} label="Copy code" className="self-start" /> : null}
    </div>
  );
}

const CONNECT_ERRORS: Record<string, string> = {
  INVALID_CODE: "The extension rejected the code (it may have expired). Try again.",
  PAIR_FAILED: "The extension could not reach the TrustLens server. Check that the API is running and try again.",
  EXTENSION_TIMEOUT: "The extension did not answer. Reload this page after installing or updating the extension.",
  FORBIDDEN: "This build of the extension is configured for a different dashboard address.",
};

type ConnectState = "idle" | "connecting" | "connected" | "error";

/**
 * One-click connect: generate a code over the signed-in session and hand it straight to the
 * extension through its dashboard bridge. Arriving from the extension popup (?connect=extension)
 * starts it automatically. Manual codes remain available for browsers where the bridge cannot run.
 */
function ExtensionPairing() {
  const pair = usePairExtension();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [deviceName, setDeviceName] = useState(browserDeviceName);
  const [presence, setPresence] = useState<ExtensionPresence | null>(null);
  const [state, setState] = useState<ConnectState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [showManual, setShowManual] = useState(false);
  const autoStarted = useRef(false);

  useEffect(() => {
    let alive = true;
    void detectExtension().then((p) => alive && setPresence(p));
    return () => {
      alive = false;
    };
  }, []);

  const connect = useCallback(async () => {
    setState("connecting");
    setError(null);
    try {
      const code = await pair.mutateAsync(deviceName.trim() || browserDeviceName());
      const outcome = await connectExtension(code.code, deviceName.trim() || browserDeviceName());
      if (outcome.ok) {
        setState("connected");
        setPresence((p) => (p ? { ...p, paired: true } : p));
        void qc.invalidateQueries({ queryKey: qk.devices });
      } else {
        setState("error");
        setError(CONNECT_ERRORS[outcome.code] ?? `The extension could not connect (${outcome.code}).`);
      }
    } catch {
      setState("error"); // the pairing request itself failed; ErrorState below shows why
    }
  }, [deviceName, pair, qc]);

  useEffect(() => {
    if (autoStarted.current || params.get("connect") !== "extension" || !presence?.installed) return;
    autoStarted.current = true;
    const next = new URLSearchParams(params);
    next.delete("connect");
    setParams(next, { replace: true });
    void connect();
  }, [params, presence, connect, setParams]);

  return (
    <Card
      title="Browser extension"
      description="Real-time protection on every site you open. The server decides; the extension shows it."
      icon={Plug}
    >
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 text-sm" role="status">
            <span
              aria-hidden
              className={cn(
                "h-2 w-2 rounded-full",
                presence === null ? "bg-border-strong" : presence.installed ? (presence.paired || state === "connected" ? "bg-success" : "bg-warning") : "bg-border-strong",
              )}
            />
            {presence === null
              ? "Looking for the extension in this browser…"
              : !presence.installed
                ? "The TrustLens extension is not installed in this browser."
                : presence.paired || state === "connected"
                  ? `Extension ${presence.version ?? ""} is connected in this browser.`
                  : `Extension ${presence.version ?? ""} found — not connected yet.`}
          </div>
          <Field label="Device name">
            <Input value={deviceName} onChange={(e) => setDeviceName(e.target.value)} maxLength={80} />
          </Field>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" loading={state === "connecting"} disabled={!presence?.installed} onClick={() => void connect()}>
              {presence?.paired || state === "connected" ? "Reconnect this browser" : "Connect this browser"}
            </Button>
            <Button variant="ghost" onClick={() => setShowManual((v) => !v)} aria-expanded={showManual}>
              {showManual ? "Hide manual code" : "Use a code instead"}
            </Button>
          </div>
          {state === "connected" ? (
            <p className="flex items-center gap-2 text-sm text-success" role="status">
              <CheckCircle2 aria-hidden className="h-4 w-4" strokeWidth={1.5} />
              Connected. Every page you open is now checked in real time — open the extension to see it.
            </p>
          ) : null}
          {error ? <p className="text-sm text-danger" role="alert">{error}</p> : null}
          {!presence?.installed && presence !== null ? (
            <p className="text-xs text-muted">
              Load it from <span className="font-mono">apps/extension/dist</span> (chrome://extensions → Developer mode → Load unpacked), then reload this page.
            </p>
          ) : null}
          {pair.isError ? <ErrorState error={pair.error} title="No pairing code was generated" compact /> : null}
          {showManual ? (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-muted-strong">Generate a code and enter it in the extension popup. It is valid for 10 minutes and works once.</p>
              <div>
                <Button loading={pair.isPending && state !== "connecting"} onClick={() => pair.mutate(deviceName.trim() || "Browser")}>
                  Generate pairing code
                </Button>
              </div>
              {pair.data && state !== "connected" && state !== "connecting" ? <PairingCodeView key={pair.data.code} code={pair.data} /> : null}
            </div>
          ) : null}
        </div>
        <div>
          <PairedDevices />
        </div>
      </div>
    </Card>
  );
}

export default function Developers() {
  return (
    <>
      <PageHeader title="Developers" subtitle="API keys for your servers, pairing for the browser extension, and your usage." />
      <div className="flex flex-col gap-6">
        <ExtensionPairing />
        <ApiKeys />
        <UsagePanel />
      </div>
    </>
  );
}
