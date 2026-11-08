import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ErrorState } from "@/components/ui/States";
import { phashFromFile, validateLogoFile } from "@/lib/image/phash";
import { useUpdateOrganisation } from "@/lib/query/hooks";
import type { Organisation } from "@/lib/api/types";
import { toast } from "@/stores/toast";

/**
 * Official logo fingerprint (R-ID-04). The image is hashed in the browser; only the 64-bit pHash is
 * stored, and scans compare page logos against it to spot impersonation.
 */
export function LogoCard({
  o,
  canManage,
  hashFile = phashFromFile,
}: {
  o: Organisation;
  canManage: boolean;
  /** Injectable for tests (jsdom has no canvas). */
  hashFile?: (file: File) => Promise<string>;
}) {
  const update = useUpdateOrganisation(o.id);
  const [preview, setPreview] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => () => (preview ? URL.revokeObjectURL(preview) : undefined), [preview]);

  const pick = async (file: File | undefined) => {
    setError(null);
    setHash(null);
    if (!file) return;
    const problem = validateLogoFile(file);
    if (problem) {
      setError(problem);
      return;
    }
    setReading(true);
    try {
      setHash(await hashFile(file));
      setPreview(typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : null);
    } catch {
      setError("We could not read that image. Try a PNG or JPEG.");
    } finally {
      setReading(false);
    }
  };

  const save = (logo_phash: string | null) =>
    update.mutate(
      { logo_phash },
      {
        onSuccess: () => {
          toast.success(logo_phash ? "Logo fingerprint saved" : "Logo removed");
          setHash(null);
          setPreview(null);
          if (input.current) input.current.value = "";
        },
      },
    );

  return (
    <Card title="Logo">
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted-strong">
          Scans compare logos on pages that claim to be {o.name} with this fingerprint. The image stays on your device;
          only a 64-bit fingerprint is saved.
        </p>
        <p className="text-xs text-muted">
          Current fingerprint:{" "}
          <span className="font-mono text-foreground" data-testid="current-phash">
            {o.logo_phash ?? "none"}
          </span>
        </p>
        {canManage ? (
          <>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium">Upload logo (PNG, JPEG or SVG, up to 1 MB)</span>
              <input
                ref={input}
                type="file"
                accept="image/png,image/jpeg,image/svg+xml"
                onChange={(e) => void pick(e.target.files?.[0])}
                className="text-sm"
              />
            </label>
            {error ? (
              <p role="alert" className="text-xs text-danger">
                {error}
              </p>
            ) : null}
            {reading ? <p className="text-xs text-muted">Reading image…</p> : null}
            {hash ? (
              <div className="flex items-center gap-3">
                {preview ? (
                  <img src={preview} alt="Selected logo preview" className="h-12 w-12 rounded border border-border object-contain" />
                ) : null}
                <span className="font-mono text-xs">New fingerprint: {hash}</span>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button variant="primary" disabled={!hash} loading={update.isPending} onClick={() => hash && save(hash)}>
                Save logo
              </Button>
              {o.logo_phash ? (
                <Button variant="secondary" disabled={update.isPending} onClick={() => save(null)}>
                  Remove logo
                </Button>
              ) : null}
            </div>
            {update.isError ? <ErrorState error={update.error} title="The logo was not saved" compact /> : null}
          </>
        ) : null}
      </div>
    </Card>
  );
}
