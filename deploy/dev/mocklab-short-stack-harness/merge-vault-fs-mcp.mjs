#!/usr/bin/env node
/**
 * Fill-missing vault_fs MCP into harness BACKEND_HOME/config.yaml (lp-oop.38.19).
 *
 * Tools snapshot and search_tool/use_tool read this document. vault_fs is
 * stdio that must see /mnt/vault: classified vault_session, bound to a
 * Daytona process session, never process/execute. The binary lives on the
 * Daytona vault mount, not this Fargate image. Do not invent tokens.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_VAULT_FS_SERVER = "/mnt/vault/mcp/vault_fs_server.py";
export const VAULT_FS_MCP_NAME = "vault_fs";
export const VAULT_FS_CWD = "/mnt/vault";

export function vaultFsServerBlock(serverPath = DEFAULT_VAULT_FS_SERVER) {
  return [
    `  ${VAULT_FS_MCP_NAME}:`,
    "    transport: stdio",
    "    enabled: true",
    "    command: python3",
    "    args:",
    `      - ${serverPath}`,
    `    cwd: ${VAULT_FS_CWD}`,
    "    requires_vault: true",
  ].join("\n");
}

export function vaultFsMcpYaml(serverPath = DEFAULT_VAULT_FS_SERVER) {
  return `mcp_servers:\n${vaultFsServerBlock(serverPath)}\n`;
}

function mcpServersBody(text) {
  const match = text.match(/(?:^|\n)mcp_servers:[ \t]*(?:\n|$)/);
  if (!match || match.index === undefined) return null;
  const lineStart = match[0].startsWith("\n") ? match.index + 1 : match.index;
  const afterKey = text.slice(lineStart + "mcp_servers:".length);
  const afterLineNl = afterKey.indexOf("\n");
  if (afterLineNl < 0) {
    return { start: text.length, body: "", needsNewline: true };
  }
  const bodyStart = lineStart + "mcp_servers:".length + afterLineNl + 1;
  const rest = text.slice(bodyStart);
  const lines = rest.split("\n");
  let consumed = 0;
  const bodyLines = [];
  for (const line of lines) {
    if (line === "" || /^[ \t]/.test(line) || /^[ \t]*#/.test(line)) {
      bodyLines.push(line);
      consumed += line.length + 1;
      continue;
    }
    break;
  }
  return { start: bodyStart, body: bodyLines.join("\n") };
}

export function hasVaultFsMcp(text) {
  const section = mcpServersBody(text ?? "");
  if (!section) return false;
  return new RegExp(`(^|\\n)[ \\t]+${VAULT_FS_MCP_NAME}[ \\t]*:`).test(
    section.body,
  );
}

export function mergeVaultFsMcpText(
  text,
  serverPath = DEFAULT_VAULT_FS_SERVER,
) {
  const src = text ?? "";
  if (hasVaultFsMcp(src)) {
    return { text: src, changed: false };
  }
  const block = vaultFsServerBlock(serverPath);
  const section = mcpServersBody(src);
  if (section) {
    const nl = section.needsNewline ? "\n" : "";
    const next = `${src.slice(0, section.start)}${nl}${block}\n${src.slice(section.start)}`;
    return { text: next, changed: true };
  }
  const prefix = src && !src.endsWith("\n") ? `${src}\n` : src;
  const gap = prefix && !prefix.endsWith("\n\n") ? "\n" : "";
  return { text: `${prefix}${gap}mcp_servers:\n${block}\n`, changed: true };
}

/**
 * Write vault_fs into BACKEND_HOME/config.yaml.
 * Fill-missing only. Binary is on Daytona /mnt/vault — do not require it
 * on this host. Unwritable home is skipped (do not crash the harness).
 */
export function ensureVaultFsMcpConfig(options) {
  const backendHome = (options?.backendHome ?? "").trim();
  const serverPath = (options?.serverPath ?? DEFAULT_VAULT_FS_SERVER).trim();
  if (!backendHome) {
    return { changed: false, skipped: "no_backend_home" };
  }
  const cfgPath = join(backendHome, "config.yaml");
  try {
    mkdirSync(backendHome, { recursive: true });
    const prev = existsSync(cfgPath) ? readFileSync(cfgPath, "utf8") : "";
    const merged = mergeVaultFsMcpText(prev, serverPath);
    if (!merged.changed) {
      return { changed: false, present: true, path: cfgPath };
    }
    writeFileSync(cfgPath, merged.text, { encoding: "utf8", mode: 0o644 });
    return { changed: true, present: true, path: cfgPath };
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : "";
    return {
      changed: false,
      skipped: code === "EACCES" ? "unwritable" : "write_failed",
    };
  }
}

function printHelp() {
  process.stdout.write(
    "Usage: merge-vault-fs-mcp.mjs --config PATH [--server PATH] [--write]\n",
  );
}

function parseArgs(argv) {
  const out = {
    config: "",
    server: DEFAULT_VAULT_FS_SERVER,
    write: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") out.help = true;
    else if (arg === "--write") out.write = true;
    else if (arg === "--config") out.config = argv[++i] ?? "";
    else if (arg === "--server") out.server = argv[++i] ?? out.server;
    else throw new Error(`unknown arg: ${arg}`);
  }
  return out;
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    printHelp();
    return 0;
  }
  if (!args.config) {
    printHelp();
    return 2;
  }
  const prev = existsSync(args.config) ? readFileSync(args.config, "utf8") : "";
  const merged = mergeVaultFsMcpText(prev, args.server);
  if (args.write) {
    mkdirSync(dirname(args.config), { recursive: true });
    writeFileSync(args.config, merged.text, { encoding: "utf8", mode: 0o644 });
  } else {
    process.stdout.write(merged.text);
  }
  return 0;
}

const invoked = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href
  : "";
if (invoked === import.meta.url) {
  try {
    process.exitCode = main();
  } catch (err) {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`,
    );
    process.exitCode = 1;
  }
}
