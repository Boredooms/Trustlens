import { useState, type FormEvent } from "react";
import { INTENTS, isIntent, type Intent } from "@/lib/api/enums";
import { INTENT_LABEL } from "@/lib/copy";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/Field";
import { cn } from "@/lib/utils/cn";

export interface ScanInputProps {
  initialUrl?: string;
  initialIntent?: string;
  onSubmit: (v: { url: string; intent: Intent }) => void;
  submitting?: boolean;
  /** Server-side error for the URL field (e.g. TARGET_NOT_ALLOWED message). */
  serverError?: string | null;
  submitLabel?: string;
  layout?: "row" | "stacked";
  className?: string;
}

/** Client-side shape check only; the API remains the authority on what may be scanned. */
export function validateUrl(raw: string): string | null {
  const v = raw.trim();
  if (!v) return "Enter the address of the page you want to check.";
  if (v.length > 2048) return "Addresses longer than 2048 characters cannot be scanned.";
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return "Enter a full address, including https://.";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "Only http and https addresses can be scanned.";
  if (u.username || u.password) return "Remove the user name and password from the address.";
  return null;
}

/** Accepts bare hosts ("example.com/path") by assuming https. */
export function normaliseUrlInput(raw: string): string {
  const v = raw.trim();
  if (v && !/^[a-z][a-z0-9+.-]*:/i.test(v)) return `https://${v}`;
  return v;
}

export function ScanInput({
  initialUrl = "",
  initialIntent,
  onSubmit,
  submitting,
  serverError,
  submitLabel = "Run scan",
  layout = "row",
  className,
}: ScanInputProps) {
  const [url, setUrl] = useState(initialUrl);
  const [intent, setIntent] = useState<Intent>(isIntent(initialIntent) ? initialIntent : "browse");
  const [error, setError] = useState<string | null>(null);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const normalised = normaliseUrlInput(url);
    const problem = validateUrl(normalised);
    setError(problem);
    if (problem) return;
    setUrl(normalised);
    onSubmit({ url: normalised, intent });
  };

  return (
    <form
      onSubmit={submit}
      noValidate
      className={cn(
        "flex gap-4",
        layout === "row" ? "flex-col md:flex-row md:items-start" : "flex-col",
        className,
      )}
    >
      <Field label="Website address" error={error ?? serverError ?? null} className="flex-1">
        <Input
          type="url"
          inputMode="url"
          autoComplete="url"
          spellCheck={false}
          placeholder="https://apply.example/register"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="font-mono"
        />
      </Field>
      <Field label="What the page asks you to do" className={layout === "row" ? "md:w-52" : undefined}>
        <Select value={intent} onChange={(e) => setIntent(isIntent(e.target.value) ? e.target.value : "browse")}>
          {INTENTS.map((i) => (
            <option key={i} value={i}>
              {INTENT_LABEL[i]}
            </option>
          ))}
        </Select>
      </Field>
      {/* 22px = label line (16px) + field gap (6px): aligns the button with the inputs in row layout */}
      <div className={layout === "row" ? "md:pt-[22px]" : undefined}>
        <Button type="submit" variant="primary" loading={submitting} className="w-full md:w-auto">
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
