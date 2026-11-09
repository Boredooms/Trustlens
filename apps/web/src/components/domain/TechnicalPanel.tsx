import type { ScanResult } from "@/lib/api/types";
import { humanise, stringifyValue } from "@/lib/format";
import { SimulatedBadge } from "./Badges";

const BLOCK_ORDER = ["action", "tls", "dns", "registration", "redirects", "page", "brand"] as const;
/** Blocks with their own card on the scan report (TrustReports.tsx): not repeated as raw JSON here. */
const OWN_CARD = new Set(["certificate", "security_posture", "intel"]);
const BLOCK_TITLE: Record<string, string> = {
  action: "Action",
  tls: "TLS",
  dns: "DNS",
  registration: "Registration",
  redirects: "Redirects",
  page: "Page",
  brand: "Brand claims",
};

export interface TechnicalPanelProps {
  result: ScanResult | null | undefined;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Compact technical rail: each result block as a mono definition list. Unknown blocks are still shown. */
export function TechnicalPanel({ result }: TechnicalPanelProps) {
  if (!result) {
    return <p className="text-sm text-muted">No technical results were recorded for this scan.</p>;
  }
  const keys = [
    ...BLOCK_ORDER.filter((k) => k in result),
    ...Object.keys(result).filter((k) => !(BLOCK_ORDER as readonly string[]).includes(k) && !OWN_CARD.has(k)),
  ];
  const blocks = keys
    .map((k) => [k, result[k]] as const)
    .filter((entry): entry is readonly [string, Record<string, unknown>] => isRecord(entry[1]));
  if (blocks.length === 0) {
    return <p className="text-sm text-muted">No technical results were recorded for this scan.</p>;
  }
  return (
    <div className="flex flex-col divide-y divide-border">
      {blocks.map(([key, block]) => (
        <section key={key} aria-labelledby={`tech-${key}`} className="py-3 first:pt-0 last:pb-0">
          <div className="flex items-center justify-between gap-2">
            <h3 id={`tech-${key}`} className="label-eyebrow">
              {BLOCK_TITLE[key] ?? humanise(key)}
            </h3>
            {block.simulated === true ? <SimulatedBadge /> : null}
          </div>
          <dl className="mt-2 grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-x-3 gap-y-1">
            {Object.entries(block)
              .filter(([k]) => k !== "simulated")
              .map(([k, v]) => (
                <div key={k} className="contents">
                  <dt className="truncate text-xs text-muted" title={k}>
                    {humanise(k)}
                  </dt>
                  <dd className="break-all font-mono text-xs text-foreground">{stringifyValue(v)}</dd>
                </div>
              ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
