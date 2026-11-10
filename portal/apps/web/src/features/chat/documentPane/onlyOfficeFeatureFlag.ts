/**
 * Feature flag + Document Server origin for the ONLYOFFICE editor host.
 *
 * Security (lp-p37.3): production builds never take enablement or DS origin
 * from the query string. DS origin is derived from trusted build config,
 * validated against an allowlist, and requires HTTPS except for explicit
 * localhost/loopback lab use.
 *
 * Default **off** so existing VaultReader previews stay the only body renderer.
 * Enable via Vite env (production) or, in non-production only, runtime window
 * flags / lab URL query (stories).
 */

export const ONLYOFFICE_EDITOR_FLAG_NAME = "onlyoffice_editor" as const;

/** Optional runtime overrides for operators / lab (no secrets). */
export type LanyardFeatureFlagsWindow = {
  onlyoffice_editor?: boolean;
  /** Browser-reachable Document Server base, e.g. http://127.0.0.1:8080 */
  onlyoffice_document_server_url?: string;
};

declare global {
  interface Window {
    __LANYARD_FEATURE_FLAGS__?: LanyardFeatureFlagsWindow;
  }
}

/** Result of parsing + validating a Document Server base URL. */
export type DocumentServerUrlValidation =
  | { ok: true; origin: string }
  | { ok: false; reason: string };

/** @internal test seam — production builds always use import.meta.env.PROD. */
let productionModeForTests: boolean | undefined;

/** Test helper: force production/non-production behavior for flag + DS resolution. */
export function setOnlyOfficeProductionModeForTests(
  value: boolean | undefined,
): void {
  productionModeForTests = value;
}

function isProductionBuild(): boolean {
  if (typeof productionModeForTests === "boolean") {
    return productionModeForTests;
  }
  try {
    return Boolean(
      (import.meta.env as { PROD?: boolean | string }).PROD === true ||
        (import.meta.env as { PROD?: boolean | string }).PROD === "true",
    );
  } catch {
    return false;
  }
}

/**
 * Static Vite env reads so production packs always bake OnlyOffice keys into
 * `import.meta.env` (lp-zuh.12.1). Dynamic `env[name]` alone can omit unset or
 * only-dynamically-referenced VITE_* keys from the client env object.
 */
const ONLYOFFICE_VITE_ENV = {
  VITE_ONLYOFFICE_EDITOR: import.meta.env.VITE_ONLYOFFICE_EDITOR,
  VITE_FEATURE_ONLYOFFICE_EDITOR: import.meta.env.VITE_FEATURE_ONLYOFFICE_EDITOR,
  VITE_ONLYOFFICE_DS_URL: import.meta.env.VITE_ONLYOFFICE_DS_URL,
  VITE_ONLYOFFICE_DOCUMENT_SERVER_URL:
    import.meta.env.VITE_ONLYOFFICE_DOCUMENT_SERVER_URL,
  VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS:
    import.meta.env.VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS,
} as const;

type OnlyOfficeViteEnvKey = keyof typeof ONLYOFFICE_VITE_ENV;

function readViteFlag(name: string): string | undefined {
  try {
    if (name in ONLYOFFICE_VITE_ENV) {
      const value = ONLYOFFICE_VITE_ENV[name as OnlyOfficeViteEnvKey];
      if (typeof value === "boolean") {
        return value ? "true" : "false";
      }
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
      return undefined;
    }
    // Fallback for non-OnlyOffice keys / test hosts.
    const env = import.meta.env as Record<string, string | boolean | undefined>;
    const value = env[name];
    if (typeof value === "boolean") {
      return value ? "true" : "false";
    }
    if (typeof value === "string") {
      return value;
    }
  } catch {
    // Non-Vite test hosts
  }
  return undefined;
}

