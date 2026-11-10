/**
 * lp-a79.13: start Vite (optional), open ?story=table-badge-links via Chromium CDP,
 * assert Astryx table + High badge + vault/external links, write screenshot + JSON.
 *
 * Usage (from monorepo root or packages/web):
 *   node portal/packages/web/scripts/table-badge-links-proof.mjs
 *
 * Env:
 *   BASE_URL          — if set, skip spawning Vite (e.g. http://127.0.0.1:3022)
 *   CHROMIUM_BIN      — default /snap/bin/chromium
 *   UI_ARTIFACTS      — dir for screenshot/json (default <repo>/artifacts/ui/lp-a79)
 */

import { spawn } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = resolve(__dirname, "..");
const MONOREPO_ROOT = resolve(WEB_ROOT, "../../..");
const DEFAULT_ARTIFACTS = resolve(MONOREPO_ROOT, "artifacts/ui/lp-a79");
const ARTIFACTS_DIR = resolve(
  process.cwd(),
  process.env.UI_ARTIFACTS ?? DEFAULT_ARTIFACTS,
);
const SCREENSHOT_PATH = resolve(ARTIFACTS_DIR, "table-badge-links.png");
const JSON_PATH = resolve(ARTIFACTS_DIR, "table-badge-links.json");
const chromiumPath = process.env.CHROMIUM_BIN ?? "/snap/bin/chromium";

const PROJECT_VAULT_PATH = "/home/u/Core";
const VAULT_HREF = "docs/runbooks/finding-f12.md";
const VAULT_RESOLVED = `${PROJECT_VAULT_PATH}/${VAULT_HREF}`;
const EXTERNAL_HREF = "https://linear.app/example/issue/LIN-204";

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once("error", rejectListen);
    server.listen(0, "127.0.0.1", resolveListen);
  });
  const address = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  if (!address || typeof address === "string") {
    throw new Error("failed to allocate port");
  }
  return address.port;
}

async function waitForHttpOk(url, label, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok || res.status === 200) {
        return;
      }
      lastError = `${res.status} ${res.statusText}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await delay(200);
  }
  throw new Error(`timed out waiting for ${label}: ${lastError}`);
}

async function waitForJson(url, label, timeoutMs = 15_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        return await res.json();
      }
      lastError = `${res.status} ${res.statusText}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await delay(150);
  }
  throw new Error(`timed out waiting for ${label}: ${lastError}`);
}

class CdpClient {
  constructor(ws) {
    this.ws = ws;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Set();
    ws.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id);
          if (message.error) {
            pending.reject(new Error(JSON.stringify(message.error)));
          } else {
            pending.resolve(message.result ?? {});
          }
        }
        return;
      }
      for (const listener of this.listeners) {
        listener(message);
      }
    });
  }

  static async connect(wsUrl) {
    const ws = new WebSocket(wsUrl);
    await new Promise((resolveOpen, rejectOpen) => {
      ws.addEventListener("open", resolveOpen, { once: true });
      ws.addEventListener("error", rejectOpen, { once: true });
    });
    return new CdpClient(ws);
  }

  send(method, params = {}, sessionId = undefined) {
    const id = this.nextId++;
    const payload =
      sessionId === undefined
        ? { id, method, params }
        : { id, method, params, sessionId };
    const promise = new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend });
    });
    this.ws.send(JSON.stringify(payload));
    return promise;
  }

  onEvent(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  close() {
    try {
      this.ws.close();
    } catch {
      /* ignore */
    }
  }
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    "Runtime.evaluate",
    {
      expression,
      returnByValue: true,
      awaitPromise: true,
    },
    sessionId,
  );
  if (result.exceptionDetails) {
    throw new Error(
      `evaluate failed: ${JSON.stringify(result.exceptionDetails)}`,
    );
  }
  return result.result?.value;
}

async function waitForExpression(
  cdp,
  sessionId,
  label,
  expression,
  timeoutMs = 20_000,
) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await evaluate(cdp, sessionId, expression);
    if (last) {
      return last;
    }
    await delay(150);
  }
  throw new Error(`timed out waiting for ${label}; last=${JSON.stringify(last)}`);
}

