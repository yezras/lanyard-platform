/**
 * Pinned HTTPS GET for integrations.sh (lp-hdzm.5).
 *
 * Host and scheme are constants. Redirects are followed only while the
 * hop stays on https://integrations.sh. Body size is capped without
 * trusting Content-Length.
 */
export const INTEGRATIONS_SH_HOST = "integrations.sh";
export const INTEGRATIONS_SH_ORIGIN = "https://integrations.sh";

export const INTEGRATIONS_SH_SEARCH_MAX_BYTES = 512 * 1024;
export const INTEGRATIONS_SH_SURFACE_MAX_BYTES = 1 * 1024 * 1024;
export const INTEGRATIONS_SH_ENVELOPE_MAX_BYTES = 8 * 1024 * 1024;
export const INTEGRATIONS_SH_MAX_REDIRECTS = 3;
export const INTEGRATIONS_SH_FETCH_TIMEOUT_MS = 15_000;
export const INTEGRATIONS_SH_READ_TIMEOUT_MS = 30_000;

export type IntegrationsShFetchFailure = "bad_url" | "oversized" | "fetch_failed";

export type IntegrationsShFetchResult =
  | { ok: true; bytes: Uint8Array; contentType?: string }
  | { ok: false; reason: IntegrationsShFetchFailure };

export type IntegrationsShFetchOptions = {
  fetchTimeoutMs?: number;
  maxReadDurationMs?: number;
  maxRedirects?: number;
  fetchImpl?: typeof fetch;
};

export function assertIntegrationsShUrl(
  urlString: string,
): { ok: true; url: URL } | { ok: false; reason: "bad_url" } {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    return { ok: false, reason: "bad_url" };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "bad_url" };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "bad_url" };
  }
  if (url.hostname.toLowerCase() !== INTEGRATIONS_SH_HOST) {
    return { ok: false, reason: "bad_url" };
  }
  if (url.port && url.port !== "443") {
    return { ok: false, reason: "bad_url" };
  }
  return { ok: true, url };
}

export function integrationsShSearchUrl(input: {
  q: string;
  kind?: string;
  limit?: number;
}): { ok: true; url: URL } | { ok: false; reason: "bad_url" } {
  const url = new URL("/api/search", INTEGRATIONS_SH_ORIGIN);
  url.searchParams.set("q", input.q);
  if (input.kind) {
    url.searchParams.set("kind", input.kind);
  }
  if (input.limit !== undefined) {
    url.searchParams.set("limit", String(input.limit));
  }
  return assertIntegrationsShUrl(url.toString());
}

export function integrationsShEnvelopeUrl(): {
  ok: true;
  url: URL;
} | { ok: false; reason: "bad_url" } {
  return assertIntegrationsShUrl(
    new URL("/api.json", INTEGRATIONS_SH_ORIGIN).toString(),
  );
}

export function integrationsShSurfaceUrl(domain: string): {
  ok: true;
  url: URL;
} | { ok: false; reason: "bad_url" } {
  return assertIntegrationsShUrl(
    new URL(
      `/api/${encodeURIComponent(domain)}/surface`,
      INTEGRATIONS_SH_ORIGIN,
    ).toString(),
  );
}

function resolvePositiveMs(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return value;
}

export async function readIntegrationsShBodyWithCap(input: {
  response: Response;
  maxBytes: number;
  maxReadDurationMs?: number;
  signal?: AbortSignal;
}): Promise<
  | { ok: true; bytes: Uint8Array }
  | { ok: false; reason: "oversized" | "fetch_failed" }
