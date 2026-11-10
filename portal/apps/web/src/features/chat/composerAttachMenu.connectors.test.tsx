/**
 * Connectors group in the + attach menu (lp-xhf4.16).
 *
 * Rows render only when `onConnectConnector` AND a non-empty
 * `connectorActions` array are provided; each row carries a stable
 * data-testid (`connector-connect-<id>`) and honors `disabled`.
 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ComposerAttachMenu } from "./composerAttachMenu.js";
import type { ComposerConnectConnectorAction } from "./composerAttachMenu.js";

afterEach(() => {
  cleanup();
});

const FIXTURE_SKILLS = [
  {
    id: "summarize",
    name: "summarize",
    description: "Condense long documents",
    enabled: true as const,
  },
];

const FIXTURE_VAULT = [{ path: "/Projects/A/notes.md", name: "notes.md" }];

const CONNECTOR_ACTIONS: ComposerConnectConnectorAction[] = [
  { connectorId: "google", label: "Connect Google" },
  { connectorId: "hubspot", label: "Connect HubSpot" },
  { connectorId: "whatsapp", label: "Connect WhatsApp" },
];

function renderMenu(
  connectorActions: ComposerConnectConnectorAction[] = CONNECTOR_ACTIONS,
  onConnectConnector?: (id: ComposerConnectConnectorAction["connectorId"]) => void,
) {
  return render(
    <ComposerAttachMenu
      skills={FIXTURE_SKILLS}
      vaultFiles={FIXTURE_VAULT}
      composerValue=""
      onComposerChange={vi.fn()}
      connectorActions={connectorActions}
      onConnectConnector={
        onConnectConnector ?? vi.fn()
      }
    />,
  );
}

describe("ComposerAttachMenu connectors group (lp-xhf4.16)", () => {
  it("renders Connectors rows with stable test ids when handler and actions are provided", async () => {
    renderMenu();

    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));

    expect(
      await screen.findByTestId("connector-connect-google"),
    ).toBeTruthy();
    expect(screen.getByTestId("connector-connect-hubspot")).toBeTruthy();
    expect(screen.getByTestId("connector-connect-whatsapp")).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: /Connect Google/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: /Connect HubSpot/i }),
    ).toBeTruthy();
    expect(
      screen.getByRole("menuitem", { name: /Connect WhatsApp/i }),
    ).toBeTruthy();
    // Honest expectation lines per connector kind.
    expect(screen.getByText(/QR code shown in this thread/i)).toBeTruthy();
  });

  it.each<ComposerConnectConnectorAction["connectorId"]>([
    "google",
    "hubspot",
    "whatsapp",
  ])(
    "invokes onConnectConnector with %id and closes the menu",
    async (connectorId) => {
      const onConnect = vi.fn();
      renderMenu(CONNECTOR_ACTIONS, onConnect);

      fireEvent.click(
        screen.getByRole("button", { name: "Attach to message" }),
      );
      fireEvent.click(
        within(
          await screen.findByTestId(`connector-connect-${connectorId}`),
        ).getByRole("menuitem"),
      );
      expect(onConnect).toHaveBeenCalledTimes(1);
      expect(onConnect).toHaveBeenCalledWith(connectorId);
      await waitFor(() => {
        expect(
          screen.getByTestId("composer-attach-menu").getAttribute("data-open"),
        ).toBe("false");
      });
    },
  );

  it("omits the Connectors group when onConnectConnector is not provided", async () => {
    render(
      <ComposerAttachMenu
        skills={FIXTURE_SKILLS}
        vaultFiles={FIXTURE_VAULT}
        composerValue=""
        onComposerChange={vi.fn()}
        connectorActions={CONNECTOR_ACTIONS}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));
    await screen.findByRole("menuitem", { name: /Select from vault/i });
    expect(screen.queryByTestId("connector-connect-google")).toBeNull();
    expect(
      screen.queryByRole("menuitem", { name: /Connect Google/i }),
    ).toBeNull();
  });

  it("omits the Connectors group when connectorActions is empty", async () => {
    renderMenu([]);

    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));
    await screen.findByRole("menuitem", { name: /Select from vault/i });
    expect(screen.queryByTestId("connector-connect-google")).toBeNull();
    expect(screen.queryByTestId("connector-connect-whatsapp")).toBeNull();
  });

  it("renders disabled rows disabled without invoking the callback", async () => {
    const onConnect = vi.fn();
    renderMenu(
      [
        { connectorId: "google", label: "Connect Google" },
        { connectorId: "hubspot", label: "Connect HubSpot", disabled: true },
      ],
      onConnect,
    );

    fireEvent.click(screen.getByRole("button", { name: "Attach to message" }));

    const googleItem = await screen.findByRole("menuitem", {
      name: /Connect Google/i,
    });
    expect(googleItem.getAttribute("aria-disabled")).toBeNull();

    const hubspotItem = await screen.findByRole("menuitem", {
      name: /Connect HubSpot/i,
    });
    expect(hubspotItem.getAttribute("aria-disabled")).toBe("true");

    // Disabled click must neither fire nor close the menu.
    fireEvent.click(hubspotItem);
    expect(onConnect).not.toHaveBeenCalled();
    expect(
      screen.getByTestId("composer-attach-menu").getAttribute("data-open"),
    ).toBe("true");
  });
});
