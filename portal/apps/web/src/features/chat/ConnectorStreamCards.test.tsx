import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectorOAuthCard } from "./ConnectorOAuthCard.js";
import { ConnectorCliCard } from "./ConnectorCliCard.js";
import { ConnectorQrBubble } from "./ConnectorQrBubble.js";
import { ChatTimeline } from "./ChatTimeline.js";
import type { ChatTimelineItem } from "../../hooks/useChatEvents.js";

describe("Connector stream cards (lp-xhf4.17)", () => {
  afterEach(cleanup);

  it("OAuth connect card shows G, OAuth chip, Connect Google, You will sign in", () => {
    const onConnect = vi.fn();
    render(<ConnectorOAuthCard connectorId="google" phase="connect" onConnect={onConnect} />);
    expect(screen.getByTestId("connector-oauth-letter-mark").textContent).toBe("G");
    expect(screen.getByText("Google")).toBeTruthy();
    expect(screen.getByTestId("connector-oauth-chip")).toBeTruthy();
    expect(screen.getByTestId("connector-oauth-chip").textContent).toMatch(/OAuth/i);
    const btn = screen.getByTestId("connector-oauth-connect-button");
    expect(btn.textContent).toMatch(/Connect Google/i);
    expect(screen.getByTestId("connector-oauth-hint").textContent).toMatch(/You will sign in/i);
    fireEvent.click(btn);
    expect(onConnect).toHaveBeenCalledTimes(1);
  });

  it("OAuth success card shows Google connected + check, email, Connected chip", () => {
    render(<ConnectorOAuthCard connectorId="google" phase="connected" accountLabel="operator@example.com" />);
    expect(screen.getByTestId("connector-oauth-card").getAttribute("data-phase")).toBe("connected");
    expect(screen.getByText(/Google connected/i)).toBeTruthy();
    expect(screen.getByTestId("connector-oauth-connected-check")).toBeTruthy();
    expect(screen.getByTestId("connector-oauth-account-label").textContent).toBe("operator@example.com");
    expect(screen.getByTestId("connector-oauth-connected-chip").textContent).toMatch(/Connected/i);
  });

  it("CLI card shows GitHub, CLI chip, device code, gh auth login, Waiting, I have authorized", () => {
    const onAuth = vi.fn();
    render(<ConnectorCliCard deviceCode="XXXX-1234" onAuthorized={onAuth} />);
    expect(screen.getByTestId("connector-cli-letter-mark").textContent).toBe("G");
    expect(screen.getByText("GitHub")).toBeTruthy();
    expect(screen.getByTestId("connector-cli-chip").textContent).toMatch(/CLI/i);
    expect(screen.getByTestId("connector-cli-device-code").textContent).toBe("XXXX-1234");
    expect(document.body.textContent).toMatch(/gh auth login --hostname github\.com/);
    expect(screen.getByTestId("connector-cli-waiting").textContent).toMatch(/Waiting for device/i);
    const btn = screen.getByTestId("connector-cli-authorized-button");
    expect(btn.textContent).toMatch(/I have authorized/i);
    fireEvent.click(btn);
    expect(onAuth).toHaveBeenCalledTimes(1);
  });

  it("WhatsApp QR card in-stream shows W, Pairing chip, QR image, Scan with WhatsApp, Waiting for scan", () => {
    render(<ConnectorQrBubble pairingId="pair-1" code="2@TEST-CODE" phase="code" />);
    expect(screen.getByTestId("connector-qr-letter-mark").textContent).toBe("W");
    expect(screen.getByText("WhatsApp")).toBeTruthy();
    expect(screen.getByTestId("connector-qr-pairing-chip").textContent).toMatch(/Pairing/i);
    expect(screen.getByTestId("connector-qr-image")).toBeTruthy();
    expect(screen.getByTestId("connector-qr-image").getAttribute("data-qr-code")).toBe("2@TEST-CODE");
    expect(screen.getByTestId("connector-qr-scan-hint").textContent).toMatch(/Scan with WhatsApp/i);
    expect(screen.getByTestId("connector-qr-waiting").textContent).toMatch(/Waiting for scan/i);
    expect(screen.queryByText(/WhatsApp connected/i)).toBeNull();
  });

  it("ChatTimeline renders OAuth, CLI and QR stream objects under agent bubble", () => {
    const items: ChatTimelineItem[] = [
      {
        type: "assistant_turn",
        id: "asst-1",
        content: "Google is not connected.",
        toolCalls: [],
        isStreaming: false,
      },
      {
        type: "connector.oauth",
        connectorId: "google",
        phase: "connect",
        ts: 1,
      },
      {
        type: "connector.oauth",
        connectorId: "google",
        phase: "connected",
        accountLabel: "operator@example.com",
        ts: 2,
      },
      {
        type: "connector.cli",
        connectorId: "github",
        deviceCode: "XXXX-1234",
        command: "gh auth login --hostname github.com",
        status: "waiting",
        ts: 3,
      },
      {
        type: "connector.qr",
        pairingId: "pair-qr-1",
        code: "2@QR-CODE",
        phase: "code",
        ts: 4,
      },
    ];
    render(<ChatTimeline items={items} toolProgress={null} onMcqSelect={vi.fn()} />);
    expect(screen.getByText("Google is not connected.")).toBeTruthy();
    // OAuth connect
    expect(screen.getAllByTestId("connector-oauth-card").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText(/You will sign in/i)).toBeTruthy();
    // OAuth success
    expect(screen.getByText("operator@example.com")).toBeTruthy();
    expect(screen.getByText(/Google connected/i)).toBeTruthy();
    // CLI
    expect(screen.getByTestId("connector-cli-card")).toBeTruthy();
    expect(screen.getByText("XXXX-1234")).toBeTruthy();
    expect(screen.getByText(/I have authorized/i)).toBeTruthy();
    // QR
    expect(screen.getByTestId("connector-qr-bubble")).toBeTruthy();
    expect(screen.getByText(/Scan with WhatsApp/i)).toBeTruthy();
  });

  it("reuses ConnectorQrBubble primitive — does not restyle chrome", () => {
    render(<ConnectorQrBubble pairingId="pair-2" code="2@OTHER" phase="code" />);
    // Still renders real QR via qrcode core, not ASCII
    const img = screen.getByTestId("connector-qr-image");
    expect(img.innerHTML).toContain("<svg");
    expect(img.innerHTML).toContain("<rect");
  });
});
