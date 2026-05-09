import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Daemon proxy — UI fetches /daemon/events + /daemon/vault/inherited.
// Defaults to the fake daemon on :8421 (scripts/serve-fake-daemon.mjs).
// Override via env COMPILE_DAEMON_URL when wiring Ayaan's real daemon.
const daemonTarget = process.env.COMPILE_DAEMON_URL ?? "http://localhost:8421";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: "0.0.0.0",
    proxy: {
      "/daemon": {
        target: daemonTarget,
        changeOrigin: true,
        // No rewrite — daemon owns the full /daemon/* path space.
      },
    },
  },
  build: { target: "es2022", outDir: "dist" },
});
