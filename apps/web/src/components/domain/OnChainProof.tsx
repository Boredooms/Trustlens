import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, Copy, XCircle } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { Banner, ErrorState } from "@/components/ui/States";
import { TimeText } from "@/components/domain/Text";
import { isApiError } from "@/lib/api/errors";
import { shortHex, type Anchor, type AnchorVerification } from "@/lib/api/web3";
import { useAnchor, useCreateAnchor, usePublicVerify } from "@/lib/query/web3";

/** Integrity only. Shown wherever a verification result appears (WEB3_REGISTRY.md §1). */
export const INTEGRITY_CAVEAT =
  "An on-chain record proves this report has not been altered since it was registered. It does not prove the report is true.";

const CHECK_LABEL: Record<keyof AnchorVerification["checks"], string> = {
  payload_hash_matches: "The payload hashes to the anchored payload hash",
  chain_commitment_matches: "The contract confirms the commitment for this payload and salt",
  report_unchanged: "The report today still matches the anchored snapshot",
};

export function isChainUnavailable(e: unknown): boolean {
  return isApiError(e) && e.code === "CHAIN_UNAVAILABLE";
}

function CopyValue({ label, value }: { label: string; value: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="font-mono text-muted">—</span>;
  return (
    <span className="inline-flex items-center gap-1">
      <span className="font-mono" title={value}>
        {shortHex(value)}
      </span>
      <button
        type="button"
        className="rounded p-1 text-muted hover:text-foreground focus-visible:outline focus-visible:outline-2"
        aria-label={copied ? `${label} copied` : `Copy ${label}`}
        onClick={() => {
          void navigator.clipboard?.writeText(value).then(() => setCopied(true));
        }}
      >
        <Copy aria-hidden className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
    </span>
  );
}

export function ProofFacts({ anchor }: { anchor: Anchor }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
      <dt className="text-muted">Contract</dt>
      <dd>
        <CopyValue label="contract address" value={anchor.contract} />
      </dd>
      <dt className="text-muted">Chain id</dt>
      <dd className="font-mono">{anchor.chain_id ?? "—"}</dd>
      <dt className="text-muted">Report id (bytes32)</dt>
      <dd>
        <CopyValue label="report id bytes" value={anchor.report_id_bytes32} />
      </dd>
      <dt className="text-muted">Commitment</dt>
      <dd>
        <CopyValue label="commitment" value={anchor.commitment} />
      </dd>
      <dt className="text-muted">Payload hash</dt>
      <dd>
        <CopyValue label="payload hash" value={anchor.payload_hash} />
      </dd>
      <dt className="text-muted">Revision</dt>
      <dd className="font-mono">{anchor.revision ?? "—"}</dd>
      <dt className="text-muted">Transaction</dt>
      <dd>
        <CopyValue label="transaction hash" value={anchor.tx_hash} />
      </dd>
      <dt className="text-muted">Block</dt>
      <dd className="font-mono">{anchor.block_number ?? "—"}</dd>
      <dt className="text-muted">Anchored</dt>
      <dd>
        <TimeText iso={anchor.anchored_at ?? undefined} />
      </dd>
    </dl>
  );
}

