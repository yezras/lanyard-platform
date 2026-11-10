import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";

import { Providers } from "../../app/providers.js";
import { AuthView } from "./AuthView.js";

const onAuthenticated = vi.fn();

function renderAuthView(ui: ReactElement = <AuthView onAuthenticated={onAuthenticated} />) {
  return render(<Providers>{ui}</Providers>);
}

function requestPath(input: RequestInfo | URL): string {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  return new URL(raw, "http://localhost").pathname;
}

function mockFetch(handlers: Record<string, () => Response | Promise<Response>>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
    const path = requestPath(input);
    const handler = handlers[path];
    if (!handler) {
      return Promise.resolve(new Response(JSON.stringify({ error: "not found" }), { status: 404 }));
    }
    return Promise.resolve(handler());
  });
}

function expectLoginCardBranding() {
  expect(screen.queryByText("Lanyard Portal")).toBeNull();
  expect(
    document.querySelector('img[src="/brand/Lanyard_Icon_blue.svg"]'),
  ).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Sign in", level: 2 })).toBeTruthy();
  expect(screen.queryByText(/tenant host|BFF|Required|dev stub/i)).toBeNull();
  expect(screen.queryByRole("navigation")).toBeNull();
  expect(screen.queryByText("Skip to content")).toBeNull();
}

describe("AuthView", () => {
  beforeEach(() => {
    onAuthenticated.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("renders login-card layout with branding and email/password form", async () => {
    mockFetch({
      "/api/context": () =>
        new Response(JSON.stringify({ tenant_slug: "demo" }), { status: 200 }),
      "/api/auth/google": () => new Response(null, { status: 503 }),
    });

    renderAuthView();

    expectLoginCardBranding();
    expect(screen.getByRole("textbox", { name: /email/i })).toBeTruthy();
    expect(screen.getByLabelText(/^Password/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();

    await waitFor(() => {
      expect(screen.getByText("Or continue with")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Sign in with Google" }),
      ).toBeTruthy();
    });
    expect(
      screen.queryByRole("button", { name: /dev stub/i }),
    ).toBeNull();
  });

  it("logs in with email/password only (no register-on-401)", async () => {
    mockFetch({
      "/api/context": () =>
        new Response(JSON.stringify({ tenant_slug: "demo" }), { status: 200 }),
      "/api/auth/google": () => new Response(null, { status: 503 }),
      "/api/auth/csrf": () =>
        new Response(JSON.stringify({ csrf_token: "csrf-test" }), { status: 200 }),
      "/api/auth/login": () =>
        new Response(
          JSON.stringify({
            user_id: "user-1",
            email: "dev@demo.local",
            tenant_id: "tenant-1",
          }),
          { status: 401 },
        ),
    });

    renderAuthView();
    expectLoginCardBranding();

    fireEvent.change(screen.getByRole("textbox", { name: /email/i }), {
      target: { value: "dev@demo.local" },
    });
    fireEvent.change(screen.getByLabelText(/^Password/), {
      target: { value: "wrong-password" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Log in" }).closest("form")!);

    await waitFor(() => {
      expect(globalThis.fetch).toHaveBeenCalledWith(
        "/api/auth/login",
        expect.objectContaining({ method: "POST" }),
      );
    });

    expect(globalThis.fetch).not.toHaveBeenCalledWith(
      "/api/auth/register",
      expect.anything(),
    );
    expect(onAuthenticated).not.toHaveBeenCalled();
  });

  it("shows Google OAuth button and divider when configured", async () => {
    mockFetch({
      "/api/context": () =>
        new Response(JSON.stringify({ tenant_slug: "demo" }), { status: 200 }),
      "/api/auth/google": () => new Response(null, { status: 302 }),
    });

    renderAuthView();
    expectLoginCardBranding();

    await waitFor(() => {
      expect(screen.getByText("Or continue with")).toBeTruthy();
      expect(
        screen.getByRole("button", { name: "Sign in with Google" }),
      ).toBeTruthy();
    });
  });

  it("omits Google divider when OAuth and dev stub are unavailable", async () => {
    mockFetch({
      "/api/context": () =>
        new Response(JSON.stringify({ tenant_slug: "beta" }), { status: 200 }),
      "/api/auth/google": () => new Response(null, { status: 503 }),
    });

    renderAuthView();
    expectLoginCardBranding();

    await waitFor(() => {
      expect(screen.queryByText("Or continue with")).toBeNull();
      expect(screen.queryByRole("button", { name: /Sign in with Google/ })).toBeNull();
    });
  });

  it("shows dev Google stub on local demo tenant without OAuth", async () => {
    mockFetch({
      "/api/context": () =>
        new Response(JSON.stringify({ tenant_slug: "demo" }), { status: 200 }),
      "/api/auth/google": () => new Response(null, { status: 503 }),
      "/api/auth/csrf": () =>
        new Response(JSON.stringify({ csrf_token: "csrf-test" }), { status: 200 }),
      "/api/auth/google/stub": () =>
        new Response(
          JSON.stringify({
            user_id: "stub-user",
            email: "dev-google-stub@demo.local",
            tenant_id: "tenant-1",
          }),
          { status: 200 },
        ),
    });

    renderAuthView();

    await waitFor(() => {
      expect(screen.getByText("Or continue with")).toBeTruthy();
    });

    const stubButton = await screen.findByRole("button", {
      name: "Sign in with Google",
    });
    fireEvent.click(stubButton);

    await waitFor(() => {
      expect(onAuthenticated).toHaveBeenCalledWith({
        user_id: "stub-user",
        email: "dev-google-stub@demo.local",
        tenant_id: "tenant-1",
      });
    });
  });
});