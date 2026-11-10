import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Providers } from "../../app/providers.js";
import { apiFetch } from "../../api/client.js";
import { AdminModelCatalog } from "./AdminModelCatalog.js";

vi.mock("../../api/client.js", () => ({
  apiFetch: vi.fn(),
}));

const fetchMock = vi.mocked(apiFetch);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("AdminModelCatalog", () => {
  afterEach(() => {
    cleanup();
    fetchMock.mockReset();
  });

  it("saves a provider model key from the dropdowns without showing the secret", async () => {
    const secret = "sk-ui-test-secret";
    fetchMock.mockImplementation(async (path: string, init?: RequestInit) => {
      if (path === "/api/settings/litellm-providers") {
        return json({ providers: ["anthropic", "openai"] });
      }
      if (path === "/api/settings/model-keys" && !init?.method) {
        return json({ models: [] });
      }
      if (path.startsWith("/api/settings/litellm-models?provider=openai")) {
        return json({
          models: [
            { id: "openai/gpt-4o", name: "gpt-4o" },
            { id: "openai/gpt-4.1", name: "gpt-4.1" },
          ],
        });
      }
      if (path === "/api/settings/model-keys" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as {
          provider: string;
          model: string;
          api_key: string;
        };
        expect(body).toMatchObject({
          provider: "openai",
          model: "openai/gpt-4o",
          api_key: secret,
        });
        return json({
          model: { id: "openai/gpt-4o", provider: "openai", name: "gpt-4o", last4: "cret" },
        });
      }
      throw new Error(`unexpected ${init?.method ?? "GET"} ${path}`);
    });

    render(
      <Providers>
        <AdminModelCatalog isAdmin />
      </Providers>,
    );

    expect(await screen.findByTestId("admin-provider-select")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: "Model" })).toBeNull();

    fireEvent.click(screen.getByTestId("admin-provider-select"));
    fireEvent.click(await screen.findByRole("option", { name: "openai" }));

    fireEvent.click(screen.getByTestId("admin-model-select"));
    fireEvent.click(await screen.findByRole("option", { name: "gpt-4o" }));

    fireEvent.change(screen.getByTestId("admin-provider-key-input"), {
      target: { value: secret },
    });
    fireEvent.click(screen.getByTestId("admin-provider-key-save"));

    expect(await screen.findByTestId("admin-saved-model-openai/gpt-4o")).toBeTruthy();
    expect(screen.getByText("••••cret")).toBeTruthy();
    expect(screen.queryByText(secret)).toBeNull();
    expect(screen.queryByTestId("models-by-provider")).toBeNull();
  });

  it("does not render for a non-admin", () => {
    render(
      <Providers>
        <AdminModelCatalog isAdmin={false} />
      </Providers>,
    );
    expect(screen.queryByTestId("admin-model-catalog")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
