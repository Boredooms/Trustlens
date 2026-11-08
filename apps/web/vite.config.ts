/// <reference types="vitest" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: { port: 5173, strictPort: true },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ["react", "react-dom", "react-router-dom"],
          query: ["@tanstack/react-query"],
          clerk: ["@clerk/clerk-react"],
        },
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    css: false,
    // Full-flow UI tests render the whole app; 5 s flakes when workspaces test in parallel.
    testTimeout: 20_000,
    // Tests never use the developer's .env.local: no real Clerk (network), dev sign-in instead.
    env: { VITE_CLERK_PUBLISHABLE_KEY: "", VITE_API_BASE_URL: "http://localhost:8000" },
  },
});
