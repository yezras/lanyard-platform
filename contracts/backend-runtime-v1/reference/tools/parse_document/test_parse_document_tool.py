#!/usr/bin/env python3
"""Offline unit tests for parse_document F3 + F5 reference tool.

Runs without network. Uses an injected converter for ACL/truncation/sidecar/
progress tests and an injected firecrawl_parse for F5 OCR cost-gate tests.
When firecrawl-anydoc is installed, also exercises real docx / xlsx / text-pdf.

Beads: lp-uxy.10.4 (F3 local anydoc), lp-uxy.10.6 (F5 scanned OCR cost-gate).
"""

from __future__ import annotations

import io
import json
import os
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

# Allow running as script from this directory or repo root.
_HERE = Path(__file__).resolve().parent
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from parse_document_tool import (  # noqa: E402
    DEFAULT_MAX_CHARS,
    ERROR_PATH_DENIED,
    ERROR_PARSE_FAILED,
    ERROR_TOO_LARGE,
    ERROR_UNSUPPORTED_FORMAT,
    ERROR_UNSUPPORTED_SCANNED,
    ERROR_NO_OCR_KEY,
    PARSER_ANYDOC,
    PARSER_FIRECRAWL_PARSE,
    TOOL_ALIAS,
    TOOL_LABEL,
    TOOL_NAME,
    ParseDocumentConfig,
    clamp_max_chars,
    is_live_firecrawl_key,
    ocr_policy_ready,
    parse_document,
    sidecar_path_for,
    tool_result_for_model,
    truncate_markdown,
    want_ocr_escalation,
)


def _make_docx(text: str) -> bytes:
    document_xml = f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body><w:p><w:r><w:t>{text}</w:t></w:r></w:p></w:body>
</w:document>"""
    content_types = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>"""
    rels = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", rels)
        z.writestr("word/document.xml", document_xml)
    return buf.getvalue()


def _make_xlsx(cell: str) -> bytes:
    content_types = """<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>"""
    rels = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>"""
    workbook = """<?xml version="1.0" encoding="UTF-8"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets>
</workbook>"""
    wb_rels = """<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>"""
    sheet = """<?xml version="1.0" encoding="UTF-8"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row></sheetData>
</worksheet>"""
    shared = f"""<?xml version="1.0" encoding="UTF-8"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="1" uniqueCount="1">
  <si><t>{cell}</t></si>
