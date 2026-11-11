# RFP / Excel workbook extraction (client materials)

Use when a meeting follow-up includes an **xlsx** RFP or spec with **embedded flow diagrams** (common: empty text cells on “Tech Stack & Flow” tabs).

## Vault layout

```
Clients/<Bucket>/<ClientName>/Materials/rfp/
  <source>.xlsx
  sheet-text-extract.txt
  extracted-images/          # from xl/media/
  extracted-images/image-transcriptions.md
  YYYY-MM-DD-rfp-knowledge-base-approach.md   # deprecated if superseded by Materials/*-proposal.md
  INDEX.md                                    # optional: point to parent Materials proposal
```

## 1. Sheet text (tabular Q&A)

PEP 668 hosts may lack `openpyxl`. Install per-user without breaking system Python:

```bash
uv pip install openpyxl --python python3
```

Then iterate sheets with `data_only=True` and write pipe-delimited rows to `sheet-text-extract.txt` (skip empty rows).

## 2. Embedded images from xlsx

xlsx is a zip archive:

```python
import zipfile, pathlib, shutil
xlsx = pathlib.Path(".../workbook.xlsx")
out = xlsx.parent / "extracted-images"
out.mkdir(exist_ok=True)
with zipfile.ZipFile(xlsx) as z:
    for name in z.namelist():
        if name.startswith("xl/media/"):
            shutil.copyfileobj(z.open(name), open(out / pathlib.Path(name).name, "wb"))
```

Diagram meaning often lives **only** in these PNGs when the sheet tab has no cell text.

## 3. Image → text (OCR)

**Do not use the `imagine` skill** — it generates visuals; it does not transcribe existing diagrams.

Order of attempts:

1. `vision_analyze` on each PNG when the active or auxiliary vision model accepts images.
2. If vision returns “Image inputs are not supported”, use **EasyOCR** (first run downloads models):

```bash
uv pip install easyocr pillow --python python3
```

```python
import easyocr, pathlib
reader = easyocr.Reader(["en"], gpu=False, verbose=False)
for img in sorted(pathlib.Path("extracted-images").glob("image*.png")):
    text = reader.readtext(str(img), detail=0, paragraph=True)
```

3. Human review OCR output before contractual or proposal use — flow labels garble easily.

**PDFs in Materials:** Company Brain default is `infra/focr/focr.sh` (franken_ocr) per `Business/Business Plan/SecondBrain/document-parsing.md`. See also: `powerpoint` for pptx.

## 4. Proposal + MemPalace

Primary RFP output is **`Materials/YYYY-MM-DD-lanyard-knowledge-base-implementation-proposal.md`** (see `references/rfp-agent-layer-proposal.md`). Do not require a `knowledge-base/` subtree under the client folder.

After proposal (and notes) exist:

```bash
mempalace mine "<VaultRoot>/Clients/<Bucket>/<ClientName>" --wing <slug> --mode projects
```

Wing slug = folder name lowercased, underscores → hyphens (e.g. `ExampleClinic` → `exampleclinic`).

## 4b. Workflow understanding (not just OCR)

After PNGs exist, run **`vision_analyze`** per image with prompts that request end-to-end flow (systems, manual vs auto, queues, CRM/EMR boundaries). **Fold synthesis into the Materials proposal** (architecture / current-state section). OCR/EasyOCR alone is insufficient for proposal-grade narrative.

## 4c. Agent Layer proposal (replaces line-by-line KB tree)

Follow **`references/rfp-agent-layer-proposal.md`**. Optional appendix: table of workbook Q# and client answers inside the single proposal file.

## 5. Gmail attachment download

When RFP arrived via email, fetch with gws (not skill wrapper if `gws-gmail` skill missing on cron):

- List/find message id (e.g. `gws gmail users messages list` with query).
- `gws gmail users messages attachments get` + base64 decode to `Materials/rfp/`.

Log inbound comm in `clients_crm.db` with message id in summary.

## 6. Post-meeting tie-in

- Cron **post-meeting-triage** may output a review list; user **YES** in Slack = approval to write note, db, AGENTS.md, and optional RFP pipeline above.
- Record Gmail **draft id** in client `AGENTS.md` next steps when Type B assessment is drafted.
