#!/usr/bin/env node
/**
 * Fill-missing lab_echo MCP into harness BACKEND_HOME/config.yaml (lp-oop.38.17).
 *
 * Tools snapshot and search_tool/use_tool read this document. BFF
 * SETTINGS_SEED_LAB_MCP does not. Guest LANYARD_ENTRY_SEED_MCP is tool-only N/A.
 *
 * lab_echo is harness-local stdio (no /mnt/vault). Do not invent tokens.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const DEFAULT_LAB_ECHO_SERVER = "/opt/lanyard/lab-mcp/lab_echo_server.py";
export const LAB_ECHO_MCP_NAME = "lab_echo";

export function labEchoServerBlock(serverPath = DEFAULT_LAB_ECHO_SERVER) {
  return [
    `  ${LAB_ECHO_MCP_NAME}:`,
    "    transport: stdio",
    "    enabled: true",
    "    command: python3",
    "    args:",
    `      - ${serverPath}`,
  ].join("\n");
}

export function labEchoMcpYaml(serverPath = DEFAULT_LAB_ECHO_SERVER) {
  return `mcp_servers:\n${labEchoServerBlock(serverPath)}\n`;
}

function mcpServersBody(text) {
  const match = text.match(/(?:^|\n)mcp_servers:[ \t]*(?:\n|$)/);
  if (!match || match.index === undefined) return null;
  const lineStart =
    match[0].startsWith("\n") ? match.index + 1 : match.index;
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
    if (
      line === "" ||
      /^[ \t]/.test(line) ||
      /^[ \t]*#/.test(line)
    ) {
      bodyLines.push(line);
      consumed += line.length + 1;
      continue;
    }
    break;
  }
  return { start: bodyStart, body: bodyLines.join("\n") };
}

export function hasLabEchoMcp(text) {
  const section = mcpServersBody(text ?? "");
  if (!section) return false;
  return new RegExp(
    `(^|\\n)[ \\t]+${LAB_ECHO_MCP_NAME}[ \\t]*:`,
  ).test(section.body);
}

export function mergeLabEchoMcpText(
  text,
  serverPath = DEFAULT_LAB_ECHO_SERVER,
) {
  const src = text ?? "";
  if (hasLabEchoMcp(src)) {
    return { text: src, changed: false };
  }
  const echo = labEchoServerBlock(serverPath);
  const section = mcpServersBody(src);
  if (section) {
    const nl = section.needsNewline ? "\n" : "";
    const next = `${src.slice(0, section.start)}${nl}${echo}\n${src.slice(section.start)}`;
    return { text: next, changed: true };
  }
  const prefix = src && !src.endsWith("\n") ? `${src}\n` : src;
  const gap = prefix && !prefix.endsWith("\n\n") ? "\n" : "";
  return { text: `${prefix}${gap}mcp_servers:\n${echo}\n`, changed: true };
}

export function fragmentMcpServersYaml(fragmentText) {
  const lines = (fragmentText ?? "").split("\n");
  const kept = [];
  let started = false;
  for (const line of lines) {
    if (!started) {
      if (/^mcp_servers:[ \t]*$/.test(line)) {
        started = true;
        kept.push(line);
      }
      continue;
    }
    if (line.startsWith("#")) continue;
    kept.push(line);
  }
  return `${kept.join("\n").replace(/\n+$/, "")}\n`;
}

export function assertFragmentMatchesLabEcho(fragmentText, serverPath = DEFAULT_LAB_ECHO_SERVER) {
  const fromFragment = fragmentMcpServersYaml(fragmentText);
  const expected = labEchoMcpYaml(serverPath);
  if (fromFragment !== expected) {
    throw new Error(
      `kitchen-sink MCP fragment does not match harness lab_echo block\n--- fragment ---\n${fromFragment}--- expected ---\n${expected}`,
    );
  }
}

/**
 * Write lab_echo into BACKEND_HOME/config.yaml when the stdio binary exists.
 * Fill-missing only. Unwritable home is skipped (do not crash the harness).
 */
export function ensureLabEchoMcpConfig(options) {
  const backendHome = (options?.backendHome ?? "").trim();
  const serverPath = (options?.serverPath ?? DEFAULT_LAB_ECHO_SERVER).trim();
  if (!backendHome) {
    return { changed: false, skipped: "no_backend_home" };
  }
  if (!existsSync(serverPath)) {
    return { changed: false, skipped: "no_binary" };
  }
  const cfgPath = join(backendHome, "config.yaml");
  try {
    mkdirSync(backendHome, { recursive: true });
    const prev = existsSync(cfgPath) ? readFileSync(cfgPath, "utf8") : "";
    const merged = mergeLabEchoMcpText(prev, serverPath);
    if (!merged.changed) {
      return { changed: false, present: true, path: cfgPath };
    }
    writeFileSync(cfgPath, merged.text, { encoding: "utf8", mode: 0o644 });
    return { changed: true, present: true, path: cfgPath };
  } catch (err) {
    const code = err && typeof err === "object" && "code" in err ? err.code : "";
    return { changed: false, skipped: code === "EACCES" ? "unwritable" : "write_failed" };
  }
}

function printHelp() {
  process.stdout.write(
    "Usage: merge-lab-echo-mcp.mjs --config PATH [--server PATH] [--write]\n" +
      "       merge-lab-echo-mcp.mjs --assert-fragment PATH [--server PATH]\n",
  );
}

function parseArgs(argv) {
  const out = {
    config: "",
    server: DEFAULT_LAB_ECHO_SERVER,
    fragment: "",
    write: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "-h" || arg === "--help") out.help = true;
    else if (arg === "--write") out.write = true;
    else if (arg === "--config") out.config = argv[++i] ?? "";
    else if (arg === "--server") out.server = argv[++i] ?? out.server;
    else if (arg === "--assert-fragment") out.fragment = argv[++i] ?? "";
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
  if (args.fragment) {
    const text = readFileSync(args.fragment, "utf8");
    assertFragmentMatchesLabEcho(text, args.server);
    process.stdout.write("fragment matches lab_echo harness block\n");
    return 0;
  }
  if (!args.config) {
    printHelp();
    return 2;
  }
  const prev = existsSync(args.config) ? readFileSync(args.config, "utf8") : "";
  const merged = mergeLabEchoMcpText(prev, args.server);
  if (args.write) {
    mkdirSync(dirname(args.config), { recursive: true });
    writeFileSync(args.config, merged.text, { encoding: "utf8", mode: 0o644 });
  } else {
    process.stdout.write(merged.text);
  }
  return 0;
}

const invoked = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (invoked === import.meta.url) {
  try {
    process.exitCode = main();
  } catch (err) {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  }
}
