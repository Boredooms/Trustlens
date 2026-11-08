import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "@/styles/globals.css";
import { AuthProvider } from "@/lib/auth/AuthProvider";
import { TooltipProvider } from "@/components/ui/Overlay";
import { ThemeController } from "@/components/layout/ThemeController";
import { isApiError } from "@/lib/api/errors";
import { App } from "./app";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      // 1 retry for GETs, but never retry 4xx (they will not change) except 408/429.
      retry: (count, error) => {
        if (isApiError(error) && error.status >= 400 && error.status < 500 && error.status !== 408 && error.status !== 429) {
          return false;
        }
        return count < 1;
      },
    },
    mutations: { retry: 0 },
  },
});

const root = document.getElementById("root");
if (!root) throw new Error("#root element missing from index.html");

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <TooltipProvider delayDuration={150}>
          <ThemeController />
          <App />
        </TooltipProvider>
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>,
);
