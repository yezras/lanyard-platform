# Repro baseline: Vite `/src/api/*` MIME fail (portal-mnn.4)

**Bead:** `portal-mnn.4`  
**Phase:** 1 — repro baseline only (no product fix)  
**Captured at:** `2026-07-16T01:22:04Z` (UTC)  
**Server:** Vite dev on `*:3010` (existing process pid `2077823`; not started by this bead)  
**Config under test:** `packages/web/vite.config.ts` (unchanged)

## Commands

```bash
curl -sI http://localhost:3010/src/api/client.ts
curl -sI http://localhost:3010/src/main.tsx
```

Raw dumps also in [repro-baseline-headers.txt](./repro-baseline-headers.txt).

## Failing URL — `/src/api/client.ts`

```http
HTTP/1.1 404 Not Found
Vary: Origin
content-type: text/plain; charset=UTF-8
date: Thu, 16 Jul 2026 01:22:04 GMT
connection: close
```

Body (`curl -s`):

```text
404 Not Found
```

**Interpretation:** Response is **not** Vite transforming a TS module. It is a plain-text 404 (BFF hop via path-tenant proxy). Browser ES module load fails with disallowed MIME type `text/plain`.

## Control URL — `/src/main.tsx`

```http
HTTP/1.1 200 OK
Vary: Origin
Content-Type: text/javascript
Content-Length: 420
Last-Modified: Wed, 08 Jul 2026 16:49:27 GMT
ETag: W/"420-1783529367787"
Cache-Control: no-cache
Date: Thu, 16 Jul 2026 01:22:04 GMT
Connection: keep-alive
Keep-Alive: timeout=5
```

Body head is Vite-transformed JS (`import __vite__cjsImport0_react_jsxDevRuntime from …`).

**Interpretation:** Sibling path under `/src/**` that does **not** match `…/api` is served correctly by Vite as `text/javascript`.

## Summary table

| URL | Status | Content-Type | Expected role |
|-----|--------|--------------|---------------|
| `http://localhost:3010/src/api/client.ts` | **404** | **`text/plain; charset=UTF-8`** | Fail (proxied) |
| `http://localhost:3010/src/main.tsx` | **200** | **`text/javascript`** | Pass (Vite) |

## Locked hypothesis

Path-tenant proxy in `packages/web/vite.config.ts`:

```ts
"^/[a-z0-9][a-z0-9-]*/api": {
  target: bffTarget, // default http://127.0.0.1:4000
  changeOrigin: true,
},
```

matches `/src/api/*` because the first segment `src` satisfies `[a-z0-9][a-z0-9-]*` and is followed by `/api`. The proxy treats `src` as a **tenant slug** and forwards the request to the BFF, which returns `404 text/plain`. Client routing already reserves `src` in `tenantBase` (`RESERVED`); the dev proxy does not.

**Hypothesis lock (portal-mnn.4):** path-tenant proxy matches `/src/api` treating `src` as tenant → BFF 404 plain text → browser MIME block.

## Out of scope (noise)

- MetaMask `ObjectMultiplex` / `orphaned data for stream "background-liveness"` / `"metamask-multichain-provider"`: browser extension noise. Not app code. Not part of this repro or fix.

## Explicit non-goals for this bead

- No change to `vite.config.ts` or product code.
- No PR / push from this phase.
- Fix belongs to later phases (reserved-segment alignment).
