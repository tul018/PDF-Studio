import { defineConfig } from "vite";

// Tauri expects a fixed port and must not clear the terminal it logs to.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  clearScreen: false,
  base: "./",
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  resolve: {
    // The legacy build ships polyfills for newer JS built-ins, so the same
    // bundle runs on older WebView2 runtimes and iOS 16 WKWebView.
    alias: [{ find: /^pdfjs-dist$/, replacement: "pdfjs-dist/legacy/build/pdf.mjs" }],
  },
  envPrefix: ["VITE_", "TAURI_ENV_"],
  build: {
    // WebView2 (Windows) is evergreen Chromium; iOS WKWebView >= 16.4.
    target: ["es2022", "chrome110", "safari16"],
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
    chunkSizeWarningLimit: 2000,
  },
  worker: { format: "es" },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
} as any);
