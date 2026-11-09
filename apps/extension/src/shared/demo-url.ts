// Demo-only URL normalisation. Not verdict logic: it only rewrites the address that is *reported* to
// the API so that pages served by apps/demo-sites look like the hosts they impersonate.
//
//   path mode : <demoOrigin>/site/<host>/<path>?q  →  https://<host>/<path>?q
//   host mode : http://<host>.example:<demoPort>/p →  https://<host>.example/p   (RFC 2606 .example only)
//
// Every other URL is returned unchanged apart from dropping the fragment (cache key rule, §3).

const HOST_RE = /^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*$/i;

function parseOrigin(origin: string | undefined | null): URL | null {
  if (!origin) return null;
  try {
    const u = new URL(origin);
    return u.protocol === "http:" || u.protocol === "https:" ? u : null;
  } catch {
    return null;
  }
}

/**
 * Normalise a page or form-action URL for the API. Returns `null` for non-http(s) or unparseable
 * input (e.g. `upi://`, `javascript:`), which callers must treat as "cannot check".
 */
export function toReportedUrl(raw: string, demoOrigin?: string | null, base?: string): string | null {
  let u: URL;
  try {
    u = base ? new URL(raw, base) : new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  u.hash = "";

  const demo = parseOrigin(demoOrigin);
  if (demo) {
    if (u.origin === demo.origin && u.pathname.startsWith("/site/")) {
      const rest = u.pathname.slice("/site/".length);
      const slash = rest.indexOf("/");
      const host = (slash === -1 ? rest : rest.slice(0, slash)).toLowerCase();
      const path = slash === -1 ? "/" : rest.slice(slash);
      if (HOST_RE.test(host)) return `https://${host}${path}${u.search}`;
      return u.toString();
    }
    const isExampleHost = u.hostname === "example" || u.hostname.endsWith(".example");
    if (isExampleHost && u.protocol === "http:" && u.port === demo.port) {
      return `https://${u.hostname}${u.pathname}${u.search}`;
    }
  }
  return u.toString();
}

/** Hostname of an already-normalised URL, or `null`. */
export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname || null;
  } catch {
    return null;
  }
}

/**
 * True for loopback, private-network and local-only hosts the API refuses (TARGET_NOT_ALLOWED).
 * Skipping them client-side avoids a pointless round trip and shows a clear neutral state instead
 * of "unavailable". The server's guard remains the authority for everything else.
 */
export function isLocalHost(url: string): boolean {
  const h = hostOf(url);
  if (!h) return true;
  const host = h.replace(/^\[|\]$/g, "").toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan")) {
    return true;
  }
  if (host === "::1" || host.startsWith("fe80:") || host.startsWith("fc") || host.startsWith("fd")) return host.includes(":");
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || a === 0 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || (a === 100 && b >= 64 && b <= 127);
}
