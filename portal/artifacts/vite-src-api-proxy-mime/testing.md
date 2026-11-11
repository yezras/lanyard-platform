# Testing notes: Vite `/src/api` proxy collision

## Repro (red)

```bash
# Dev server on 3010
curl -sI http://localhost:3010/src/api/client.ts
# HTTP/1.1 404 Not Found
# content-type: text/plain; charset=UTF-8
```

Browser Network: module request for `/src/api/client.ts` fails; AuthView / PortalShell break.

## Pass (green)

```bash
curl -sI http://localhost:3010/src/api/client.ts
# HTTP/1.1 200 OK
# Content-Type: text/javascript  (or application/javascript)
```

**Phase 4 (shipping bar):** use **web-ui-testing** (`/web-ui-testing`) against `BASE_URL` on port **3010**. Headless Chromium must load the app with no module MIME failures for `/src/api/*.ts`. Screenshots under `artifacts/ui/vite-src-api-proxy-mime/`. See [phase-4-verify-ship.md](./phase-4-verify-ship.md).

## Do not regress

```bash
# Path-based tenant API still proxied to BFF (not served as Vite TS)
curl -sI "http://localhost:3010/demo/api/<known-route>"
```

Unit: reserved segment `src` never treated as tenant for proxy match.
