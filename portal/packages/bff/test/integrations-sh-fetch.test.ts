import { describe, expect, it } from "vitest";

import { parseCatalogDomain } from "../src/connector-source.js";
import {
  assertIntegrationsShUrl,
  createIntegrationsShFetcher,
  integrationsShEnvelopeUrl,
  integrationsShSearchUrl,
  integrationsShSurfaceUrl,
} from "../src/integrations-sh-fetch.js";
import { createIntegrationsShSource } from "../src/integrations-sh-source.js";

const PINNED = "https://integrations.sh/api.json";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
}

function chunkedResponse(options: {
  chunks: Uint8Array[];
  contentLength?: number | null;
  status?: number;
  headers?: Record<string, string>;
  onCancel?: () => void;
}): Response {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        for (const chunk of options.chunks) {
          if (cancelled) return;
          controller.enqueue(chunk);
        }
        if (!cancelled) controller.close();
      } catch {
        // cancel during enqueue
      }
    },
    cancel() {
      cancelled = true;
      options.onCancel?.();
    },
  });
  const headers = new Headers(options.headers ?? {});
  if (options.contentLength === null) {
    headers.delete("content-length");
  } else if (options.contentLength !== undefined) {
    headers.set("content-length", String(options.contentLength));
  }
  return new Response(stream, {
    status: options.status ?? 200,
    headers,
  });
}

describe("assertIntegrationsShUrl (lp-hdzm.5)", () => {
  it("accepts the pinned origin and built catalog paths", () => {
    expect(assertIntegrationsShUrl(PINNED).ok).toBe(true);
    expect(integrationsShEnvelopeUrl().ok).toBe(true);
    expect(integrationsShSearchUrl({ q: "stripe" }).ok).toBe(true);
    expect(integrationsShSurfaceUrl("stripe.com").ok).toBe(true);
    const surface = integrationsShSurfaceUrl("stripe.com");
    if (surface.ok) {
      expect(surface.url.hostname).toBe("integrations.sh");
      expect(surface.url.protocol).toBe("https:");
      expect(surface.url.pathname).toBe("/api/stripe.com/surface");
    }
  });

  it("rejects SSRF and off-origin URLs", () => {
    const rejected = [
      "http://integrations.sh/api.json",
      "https://evil.com/api.json",
      "https://integrations.sh.evil.com/api.json",
      "https://user@integrations.sh/api.json",
      "https://user:pass@integrations.sh/api.json",
      "https://integrations.sh@evil.com/api.json",
      "file:///etc/passwd",
      "https://169.254.169.254/latest/meta-data/",
      "http://127.0.0.1/",
      "https://integrations.sh:8443/api.json",
      "javascript:alert(1)",
      "//evil.com/api.json",
      "https://[::1]/",
    ];
    for (const url of rejected) {
      expect(assertIntegrationsShUrl(url).ok, url).toBe(false);
    }
  });
});

describe("parseCatalogDomain (lp-hdzm.5)", () => {
  it("accepts LDH hostnames", () => {
    expect(parseCatalogDomain("Stripe.COM")).toBe("stripe.com");
    expect(parseCatalogDomain("mcp.stripe.com")).toBe("mcp.stripe.com");
  });

  it("rejects IPs, URLs, and path injection", () => {
    expect(parseCatalogDomain("169.254.169.254")).toBeNull();
    expect(parseCatalogDomain("127.0.0.1")).toBeNull();
    expect(parseCatalogDomain("localhost")).toBeNull();
    expect(parseCatalogDomain("https://stripe.com")).toBeNull();
    expect(parseCatalogDomain("stripe.com/../../etc/passwd")).toBeNull();
    expect(parseCatalogDomain("stripe.com@evil.com")).toBeNull();
    expect(parseCatalogDomain("")).toBeNull();
    expect(parseCatalogDomain("not a domain")).toBeNull();
  });
});