function truthy(raw: string | boolean | undefined | null): boolean {
  if (raw === true) return true;
  if (raw === false || raw == null) return false;
  const v = String(raw).trim().toLowerCase();
  return v === "1" || v === "true" || v === "yes" || v === "on";
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/** True for localhost / 127.0.0.1 / ::1 (IPv6 bracket form accepted). */
export function isLoopbackHostname(hostname: string): boolean {
  const h = hostname.trim().toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost" || h === "127.0.0.1" || h === "::1";
}

/**
 * Parse an absolute http(s) Document Server base into a normalized origin
 * (scheme + host + port, no path, no trailing slash). Rejects credentials.
 */
export function parseDocumentServerOrigin(
  raw: string,
): { origin: string; url: URL } | null {
  const trimmed = stripTrailingSlash(raw.trim());
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return null;
    }
    if (url.username || url.password) {
      return null;
    }
    // Prefer origin without default-port quirks; URL.host includes non-default port.
    const origin = stripTrailingSlash(`${url.protocol}//${url.host}`);
    return { origin, url };
  } catch {
    return null;
  }
}

/**
 * Origins trusted for browser script injection of DocsAPI api.js.
 * Built from VITE_ONLYOFFICE_DS_URL / VITE_ONLYOFFICE_DOCUMENT_SERVER_URL and
 * optional comma-separated VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS.
 */
export function getTrustedDocumentServerAllowlist(): string[] {
  const origins = new Set<string>();

  const primary =
    readViteFlag("VITE_ONLYOFFICE_DS_URL") ??
    readViteFlag("VITE_ONLYOFFICE_DOCUMENT_SERVER_URL");
  if (primary?.trim()) {
    const parsed = parseDocumentServerOrigin(primary);
    if (parsed) {
      origins.add(parsed.origin);
    }
  }

  const extra = readViteFlag("VITE_ONLYOFFICE_DS_ALLOWED_ORIGINS") ?? "";
  for (const part of extra.split(",")) {
    const parsed = parseDocumentServerOrigin(part);
    if (parsed) {
      origins.add(parsed.origin);
    }
  }

  return [...origins];
}

export type ValidateDocumentServerUrlOptions = {
  /**
   * When true, http:// is allowed for loopback hosts only.
   * Defaults to !production (lab / unit tests).
   */
  allowLocalhost?: boolean;
  /** Override allowlist (defaults to build-config allowlist). */
  allowlist?: string[];
  /**
   * When true, skip allowlist membership (scheme/host rules still apply).
   * Used only for explicit call-site overrides in tests/stories.
   */
  skipAllowlist?: boolean;
};

/**
 * Parse and validate a Document Server base URL before script injection.
 *
 * Rules:
 * - Must be absolute http(s) without credentials
 * - Remote origins require HTTPS
 * - Loopback may use HTTP only when allowLocalhost is true
 * - Non-loopback origins must appear on the trusted allowlist (unless skipAllowlist)
 */
export function validateOnlyOfficeDocumentServerUrl(
  raw: string,
  options?: ValidateDocumentServerUrlOptions,
): DocumentServerUrlValidation {
  const parsed = parseDocumentServerOrigin(raw);
  if (!parsed) {
    return { ok: false, reason: "invalid_url" };
  }

  const allowLocalhost = options?.allowLocalhost ?? !isProductionBuild();
  const loopback = isLoopbackHostname(parsed.url.hostname);

  if (parsed.url.protocol === "http:") {
    if (!(allowLocalhost && loopback)) {
      return { ok: false, reason: "https_required" };
    }
  }

  if (loopback && allowLocalhost) {
    return { ok: true, origin: parsed.origin };
  }

  if (options?.skipAllowlist) {
    return { ok: true, origin: parsed.origin };
  }

  const allowlist = options?.allowlist ?? getTrustedDocumentServerAllowlist();
  if (allowlist.length === 0) {
    return { ok: false, reason: "empty_allowlist" };
  }
  if (!allowlist.includes(parsed.origin)) {
    return { ok: false, reason: "not_allowlisted" };
  }

  return { ok: true, origin: parsed.origin };
}

/**
 * Whether the ONLYOFFICE editor host may replace previews for supported files.
 * Default false. Explicit `override` wins (tests).
 *
 * Production builds: Vite env only (no query-string enablement).
 * Non-production: runtime window flags and lab URL query still allowed.
 */
