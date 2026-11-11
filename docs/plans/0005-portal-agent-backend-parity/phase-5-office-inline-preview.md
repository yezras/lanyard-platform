# Phase 5 — Office inline client preview (no generic placeholder)

**Back-link:** [overview.md](./overview.md)  
**Bead:** `lp-rt5.7`  
**Independent of phases 2–4** (may parallel after framing)

## Goal

Selecting or citing DOCX/XLSX/PPTX always opens the **Office client preview** inline (chat document pane and vault), never the generic “Unsupported preview” placeholder, and never a host desktop/X11 app from Portal (grill Q2). OnlyOffice remains Edit-only behind existing flags (`lp-5q6`).

## Changes

- Audit `VaultReader` / `chatDocumentRenderer` / open paths: all Office extensions/mimes hit Docx/Xlsx/Pptx preview branches.
- Regression tests for each type (including edge mimes) asserting renderer ≠ unsupported.
- Audit downloads, “Open in Vault,” agent tool open, and any shell/xdg hooks: **no** Portal-initiated desktop open. Document operator-side causes of X11 if found outside Portal.
- Ensure default open mode for chat citations is preview pane beside chat (already primary); fix any path that skips the pane.
- Do **not** change OnlyOffice default-off policy for free-track.

## Data structures

- Existing preview kinds in VaultReader; `isOfficeEditorPath` vs preview path split remains.

## Verification

**Static:** vault + document pane unit tests for docx/xlsx/pptx → office preview renderer.

**Runtime:** web UI test or story: open each type → screenshot/evidence not Unsupported; pane visible beside chat on desktop layout. Grep/audit note: zero xdg-open/LibreOffice GUI launches from portal packages.

## Sister awareness

Agent host must not open GUI Office for vault files when operating under Portal. Headless skills only. Any agent-side desktop open is a separate host bug.