describe("createIntegrationsShFetcher (lp-hdzm.5)", () => {
  it("follows same-origin HTTPS redirects", async () => {
    const calls: string[] = [];
    const fetcher = createIntegrationsShFetcher({
      fetchImpl: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url === "https://integrations.sh/api.json") {
          return new Response(null, {
            status: 302,
            headers: { location: "https://integrations.sh/api.json?pinned=1" },
          });
        }
        return jsonResponse({ version: 1, data: [] });
      },
    });
    const result = await fetcher({ url: PINNED, maxBytes: 1024 });
    expect(result.ok).toBe(true);
    expect(calls).toEqual([
      "https://integrations.sh/api.json",
      "https://integrations.sh/api.json?pinned=1",
    ]);
  });

  it("rejects off-origin redirects", async () => {
    const calls: string[] = [];
    const fetcher = createIntegrationsShFetcher({
      fetchImpl: async (input) => {
        calls.push(String(input));
        return new Response(null, {
          status: 302,
          headers: { location: "http://169.254.169.254/latest/meta-data/" },
        });
      },
    });
    const result = await fetcher({ url: PINNED, maxBytes: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("bad_url");
    }
    expect(calls).toEqual(["https://integrations.sh/api.json"]);
  });

  it("rejects http redirects even when the host is integrations.sh", async () => {
    const fetcher = createIntegrationsShFetcher({
      fetchImpl: async () =>
        new Response(null, {
          status: 301,
          headers: { location: "http://integrations.sh/api.json" },
        }),
    });
    const result = await fetcher({ url: PINNED, maxBytes: 1024 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("bad_url");
    }
  });

  it("does not fetch when the initial URL is not pinned", async () => {
    let called = false;
    const fetcher = createIntegrationsShFetcher({
      fetchImpl: async () => {
        called = true;
        return jsonResponse({});
      },
    });
    const result = await fetcher({
      url: "https://evil.com/api.json",
      maxBytes: 1024,
    });
    expect(result.ok).toBe(false);
    expect(called).toBe(false);
  });

  it("aborts once maxBytes is exceeded when Content-Length is absent", async () => {
    const chunk = new Uint8Array(40).fill(0x41);
    let cancelled = false;
    const fetcher = createIntegrationsShFetcher({
      fetchImpl: async () =>
        chunkedResponse({
          chunks: Array.from({ length: 20 }, () => chunk),
          contentLength: null,
          onCancel: () => {
            cancelled = true;
          },
        }),
    });
    const result = await fetcher({ url: PINNED, maxBytes: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("oversized");
    }
    expect(cancelled).toBe(true);
  });

  it("rejects declared Content-Length over the cap", async () => {
    const fetcher = createIntegrationsShFetcher({
      fetchImpl: async () =>
        chunkedResponse({
          chunks: [new Uint8Array(50_000).fill(1)],
          contentLength: 50_000,
        }),
    });
    const result = await fetcher({ url: PINNED, maxBytes: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("oversized");
    }
    expect("bytes" in result).toBe(false);
  });
});

describe("createIntegrationsShSource (lp-hdzm.5)", () => {
  it("searches only the pinned host", async () => {
    const calls: string[] = [];
    const source = createIntegrationsShSource({
      fetchImpl: async (input) => {
        calls.push(String(input));
        return jsonResponse({
          results: [
            {
              domain: "stripe.com",
              name: "Stripe",
              description: "Payments",
              kinds: ["mcp", "openapi"],
              url: "https://integrations.sh/stripe.com",
            },
          ],
        });
      },
    });
    const result = await source.search({ q: "stripe" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.results[0]?.domain).toBe("stripe.com");
      expect(JSON.stringify(result.value)).not.toContain(
        "https://integrations.sh/stripe.com",
      );
    }
    expect(calls).toHaveLength(1);
    expect(calls[0]?.startsWith("https://integrations.sh/api/search?")).toBe(
      true,
    );
    expect(new URL(calls[0] ?? "").hostname).toBe("integrations.sh");
  });

  it("does not call fetch for an illegal domain", async () => {
    let called = false;
    const source = createIntegrationsShSource({
      fetchImpl: async () => {
        called = true;
        return jsonResponse({});
      },
    });
    for (const domain of [
      "169.254.169.254",
      "https://evil.com",
      "stripe.com@evil.com",
      "file://etc",
    ]) {
      const result = await source.getSurface(domain);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.reason).toBe("bad_domain");
      }
    }
    expect(called).toBe(false);
  });
});
