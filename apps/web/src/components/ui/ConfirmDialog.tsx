import { useState, type ReactNode } from "react";
import { Button } from "./Button";
import { Field, Input } from "./Field";
import { Modal } from "./Overlay";
import { ErrorState } from "./States";

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** The consequence, in one sentence (UI_UX_SPECIFICATIONS.md §1). */
  consequence: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  onConfirm: () => void;
  pending?: boolean;
  error?: unknown;
  errorTitle?: string;
  /** When set, the user must type this exact text to enable the confirm button (FRONTEND_ARCHITECTURE §8). */
  typedConfirmation?: string;
  tone?: "danger" | "primary";
  children?: ReactNode;
}

/** Destructive or irreversible action confirmation. */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  consequence,
  confirmLabel,
  cancelLabel = "Cancel",
  onConfirm,
  pending = false,
  error,
  errorTitle,
  typedConfirmation,
  tone = "danger",
  children,
}: ConfirmDialogProps) {
  const [typed, setTyped] = useState("");
  const typedOk = !typedConfirmation || typed.trim() === typedConfirmation;
  const close = (o: boolean) => {
    if (!o) setTyped("");
    onOpenChange(o);
  };
  return (
    <Modal
      open={open}
      onOpenChange={close}
      dismissable={!pending}
      title={title}
      description={consequence}
      footer={
        <>
          <Button variant="ghost" onClick={() => close(false)} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button variant={tone} loading={pending} disabled={!typedOk} onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {children}
        {typedConfirmation ? (
          <Field label={`Type ${typedConfirmation} to confirm`}>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" spellCheck={false} />
          </Field>
        ) : null}
        {error ? <ErrorState error={error} title={errorTitle ?? "That did not work"} compact /> : null}
      </div>
    </Modal>
  );
}
