import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const portalRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

export default defineConfig({
  envDir: portalRoot,
  server: {
    host: true,
    port: 3001,
    strictPort: true,
  },
  resolve: {
    dedupe: ["react", "react-dom", "@tanstack/react-router"],
  },
  ssr: {
    noExternal: ["@astryxdesign/core", "@astryxdesign/theme-neutral", "tslib"],
  },
  plugins: [
    tanstackStart({
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
