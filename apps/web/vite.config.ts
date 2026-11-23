import preact from "@preact/preset-vite";
import { defineConfig } from "vite";

// The app is served by the Worker at /app/. In dev, /data is proxied to `wrangler dev` on :8787.
export default defineConfig({
  base: "/app/",
  plugins: [preact()],
  build: { outDir: "../worker/public/app", emptyOutDir: true, target: "es2022", sourcemap: true },
  server: { proxy: { "/data": "http://localhost:8787" } },
});
