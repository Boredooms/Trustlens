// Build-time constants injected by scripts/build.mjs (esbuild `define`) and vitest.config.ts.
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  readonly VITE_WEB_BASE_URL: string;
  readonly VITE_DEMO_SITES_ORIGIN: string;
  readonly EXT_VERSION: string;
}
interface ImportMeta {
  readonly env: ImportMetaEnv;
}
