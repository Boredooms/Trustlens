// The single seam between the auth provider and the API client.
// The AuthProvider registers a getter; the API client is the one reader. The token itself is never
// copied into a store (FRONTEND_ARCHITECTURE.md §7).

export interface TokenRequest {
  /** Bypass any cache and mint a fresh token (Clerk: getToken({ skipCache: true })). */
  forceRefresh: boolean;
}

export type TokenGetter = (req: TokenRequest) => Promise<string | null>;

let getter: TokenGetter = async () => null;
let onAuthFailure: () => void = () => {};
let refreshInFlight: Promise<string | null> | null = null;

export function registerTokenGetter(fn: TokenGetter, failureHandler: () => void): () => void {
  getter = fn;
  onAuthFailure = failureHandler;
  return () => {
    getter = async () => null;
    onAuthFailure = () => {};
  };
}

export function getAuthToken(): Promise<string | null> {
  return getter({ forceRefresh: false });
}

/** Concurrent 401s share one refresh promise (no stampede). */
export function refreshAuthToken(): Promise<string | null> {
  if (!refreshInFlight) {
    refreshInFlight = getter({ forceRefresh: true }).finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

export function reportAuthFailure(): void {
  onAuthFailure();
}

// ── Development sign-in (only when VITE_CLERK_PUBLISHABLE_KEY is empty) ─────────
export const DEV_TOKEN_KEY = "trustlens.dev-token";

export const DEV_PERSONAS = [
  { id: "analyst", label: "Analyst", email: "analyst@trustlens.local", role: "analyst" },
  { id: "operator", label: "Operator", email: "operator@trustlens.local", role: "operator" },
  { id: "org_admin", label: "Org admin", email: "admin@northstar-demo.example", role: "user" },
] as const;

export type DevPersona = (typeof DEV_PERSONAS)[number];

export function devTokenFor(p: DevPersona): string {
  return `dev:${p.email}:${p.role}`;
}

export function readDevToken(): string | null {
  try {
    return sessionStorage.getItem(DEV_TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeDevToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(DEV_TOKEN_KEY, token);
    else sessionStorage.removeItem(DEV_TOKEN_KEY);
  } catch {
    // sessionStorage unavailable (privacy mode); the session simply will not persist.
  }
}
