import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import {
  DEFAULT_VAULT_FS_SERVER,
  VAULT_FS_CWD,
  VAULT_FS_MCP_NAME,
  ensureVaultFsMcpConfig,
  hasVaultFsMcp,
  mergeVaultFsMcpText,
  vaultFsMcpYaml,
} from "./merge-vault-fs-mcp.mjs";

const SERVER = join(
  import.meta.dirname,
  "../../artifacts/mocklab-vault-seed/mcp/vault_fs_server.py",
);

describe("mergeVaultFsMcpText", () => {
  it("appends vault_fs when config has no mcp_servers", () => {
    const prev = [
      "tenant_id: mocklab",
      "tools:",
      "  catalog_search:",
      "    enabled: true",
      "",
    ].join("\n");
    const merged = mergeVaultFsMcpText(prev);
    assert.equal(merged.changed, true);
    assert.equal(hasVaultFsMcp(merged.text), true);
    assert.match(merged.text, /tenant_id: mocklab/);
    assert.match(merged.text, /command: python3/);
    assert.match(merged.text, /requires_vault: true/);
    assert.match(merged.text, /cwd: \/mnt\/vault/);
    assert.equal(merged.text.includes(DEFAULT_VAULT_FS_SERVER), true);
    assert.doesNotMatch(merged.text, /MCP_API_KEY|sk-|Bearer /i);
  });

  it("inserts vault_fs under an existing mcp_servers mapping", () => {
    const prev = [
      "mcp_servers:",
      "  lab_echo:",
      "    transport: stdio",
      "    command: python3",
      "    args:",
      "      - /opt/lanyard/lab-mcp/lab_echo_server.py",
      "",
    ].join("\n");
    const merged = mergeVaultFsMcpText(prev);
    assert.equal(merged.changed, true);
    const vaultIdx = merged.text.indexOf(`  ${VAULT_FS_MCP_NAME}:`);
    const echoIdx = merged.text.indexOf("  lab_echo:");
    assert.ok(vaultIdx > 0 && echoIdx > vaultIdx);
    assert.match(merged.text, /lab_echo:/);
  });

  it("is idempotent when vault_fs is already present", () => {
    const once = mergeVaultFsMcpText("tenant_id: mocklab\n");
    const twice = mergeVaultFsMcpText(once.text);
    assert.equal(twice.changed, false);
    assert.equal(twice.text, once.text);
    assert.equal((twice.text.match(/vault_fs:/g) || []).length, 1);
  });

  it("does not treat a non-mcp vault_fs key as present", () => {
    const prev = "skills:\n  vault_fs:\n    enabled: true\n";
    const merged = mergeVaultFsMcpText(prev);
    assert.equal(merged.changed, true);
    assert.equal(hasVaultFsMcp(merged.text), true);
  });

  it("yaml block is vault_session shaped", () => {
    const yaml = vaultFsMcpYaml();
    assert.match(yaml, new RegExp(`cwd: ${VAULT_FS_CWD}`));
    assert.match(yaml, /requires_vault: true/);
    assert.match(yaml, /\/mnt\/vault\/mcp\/vault_fs_server\.py/);
  });
});

describe("ensureVaultFsMcpConfig", () => {
  it("writes config.yaml without requiring a harness-local binary", () => {
    const home = mkdtempSync(join(tmpdir(), "vault-fs-home-"));
    writeFileSync(join(home, "config.yaml"), "workflow:\n  enabled: true\n");
    const result = ensureVaultFsMcpConfig({ backendHome: home });
    assert.equal(result.changed, true);
    const text = readFileSync(join(home, "config.yaml"), "utf8");
    assert.match(text, /workflow:/);
    assert.match(text, /vault_fs:/);
    assert.match(text, /requires_vault: true/);
    assert.doesNotMatch(text, /MCP_API_KEY|sk-/);
    const again = ensureVaultFsMcpConfig({ backendHome: home });
    assert.equal(again.changed, false);
    assert.equal(again.present, true);
  });

  it("skips when BACKEND_HOME is empty", () => {
    const result = ensureVaultFsMcpConfig({ backendHome: "  " });
    assert.deepEqual(result, { changed: false, skipped: "no_backend_home" });
  });
});

describe("vault_fs_server.py", () => {
  it("lists vault paths over JSON-RPC and skips secret names", () => {
    const vault = mkdtempSync(join(tmpdir(), "vault-fs-probe-"));
    writeFileSync(join(vault, "welcome.md"), "hello vault\n");
    writeFileSync(join(vault, ".env"), "MCP_API_KEY=do-not-dump\n");
    const input = [
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe"}}}',
      '{"jsonrpc":"2.0","method":"notifications/initialized"}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/list","params":{}}',
      '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"list_vault","arguments":{}}}',
      "",
    ].join("\n");
    const proc = spawnSync("python3", [SERVER], {
      input,
      encoding: "utf8",
      env: { ...process.env, VAULT_ROOT: vault },
      timeout: 10_000,
    });
    assert.equal(proc.status, 0, proc.stderr);
    const lines = proc.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l.startsWith("{"));
    const parsed = lines.map((l) => JSON.parse(l));
    const init = parsed.find((m) => m.id === 1);
    assert.equal(init.result.serverInfo.name, "vault_fs");
    const listed = parsed.find((m) => m.id === 2);
    assert.equal(listed.result.tools[0].name, "list_vault");
    const called = parsed.find((m) => m.id === 3);
    const text = called.result.content[0].text;
    assert.match(text, /welcome\.md/);
    assert.doesNotMatch(text, /\.env/);
    assert.doesNotMatch(text, /MCP_API_KEY|do-not-dump/);
  });
});
