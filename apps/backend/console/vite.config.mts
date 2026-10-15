// Florayn Console (CONSOLE.md): our own admin, served by the backend at /console.
// Build: npm run build:console (from apps/backend) -> console-dist/
import { fileURLToPath } from "node:url"
import { defineConfig } from "vite"

const here = fileURLToPath(new URL(".", import.meta.url))

export default defineConfig({
  root: here,
  base: "/console/",
  // esbuild compiles the TSX; no React plugin needed (no fast refresh in a build)
  esbuild: { jsx: "automatic" },
  build: {
    outDir: fileURLToPath(new URL("../console-dist", import.meta.url)),
    emptyOutDir: true,
    assetsDir: "assets",
    target: "es2022",
    sourcemap: false,
  },
  server: {
    // npm run dev:console: the console on :5173, API calls to a local backend on :9000
    proxy: { "/admin": "http://localhost:9000", "/auth": "http://localhost:9000" },
  },
})
