import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { ProofFacts, VerifyResult, INTEGRITY_CAVEAT, isChainUnavailable } from "@/components/domain/OnChainProof";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Field, Textarea } from "@/components/ui/Field";
import { Skeleton } from "@/components/ui/Skeleton";
import { Banner, EmptyState, ErrorState } from "@/components/ui/States";
import { isNotFound } from "@/lib/api/errors";
import { usePublicVerify, useVerifyPayload } from "@/lib/query/web3";

function TamperCheck({ reportId, payload }: { reportId: string; payload: Record<string, unknown> }) {
  const [text, setText] = useState(() => JSON.stringify(payload, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const check = useVerifyPayload(reportId);
  const submit = () => {
    try {
      const parsed: unknown = JSON.parse(text);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
      setParseError(null);
      check.mutate(parsed as Record<string, unknown>);
    } catch {
      setParseError("Enter a JSON object.");
    }
  };
  return (
    <Card title="Check a copy of the payload">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted-strong">
          Edit any field (for example the indicator) and verify. A copy that differs by one character hashes differently and fails the on-chain check.
        </p>
        <Field label="Payload (JSON)" error={parseError}>
          <Textarea value={text} onChange={(e) => setText(e.target.value)} className="min-h-64 font-mono text-xs" spellCheck={false} />
        </Field>
        <div>
          <Button onClick={submit} loading={check.isPending}>
            Verify this payload
          </Button>
        </div>
        {check.data ? <VerifyResult result={check.data} /> : null}
        {check.isError ? <ErrorState error={check.error} title="The check did not run" compact /> : null}
      </div>
    </Card>
  );
}

/** Public `/verify/:reportId` — no sign-in; works in a private window (WEB3_REGISTRY.md §5). */
export function Verify() {
  const { reportId = "" } = useParams();
  const q = usePublicVerify(reportId);
  useEffect(() => {
    document.title = "Verify a report · TrustLens";
  }, []);

  return (
    <div className="mx-auto flex max-w-reading flex-col gap-6 px-4 py-16">
      <div>
        <h1 className="text-3xl font-medium tracking-tight">Verify a threat report</h1>
        <p className="mt-2 text-sm text-muted-strong">
          Report <span className="font-mono">{reportId}</span>. This page recomputes the report’s hash and asks the registry contract whether it matches.
        </p>
      </div>
      {q.isPending ? (
        <div role="status" aria-label="Verifying" className="flex flex-col gap-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-40 w-full" />
        </div>
      ) : q.isError ? (
        isNotFound(q.error) ? (
          <EmptyState title="This report has not been anchored" description="Only reports registered on chain can be verified here." />
        ) : isChainUnavailable(q.error) ? (
          <Banner title="The report registry is unavailable">The blockchain node is not reachable right now, so nothing can be verified. Try again later.</Banner>
        ) : (
          <ErrorState error={q.error} title="Verification did not run" onRetry={() => void q.refetch()} retrying={q.isFetching} />
        )
      ) : (
        <>
          <Card title="Result">
            <VerifyResult result={q.data} />
          </Card>
          <Card title="On-chain record">
            {q.data.simulated ? <p className="mb-3 text-xs text-muted">simulated: demo report on a local development chain.</p> : null}
            <ProofFacts anchor={q.data} />
          </Card>
          <Card title="What was committed">
            <p className="mb-3 text-sm text-muted-strong">
              The payload contains no address, message or personal data: only the reported registrable domain, enums, finding codes and hashes. Salt{" "}
              <span className="break-all font-mono text-xs">{q.data.salt}</span>
            </p>
            <pre className="overflow-x-auto rounded-md bg-surface-secondary p-3 text-xs">{JSON.stringify(q.data.payload, null, 2)}</pre>
          </Card>
          <TamperCheck reportId={reportId} payload={q.data.payload} />
          <Card title="Verify without trusting TrustLens">
            <p className="text-sm text-muted-strong">This command recomputes both hashes locally and reads the contract directly over RPC:</p>
            <pre className="mt-2 overflow-x-auto rounded-md bg-surface-secondary p-3 text-xs">{`pnpm --filter @trustlens/contracts verify-report -- --report ${reportId}`}</pre>
          </Card>
          <p className="text-xs text-muted">{INTEGRITY_CAVEAT}</p>
        </>
      )}
    </div>
  );
}
