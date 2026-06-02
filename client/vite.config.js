import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
