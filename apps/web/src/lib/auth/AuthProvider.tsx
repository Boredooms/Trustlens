import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";
import { ClerkProvider, useAuth as useClerkAuth } from "@clerk/clerk-react";
import { useQueryClient } from "@tanstack/react-query";
import { env, clerkEnabled } from "@/lib/env";
import { api } from "@/lib/api/endpoints";
import { devTokenFor, readDevToken, registerTokenGetter, writeDevToken, type DevPersona } from "./token";

export type AuthStatus = "loading" | "signed_out" | "signed_in";

export interface AuthContextValue {
  status: AuthStatus;
  mode: "clerk" | "dev";
  /** Development sign-in only; undefined under Clerk. */
  devSignIn?: (persona: DevPersona) => void;
  signOut: () => Promise<void>;
  /** Set when the session ended unexpectedly (failed refresh). Shown non-destructively on /login. */
  endedReason: string | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}

async function serverLogout(): Promise<void> {
  try {
    await api.auth.logout();
  } catch {
    // Logout is best-effort audit; the local session ends regardless.
  }
}

function DevAuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(() => readDevToken());
  const [endedReason, setEndedReason] = useState<string | null>(null);

  // Registered during the first render so children's first queries already carry the token.
  useState(() =>
    registerTokenGetter(
      async () => readDevToken(),
      () => {
        // Dev tokens cannot refresh; keep the session so the 401 and its hint stay visible.
      },
    ),
  );

  const devSignIn = useCallback(
    (p: DevPersona) => {
      const t = devTokenFor(p);
      writeDevToken(t);
      queryClient.clear();
      setEndedReason(null);
      setToken(t);
    },
    [queryClient],
  );

  const signOut = useCallback(async () => {
    await serverLogout();
    writeDevToken(null);
    setToken(null);
    queryClient.clear();
  }, [queryClient]);

  const value = useMemo<AuthContextValue>(
    () => ({ status: token ? "signed_in" : "signed_out", mode: "dev", devSignIn, signOut, endedReason }),
    [token, devSignIn, signOut, endedReason],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

function ClerkBridge({ children }: { children: ReactNode }) {
  const { isLoaded, isSignedIn, getToken, signOut: clerkSignOut } = useClerkAuth();
  const queryClient = useQueryClient();
  const [endedReason, setEndedReason] = useState<string | null>(null);

  const signOut = useCallback(async () => {
    await serverLogout();
    await clerkSignOut();
    queryClient.clear();
  }, [clerkSignOut, queryClient]);

  // Latest Clerk functions, read by a getter registered once during the first render.
  const latest = useRef({ getToken, clerkSignOut });
  latest.current = { getToken, clerkSignOut };
  useState(() =>
    registerTokenGetter(
      ({ forceRefresh }) => latest.current.getToken(forceRefresh ? { skipCache: true } : undefined),
      () => {
        setEndedReason("Your session ended. Sign in again to continue.");
        void latest.current.clerkSignOut().then(() => queryClient.clear());
      },
    ),
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status: !isLoaded ? "loading" : isSignedIn ? "signed_in" : "signed_out",
      mode: "clerk",
      signOut,
      endedReason,
    }),
    [isLoaded, isSignedIn, signOut, endedReason],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** One provider, one token getter for the API client — Clerk when configured, development sign-in otherwise. */
export function AuthProvider({ children }: { children: ReactNode }) {
  if (clerkEnabled) {
    return (
      <ClerkProvider publishableKey={env.clerkPublishableKey} afterSignOutUrl="/">
        <ClerkBridge>{children}</ClerkBridge>
      </ClerkProvider>
    );
  }
  return <DevAuthProvider>{children}</DevAuthProvider>;
}
