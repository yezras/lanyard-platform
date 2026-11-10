/**
 * lp-oop.32 — browser + vault-tree invariants (plan 0015 phase 8).
 * Static + existing cp_s3 tree path. No live Daytona / AWS.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const bffSrcRoot = join(__dirname, "../src");
const webSrcRoot = join(__dirname, "../../../apps/web/src");
const adminSrcRoot = join(__dirname, "../../../apps/admin/src");

const FORBIDDEN_BROWSER_TOKENS = [
  "HARNESS_SERVICE_TOKEN",
  "DAYTONA_API_KEY",
  "x-harness-service-token",
  "GATEWAY_RELAY_SECRET",
];

function walkFiles(root: string, acc: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return acc;
  }
  for (const name of entries) {
    const full = join(root, name);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walkFiles(full, acc);
      continue;
    }
    if (/\.(ts|tsx|js|jsx)$/.test(name)) {
      acc.push(full);
    }
  }
  return acc;
}

describe("short-stack invariants (lp-oop.32)", () => {
  it("browser apps never hold harness or Daytona tokens", () => {
    const files = [...walkFiles(webSrcRoot), ...walkFiles(adminSrcRoot)];
    expect(files.length).toBeGreaterThan(0);
    const hits: string[] = [];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const token of FORBIDDEN_BROWSER_TOKENS) {
        if (text.includes(token)) {
          hits.push(`${file}: ${token}`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  it("GET /api/vault/tree on VaultPlane=cp_s3 must not call ensure_online", () => {
    const appSrc = readFileSync(join(bffSrcRoot, "app.ts"), "utf8");
    const providerSrc = readFileSync(
      join(bffSrcRoot, "vault/cp-s3-provider.ts"),
      "utf8",
    );
    const planeTest = readFileSync(
      join(__dirname, "vault-plane.test.ts"),
      "utf8",
    );

    expect(appSrc).toContain('api.get("/vault/tree"');
    expect(appSrc).toMatch(/VaultPlane=cp_s3:[\s\S]*CP HTTP list \(no ensure_online\)/);
    expect(providerSrc).toContain("Does not call ensureOnline");
    expect(planeTest).toContain(
      "lists CP S3 without calling ensureOnline or Brain RPC",
    );
    expect(planeTest).toContain("expect(ctx.cpEnsureOnline).not.toHaveBeenCalled()");
    expect(planeTest).toContain("expect(ctx.bffEnsureOnline).not.toHaveBeenCalled()");
  });

  it("GET /api/settings/snapshot on cp_s3+harness must not ensure_online a guest", () => {
    const appSrc = readFileSync(join(bffSrcRoot, "app.ts"), "utf8");
    const harnessSrc = readFileSync(join(bffSrcRoot, "harness-client.ts"), "utf8");
    const settingsTest = readFileSync(
      join(__dirname, "settings-harness.test.ts"),
      "utf8",
    );
    expect(appSrc).toMatch(
      /Opening Tools must not ensure_online a guest/,
    );
    expect(harnessSrc).toContain("HARNESS_SETTINGS_SNAPSHOT_PATH");
    expect(settingsTest).toContain("expect(ctx.ensureOnline).not.toHaveBeenCalled()");
    expect(settingsTest).toContain("expect(ctx.invokeBrainRpc).not.toHaveBeenCalled()");
    expect(appSrc).toContain("projectVaultInventoryOntoSnapshot");
    expect(settingsTest).toContain("projects vault skills/workflows onto an empty harness snapshot");
  });

  it("BFF harness client is server-side only (not imported by web)", () => {
    const harnessSrc = readFileSync(join(bffSrcRoot, "harness-client.ts"), "utf8");
    expect(harnessSrc).toContain("HARNESS_SERVICE_TOKEN_HEADER");
    const webFiles = walkFiles(webSrcRoot);
    const imports: string[] = [];
    for (const file of webFiles) {
      const text = readFileSync(file, "utf8");
      if (
        text.includes("harness-client") ||
        text.includes("createHarnessClient")
      ) {
        imports.push(file);
      }
    }
    expect(imports).toEqual([]);
  });
});