async function runProof(cdp, sessionId, appUrl) {
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    {
      width: 1280,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    },
    sessionId,
  );

  await cdp.send("Page.navigate", { url: appUrl }, sessionId);

  await waitForExpression(
    cdp,
    sessionId,
    "story root",
    `!!document.querySelector('[data-testid="table-badge-links-proof-story"]')`,
  );
  await waitForExpression(
    cdp,
    sessionId,
    "portal table card",
    `!!document.querySelector('[data-testid="portal-table-card"]')`,
  );
  await waitForExpression(
    cdp,
    sessionId,
    "High badge",
    `document.body.innerText.includes("High")`,
  );
  await waitForExpression(
    cdp,
    sessionId,
    "table element",
    // Astryx uses a native <table> (implicit table role; no role= attribute).
    `!!document.querySelector('[data-testid="portal-table-card"] table.astryx-table, [data-testid="portal-table-card"] table')`,
  );

  // Click first vault link (runbook.md)
  await evaluate(
    cdp,
    sessionId,
    `(() => {
      const el = document.querySelector('[data-testid="portal-table-vault-link"]');
      if (!el) throw new Error('no vault link');
      el.click();
      return true;
    })()`,
  );

  const proof = await evaluate(
    cdp,
    sessionId,
    `(() => {
      const card = document.querySelector('[data-testid="portal-table-card"]');
      const table = card?.querySelector('table');
      const badges = document.querySelectorAll('[data-testid="portal-table-badge"]');
      const external = document.querySelector('[data-testid="portal-table-external-link"]');
      const lastClick = document.querySelector('[data-testid="table-badge-links-last-vault-click"]')?.textContent ?? '';
      const vaultResolved = document.querySelector('[data-testid="table-badge-links-vault-resolved"]')?.textContent ?? '';
      const vaultHref = document.querySelector('[data-testid="table-badge-links-vault-href"]')?.textContent ?? '';
      return {
        url: window.location.href,
        hasCard: !!card,
        hasTableRole: !!table,
        tableTag: table?.tagName ?? null,
        badgeCount: badges.length,
        hasHigh: document.body.innerText.includes("High"),
        externalHref: external?.getAttribute("href") ?? null,
        externalTarget: external?.getAttribute("target") ?? null,
        vaultHref,
        vaultResolved,
        lastVaultClick: lastClick,
      };
    })()`,
  );

  if (!proof.hasCard) throw new Error("portal-table-card missing");
  if (!proof.hasTableRole) throw new Error("native <table> missing inside portal-table-card");
  if (!proof.hasHigh) throw new Error("High badge text missing");
  if (proof.badgeCount < 1) throw new Error("no badges");
  if (proof.externalHref !== EXTERNAL_HREF) {
    throw new Error(`external href mismatch: ${proof.externalHref}`);
  }
  if (proof.externalTarget !== "_blank") {
    throw new Error(`external target mismatch: ${proof.externalTarget}`);
  }
  if (proof.vaultHref !== VAULT_HREF) {
    throw new Error(`vault href mismatch: ${proof.vaultHref}`);
  }
  if (proof.vaultResolved !== VAULT_RESOLVED) {
    throw new Error(`vault resolved mismatch: ${proof.vaultResolved}`);
  }
  if (proof.lastVaultClick !== VAULT_RESOLVED) {
    throw new Error(`vault click path mismatch: ${proof.lastVaultClick}`);
  }

  await mkdir(dirname(SCREENSHOT_PATH), { recursive: true });
  const screenshot = await cdp.send(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: true },
    sessionId,
  );
  await writeFile(SCREENSHOT_PATH, Buffer.from(screenshot.data, "base64"));

  const evidence = {
    bead: "lp-a79.13",
    story: "table-badge-links",
    url: appUrl,
    screenshot: SCREENSHOT_PATH,
    projectVaultPath: PROJECT_VAULT_PATH,
    vaultHref: VAULT_HREF,
    vaultResolvedPath: VAULT_RESOLVED,
    externalHref: EXTERNAL_HREF,
    ...proof,
    notes:
      "Astryx Table in chat via ```table fence. Vault path documented above; click invokes onCitationClick with project-joined path.",
  };
  await writeFile(JSON_PATH, `${JSON.stringify(evidence, null, 2)}\n`);

  return evidence;
}

async function startVite() {
  const port = await freePort();
  const viteBin = resolve(WEB_ROOT, "node_modules/vite/bin/vite.js");
  const child = spawn(
    process.execPath,
    [viteBin, "--port", String(port), "--host", "127.0.0.1", "--strictPort"],
    {
      cwd: WEB_ROOT,
      env: {
        ...process.env,
        BFF_URL: process.env.BFF_URL ?? "http://127.0.0.1:4000",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-8000);
  });
  child.stdout.on("data", () => {
    /* drain */
  });
  const base = `http://127.0.0.1:${port}`;
  try {
    await waitForHttpOk(`${base}/?story=table-badge-links`, "vite story", 90_000);
  } catch (err) {
    child.kill("SIGTERM");
    throw new Error(`${err.message}\n--- vite stderr ---\n${stderr}`);
  }
  return {
    base,
    stop: () => {
      child.kill("SIGTERM");
    },
  };
}

async function main() {
  let vite = null;
  let baseUrl = process.env.BASE_URL?.replace(/\/$/, "") ?? null;
  if (!baseUrl) {
    vite = await startVite();
    baseUrl = vite.base;
  }
  const appUrl = `${baseUrl}/?story=table-badge-links`;

  const port = await freePort();
  const userDataDir = await mkdtemp(resolve(tmpdir(), "table-badge-links-proof-"));
  let stderr = "";
  const chrome = spawn(
    chromiumPath,
    [
      "--headless=new",
      "--disable-gpu",
      "--disable-dev-shm-usage",
      "--no-first-run",
      "--no-default-browser-check",
      "--no-sandbox",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${userDataDir}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  chrome.stderr.on("data", (chunk) => {
    stderr = `${stderr}${chunk.toString()}`.slice(-6000);
  });

  let cdp;
  try {
    const version = await waitForJson(
      `http://127.0.0.1:${port}/json/version`,
      "Chromium CDP",
    );
    cdp = await CdpClient.connect(version.webSocketDebuggerUrl);
    const { targetId } = await cdp.send("Target.createTarget", {
      url: "about:blank",
    });
    const { sessionId } = await cdp.send("Target.attachToTarget", {
      targetId,
      flatten: true,
    });
    const evidence = await runProof(cdp, sessionId, appUrl);
    console.log(
      JSON.stringify(
        {
          ok: true,
          appUrl,
          screenshot: SCREENSHOT_PATH,
          json: JSON_PATH,
          vaultResolvedPath: evidence.vaultResolvedPath,
          badgeCount: evidence.badgeCount,
        },
        null,
        2,
      ),
    );
  } catch (err) {
    if (stderr) {
      console.error(stderr);
    }
    throw err;
  } finally {
    try {
      cdp?.close();
    } catch {
      /* ignore */
    }
    chrome.kill("SIGTERM");
    vite?.stop();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