> {
  const maxBytes = input.maxBytes;
  if (!Number.isFinite(maxBytes) || maxBytes < 0) {
    return { ok: false, reason: "fetch_failed" };
  }
  if (!input.response.body) {
    return { ok: true, bytes: new Uint8Array(0) };
  }

  const maxReadDurationMs = resolvePositiveMs(
    input.maxReadDurationMs,
    INTEGRATIONS_SH_READ_TIMEOUT_MS,
  );
  const reader = input.response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let timedOut = false;

  const readTimeoutId = setTimeout(() => {
    timedOut = true;
    void reader.cancel("read_timeout");
  }, maxReadDurationMs);

  const onExternalAbort = (): void => {
    timedOut = true;
    void reader.cancel("aborted");
  };
  if (input.signal) {
    if (input.signal.aborted) {
      clearTimeout(readTimeoutId);
      await reader.cancel("aborted").catch(() => undefined);
      return { ok: false, reason: "fetch_failed" };
    }
    input.signal.addEventListener("abort", onExternalAbort, { once: true });
  }

  try {
    while (true) {
      if (timedOut || input.signal?.aborted) {
        return { ok: false, reason: "fetch_failed" };
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      if (total + value.byteLength > maxBytes) {
        await reader.cancel("oversized").catch(() => undefined);
        return { ok: false, reason: "oversized" };
      }
      total += value.byteLength;
      chunks.push(value);
    }
  } catch (err) {
    if (timedOut || input.signal?.aborted) {
      return { ok: false, reason: "fetch_failed" };
    }
    if (
      err &&
      typeof err === "object" &&
      "name" in err &&
      (err as { name: string }).name === "AbortError"
    ) {
      return { ok: false, reason: "fetch_failed" };
    }
    return { ok: false, reason: "fetch_failed" };
  } finally {
    clearTimeout(readTimeoutId);
    input.signal?.removeEventListener("abort", onExternalAbort);
  }

  if (timedOut || input.signal?.aborted) {
    return { ok: false, reason: "fetch_failed" };
  }

  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, bytes: out };
}

export function createIntegrationsShFetcher(
  options: IntegrationsShFetchOptions = {},
): (input: { url: string; maxBytes: number }) => Promise<IntegrationsShFetchResult> {
  const fetchTimeoutMs = resolvePositiveMs(
    options.fetchTimeoutMs,
    INTEGRATIONS_SH_FETCH_TIMEOUT_MS,
  );
  const maxReadDurationMs = resolvePositiveMs(
    options.maxReadDurationMs,
    INTEGRATIONS_SH_READ_TIMEOUT_MS,
  );
  const maxRedirects =
    options.maxRedirects === undefined
      ? INTEGRATIONS_SH_MAX_REDIRECTS
      : Math.max(0, Math.floor(options.maxRedirects));
  const fetchImpl = options.fetchImpl ?? fetch;

  return async (input) => {
    const initial = assertIntegrationsShUrl(input.url);
    if (!initial.ok) {
      return { ok: false, reason: "bad_url" };
    }

    let currentUrl = initial.url.toString();
    let redirectHops = 0;

    while (true) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => {
        controller.abort();
      }, fetchTimeoutMs);

      let response: Response;
      try {
        response = await fetchImpl(currentUrl, {
          method: "GET",
          redirect: "manual",
          headers: { accept: "application/json" },
          signal: controller.signal,
        });
      } catch {
        return { ok: false, reason: "fetch_failed" };
      } finally {
        clearTimeout(timeoutId);
      }

      if (response.status >= 300 && response.status < 400) {
        if (response.body) {
          await response.body.cancel().catch(() => undefined);
        }
        if (redirectHops >= maxRedirects) {
          return { ok: false, reason: "bad_url" };
        }
        const location = response.headers.get("location");
        if (!location) {
          return { ok: false, reason: "bad_url" };
        }
        let nextUrl: URL;
        try {
          nextUrl = new URL(location, currentUrl);
        } catch {
          return { ok: false, reason: "bad_url" };
        }
        const recheck = assertIntegrationsShUrl(nextUrl.toString());
        if (!recheck.ok) {
          return { ok: false, reason: "bad_url" };
        }
        currentUrl = recheck.url.toString();
        redirectHops += 1;
        continue;
      }

      if (response.status === 404) {
        if (response.body) {
          await response.body.cancel().catch(() => undefined);
        }
        return { ok: false, reason: "fetch_failed" };
      }

      if (!response.ok) {
        if (response.body) {
          await response.body.cancel().catch(() => undefined);
        }
        return { ok: false, reason: "fetch_failed" };
      }

      const lenHeader = response.headers.get("content-length");
      if (lenHeader) {
        const declared = Number(lenHeader);
        if (Number.isFinite(declared) && declared > input.maxBytes) {
          if (response.body) {
            await response.body.cancel().catch(() => undefined);
          }
          return { ok: false, reason: "oversized" };
        }
      }

      const read = await readIntegrationsShBodyWithCap({
        response,
        maxBytes: input.maxBytes,
        maxReadDurationMs,
      });
      if (!read.ok) {
        return { ok: false, reason: read.reason };
      }
      return {
        ok: true,
        bytes: read.bytes,
        contentType: response.headers.get("content-type") ?? undefined,
      };
    }
  };
}

export function parseIntegrationsShJson(
  bytes: Uint8Array,
): { ok: true; value: unknown } | { ok: false; reason: "invalid_payload" } {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, reason: "invalid_payload" };
  }
}
