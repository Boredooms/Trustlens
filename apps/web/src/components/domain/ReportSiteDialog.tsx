import { useState } from "react";
import { Link } from "react-router-dom";
import { Modal } from "@/components/ui/Overlay";
import { Button } from "@/components/ui/Button";
import { Field, Input, Textarea } from "@/components/ui/Field";
import { ErrorState } from "@/components/ui/States";
import type { ReportCreated } from "@/lib/api/types";
import { UrlText } from "./Text";

export interface ReportSiteValues {
  justification: string;
  observed_payee?: string;
}

export interface ReportSiteDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
  defaultPayee?: string | null;
  onSubmit: (v: ReportSiteValues) => void;
  pending: boolean;
  error: unknown;
  created: ReportCreated | undefined;
}

const MIN = 10;
const MAX = 500;

/** Presentational: the route owns the mutation. Justification 10–500 chars (API_CONTRACTS §13). */
export function ReportSiteDialog({
  open,
  onOpenChange,
  url,
  defaultPayee,
  onSubmit,
  pending,
  error,
  created,
}: ReportSiteDialogProps) {
  const [justification, setJustification] = useState("");
  const [payee, setPayee] = useState(defaultPayee ?? "");
  const [touched, setTouched] = useState(false);
  const len = justification.trim().length;
  const problem =
    len < MIN ? `Explain what happened in at least ${MIN} characters.` : len > MAX ? `Keep it under ${MAX} characters.` : null;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Report this site"
      description="An analyst reviews every report. Confirmed reports warn other users of the network."
      footer={
        created ? (
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        ) : (
          <>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              loading={pending}
              onClick={() => {
                setTouched(true);
                if (problem) return;
                onSubmit({ justification: justification.trim(), observed_payee: payee.trim() || undefined });
              }}
            >
              Send report
            </Button>
          </>
        )
      }
    >
      {created ? (
        <div role="status" className="flex flex-col gap-2 text-sm">
          <p className="font-medium">Report received</p>
          <p className="text-muted-strong">
            It is waiting for analyst review. Nothing changes for other users until an analyst confirms it.
          </p>
          <Link to={`/app/reports/${created.id}`} className="text-foreground underline underline-offset-4">
            Open the report
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <p className="text-xs text-muted">Address</p>
            <UrlText url={url} max={64} />
          </div>
          <Field
            label="What happened"
            required
            error={touched ? problem : null}
            counter={{ value: len, max: MAX }}
            help="Plain text. Do not include passwords or card numbers."
          >
            <Textarea
              value={justification}
              maxLength={MAX + 50}
              onChange={(e) => setJustification(e.target.value)}
              onBlur={() => setTouched(true)}
              placeholder="Asked for an application fee to a personal UPI ID after I applied."
            />
          </Field>
          <Field label="Payee the page asked for" help="Optional. The UPI ID, IBAN or wallet address shown on the page.">
            <Input value={payee} onChange={(e) => setPayee(e.target.value)} className="font-mono" />
          </Field>
          {error ? <ErrorState error={error} title="The report was not sent" compact /> : null}
        </div>
      )}
    </Modal>
  );
}
