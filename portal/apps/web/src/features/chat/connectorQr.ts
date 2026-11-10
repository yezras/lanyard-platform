// Encoder only. Package main pulls Node png/fs and blanks the SPA QR.
import qrcodeCore from "qrcode/lib/core/qrcode.js";

export const CONNECTOR_QR_PORTAL_EVENT = "connector.qr" as const;

export type ConnectorQrPhase =
  | "code"
  | "complete"
  | "failed"
  | "needs_reauth";

export type ConnectorQrEventFields = {
  pairing_id: string;
  code: string;
  ts: number;
  phase: ConnectorQrPhase;
  message?: string;
  connector_id: "whatsapp";
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseConnectorQrEvent(event: {
  type?: string;
  pairing_id?: string;
  code?: string;
  ts?: number;
  phase?: string;
  message?: string;
  connector_id?: string;
  metadata?: Record<string, unknown>;
}): ConnectorQrEventFields | null {
  const meta = isRecord(event.metadata) ? event.metadata : {};
  const portal =
    event.type === CONNECTOR_QR_PORTAL_EVENT ||
    meta.portal_event === CONNECTOR_QR_PORTAL_EVENT;
  if (!portal) return null;
  const pairing_id = (
    (typeof event.pairing_id === "string" && event.pairing_id) ||
    (typeof meta.pairing_id === "string" && meta.pairing_id) ||
    ""
  ).trim();
  if (!pairing_id) return null;
  const phaseRaw =
    (typeof event.phase === "string" && event.phase) ||
    (typeof meta.phase === "string" && meta.phase) ||
    "code";
  const phase: ConnectorQrPhase =
    phaseRaw === "complete" ||
    phaseRaw === "failed" ||
    phaseRaw === "needs_reauth"
      ? phaseRaw
      : "code";
  const code =
    (typeof event.code === "string" && event.code) ||
    (typeof meta.code === "string" && meta.code) ||
    "";
  const ts =
    (typeof event.ts === "number" && event.ts) ||
    (typeof meta.ts === "number" && meta.ts) ||
    0;
  const message =
    (typeof event.message === "string" && event.message.trim()) ||
    (typeof meta.message === "string" && meta.message.trim()) ||
    undefined;
  return {
    pairing_id,
    code,
    ts,
    phase,
    connector_id: "whatsapp",
    ...(message ? { message } : {}),
  };
}

/** Render a scannable QR SVG from the raw wacli code payload. */
export function qrSvgFromCode(code: string): string {
  const qr = qrcodeCore.create(code, { errorCorrectionLevel: "M" });
  const size = qr.modules.size;
  const rects: string[] = [];
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (qr.modules.get(x, y)) {
        rects.push(`<rect x="${x}" y="${y}" width="1" height="1"/>`);
      }
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="192" height="192" shape-rendering="crispEdges" role="img" aria-label="WhatsApp QR code">${rects.join("")}</svg>`;
}
