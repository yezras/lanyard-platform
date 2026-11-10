import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";
import { OpsAuthView } from "./OpsAuthView.js";

const onAuthenticated = vi.fn();

function requestPath(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return new URL(raw, "http://localhost").pathname;
}

function mockFetch(handlers: Record<string, () => Response | Promise<Response>>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const path = requestPath(input);
    const handler = handlers[path];
    if (!handler) {
      return Promise.resolve(
        new Response(JSON.stringify({ error: "not found" }), { status: 404 }),
      );
    }
    return Promise.resolve(handler());
  });
}

describe("OpsAuthView", () => {
  beforeEach(() => {
    onAuthenticated.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("is the ops login, not tenant Chat or tenant Sign in form", async () => {
    mockFetch({
      "/api/admin/auth/google": () => new Response(null, { status: 503 }),
    });

    render(
      <Providers>
        <OpsAuthView onAuthenticated={onAuthenticated} />
      </Providers>,
    );

    expect(await screen.findByRole("heading", { name: "Platform admin" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Lanyard Portal" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Agents" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Vault" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Connectors" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Log in" })).toBeNull();
    expect(screen.queryByLabelText(/^Password/)).toBeNull();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Sign in (local stub)" })).toBeTruthy();
    });
  });

  it("starts Google OAuth on the ops API, not tenant /api/auth/google", async () => {
    const assign = vi.fn();
    vi.spyOn(window.location, "assign").mockImplementation(assign);
    mockFetch({
      "/api/admin/auth/google": () => new Response(null, { status: 302 }),
    });

    render(
      <Providers>
        <OpsAuthView onAuthenticated={onAuthenticated} />
      </Providers>,
    );

    const button = await screen.findByRole("button", { name: "Sign in with Google" });
    fireEvent.click(button);
    expect(assign).toHaveBeenCalledWith("/api/admin/auth/google");
  });
});
