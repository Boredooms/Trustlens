import { describe, expect, it } from "vitest";
import { CLERK_ROUTES } from "./AuthProvider";
import { safeNext } from "@/routes/public/Login";

// Regression (2026-11-09, reproduced in a real browser): without signInUrl/signUpUrl, Clerk's
// "Sign up" link on /login left for the hosted Account Portal with the dev-browser token in the
// address bar and returned to "/" instead of /app.
describe("Clerk routing", () => {
  it("keeps every auth flow in-app and lands on /app", () => {
    expect(CLERK_ROUTES).toEqual({
      signInUrl: "/login",
      signUpUrl: "/register",
      signInFallbackRedirectUrl: "/app",
      signUpFallbackRedirectUrl: "/app",
      afterSignOutUrl: "/",
    });
  });

  it("only honours ?next= inside /app (no open redirect)", () => {
    expect(safeNext("/app/scan")).toBe("/app/scan");
    expect(safeNext("https://evil.example/app")).toBe("/app");
    expect(safeNext("//evil.example/app")).toBe("/app");
    expect(safeNext("/")).toBe("/app");
    expect(safeNext(null)).toBe("/app");
  });
});
