// Formatting helpers — DESIGN_SYSTEM.md §8 (numbers, dates).

const rtf = typeof Intl !== "undefined" ? new Intl.RelativeTimeFormat("en", { numeric: "auto" }) : null;

export function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** "12 min ago" style relative time. */
export function relativeTime(iso: string | null | undefined, now: number = Date.now()): string {
  const d = parseDate(iso);
  if (!d) return "—";
  const diffS = Math.round((d.getTime() - now) / 1000);
  const abs = Math.abs(diffS);
  if (!rtf) return absoluteTime(iso);
  if (abs < 45) return rtf.format(diffS, "second");
  if (abs < 45 * 60) return rtf.format(Math.round(diffS / 60), "minute");
  if (abs < 22 * 3600) return rtf.format(Math.round(diffS / 3600), "hour");
  if (abs < 26 * 86400) return rtf.format(Math.round(diffS / 86400), "day");
  if (abs < 320 * 86400) return rtf.format(Math.round(diffS / (30 * 86400)), "month");
  return rtf.format(Math.round(diffS / (365 * 86400)), "year");
}

/** Absolute timestamp with an explicit time zone. */
export function absoluteTime(iso: string | null | undefined): string {
  const d = parseDate(iso);
  if (!d) return "—";
  return d.toLocaleString("en-GB", {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function durationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms)) return "—";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.floor(ms / 60_000)} min ${Math.round((ms % 60_000) / 1000)} s`;
}

export function percent(fraction: number | null | undefined): string {
  if (fraction === null || fraction === undefined || !Number.isFinite(fraction)) return "—";
  return `${Math.round(fraction * 100)}%`;
}

/** Truncate in the middle so both host and path stay readable. */
export function truncateMiddle(s: string, max = 56): string {
  if (s.length <= max) return s;
  const keep = max - 1;
  const head = Math.ceil(keep * 0.6);
  const tail = keep - head;
  return `${s.slice(0, head)}…${s.slice(s.length - tail)}`;
}

/** Strip the scheme for compact display. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "");
}

export function humanise(key: string): string {
  const s = key.replace(/_/g, " ").trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Render any JSON-ish value as a short string for technical panels. */
export function stringifyValue(v: unknown): string {
  if (v === null) return "none";
  if (v === undefined) return "—";
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (typeof v === "number" || typeof v === "string") return String(v);
  if (Array.isArray(v)) {
    if (v.length === 0) return "none";
    return v.map((x) => (typeof x === "object" && x !== null ? JSON.stringify(x) : String(x))).join(", ");
  }
  return JSON.stringify(v);
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
