# franken_ocr (`focr`) — default Company Brain OCR

[franken_ocr](https://github.com/Dicklesworthstone/franken_ocr) is the **default OCR provider** for Company Brain document parsing when local text extraction is insufficient. It runs offline after a one-time `focr pull` (~3.9 GB Unlimited-OCR weights in `~/.cache/franken_ocr/models`).

Canonical routing doctrine: `Business/Business Plan/SecondBrain/document-parsing.md`.

Full checklist, PATH/poppler deps, and **Core `main` vs focr upgrade policy**: `references/deployment.md`.

## Install

On an **OCR-capable worker** (not the small Hermes-only box):

```bash
chmod +x Core/infra/focr/*.sh
# poppler-utils provides pdftotext (digital PDF path in focr.sh)
Core/infra/focr/install-focr.sh   # pins FOCR_VERSION=v0.4.0 by default
focr pull
focr doctor
focr robot selftest
```

Upstream quick install (same as the script):

```bash
curl -fsSL https://raw.githubusercontent.com/Dicklesworthstone/franken_ocr/main/install.sh | bash
```

## Runtime contract

| Item | Value |
|------|--------|
| CLI | `focr` |
| Default model | Baidu Unlimited-OCR (`unlimited-ocr.int8.focrq`) |
| Parse artifact | `<source-stem>.parse.md` beside the source file |
| Env tuning | `FOCR_THREADS` (default host-dependent), `FOCR_MIN_TEXT_CHARS` (wrapper, default `400`) |
| Model cache | `~/.cache/franken_ocr/models` — **do not commit**; local runtime only |

## Brain wrapper

`infra/focr/focr.sh` implements the standard ingest path:

1. **Plain text** (`.md`, `.txt`) — no OCR; optional copy-through for pipelines that expect `.parse.md`.
2. **Digital PDFs** — `pdftotext` when extracted text meets `FOCR_MIN_TEXT_CHARS`.
3. **Scanned / image PDFs and raster images** — `focr ocr … -o <file>.parse.md`.
4. **Office formats** (`.docx`, `.xlsx`, `.pptx`) — not handled here; use format-specific skills or escalation (see document-parsing.md).

```bash
Core/infra/focr/focr.sh /path/in/<VaultRoot>/Materials/report.pdf
# → /path/in/<VaultRoot>/Materials/report.parse.md
```

Force OCR even when text layer looks usable:

```bash
Core/infra/focr/focr.sh --force-ocr /path/to/scan.pdf
```

## Hardware

| Resource | Minimum | Recommended |
|----------|---------|-------------|
| RAM | **8 GB** | 16 GB for batch/cron ingest |
| CPU | 4 vCPUs | More cores reduce per-page latency |
| Disk | ~4 GB for model cache | Plus vault staging |

On hosts with **&lt; 8 GB RAM**, `focr` may OOM during model load (~3 GB RSS before inference headroom). Run OCR on a **dedicated worker** or use a cloud document API for escalation only.

## Escalation (not focr)

Keep a secondary provider (e.g. Reducto) for handwriting, JSON Schema field extraction, agentic recovery on poor scans, and native Office parsing when the customer contract allows cloud document APIs. focr remains the **default** for bulk scanned PDF OCR.

## Safety

- Do not copy customer document bodies into Core commits.
- Wrapper operates on `<VaultRoot>` paths in deployment; examples use placeholders only.