export function isOnlyOfficeEditorEnabled(override?: boolean): boolean {
  if (typeof override === "boolean") {
    return override;
  }

  const prod = isProductionBuild();

  if (typeof window !== "undefined") {
    const runtime = window.__LANYARD_FEATURE_FLAGS__?.onlyoffice_editor;
    if (typeof runtime === "boolean") {
      // Runtime window flag is operator/lab controlled, not end-user query input.
      // Still honored in production for staged flag flips without rebuild.
      return runtime;
    }
    // Query-string enablement is lab/story only — never in production builds.
    if (!prod) {
      try {
        const q = new URLSearchParams(window.location.search);
        if (q.has("onlyoffice_editor") || q.has("onlyoffice")) {
          const raw =
            q.get("onlyoffice_editor") ?? q.get("onlyoffice") ?? "1";
          return truthy(raw === "" ? "1" : raw);
        }
      } catch {
        // ignore
      }
    }
  }

  return truthy(
    readViteFlag("VITE_ONLYOFFICE_EDITOR") ??
      readViteFlag("VITE_FEATURE_ONLYOFFICE_EDITOR"),
  );
}

/**
 * Browser-reachable Document Server origin (no trailing slash).
 * Empty when unset or when the candidate fails validation — host surfaces a
 * load_failure error instead of injecting an untrusted script.
 *
 * Production: Vite env only (no query string, no untrusted runtime DS URL).
 * Non-production: window flags and lab query params may supply a candidate,
 * still subject to HTTPS / localhost / allowlist validation.
 *
 * Explicit `override` (tests/stories) applies scheme rules only.
 */
export function getOnlyOfficeDocumentServerUrl(override?: string): string {
  if (typeof override === "string") {
    const validated = validateOnlyOfficeDocumentServerUrl(override, {
      skipAllowlist: true,
      allowLocalhost: true,
    });
    return validated.ok ? validated.origin : "";
  }

  const prod = isProductionBuild();
  let raw = "";

  // Trusted build-time config always wins when set.
  const fromEnv =
    readViteFlag("VITE_ONLYOFFICE_DS_URL") ??
    readViteFlag("VITE_ONLYOFFICE_DOCUMENT_SERVER_URL");
  if (fromEnv?.trim()) {
    raw = fromEnv.trim();
  }

  // Untrusted runtime / query DS URL overrides: non-production only (lp-p37.3).
  if (!raw && !prod && typeof window !== "undefined") {
    const runtime =
      window.__LANYARD_FEATURE_FLAGS__?.onlyoffice_document_server_url;
    if (typeof runtime === "string" && runtime.trim()) {
      raw = runtime.trim();
    }
    if (!raw) {
      try {
        const q = new URLSearchParams(window.location.search);
        const fromQuery =
          q.get("onlyoffice_ds_url") ??
          q.get("ds_url") ??
          q.get("document_server");
        if (fromQuery?.trim()) {
          raw = fromQuery.trim();
        }
      } catch {
        // ignore
      }
    }
  }

  if (!raw) {
    return "";
  }

  const validated = validateOnlyOfficeDocumentServerUrl(raw);
  return validated.ok ? validated.origin : "";
}

/**
 * Path to DocsAPI loader relative to Document Server origin.
 * Returns empty string when the base fails validation (never emits an
 * attacker-controlled script src).
 */
export function onlyOfficeApiScriptUrl(documentServerUrl: string): string {
  const base = stripTrailingSlash(documentServerUrl);
  if (!base) {
    return "";
  }
  const validated = validateOnlyOfficeDocumentServerUrl(base);
  if (!validated.ok) {
    return "";
  }
  return `${validated.origin}/web-apps/apps/api/documents/api.js`;
}

/**
 * CSP `script-src` host sources for approved ONLYOFFICE Document Server origins.
 * Used by deploy response-headers policy / operator docs (lp-p37.3).
 */
export function onlyOfficeScriptSrcCspSources(
  allowlist: string[] = getTrustedDocumentServerAllowlist(),
): string[] {
  return allowlist
    .map((entry) => parseDocumentServerOrigin(entry)?.origin)
    .filter((origin): origin is string => Boolean(origin));
}

/**
 * Build a Content-Security-Policy fragment that allows DocsAPI only from
 * approved Document Server origins (plus self for the portal bundle).
 */
export function buildOnlyOfficeScriptSrcCsp(
  allowlist: string[] = getTrustedDocumentServerAllowlist(),
): string {
  const hosts = onlyOfficeScriptSrcCspSources(allowlist);
  const parts = ["'self'", ...hosts];
  return `script-src ${parts.join(" ")};`;
}
