/**
 * Load ONLYOFFICE DocsAPI via api.js (lp-5q6.27).
 * No npm package required — script loader is easier to mock and matches lab DS.
 *
 * Security (lp-p37.3): never inject api.js until the Document Server origin
 * is parsed and validated (allowlist + HTTPS / localhost rules).
 */

import {
  getOnlyOfficeDocumentServerUrl,
  onlyOfficeApiScriptUrl,
  validateOnlyOfficeDocumentServerUrl,
} from "./onlyOfficeFeatureFlag.js";
import type { DocsApiGlobal } from "./onlyOfficeTypes.js";

const SCRIPT_ATTR = "data-lanyard-onlyoffice-api";

type LoadState =
  | { status: "idle" }
  | { status: "loading"; promise: Promise<DocsApiGlobal> }
  | { status: "ready"; api: DocsApiGlobal }
  | { status: "error"; error: Error };

let loadState: LoadState = { status: "idle" };

/** Test helper: reset module cache between tests. */
export function resetOnlyOfficeApiLoaderForTests(): void {
  loadState = { status: "idle" };
  if (typeof document !== "undefined") {
    document
      .querySelectorAll(`script[${SCRIPT_ATTR}]`)
      .forEach((node) => node.remove());
  }
  if (typeof window !== "undefined" && window.DocsAPI) {
    // Leave injected mocks unless tests clear DocsAPI themselves.
  }
}

/**
 * Resolve DocsAPI. Uses existing window.DocsAPI when present (tests / story mock).
 * Otherwise injects api.js from a **validated** Document Server origin.
 */
export async function loadOnlyOfficeDocsApi(options?: {
  documentServerUrl?: string;
  /** Inject script loader for tests. */
  injectScript?: (src: string) => Promise<void>;
}): Promise<DocsApiGlobal> {
  if (typeof window !== "undefined" && window.DocsAPI?.DocEditor) {
    loadState = { status: "ready", api: window.DocsAPI };
    return window.DocsAPI;
  }

  if (loadState.status === "ready") {
    return loadState.api;
  }
  if (loadState.status === "loading") {
    return loadState.promise;
  }
  if (loadState.status === "error") {
    // Allow retry after failure.
    loadState = { status: "idle" };
  }

  const candidate =
    options?.documentServerUrl?.trim() || getOnlyOfficeDocumentServerUrl();
  const validated = validateOnlyOfficeDocumentServerUrl(candidate);
  if (!validated.ok) {
    const err = new Error(
      candidate
        ? `ONLYOFFICE Document Server URL rejected (${validated.reason})`
        : "ONLYOFFICE Document Server URL is not configured (set VITE_ONLYOFFICE_DS_URL)",
    );
    loadState = { status: "error", error: err };
    throw err;
  }

  const src = onlyOfficeApiScriptUrl(validated.origin);
  if (!src) {
    const err = new Error(
      "ONLYOFFICE Document Server URL failed validation before script injection",
    );
    loadState = { status: "error", error: err };
    throw err;
  }

  const promise = (async () => {
    const inject =
      options?.injectScript ??
      ((scriptSrc: string) => injectScriptTag(scriptSrc));
    await inject(src);
    if (!window.DocsAPI?.DocEditor) {
      throw new Error("DocsAPI.DocEditor missing after loading api.js");
    }
    return window.DocsAPI;
  })();

  loadState = { status: "loading", promise };

  try {
    const api = await promise;
    loadState = { status: "ready", api };
    return api;
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    loadState = { status: "error", error };
    throw error;
  }
}

function injectScriptTag(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (typeof document === "undefined") {
      reject(new Error("document unavailable"));
      return;
    }
    // Defense in depth: re-validate the concrete script URL origin.
    let scriptOrigin: string;
    try {
      const u = new URL(src);
      scriptOrigin = `${u.protocol}//${u.host}`.replace(/\/+$/, "");
    } catch {
      reject(new Error("Invalid ONLYOFFICE api.js URL"));
      return;
    }
    const recheck = validateOnlyOfficeDocumentServerUrl(scriptOrigin);
    if (!recheck.ok) {
      reject(
        new Error(
          `Refusing to inject ONLYOFFICE api.js from untrusted origin (${recheck.reason})`,
        ),
      );
      return;
    }

    const existing = Array.from(
      document.querySelectorAll<HTMLScriptElement>(`script[${SCRIPT_ATTR}]`),
    ).find((node) => node.getAttribute("src") === src);
    if (existing) {
      if (window.DocsAPI?.DocEditor) {
        resolve();
        return;
      }
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error(`Failed to load ONLYOFFICE api.js from ${src}`)),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.setAttribute(SCRIPT_ATTR, "1");
    script.onload = () => resolve();
    script.onerror = () =>
      reject(new Error(`Failed to load ONLYOFFICE api.js from ${src}`));
    document.head.appendChild(script);
  });
}
