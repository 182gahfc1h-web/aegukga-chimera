import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => ({
  // GitHub Pages hosts project sites under /<repository>/, not the domain root.
  // A relative base keeps the same build usable regardless of the repository name.
  // Keep the normal root path during local development.
  base: mode === "production" ? "./" : "/",
  plugins: [react()],
  worker: { format: "es" },
  build: { target: "es2022", sourcemap: true },
  server: { host: "127.0.0.1", port: 5317, strictPort: true, allowedHosts: true },
  preview: { host: "127.0.0.1", port: 5318, strictPort: true, allowedHosts: true },
}));
