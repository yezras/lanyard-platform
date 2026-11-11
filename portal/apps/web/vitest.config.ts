import path from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const webRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: {
    // Match vite.config.ts — single React for recharts in tests (lp-uxy.11).
    dedupe: ["react", "react-dom", "@tanstack/react-router"],
    alias: {
      react: path.resolve(webRoot, "node_modules/react"),
      "react-dom": path.resolve(webRoot, "node_modules/react-dom"),
      "@tanstack/react-router": path.resolve(
        webRoot,
        "node_modules/@tanstack/react-router",
      ),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
  },
});
