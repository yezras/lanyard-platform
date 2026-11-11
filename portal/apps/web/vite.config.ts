import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

import { shouldProxyTenantApiPath } from "./src/api/tenantBase";

const mcpInvokeBrowserStub = fileURLToPath(
  new URL("./src/shims/mcp-invoke-browser.ts", import.meta.url),
);

const bffTarget = process.env.BFF_URL ?? "http://127.0.0.1:4000";

export default defineConfig({
  server: {
    host: true,
    port: 3010,
    strictPort: true,
    proxy: {
      "/api": {
        target: bffTarget,
        changeOrigin: true,
      },
      "^/[a-z0-9][a-z0-9-]*/api": {
        target: bffTarget,
        changeOrigin: true,
        bypass(req) {
          const url = req.url ?? "";
          const pathname = url.split("?")[0] ?? "";
          if (!shouldProxyTenantApiPath(pathname)) {
            return url;
          }
        },
      },
    },
  },
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-router"],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "recharts", "motion"],
  },
  ssr: {
    // One React instance for Astryx Theme (React 19 `use()`) during SPA prerender.
    external: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "react-dom/server",
    ],
    noExternal: ["@astryxdesign/core", "@astryxdesign/theme-neutral", "tslib"],
  },
  plugins: [
    {
      name: "stub-mcp-invoke-browser",
      enforce: "pre",
      resolveId(source) {
        const id = (source.split("?")[0] ?? source).replaceAll("\\", "/");
        if (id.endsWith("mcp-invoke.js") || id.endsWith("mcp-invoke.ts")) {
          return mcpInvokeBrowserStub;
        }
        return null;
      },
    },
    tanstackStart({
      spa: {
        enabled: true,
        prerender: {
          outputPath: "/index.html",
        },
      },
      importProtection: {
        behavior: "error",
        client: {
          specifiers: [
            "@lanyard/auth/server",
            "@lanyard/db",
            "@prisma/adapter-pg",
            "@prisma/client",
          ],
        },
      },
    }),
    react(),
    tailwindcss(),
  ],
});
