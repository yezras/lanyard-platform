/**
 * RTL proof for `?story=parse-document` (lp-uxy.10.7 F6).
 * Browser paint: ui-testing / manual evidence under artifacts/ui/lp-uxy.10/.
 */

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  DOCX_MARKER,
  PDF_MARKER,
  ParseDocumentProofStory,
  STAGING_DOCX,
  STAGING_PDF,
} from "./ParseDocumentProofStory.js";
import {
  humanToolActivityLabel,
  isContextGatheringTool,
  mapToolCallFields,
} from "./chatToolCallMapper.js";

describe("ParseDocumentProofStory (lp-uxy.10.7 F6)", () => {
  it("renders attach paths, Parsing a document tool rows, and answer markers", () => {
    render(<ParseDocumentProofStory />);

    const root = screen.getByTestId("parse-document-proof-story");
    expect(root.getAttribute("data-parse-document-live")).toBe("false");
    expect(root.getAttribute("data-cost-gated")).toBe("true");
    expect(root.getAttribute("data-bff-parse")).toBe("false");
    expect(root.getAttribute("data-friendly-label")).toBe("Parsing a document");
    expect(root.getAttribute("data-alias-label")).toBe("Parsing a document");
    expect(root.getAttribute("data-context-gathering")).toBe("true");

    // Attach panel stamps staging paths
    const attach = screen.getByTestId("parse-document-user-attach");
    expect(attach.textContent).toContain(STAGING_DOCX);
    expect(attach.textContent).toContain(STAGING_PDF);
    expect(attach.textContent).toMatch(/\[staging uploads\]/);

    // Tool panel present
    expect(screen.getByTestId("parse-document-tool-panel")).toBeTruthy();

    // Friendly activity label appears on tool rows
    const labels = screen.getAllByText("Parsing a document");
    expect(labels.length).toBeGreaterThanOrEqual(1);

    // Markers in result detail / answer
    expect(screen.getAllByText(new RegExp(DOCX_MARKER)).length).toBeGreaterThan(
      0,
    );
    expect(screen.getAllByText(new RegExp(PDF_MARKER)).length).toBeGreaterThan(
      0,
    );

    // Answer panel cites both
    const answer = screen.getByTestId("parse-document-answer-panel");
    expect(answer.textContent).toContain(DOCX_MARKER);
    expect(answer.textContent).toContain(PDF_MARKER);

    // Negatives called out
    expect(screen.getByTestId("parse-document-neg-path").textContent).toMatch(
      /path_denied/,
    );
    expect(screen.getByTestId("parse-document-neg-scanned").textContent).toMatch(
      /unsupported_scanned/,
    );
  });

  it("maps host tool_progress fields to friendly label + statuses", () => {
    expect(humanToolActivityLabel("parse_document")).toBe("Parsing a document");
    expect(humanToolActivityLabel("extract_document_text")).toBe(
      "Parsing a document",
    );
    expect(
      isContextGatheringTool({ name: "Parsing a document" }),
    ).toBe(true);

    const running = mapToolCallFields({
      type: "tool_progress",
      tool_name: "parse_document",
      tool_label: "Parsing a document",
      tool_target: STAGING_DOCX,
      tool_status: "running",
      tool_call_id: "t1",
    } as never);
    expect(running.name).toBe("Parsing a document");
    expect(running.status).toBe("running");
    expect(running.target).toBe(STAGING_DOCX);

    const complete = mapToolCallFields({
      type: "tool_progress",
      tool_name: "parse_document",
      tool_label: "Parsing a document",
      tool_target: STAGING_PDF,
      tool_status: "complete",
      tool_call_id: "t2",
    } as never);
    expect(complete.status).toBe("complete");

    const err = mapToolCallFields({
      type: "tool_progress",
      tool_name: "parse_document",
      tool_label: "Parsing a document",
      tool_target: "/etc/passwd",
      tool_status: "error",
      tool_call_id: "t3",
    } as never);
    expect(err.status).toBe("error");
  });
});
