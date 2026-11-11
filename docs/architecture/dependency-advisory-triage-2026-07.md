# Dependency advisory triage (lp-p37.12)

**Bead:** `lp-p37.12` — P1 security: dependency remediation across portal, agent, and Hermes  
**Epic:** `lp-p37` — security remediation: July 2026 audit findings  
**Date:** 2026-07-27  
**Scope:** Portal monorepo, lanyard-agent, hermes-lanyard root/website/Photon/whatsapp/Python.

> Prefer upgrade/remove over silence. Remaining findings below are **triaged** with reachability and residual risk — not ignored.

---

## 1. Portal (`portal/`)

### Audit result (post-fix)

| Surface | Command | Result |
|---------|---------|--------|
| Production | `pnpm audit --prod` | **0 vulnerabilities** |
| Full (incl. dev) | `pnpm audit` | **0 vulnerabilities** |

### Changes

| Package | Before | After | Notes |
|---------|--------|-------|-------|
| `xlsx` (SheetJS) | npm `0.18.5` (prototype pollution + ReDoS) | CDN tarball **0.20.3** (`https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`) | Community npm channel is frozen at 0.18.5; patched builds ship from SheetJS CDN only. |
| `@hono/node-server` | `^1.14.3` | `^2.0.12` | GHSA-frvp-7c67-39w9 Windows `serveStatic` traversal fixed ≥2.0.5. Portal uses `serve()` only (no `serveStatic`); upgrade still applied. |
| `pptx-preview` transitives | `uuid@10`, `echarts@5.5` | **pnpm overrides** `uuid≥11.1.1`, `echarts≥6.1.0` | Overrides live in `pnpm-workspace.yaml` (pnpm 11 no longer reads `package.json#pnpm`). |
| `ws` | `^8.18` | `≥8.21.0` override + direct pins | Memory DoS / uninit disclosure. |
| `postcss` / `esbuild` | older via vite | overrides ≥8.5.18 / ≥0.25.0 | Cleared with vitest/vite bumps. |
| `vitest` / `vite` | 2.x–3.0.x / 6.0.x | `vitest ^3.2.6`, `vite ^6.4.3` | Dev-time high/critical (UI server, `server.fs.deny`, etc.). |

### Residual risk — vault XLSX preview

- **Reachability:** Authenticated vault/document-pane path only. Workbook bytes are tenant vault content, parsed **client-side** via lazy `import("xlsx")` in `VaultReader`.
- **Mitigations already in product:** row cap (`MAX_SHEET_ROWS = 500` in `vaultOffice.ts`); preview is read-only tabular render (not arbitrary formula execution host).
- **Residual:** Malicious or pathological workbooks can still stress the browser tab (CPU/memory). Operator control is vault write RBAC + content trust of collaborators. No server-side SheetJS execution.
- **Follow-up (optional):** Web Worker sandbox + byte-size gate before `XLSX.read`.

### Residual risk — pptx-preview

- Transitives upgraded via overrides (uuid, echarts). Parent package remains `pptx-preview@1.0.7` (no newer release).
- **Reachability:** Same client-side vault preview path as XLSX. Chart configs from PPTX feed echarts in-browser.
- **Residual:** Package is lightly maintained; prefer long-term replace with a maintained PPTX renderer or server-side OnlyOffice preview when licensed.

### Validation

- `pnpm --filter @lanyard/web exec vitest run src/features/vault` — **98 passed** (includes `VaultReader` XLSX/PPTX paths).
- `pnpm --filter @lanyard/relay test` — **95 passed** (`ws` consumer).

---

## 2. lanyard-agent (external: `LanyardBrain/lanyard-agent`)

### Audit result (post-fix)

`pnpm audit` → **No known vulnerabilities found**.

### Changes

| Package | Fix |
|---------|-----|
| `ws` (`packages/adapters-portal`) | Pin **8.21.1** (was 8.18.3). |
| `brace-expansion` (via `@earendil-works/pi-coding-agent` → minimatch) | Workspace override **≥5.0.8** in `pnpm-workspace.yaml`. |
| `ws` transitive floor | Workspace override **≥8.21.0**. |

### Validation

- `pnpm install` + `pnpm audit` clean on branch `beads/lp-p37.12-p1-security-dependency-remediation-acros`.

