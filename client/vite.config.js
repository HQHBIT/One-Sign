import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { writeFileSync, mkdirSync } from "node:fs";

// A unique id per build. It's injected into the bundle (__BUILD_ID__) AND written
// to dist/version.json, so the running app can compare the two and silently reload
// itself when a newer build has been deployed. See src/lib/autoUpdate.js.
const BUILD_ID = String(Date.now());

// After a production build, drop the id into dist/version.json (served alongside
// index.html) so clients can poll it to detect a new release.
const versionStamp = {
  name: "signflow-version-stamp",
  apply: "build",
  closeBundle() {
    try {
      mkdirSync("dist", { recursive: true });
      writeFileSync("dist/version.json", JSON.stringify({ build: BUILD_ID }) + "\n");
    } catch { /* non-fatal — auto-update just won't trigger */ }
  },
};

export default defineConfig({
  plugins: [react(), tailwindcss(), versionStamp],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  build: { target: "es2022" },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
  server: {
    port: 5173,
    open: true,
    proxy: {
      "/api": {
        target: "http://localhost:5001",
        changeOrigin: true
      }
    }
  }
});
