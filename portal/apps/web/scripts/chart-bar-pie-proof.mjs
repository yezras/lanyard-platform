/**
 * lp-a79.9: start Vite (optional), open ?story=chart-bar-pie via Chromium CDP,
 * assert bar + pie PortalChartCards + error card, write screenshot + JSON.
 *
 * Usage (from monorepo root or packages/web):
 *   node portal/packages/web/scripts/chart-bar-pie-proof.mjs
 *
 * Env:
 *   BASE_URL          — if set, skip spawning Vite (e.g. http://127.0.0.1:3023)
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
const SCREENSHOT_PATH = resolve(ARTIFACTS_DIR, "chart-bar-pie.png");
const JSON_PATH = resolve(ARTIFACTS_DIR, "chart-bar-pie.json");
const chromiumPath = process.env.CHROMIUM_BIN ?? "/snap/bin/chromium";

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
    `!!document.querySelector('[data-testid="chart-bar-pie-proof-story"]')`,
  );
  await waitForExpression(
    cdp,
    sessionId,
    "assistant bubble",
    `!!document.querySelector('[data-testid="chart-bar-pie-assistant-bubble"]')`,
  );
  await waitForExpression(
    cdp,
    sessionId,
    "bar chart card",
    `!!document.querySelector('[data-testid="portal-chart-card"][data-chart-type="bar"]')`,
  );
  await waitForExpression(
    cdp,
    sessionId,
    "pie chart card",
    `!!document.querySelector('[data-testid="portal-chart-card"][data-chart-type="pie"]')`,
  );
  await waitForExpression(
    cdp,
    sessionId,
    "error card",
    `!!document.querySelector('[data-testid="chart-spec-error-card"]')`,
  );

  // Wait until both plots have real painted SVG geometry (not empty shells).
  // Lazy PortalChartCard + Recharts can take >500ms after Suspense settles.
  const paintExpr = `(() => {
    const measure = (type) => {
      const card = document.querySelector(
        '[data-testid="portal-chart-card"][data-chart-type="' + type + '"]',
      );
      const plot = card?.querySelector('[data-testid="portal-chart-card-plot"]');
      const svg = plot?.querySelector("svg");
      if (!svg) return null;
      const rect = svg.getBoundingClientRect();
      const paths = svg.querySelectorAll("path").length;
      const rects = svg.querySelectorAll("rect").length;
      const sectors = svg.querySelectorAll(".recharts-pie-sector, .recharts-sector").length;
      const bars = svg.querySelectorAll(".recharts-bar-rectangle, .recharts-rectangle").length;
      return {
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        paths,
        rects,
        sectors,
        bars,
      };
    };
    const bar = measure("bar");
    const pie = measure("pie");
    const barOk = !!bar && bar.w >= 80 && bar.h >= 80 && (bar.bars > 0 || bar.rects > 0 || bar.paths > 0);
    const pieOk = !!pie && pie.w >= 80 && pie.h >= 80 && (pie.sectors > 0 || pie.paths > 0);
    return barOk && pieOk ? { bar, pie } : null;
  })()`;

  const paint = await waitForExpression(
    cdp,
    sessionId,
    "bar+pie SVG paint (non-zero geometry)",
    paintExpr,
    45_000,
  );

  const proof = await evaluate(
    cdp,
    sessionId,
    `(() => {
      const cards = [...document.querySelectorAll('[data-testid="portal-chart-card"]')];
      const bar = document.querySelector('[data-testid="portal-chart-card"][data-chart-type="bar"]');
      const pie = document.querySelector('[data-testid="portal-chart-card"][data-chart-type="pie"]');
      const err = document.querySelector('[data-testid="chart-spec-error-card"]');
      const barTitle = bar?.querySelector('[data-testid="portal-chart-card-title"]')?.textContent?.trim() ?? null;
      const pieTitle = pie?.querySelector('[data-testid="portal-chart-card-title"]')?.textContent?.trim() ?? null;
      const barPlot = bar?.querySelector('[data-testid="portal-chart-card-plot"]');
      const piePlot = pie?.querySelector('[data-testid="portal-chart-card-plot"]');
      const barSvgEl = barPlot?.querySelector('svg');
      const pieSvgEl = piePlot?.querySelector('svg');
      const barRect = barSvgEl?.getBoundingClientRect();
      const pieRect = pieSvgEl?.getBoundingClientRect();
      return {
        url: window.location.href,
        cardCount: cards.length,
        hasBar: !!bar,
        hasPie: !!pie,
        barTitle,
        pieTitle,
        barSvg: !!barSvgEl,
        pieSvg: !!pieSvgEl,
        barSvgWidth: barRect ? Math.round(barRect.width) : 0,
        barSvgHeight: barRect ? Math.round(barRect.height) : 0,
        pieSvgWidth: pieRect ? Math.round(pieRect.width) : 0,
        pieSvgHeight: pieRect ? Math.round(pieRect.height) : 0,
        hasError: !!err,
        errorCode: err?.getAttribute("data-error-code") ?? null,
        errorRole: err?.getAttribute("role") ?? null,
        proseBar: document.body.innerText.includes("Here is the quarterly breakdown:"),
        prosePie: document.body.innerText.includes("And the share of spend:"),
      };
    })()`,
  );

  // Attach measured paint stats from the wait step (authoritative).
  proof.barPaint = paint.bar;
  proof.piePaint = paint.pie;

  if (proof.cardCount !== 2) {
    throw new Error(`expected 2 chart cards, got ${proof.cardCount}`);
  }
  if (!proof.hasBar) throw new Error("bar portal-chart-card missing");
  if (!proof.hasPie) throw new Error("pie portal-chart-card missing");
  if (proof.barTitle !== "Q1 revenue vs cost") {
    throw new Error(`bar title mismatch: ${proof.barTitle}`);
  }
  if (proof.pieTitle !== "Spend by category") {
    throw new Error(`pie title mismatch: ${proof.pieTitle}`);
  }
  if (!proof.barSvg) throw new Error("bar plot has no SVG (blank chart)");
  if (!proof.pieSvg) throw new Error("pie plot has no SVG (blank chart)");
  if (proof.barSvgWidth < 80 || proof.barSvgHeight < 80) {
    throw new Error(
      `bar SVG too small: ${proof.barSvgWidth}x${proof.barSvgHeight}`,
    );
  }
  if (proof.pieSvgWidth < 80 || proof.pieSvgHeight < 80) {
    throw new Error(
      `pie SVG too small: ${proof.pieSvgWidth}x${proof.pieSvgHeight}`,
    );
  }
  if (!proof.hasError) throw new Error("chart-spec-error-card missing");
  if (proof.errorRole !== "alert") {
    throw new Error(`error role mismatch: ${proof.errorRole}`);
  }
  if (!["schema", "json", "limits", "empty"].includes(proof.errorCode)) {
    throw new Error(`unexpected error code: ${proof.errorCode}`);
  }
  if (!proof.proseBar || !proof.prosePie) {
    throw new Error("fixture prose missing from page");
  }

  await mkdir(dirname(SCREENSHOT_PATH), { recursive: true });
  const screenshot = await cdp.send(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: true },
    sessionId,
  );
  await writeFile(SCREENSHOT_PATH, Buffer.from(screenshot.data, "base64"));

  const evidence = {
    bead: "lp-a79.9",
    story: "chart-bar-pie",
    url: appUrl,
    screenshot: "artifacts/ui/lp-a79/chart-bar-pie.png",
    ...proof,
    notes:
      "Bar + pie charts in chat via ```chart fences (ChatMessageContent → PortalChartCard). SVG paint asserted (non-zero geometry + sectors/bars). Invalid fence shows ChartSpecErrorCard without crash.",
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
    await waitForHttpOk(`${base}/?story=chart-bar-pie`, "vite story", 90_000);
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
  const appUrl = `${baseUrl}/?story=chart-bar-pie`;

  const port = await freePort();
  const userDataDir = await mkdtemp(resolve(tmpdir(), "chart-bar-pie-proof-"));
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
          cardCount: evidence.cardCount,
          barTitle: evidence.barTitle,
          pieTitle: evidence.pieTitle,
          errorCode: evidence.errorCode,
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
