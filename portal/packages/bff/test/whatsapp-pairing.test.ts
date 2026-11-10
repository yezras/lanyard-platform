import { describe, expect, it } from "vitest";

import {
  createFixtureWhatsAppPairingHost,
  runWhatsAppPairing,
} from "../src/whatsapp-pairing.js";

const QR_A = "2@FIRST-QR-PAYLOAD-SCAN-FROM-IMAGE";
const QR_B = "2@ROTATED-QR-PAYLOAD-REPLACE-BUBBLE";
const SESSION = Buffer.from("session-keys-only").toString("base64");

function qrLine(code: string, ts: number): string {
  return JSON.stringify({ event: "qr_code", data: { code }, ts });
}

describe("runWhatsAppPairing (lp-xhf4.11)", () => {
  it("emits connector.qr for each code and exports session.db only", async () => {
    const published: Array<{ pairing_id: string; code: string; phase: string }> =
      [];
    const host = createFixtureWhatsAppPairingHost({
      stderr_lines: [
        '{"event":"auth_starting","ts":1}',
        "████ ASCII must be ignored",
        qrLine(QR_A, 2),
        qrLine(QR_B, 3),
      ],
      session_db_base64: SESSION,
    });
    const result = await runWhatsAppPairing({
      pairing_id: "pair-1",
      ports: {
        host,
        sandbox_id: "sbx-1",
        store_dir: "/var/lib/company-brain-backend/wacli",
        thread_id: "th-1",
        publish: (event) => {
          published.push({
            pairing_id: event.pairing_id,
            code: event.code,
            phase: event.phase,
          });
          expect(event.content).not.toContain(QR_A);
          expect(event.content).not.toContain(QR_B);
        },
      },
    });
    expect(result.status).toBe("connected");
    expect(result.session_db_base64).toBe(SESSION);
    expect(result.account_label).toBe("+15551212");
    expect(result.llm_status).not.toContain(QR_B);
    expect(published.map((p) => p.phase)).toEqual(["code", "code", "complete"]);
    expect(published[0]?.pairing_id).toBe("pair-1");
    expect(published[1]?.pairing_id).toBe("pair-1");
    expect(published[0]?.code).toBe(QR_A);
    expect(published[1]?.code).toBe(QR_B);
  });

  it("fail-closes on passkey and does not export a session", async () => {
    const host = createFixtureWhatsAppPairingHost({
      stderr_lines: [
        qrLine(QR_A, 1),
        JSON.stringify({
          event: "error",
          data: { message: "Passkey confirmation is required" },
          ts: 2,
        }),
        qrLine(QR_B, 3),
      ],
      session_db_base64: SESSION,
    });
    const result = await runWhatsAppPairing({
      ports: {
        host,
        sandbox_id: "sbx-1",
        store_dir: "/tmp/wacli",
      },
    });
    expect(result.status).toBe("failed");
    expect(result.session_db_base64).toBeNull();
    expect(result.portal_events.at(-1)?.phase).toBe("failed");
    expect(result.llm_status).toMatch(/passkey/i);
  });

  it("maps an unlinked device to needs_reauth and does not export", async () => {
    const host = createFixtureWhatsAppPairingHost({
      stderr_lines: [
        JSON.stringify({
          event: "error",
          data: { message: "Logged out. Device unlinked." },
          ts: 2,
        }),
      ],
      session_db_base64: SESSION,
    });
    const result = await runWhatsAppPairing({
      ports: {
        host,
        sandbox_id: "sbx-1",
        store_dir: "/tmp/wacli",
      },
    });
    expect(result.status).toBe("needs_reauth");
    expect(result.session_db_base64).toBeNull();
    expect(result.portal_events.at(-1)?.phase).toBe("needs_reauth");
  });

  it("rejects exporting wacli.db", async () => {
    const host = createFixtureWhatsAppPairingHost({
      stderr_lines: [qrLine(QR_A, 1)],
      session_db_base64: SESSION,
      export_filename: "wacli.db",
    });
    await expect(
      runWhatsAppPairing({
        ports: { host, sandbox_id: "sbx-1", store_dir: "/tmp/wacli" },
      }),
    ).rejects.toMatchObject({ code: "WHATSAPP_EXPORT_REJECTED" });
  });
});
