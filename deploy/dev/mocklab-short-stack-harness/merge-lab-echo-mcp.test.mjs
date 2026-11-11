import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_LAB_ECHO_SERVER,
  assertFragmentMatchesLabEcho,
  ensureLabEchoMcpConfig,
  hasLabEchoMcp,
  labEchoMcpYaml,
  mergeLabEchoMcpText,
} from "./merge-lab-echo-mcp.mjs";

const FRAGMENT = join(
  import.meta.dirname,
  "../../daytona/agent-gateway/kitchen-sink-mcp.fragment.yaml",
);

describe("mergeLabEchoMcpText", () => {
  it("appends lab_echo when config has no mcp_servers", () => {
    const prev = [
      "tenant_id: mocklab",
      "tools:",
      "  catalog_search:",
      "    enabled: true",
      "",
    ].join("\n");
    const merged = mergeLabEchoMcpText(prev);
    assert.equal(merged.changed, true);
    assert.equal(hasLabEchoMcp(merged.text), true);
    assert.match(merged.text, /tenant_id: mocklab/);
    assert.match(merged.text, /catalog_search:/);
    assert.match(merged.text, /command: python3/);
    assert.doesNotMatch(merged.text, /\/mnt\/vault/);
    assert.equal(merged.text.includes(DEFAULT_LAB_ECHO_SERVER), true);
  });

  it("inserts lab_echo under an existing mcp_servers mapping", () => {
    const prev = [
      "mcp_servers:",
      "  other:",
      "    transport: http",
      "    url: https://example.invalid/mcp",
      "    enabled: true",
      "",
    ].join("\n");
    const merged = mergeLabEchoMcpText(prev);
    assert.equal(merged.changed, true);
    const echoIdx = merged.text.indexOf("  lab_echo:");
    const otherIdx = merged.text.indexOf("  other:");
    assert.ok(echoIdx > 0 && otherIdx > echoIdx);
  });

  it("adds a newline when mcp_servers: is the last line", () => {
    const merged = mergeLabEchoMcpText("mcp_servers:");
    assert.equal(merged.changed, true);
    assert.match(merged.text, /^mcp_servers:\n  lab_echo:/);
  });

  it("is idempotent when lab_echo is already present", () => {
    const once = mergeLabEchoMcpText("tenant_id: mocklab\n");
    const twice = mergeLabEchoMcpText(once.text);
    assert.equal(twice.changed, false);
    assert.equal(twice.text, once.text);
    assert.equal((twice.text.match(/lab_echo:/g) || []).length, 1);
  });

  it("does not treat a non-mcp lab_echo key as present", () => {
    const prev = "skills:\n  lab_echo:\n    enabled: true\n";
    const merged = mergeLabEchoMcpText(prev);
    assert.equal(merged.changed, true);
    assert.equal(hasLabEchoMcp(merged.text), true);
  });
});

describe("kitchen-sink fragment", () => {
  it("matches the harness lab_echo block", () => {
    const text = readFileSync(FRAGMENT, "utf8");
    assertFragmentMatchesLabEcho(text);
    assert.equal(labEchoMcpYaml().includes("requires_vault"), false);
  });
});

describe("ensureLabEchoMcpConfig", () => {
  it("skips when the stdio binary is missing", () => {
    const home = mkdtempSync(join(tmpdir(), "lab-echo-home-"));
    const result = ensureLabEchoMcpConfig({
      backendHome: home,
      serverPath: join(home, "missing.py"),
    });
    assert.deepEqual(result, { changed: false, skipped: "no_binary" });
  });

  it("writes config.yaml when the binary exists", () => {
    const home = mkdtempSync(join(tmpdir(), "lab-echo-home-"));
    const server = join(home, "lab_echo_server.py");
    writeFileSync(server, "# fixture\n");
    writeFileSync(join(home, "config.yaml"), "workflow:\n  enabled: true\n");
    const result = ensureLabEchoMcpConfig({
      backendHome: home,
      serverPath: server,
    });
    assert.equal(result.changed, true);
    const text = readFileSync(join(home, "config.yaml"), "utf8");
    assert.match(text, /workflow:/);
    assert.match(text, /lab_echo:/);
    assert.match(text, new RegExp(server.replace(/\\/g, "\\\\")));
    assert.doesNotMatch(text, /\/mnt\/vault/);
    const again = ensureLabEchoMcpConfig({
      backendHome: home,
      serverPath: server,
    });
    assert.equal(again.changed, false);
    assert.equal(again.present, true);
  });

  it("creates BACKEND_HOME when missing", () => {
    const parent = mkdtempSync(join(tmpdir(), "lab-echo-parent-"));
    const home = join(parent, "backend");
    const server = join(parent, "lab_echo_server.py");
    writeFileSync(server, "# fixture\n");
    mkdirSync(home, { recursive: true });
    const nested = join(home, "state");
    const result = ensureLabEchoMcpConfig({
      backendHome: nested,
      serverPath: server,
    });
    assert.equal(result.changed, true);
    assert.equal(hasLabEchoMcp(readFileSync(join(nested, "config.yaml"), "utf8")), true);
  });
});
