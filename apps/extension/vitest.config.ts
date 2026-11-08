import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    "import.meta.env.VITE_API_BASE_URL": JSON.stringify("http://localhost:8000"),
    "import.meta.env.VITE_WEB_BASE_URL": JSON.stringify("http://localhost:5173"),
    "import.meta.env.VITE_DEMO_SITES_ORIGIN": JSON.stringify("http://localhost:8081"),
    "import.meta.env.EXT_VERSION": JSON.stringify("0.4.1"),
  },
  test: {
    include: ["test/**/*.test.ts"],
  },
});