</sst>"""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", rels)
        z.writestr("xl/workbook.xml", workbook)
        z.writestr("xl/_rels/workbook.xml.rels", wb_rels)
        z.writestr("xl/worksheets/sheet1.xml", sheet)
        z.writestr("xl/sharedStrings.xml", shared)
    return buf.getvalue()


def _make_text_pdf(text: str) -> bytes:
    content = f"BT /F1 12 Tf 100 700 Td ({text}) Tj ET"
    objects = [
        b"1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj\n",
        b"2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj\n",
        b"3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj\n",
    ]
    stream = content.encode("latin-1")
    objects.append(
        f"4 0 obj<< /Length {len(stream)} >>stream\n".encode()
        + stream
        + b"\nendstream\nendobj\n"
    )
    objects.append(b"5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj\n")
    out = io.BytesIO()
    out.write(b"%PDF-1.4\n")
    offsets = [0]
    for obj in objects:
        offsets.append(out.tell())
        out.write(obj)
    xref_pos = out.tell()
    out.write(f"xref\n0 {len(objects)+1}\n".encode())
    out.write(b"0000000000 65535 f \n")
    for off in offsets[1:]:
        out.write(f"{off:010d} 00000 n \n".encode())
    out.write(
        f"trailer<< /Size {len(objects)+1} /Root 1 0 R >>\nstartxref\n{xref_pos}\n%%EOF\n".encode()
    )
    return out.getvalue()


class ClampAndTruncateTests(unittest.TestCase):
    def test_clamp_defaults_and_bounds(self) -> None:
        self.assertEqual(clamp_max_chars(None), DEFAULT_MAX_CHARS)
        self.assertEqual(clamp_max_chars("nope"), DEFAULT_MAX_CHARS)
        self.assertEqual(clamp_max_chars(50), 1000)
        self.assertEqual(clamp_max_chars(999_999), 200_000)
        self.assertEqual(clamp_max_chars(12_000), 12_000)

    def test_truncate_pure_slice(self) -> None:
        body, trunc = truncate_markdown("abcdef", 4)
        self.assertEqual(body, "abcd")
        self.assertTrue(trunc)
        body2, trunc2 = truncate_markdown("hi", 10)
        self.assertEqual(body2, "hi")
        self.assertFalse(trunc2)

    def test_sidecar_stem(self) -> None:
        p = Path("/staging/uploads/_inbox/report.pdf")
        self.assertEqual(sidecar_path_for(p).name, "report.parse.md")
        p2 = Path("/vault/archive.tar.gz")
        self.assertEqual(sidecar_path_for(p2).name, "archive.tar.parse.md")


class PathAclAndProgressTests(unittest.TestCase):
    def setUp(self) -> None:
        self._td = tempfile.TemporaryDirectory()
        self.root = Path(self._td.name)
        self.vault = self.root / "vault"
        self.staging = self.root / "staging" / "uploads"
        self.vault.mkdir(parents=True)
        self.staging.mkdir(parents=True)
        self.outside = self.root / "outside"
        self.outside.mkdir()
        (self.vault / "notes.docx").write_bytes(_make_docx("Vault Notes"))
        (self.staging / "report.docx").write_bytes(_make_docx("Staging Report"))
        (self.outside / "secret.docx").write_bytes(_make_docx("Secret"))

        def converter(data: bytes, fmt=None) -> str:  # noqa: ANN001
            # Deterministic offline converter — ignores format.
            return f"# Converted\n\nbytes={len(data)}\n"

        self.converter = converter
        self.cfg = ParseDocumentConfig(
            vault_roots=[self.vault],
            staging_root=self.staging,
            to_markdown_bytes=self.converter,
        )

    def tearDown(self) -> None:
        self._td.cleanup()

    def test_path_denied_outside_roots(self) -> None:
        events: list[dict] = []
        res = parse_document(
            {"path": str(self.outside / "secret.docx")},
            config=self.cfg,
            progress=events.append,
            tool_call_id="tc-deny",
        )
        self.assertEqual(res["error_code"], ERROR_PATH_DENIED)
        statuses = [e["metadata"]["tool_status"] for e in events]
        self.assertEqual(statuses, ["running", "error"])
        self.assertEqual(events[0]["metadata"]["tool_label"], TOOL_LABEL)
        self.assertEqual(events[0]["metadata"]["tool_name"], TOOL_NAME)

    def test_path_denied_dotdot_escape(self) -> None:
        evil = str(self.staging / ".." / ".." / "outside" / "secret.docx")
        res = parse_document({"path": evil}, config=self.cfg)
        self.assertEqual(res["error_code"], ERROR_PATH_DENIED)

    def test_path_denied_missing(self) -> None:
        res = parse_document(
            {"path": str(self.staging / "nope.docx")},
            config=self.cfg,
        )
        self.assertEqual(res["error_code"], ERROR_PATH_DENIED)

    def test_staging_success_sidecar_and_progress(self) -> None:
        events: list[dict] = []
        path = str(self.staging / "report.docx")
        res = parse_document(
            {"path": path, "write_sidecar": True},
            config=self.cfg,
            progress=events.append,
            tool_call_id="tc-ok",
        )
        self.assertNotIn("error_code", res)
        self.assertEqual(res["parser"], "anydoc")
        self.assertIn("Converted", res["markdown"])
        self.assertFalse(res["truncated"])
        self.assertEqual(res["chars"], len(res["markdown"]))
        side = Path(res["sidecar_path"])
        self.assertTrue(side.is_file())
        self.assertEqual(side.name, "report.parse.md")
        self.assertIn("Converted", side.read_text(encoding="utf-8"))
        statuses = [e["metadata"]["tool_status"] for e in events]
        self.assertEqual(statuses, ["running", "complete"])
        self.assertEqual(events[0]["metadata"]["tool_target"], path)
        # complete result is JSON ParseDocumentResult string
        complete_result = json.loads(events[1]["metadata"]["result"])
        self.assertEqual(complete_result["parser"], "anydoc")

    def test_vault_success(self) -> None:
        res = parse_document(
            {"path": str(self.vault / "notes.docx")},
            config=self.cfg,
        )
        self.assertNotIn("error_code", res)
        self.assertIn("Converted", res["markdown"])

    def test_truncation(self) -> None:
        def long_converter(data: bytes, fmt=None) -> str:  # noqa: ANN001
            return "x" * 10_000

        cfg = ParseDocumentConfig(
            vault_roots=[self.vault],
            staging_root=self.staging,
            to_markdown_bytes=long_converter,
        )
        res = parse_document(
            {"path": str(self.vault / "notes.docx"), "max_chars": 1500, "write_sidecar": True},
            config=cfg,
        )
        self.assertTrue(res["truncated"])
        self.assertEqual(res["chars"], 1500)
        self.assertEqual(len(res["markdown"]), 1500)
        # sidecar holds full text
        side = Path(res["sidecar_path"])
        self.assertEqual(len(side.read_text(encoding="utf-8")), 10_000)

    def test_too_large(self) -> None:
        big = self.staging / "big.bin"
        big.write_bytes(b"a" * 1000)
        cfg = ParseDocumentConfig(
            vault_roots=[self.vault],
            staging_root=self.staging,
            max_source_bytes=100,
            to_markdown_bytes=self.converter,
        )
        res = parse_document({"path": str(big)}, config=cfg)
        self.assertEqual(res["error_code"], ERROR_TOO_LARGE)

    def test_force_ocr_no_key_on_empty_pdf(self) -> None:
        def empty_pdf(_data: bytes, fmt=None) -> str:  # noqa: ANN001
            return "   "

        pdf = self.staging / "scan.pdf"
        pdf.write_bytes(b"%PDF-1.4 empty-ish")
        cfg = ParseDocumentConfig(
            vault_roots=[self.vault],
            staging_root=self.staging,
            to_markdown_bytes=empty_pdf,
        )
        res = parse_document(
            {"path": str(pdf), "force_ocr": True},
            config=cfg,
        )
        self.assertEqual(res["error_code"], ERROR_NO_OCR_KEY)

    def test_unsupported_scanned_without_force_ocr(self) -> None:
        def empty_pdf(_data: bytes, fmt=None) -> str:  # noqa: ANN001
            return ""

        pdf = self.staging / "scan2.pdf"
        pdf.write_bytes(b"%PDF-1.4")
        cfg = ParseDocumentConfig(
            vault_roots=[self.vault],
            staging_root=self.staging,
            to_markdown_bytes=empty_pdf,
        )
        res = parse_document({"path": str(pdf)}, config=cfg)
        self.assertEqual(res["error_code"], ERROR_UNSUPPORTED_SCANNED)

    def test_model_result_channel(self) -> None:
        ok = {"markdown": "# Hi", "format": "docx", "parser": "anydoc", "chars": 4, "truncated": False}
        self.assertEqual(tool_result_for_model(ok), "# Hi")
        err = {"markdown": "", "format": "unknown", "chars": 0, "truncated": False, "error_code": ERROR_PATH_DENIED}
        self.assertIn(ERROR_PATH_DENIED, tool_result_for_model(err))

    def test_alias_tool_name_on_progress(self) -> None:
        events: list[dict] = []
        parse_document(
            {"path": str(self.staging / "report.docx")},
            config=self.cfg,
            progress=events.append,
            tool_name=TOOL_ALIAS,
        )
        self.assertEqual(events[0]["metadata"]["tool_name"], TOOL_ALIAS)


class FirecrawlKeyAndPolicyTests(unittest.TestCase):
    def test_placeholder_keys_not_live(self) -> None:
        self.assertFalse(is_live_firecrawl_key(None))
        self.assertFalse(is_live_firecrawl_key(""))
        self.assertFalse(is_live_firecrawl_key("   "))
        self.assertFalse(is_live_firecrawl_key("fc-placeholder-firecrawl-unused"))
        self.assertFalse(is_live_firecrawl_key("fc-YOUR-API-KEY"))
        self.assertFalse(is_live_firecrawl_key("replace-me-key"))
        self.assertTrue(is_live_firecrawl_key("fc-live-key-abc123xyz"))

    def test_want_ocr_escalation_force_vs_auto(self) -> None:
        bare = ParseDocumentConfig()
        self.assertTrue(want_ocr_escalation(True, bare))
        self.assertFalse(want_ocr_escalation(False, bare))

        ready = ParseDocumentConfig(
            allow_ocr=True,
            auto_ocr=True,
            firecrawl_api_key="fc-live-key-abc123xyz",
        )
        self.assertTrue(ocr_policy_ready(ready))
        self.assertTrue(want_ocr_escalation(False, ready))

        auto_no_key = ParseDocumentConfig(allow_ocr=True, auto_ocr=True)
        self.assertFalse(want_ocr_escalation(False, auto_no_key))


class F5OcrCostGateTests(unittest.TestCase):
    """F5: scanned PDF → Firecrawl Parse only when policy+live key; else fail closed."""

    def setUp(self) -> None:
        self._td = tempfile.TemporaryDirectory()
        self.root = Path(self._td.name)
        self.vault = self.root / "vault"
        self.staging = self.root / "staging" / "uploads"
        self.vault.mkdir(parents=True)
        self.staging.mkdir(parents=True)
        self.pdf = self.staging / "scan.pdf"
        self.pdf.write_bytes(b"%PDF-1.4 scanned-image-only")

        def empty_pdf(_data: bytes, fmt=None) -> str:  # noqa: ANN001
            return ""

        self.empty_converter = empty_pdf
        self.ocr_calls: list[dict] = []

        def mock_parse(
            data: bytes,
            *,
            filename: str,
            content_type: str,
            api_key: str,
            api_base: str = "",
            timeout_s: float = 60.0,
            **_kw: object,
        ) -> str:
            self.ocr_calls.append(
                {
                    "n_bytes": len(data),
                    "filename": filename,
                    "content_type": content_type,
                    "api_key": api_key,
                    "api_base": api_base,
                }
            )
            return "# OCR body\n\nHello scanned page\n"

        self.mock_parse = mock_parse

    def tearDown(self) -> None:
        self._td.cleanup()

    def _cfg(self, **kw: object) -> ParseDocumentConfig:
        base = dict(
            vault_roots=[self.vault],
            staging_root=self.staging,
            to_markdown_bytes=self.empty_converter,
            firecrawl_parse=self.mock_parse,
        )
        base.update(kw)
        return ParseDocumentConfig(**base)  # type: ignore[arg-type]

    def test_force_ocr_placeholder_key_is_no_ocr_key(self) -> None:
        cfg = self._cfg(
            allow_ocr=True,
            firecrawl_api_key="fc-placeholder-firecrawl-unused",
        )
        res = parse_document({"path": str(self.pdf), "force_ocr": True}, config=cfg)
        self.assertEqual(res["error_code"], ERROR_NO_OCR_KEY)
        self.assertEqual(self.ocr_calls, [])

    def test_force_ocr_allow_false_is_no_ocr_key(self) -> None:
        cfg = self._cfg(
            allow_ocr=False,
            firecrawl_api_key="fc-live-key-abc123xyz",
        )
        res = parse_document({"path": str(self.pdf), "force_ocr": True}, config=cfg)
        self.assertEqual(res["error_code"], ERROR_NO_OCR_KEY)
        self.assertIn("allow_ocr", res.get("error_message", ""))
        self.assertEqual(self.ocr_calls, [])

    def test_force_ocr_success_parser_firecrawl_parse(self) -> None:
        events: list[dict] = []
        cfg = self._cfg(
            allow_ocr=True,
            firecrawl_api_key="fc-live-key-abc123xyz",
        )
        res = parse_document(
            {"path": str(self.pdf), "force_ocr": True, "write_sidecar": True},
            config=cfg,
            progress=events.append,
            tool_call_id="tc-ocr",
        )
        self.assertNotIn("error_code", res, msg=res)
        self.assertEqual(res["parser"], PARSER_FIRECRAWL_PARSE)
        self.assertIn("Hello scanned page", res["markdown"])
        self.assertEqual(len(self.ocr_calls), 1)
        self.assertEqual(self.ocr_calls[0]["api_key"], "fc-live-key-abc123xyz")
        self.assertEqual(self.ocr_calls[0]["filename"], "scan.pdf")
        statuses = [e["metadata"]["tool_status"] for e in events]
        self.assertEqual(statuses, ["running", "complete"])
        complete = json.loads(events[1]["metadata"]["result"])
        self.assertEqual(complete["parser"], PARSER_FIRECRAWL_PARSE)
        side = Path(res["sidecar_path"])
        self.assertTrue(side.is_file())
        self.assertIn("Hello scanned page", side.read_text(encoding="utf-8"))

    def test_auto_ocr_escalates_without_force_flag(self) -> None:
        cfg = self._cfg(
            allow_ocr=True,
            auto_ocr=True,
            firecrawl_api_key="fc-live-key-abc123xyz",
        )
        res = parse_document({"path": str(self.pdf)}, config=cfg)
        self.assertNotIn("error_code", res, msg=res)
        self.assertEqual(res["parser"], PARSER_FIRECRAWL_PARSE)
        self.assertEqual(len(self.ocr_calls), 1)

    def test_auto_ocr_without_key_stays_unsupported_scanned(self) -> None:
        """auto_policy alone without key must not spam no_ocr_key."""
        cfg = self._cfg(allow_ocr=True, auto_ocr=True, firecrawl_api_key=None)
        res = parse_document({"path": str(self.pdf)}, config=cfg)
        self.assertEqual(res["error_code"], ERROR_UNSUPPORTED_SCANNED)
        self.assertEqual(self.ocr_calls, [])

    def test_ocr_api_failure_is_parse_failed(self) -> None:
        def boom(*_a: object, **_k: object) -> str:
            raise RuntimeError("HTTP 402 payment required")

        cfg = self._cfg(
            allow_ocr=True,
            firecrawl_api_key="fc-live-key-abc123xyz",
            firecrawl_parse=boom,
        )
        res = parse_document({"path": str(self.pdf), "force_ocr": True}, config=cfg)
        self.assertEqual(res["error_code"], ERROR_PARSE_FAILED)
        self.assertEqual(res["parser"], PARSER_FIRECRAWL_PARSE)
        self.assertIn("402", res.get("error_message", ""))

    def test_ocr_empty_markdown_is_parse_failed(self) -> None:
        def empty_ocr(*_a: object, **_k: object) -> str:
            return "  \n"

        cfg = self._cfg(
            allow_ocr=True,
            firecrawl_api_key="fc-live-key-abc123xyz",
            firecrawl_parse=empty_ocr,
        )
        res = parse_document({"path": str(self.pdf), "force_ocr": True}, config=cfg)
        self.assertEqual(res["error_code"], ERROR_PARSE_FAILED)

    def test_anydoc_exception_scanned_then_ocr(self) -> None:
        def raise_scanned(_data: bytes, fmt=None) -> str:  # noqa: ANN001
            raise RuntimeError("unsupported scanned image-only PDF (needs OCR)")

        cfg = self._cfg(
            to_markdown_bytes=raise_scanned,
            allow_ocr=True,
            firecrawl_api_key="fc-live-key-abc123xyz",
        )
        res = parse_document({"path": str(self.pdf), "force_ocr": True}, config=cfg)
        self.assertNotIn("error_code", res, msg=res)
        self.assertEqual(res["parser"], PARSER_FIRECRAWL_PARSE)
        self.assertEqual(len(self.ocr_calls), 1)

    def test_local_anydoc_success_never_calls_ocr(self) -> None:
        def ok_converter(_data: bytes, fmt=None) -> str:  # noqa: ANN001
            return "# Local\n\ntext layer\n"

        cfg = self._cfg(
            to_markdown_bytes=ok_converter,
            allow_ocr=True,
            auto_ocr=True,
            firecrawl_api_key="fc-live-key-abc123xyz",
        )
        res = parse_document(
            {"path": str(self.pdf), "force_ocr": True},
            config=cfg,
        )
        self.assertNotIn("error_code", res, msg=res)
        self.assertEqual(res["parser"], PARSER_ANYDOC)
        self.assertIn("text layer", res["markdown"])
        self.assertEqual(self.ocr_calls, [])


@unittest.skipUnless(
    __import__("importlib").util.find_spec("anydoc") is not None,
    "firecrawl-anydoc not installed",
)
class LiveAnydocTests(unittest.TestCase):
    """Real firecrawl-anydoc conversions when the package is present."""

    def setUp(self) -> None:
        self._td = tempfile.TemporaryDirectory()
        self.root = Path(self._td.name)
        self.staging = self.root / "staging" / "uploads"
        self.staging.mkdir(parents=True)
        self.cfg = ParseDocumentConfig(
            vault_roots=[],
            staging_root=self.staging,
            # use default anydoc backend
        )

    def tearDown(self) -> None:
        self._td.cleanup()

    def test_docx(self) -> None:
        p = self.staging / "q2.docx"
        p.write_bytes(_make_docx("Hello Q2 Report body"))
        res = parse_document({"path": str(p)}, config=self.cfg)
        self.assertNotIn("error_code", res, msg=res)
        self.assertEqual(res["parser"], "anydoc")
        self.assertIn("Hello Q2 Report body", res["markdown"])
        self.assertEqual(res["format"], "docx")

    def test_xlsx(self) -> None:
        p = self.staging / "sheet.xlsx"
        p.write_bytes(_make_xlsx("Revenue"))
        res = parse_document({"path": str(p)}, config=self.cfg)
        self.assertNotIn("error_code", res, msg=res)
        self.assertIn("Revenue", res["markdown"])
        self.assertEqual(res["format"], "xlsx")

    def test_text_pdf(self) -> None:
        p = self.staging / "notes.pdf"
        p.write_bytes(_make_text_pdf("Hello PDF text layer"))
        res = parse_document({"path": str(p)}, config=self.cfg)
        self.assertNotIn("error_code", res, msg=res)
        self.assertIn("Hello PDF text layer", res["markdown"])
        self.assertEqual(res["format"], "pdf")

    def test_unsupported_binary(self) -> None:
        p = self.staging / "x.bin"
        p.write_bytes(b"\x00\x01\x02not-a-document")
        res = parse_document({"path": str(p)}, config=self.cfg)
        self.assertIn(
            res.get("error_code"),
            {ERROR_UNSUPPORTED_FORMAT, "parse_failed"},
        )


def main() -> int:
    loader = unittest.TestLoader()
    suite = loader.loadTestsFromModule(sys.modules[__name__])
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == "__main__":
    raise SystemExit(main())