export function VerifyResult({ result }: { result: AnchorVerification }) {
  const Icon = result.valid ? CheckCircle2 : XCircle;
  return (
    <div className="flex flex-col gap-3">
      <div role="status" className={`flex items-start gap-3 rounded-md border p-4 text-sm ${result.valid ? "border-success" : "border-danger"}`}>
        <Icon aria-hidden className={`mt-0.5 h-5 w-5 shrink-0 ${result.valid ? "text-success" : "text-danger"}`} strokeWidth={1.5} />
        <div>
          <p className="font-medium">{result.valid ? "Integrity verified: valid" : "Does not match the on-chain record: invalid"}</p>
          <p className="mt-1 text-muted-strong">
            Revision {result.on_chain_revision} · on-chain status <span className="font-mono">{result.on_chain_status}</span> · checked{" "}
            <TimeText iso={result.checked_at} />
          </p>
        </div>
      </div>
      <ul className="flex flex-col gap-1.5 text-sm" aria-label="Verification checks">
        {(Object.keys(CHECK_LABEL) as (keyof AnchorVerification["checks"])[]).map((k) => (
          <li key={k} className="flex items-start gap-2">
            {result.checks[k] ? (
              <CheckCircle2 aria-label="passed" className="mt-0.5 h-4 w-4 shrink-0 text-success" strokeWidth={1.5} />
            ) : (
              <XCircle aria-label="failed" className="mt-0.5 h-4 w-4 shrink-0 text-danger" strokeWidth={1.5} />
            )}
            <span>{CHECK_LABEL[k]}</span>
          </li>
        ))}
      </ul>
      {result.on_chain_status === "disputed" ? (
        <Banner title="This record is disputed on chain">Someone has publicly disputed this report. The commitment is unchanged; analysts review disputes off chain.</Banner>
      ) : null}
      <p className="text-xs text-muted">{INTEGRITY_CAVEAT}</p>
    </div>
  );
}

/** Report detail panel. States: loading · not anchored · anchored · verify failed · chain unavailable. */
export function OnChainProofPanel({ reportId }: { reportId: string }) {
  const anchor = useAnchor(reportId);
  const create = useCreateAnchor(reportId);
  const [verifyRequested, setVerifyRequested] = useState(false);
  const verify = usePublicVerify(reportId, verifyRequested && !!anchor.data?.anchored);

  if (anchor.isPending)
    return (
      <Card title="On-chain proof">
        <div role="status" aria-label="Loading on-chain proof" className="flex flex-col gap-2">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </Card>
    );
  if (anchor.isError)
    return (
      <Card title="On-chain proof">
        <ErrorState error={anchor.error} title="We could not load the on-chain proof" compact onRetry={() => void anchor.refetch()} />
      </Card>
    );

  const a = anchor.data;
  const chainDown = isChainUnavailable(create.error) || isChainUnavailable(verify.error);

  return (
    <Card title="On-chain proof">
      <div className="flex flex-col gap-4">
        {chainDown ? (
          <Banner title="The report registry is unavailable">
            The blockchain node is not reachable right now. The report itself is unaffected; try again when the registry is back.
          </Banner>
        ) : null}
        {!a.anchored ? (
          <>
            <p className="text-sm text-muted-strong">
              Not anchored yet. Anchoring records a salted hash of this report on chain. No address, text or personal data leaves our database.
            </p>
            <div>
              <Button variant="primary" loading={create.isPending} onClick={() => create.mutate()}>
                Anchor on chain
              </Button>
            </div>
            {create.isError && !chainDown ? <ErrorState error={create.error} title="The report was not anchored" compact /> : null}
          </>
        ) : (
          <>
            {a.simulated ? <p className="text-xs text-muted">simulated: demo report on a local development chain.</p> : null}
            <ProofFacts anchor={a} />
            <div className="flex flex-wrap gap-3">
              <Button
                variant="primary"
                loading={verify.isFetching}
                onClick={() => (verifyRequested ? void verify.refetch() : setVerifyRequested(true))}
              >
                Verify independently
              </Button>
              <Button loading={create.isPending} onClick={() => create.mutate()}>
                Re-anchor if changed
              </Button>
              <Link to={`/verify/${reportId}`} className="self-center text-sm underline underline-offset-4">
                Public verification page
              </Link>
            </div>
            {create.isSuccess && create.data && create.data.created === false ? (
              <p role="status" className="text-sm">The report has not changed since revision {create.data.revision}; no transaction was sent.</p>
            ) : null}
            {verify.data ? <VerifyResult result={verify.data} /> : null}
            {verify.isError && !chainDown ? <ErrorState error={verify.error} title="Verification did not run" compact /> : null}
          </>
        )}
      </div>
    </Card>
  );
}