---

## 3. hermes-lanyard (external: `LanyardBrain/hermes-lanyard`)

### 3.1 Root npm

**Fixed / overridden (exact pins in root `package.json#overrides`):**

| Advisory area | Pin |
|---------------|-----|
| `dompurify` | `3.4.12` |
| `postcss` | `8.5.18` |
| `react-router` | `8.3.0` (GHSA-qwww RSC CSRF; fixed only on 8.3.0) |
| `react-router-dom` | `7.18.1` (no 8.x release on npm; OSV clean) |
| `tar` | `7.5.22` (was critical ≤7.5.20) |
| `shell-quote` | `1.10.0` |
| `js-yaml` | `4.3.0` |
| `fast-uri` | `3.1.4` |
| `brace-expansion@5` | `5.0.8` |

**Residual (triaged — high via packaging/lint toolchain only):**

| Cluster | Packages | Reachability | Decision |
|---------|----------|--------------|----------|
| electron-builder → minimatch → brace-expansion 1.x/2.x | `electron-builder`, `@electron/asar`, `ejs`/`jake`/`filelist`, etc. | **Desktop packaging** (`apps/desktop`). Not on Hermes agent headless runtime path. | **Risk-accepted** until upstream electron-builder ships minimatch≥10.1 with brace-expansion≥5.0.8. No 1.x brace-expansion patch exists. |
| eslint → minimatch → brace-expansion 1.x | `eslint`, `eslint-plugin-react` | **Dev lint only.** | **Risk-accepted**; upgrade to ESLint 10 when workspace is ready (semver-major). |

Post-fix `npm audit` at root: named audit packages (react-router, postcss, dompurify, tar, shell-quote, js-yaml, fast-uri) **clean**. Remaining ~20 highs are the electron/eslint brace-expansion fan-out above.

### 3.2 Website (`website/`)

**Fixed via overrides:** `websocket-driver≥0.7.5`, `ws≥7.5.11`, `undici≥7.28.0` (plus prior serialize-javascript/uuid).

**Result:** critical `websocket-driver` and high `ws`/`undici` **cleared**. Installed: `websocket-driver@0.7.5`, `ws@8.21.1`, `undici@8.9.0`.

**Residual:** high `brace-expansion` via Docusaurus `serve-handler` → minimatch. Docs-site static build/preview tooling only — **risk-accepted** pending Docusaurus upstream.

### 3.3 Photon sidecar (`plugins/platforms/photon/sidecar/`)

Overrides bumped: `protobufjs@8.7.1`, OpenTelemetry core/resources/sdk packages `2.10.0`, OTLP packages `0.221.0`.

**`npm audit` → 0 vulnerabilities.**

### 3.4 WhatsApp bridge (`scripts/whatsapp-bridge/`)

- `body-parser≥1.20.6` override; `express@^4.21.2`; `protobufjs@7.6.5`.

**`npm audit` → 0 vulnerabilities.**

### 3.5 Python (`pyproject.toml` + `uv.lock`)

| Package | Before | After | OSV |
|---------|--------|-------|-----|
| `cryptography` | 46.0.7 (GHSA-537c-gmf6-5ccf OpenSSL wheels) | **49.0.0** | 0 vulns |
| `Pillow` | 12.2.0 (multiple GHSA) | **12.3.0** | 0 vulns |

Lock regenerated with `uv lock`.

---

## 4. Cross-repo PR map

| Repo | Branch | Contents |
|------|--------|----------|
| `lanyard-platform` | `beads/lp-p37.12-p1-security-dependency-remediation-acros` | Portal lockfile + package pins + this triage doc |
| `lanyard-agent` | same branch name | `ws` pin + workspace overrides |
| `hermes-lanyard` | same branch name | npm overrides/lockfiles + Python pins/lock |

---

## 5. Operator notes

1. **pnpm 11:** put `overrides` in `pnpm-workspace.yaml`, not `package.json#pnpm` (silently ignored).
2. **SheetJS:** do not “upgrade” `xlsx` via npm registry alone — it will resolve back to 0.18.5.
3. **Re-audit cadence:** re-run `pnpm audit` / `npm audit` / OSV for cryptography+Pillow on each release train; re-check electron-builder and Docusaurus brace-expansion when those majors move.
