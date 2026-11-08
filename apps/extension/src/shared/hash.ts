// SHA-256 hex via WebCrypto (available in the service worker, extension pages and Node ≥ 20).
export async function sha256Hex(input: string): Promise<string> {
  const bytes = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const KEY_WINDOW_MS = 10 * 60 * 1000;

/**
 * Idempotency-Key for /assess (EXTENSION_API_INTEGRATION.md §3): sha256 of the request identity,
 * truncated to 64 chars. Two deliberate additions to the documented `url+intent+payee`:
 *  - form_action/destination_host, so two different bodies never share a key (the API would answer
 *    409 IDEMPOTENCY_KEY_REUSED);
 *  - a 10-minute window, so a retry after a worker restart is deduplicated, but a decision is never
 *    replayed from the server's 24 h idempotency store long after the 10-minute freshness rule.
 */
export async function assessIdempotencyKey(
  body: { url: string; intent: string; payee?: string; form_action?: string; destination_host?: string },
  now: number = Date.now(),
): Promise<string> {
  const windowId = Math.floor(now / KEY_WINDOW_MS);
  const parts = [body.url, body.intent, body.payee ?? "", body.form_action ?? "", body.destination_host ?? "", windowId];
  return (await sha256Hex(parts.join("\n"))).slice(0, 64);
}
