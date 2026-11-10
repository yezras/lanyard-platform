import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { Providers } from "../../app/providers.js";
import { FakeOpsProofStory } from "./FakeOpsProofStory.js";
import { resetFakeOpsFetch } from "./fakeOpsFetch.js";

afterEach(() => {
  cleanup();
  resetFakeOpsFetch();
});

describe("FakeOpsProofStory", () => {
  it("mounts the superadmin empty shell", async () => {
    render(
      <Providers>
        <FakeOpsProofStory mode="superadmin" />
      </Providers>,
    );
    expect(screen.getByTestId("fakeops-proof-story")).toBeTruthy();
    await waitFor(() => {
      expect(screen.getByTestId("admin-nav-tenants")).toBeTruthy();
    });
    expect(screen.getByTestId("admin-nav-registry")).toBeTruthy();
    expect(screen.queryByTestId("admin-nav-instances")).toBeNull();
    expect(await screen.findByTestId("ops-tenant-row-mocklab")).toBeTruthy();
  });

  it("hides registry for a tenant_admin session", async () => {
    render(
      <Providers>
        <FakeOpsProofStory mode="tenant_admin" />
      </Providers>,
    );
    await waitFor(() => {
      expect(screen.getByTestId("admin-nav-connectors")).toBeTruthy();
    });
    expect(screen.queryByTestId("admin-nav-registry")).toBeNull();
    expect(screen.queryByTestId("admin-nav-secrets")).toBeNull();
  });

  it("does not treat a tenant session as ops auth", async () => {
    render(
      <Providers>
        <FakeOpsProofStory mode="unauth" />
      </Providers>,
    );
    expect(
      await screen.findByRole("heading", { name: "Platform admin" }),
    ).toBeTruthy();
    expect(screen.queryByTestId("admin-nav-registry")).toBeNull();
  });
});
