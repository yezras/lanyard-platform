import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import * as browser from "./browser.js";

const pkgRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

describe("SPA @lanyard/shared barrel (lp-xhf4.5)", () => {
  it("package.json browser export is dist/browser.js, not the node index", () => {
    const pkg = JSON.parse(
      readFileSync(join(pkgRoot, "package.json"), "utf8"),
    ) as { exports: { ".": { browser?: string; import?: string } } };
    expect(pkg.exports["."].browser).toBe("./dist/browser.js");
    expect(pkg.exports["."].import).toBe("./dist/index.js");
  });

  it("omits harness mcp-invoke so Vite never sees node:path", () => {
    expect("LAB_ECHO_MCP_NAME" in browser).toBe(false);
    expect("runHarnessMcpLabEchoTurn" in browser).toBe(false);
    expect("bindVaultMcpStdioSession" in browser).toBe(false);
    expect("harness-local" in browser).toBe(false);
    const src = readFileSync(join(pkgRoot, "src/browser.ts"), "utf8");
    expect(src).not.toMatch(/mcp-invoke/);
    expect(src).not.toMatch(/fake-http/);
    expect(src).not.toMatch(/vault-fs-turn/);
    expect(src).not.toMatch(/session-rpc/);
    expect(src).not.toMatch(/session-fake/);
    expect(src).not.toMatch(/node:/);
  });
});
