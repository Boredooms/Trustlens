const raw = import.meta.env;

function trimSlash(s: string): string {
  return s.endsWith("/") ? s.slice(0, -1) : s;
}

export const env = {
  apiBaseUrl: trimSlash(raw.VITE_API_BASE_URL?.trim() || "http://localhost:8000"),
  clerkPublishableKey: raw.VITE_CLERK_PUBLISHABLE_KEY?.trim() ?? "",
  demoMode: raw.VITE_DEMO_MODE === "true" || raw.VITE_DEMO_MODE === "1",
  appVersion: raw.VITE_APP_VERSION?.trim() || "0.1.0",
} as const;

/** True when a Clerk publishable key is configured; otherwise the development sign-in is used. */
export const clerkEnabled = env.clerkPublishableKey.length > 0;
