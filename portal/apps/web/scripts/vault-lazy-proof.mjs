import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";

const DEFAULT_APP_URL = "http://127.0.0.1:5179/?story=vault-lazy-proof";
const DEFAULT_SCREENSHOT = "artifacts/ui/lp-ypx13-vault-lazy-proof.png";
const DEFAULT_JSON = "artifacts/ui/lp-ypx13-vault-lazy-proof.json";
const PROJECT_PATH = "/Vault proof";
const HUGE_FOLDER_PATH = `${PROJECT_PATH}/Huge folder`;
const FILE_501_PATH = `${HUGE_FOLDER_PATH}/note-501.md`;
const LOAD_MORE_ID = `__vault_load-more:${HUGE_FOLDER_PATH}`;

const appUrl = process.argv[2] ?? DEFAULT_APP_URL;
const screenshotPath = resolve(process.cwd(), process.argv[3] ?? DEFAULT_SCREENSHOT);
const jsonPath = resolve(process.cwd(), process.argv[4] ?? DEFAULT_JSON);
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
    throw new Error("failed to allocate Chromium debugging port");
  }
  return address.port;
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

  close() {
    this.ws.close();
  }
}

async function evaluate(cdp, sessionId, expression) {
  const result = await cdp.send(
    "Runtime.evaluate",
    {
      expression,
      awaitPromise: true,
      returnByValue: true,
      userGesture: true,
    },
    sessionId,
  );
  if (result.exceptionDetails) {
    const text =
      result.exceptionDetails.exception?.description ??
      result.exceptionDetails.text ??
      "Runtime.evaluate failed";
    throw new Error(text);
  }
  return result.result?.value;
}

async function waitForExpression(cdp, sessionId, label, expression, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  let lastError = "";
  while (Date.now() < deadline) {
    try {
      if (await evaluate(cdp, sessionId, expression)) {
        return;
      }
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await delay(100);
  }
  throw new Error(`timed out waiting for ${label}${lastError ? `: ${lastError}` : ""}`);
}

function bodyContains(text) {
  return `document.body && document.body.innerText.includes(${JSON.stringify(text)})`;
}

function findTreeItemByIdFunction(id) {
  return `
  const expectedId = ${JSON.stringify(id)};
  const items = Array.from(document.querySelectorAll('[role="treeitem"]'));
  const item = items.find((el) => el.getAttribute("data-tree-id") === expectedId);
  if (!item) {
    throw new Error("tree item not found: " + expectedId);
  }
  item.scrollIntoView({ block: "center", inline: "nearest" });
`;
}

function toggleTreeItemById(id) {
  return `
(() => {
${findTreeItemByIdFunction(id)}
  const toggle = item.querySelector('button[aria-label="Toggle children"]');
  if (!toggle) {
    throw new Error("tree item has no toggle: " + expectedId);
  }
  toggle.click();
  return item.getAttribute("data-tree-id") || item.textContent;
})()
`;
}

function activateTreeItemById(id) {
  return `
(() => {
${findTreeItemByIdFunction(id)}
  const action = Array.from(item.querySelectorAll('button, a')).find(
    (el) => el.getAttribute("aria-label") !== "Toggle children",
  );
  if (action) {
    action.click();
  } else {
    const row = item.querySelector("div");
    (row || item).click();
  }
  return item.getAttribute("data-tree-id") || item.textContent;
})()
`;
}

async function runProof(cdp, sessionId) {
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    {
      width: 1440,
      height: 960,
      deviceScaleFactor: 1,
      mobile: false,
    },
    sessionId,
  );

  await cdp.send("Page.navigate", { url: appUrl }, sessionId);
  await waitForExpression(cdp, sessionId, "Vault proof root", bodyContains("Vault proof"));
  // lp-vnz.10: soft tree truncation no longer yellow-banners when lazy entries work.
  // Still assert the truncated honesty copy is absent for this story fixture.
  await waitForExpression(
    cdp,
    sessionId,
    "no truncated vault honesty banner",
    `!document.body.innerText.includes("Vault tree is truncated")`,
  );

  await evaluate(cdp, sessionId, toggleTreeItemById(PROJECT_PATH));
  await waitForExpression(cdp, sessionId, "top-level folder", bodyContains("Huge folder"));

  await evaluate(cdp, sessionId, toggleTreeItemById(HUGE_FOLDER_PATH));
  await waitForExpression(cdp, sessionId, "first lazy page", bodyContains("note-001.md"));
  await waitForExpression(cdp, sessionId, "load-more affordance", bodyContains("Load more"));

  await evaluate(cdp, sessionId, activateTreeItemById(LOAD_MORE_ID));
  await waitForExpression(cdp, sessionId, "second lazy page", bodyContains("note-501.md"));

  await evaluate(cdp, sessionId, activateTreeItemById(FILE_501_PATH));
  await waitForExpression(
    cdp,
    sessionId,
    "lazy loaded file content",
    bodyContains("Lazy-loaded proof file 501 opened"),
  );

  const proof = await evaluate(
    cdp,
    sessionId,
    `(() => {
      const text = document.body.innerText;
      const fetches = window.__vaultLazyProofFetchLog || [];
      return {
        url: window.location.href,
        hasRoot: text.includes("Vault proof"),
        hasHugeFolder: text.includes("Huge folder"),
        hasFirstPage: text.includes("note-001.md"),
        hasSecondPage: text.includes("note-501.md"),
        hasOpenedContent: text.includes("Lazy-loaded proof file 501 opened"),
        treeItemCount: document.querySelectorAll('[role="treeitem"]').length,
        fetches,
      };
    })()`,
  );

  const fetches = proof.fetches ?? [];
  const entriesFetches = fetches.filter((line) => line.includes("/api/vault/entries"));
  const contentFetches = fetches.filter((line) => line.includes("/api/vault/content"));
  if (entriesFetches.length !== 2) {
    throw new Error(`expected 2 entries fetches, saw ${entriesFetches.length}`);
  }
  if (!entriesFetches.some((line) => line.includes("cursor=page-2"))) {
    throw new Error("expected second entries fetch to include cursor=page-2");
  }
  if (!contentFetches.some((line) => line.includes("note-501.md"))) {
    throw new Error("expected content fetch for note-501.md");
  }

  await mkdir(dirname(screenshotPath), { recursive: true });
  const screenshot = await cdp.send(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: false },
    sessionId,
  );
  await writeFile(screenshotPath, Buffer.from(screenshot.data, "base64"));

  await mkdir(dirname(jsonPath), { recursive: true });
  await writeFile(
    jsonPath,
    `${JSON.stringify(
      {
        ...proof,
        screenshot: screenshotPath,
      },
      null,
      2,
    )}\n`,
  );

  return proof;
}

async function main() {
  const port = await freePort();
  const userDataDir = await mkdtemp(resolve(tmpdir(), "vault-lazy-proof-"));
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
    const proof = await runProof(cdp, sessionId);
    console.log(
      JSON.stringify(
        {
          ok: true,
          appUrl,
          screenshot: screenshotPath,
          json: jsonPath,
          treeItemCount: proof.treeItemCount,
          fetches: proof.fetches,
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
      await cdp?.send("Browser.close");
    } catch {
      chrome.kill("SIGKILL");
    }
    await rm(userDataDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : err);
  process.exit(1);
});
