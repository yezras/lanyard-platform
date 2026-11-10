import { describe, expect, it } from "vitest";

import { parseConnectorQrEvent, qrSvgFromCode } from "./connectorQr.js";

const CODE_A = "2@ABCDEF-first-whatsapp-qr";
const CODE_B = "2@XYZXYZ-rotated-whatsapp-qr";

describe("connector QR (lp-xhf4.11)", () => {
  it("parses reserved portal_event connector.qr", () => {
    const parsed = parseConnectorQrEvent({
      type: "connector.qr",
      pairing_id: "pair-1",
      code: CODE_A,
      ts: 1,
      phase: "code",
      connector_id: "whatsapp",
      metadata: { portal_event: "connector.qr" },
    });
    expect(parsed).toMatchObject({
      pairing_id: "pair-1",
      code: CODE_A,
      phase: "code",
    });
  });

  it("renders a real QR image from the raw code, not ASCII", () => {
    const a = qrSvgFromCode(CODE_A);
    const b = qrSvgFromCode(CODE_B);
    expect(a.startsWith("<svg")).toBe(true);
    expect(a).toContain("<rect");
    expect(a).not.toContain("█");
    expect(a).not.toBe(b);
    expect((a.match(/<rect /g) ?? []).length).toBeGreaterThan(50);
  });
});
