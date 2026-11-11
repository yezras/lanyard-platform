# infra/focr — agent rules

- **Default OCR** for Company Brain ingest is **franken_ocr** (`focr`), per `Business/Business Plan/SecondBrain/document-parsing.md`.
- Install and `focr pull` on an OCR worker with **≥ 8 GB RAM**; do not assume `focr` runs on the same instance as a memory-constrained Hermes host.
- Use `infra/focr/focr.sh` to emit `<filename>.parse.md` beside sources before chunking or MemPalace promotion.
- Escalate to cloud document APIs or format-specific tools only for cases listed in `document-parsing.md` (handwriting, schema extract, Office-native paths, failed/low-confidence OCR).
- Never commit model weights, `.parse.md` from live client vaults, or API keys into Core.
