import { afterEach, describe, expect, it, vi } from "vitest";

import {
  fetchOpsMe,
  isLocalOpsFrontend,
  opsAdminApiPath,
  opsGoogleStartUrl,
  parseOpsOperator,
  stubOpsGoogleLogin,
} from "./opsAuth.js";

function requestPath(input: RequestInfo | URL): string {
  const raw =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.href
        : input.url;
  return new URL(raw, "http://localhost").pathname;
}

describe("parseOpsOperator", () => {
  it("accepts an ops-plane payload", () => {
    expect(
      parseOpsOperator({
        operator_id: "op-1",
        email: "ops@lanyard.local",
        plane: "ops",
      }),
    ).toEqual({
      operator_id: "op-1",
      email: "ops@lanyard.local",
      plane: "ops",
    });
  });

  it("rejects tenant-shaped payloads", () => {
    expect(
      parseOpsOperator({
        user_id: "user-1",
        email: "dev@demo.local",
        tenant_id: "tenant-1",
      }),
    ).toBeNull();
    expect(
      parseOpsOperator({
        operator_id: "op-1",
        email: "ops@lanyard.local",
        plane: "ops",
        tenant_id: "tenant-1",
      }),
    ).toBeNull();
    expect(
      parseOpsOperator({
        operator_id: "op-1",
        email: "ops@lanyard.local",
        plane: "tenant",
      }),
    ).toBeNull();
  });
});

describe("ops admin API paths", () => {
  it("stays on bare /api/admin", () => {
    expect(opsAdminApiPath("/auth/me")).toBe("/api/admin/auth/me");
    expect(opsGoogleStartUrl()).toBe("/api/admin/auth/google");
  });
});

describe("isLocalOpsFrontend", () => {
  it("treats localhost hosts as local ops", () => {
    expect(isLocalOpsFrontend("localhost")).toBe(true);
    expect(isLocalOpsFrontend("app.localhost")).toBe(true);
    expect(isLocalOpsFrontend("app.withlanyard.com")).toBe(false);
  });
});

describe("fetchOpsMe", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls /api/admin/auth/me and ignores tenant /api/auth/me", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        const path = requestPath(input);
        if (path === "/api/admin/auth/me") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                operator_id: "op-1",
                email: "ops@lanyard.local",
                plane: "ops",
              }),
              { status: 200 },
            ),
          );
        }
        if (path === "/api/auth/me") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                user_id: "user-1",
                email: "dev@demo.local",
                tenant_id: "tenant-1",
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });

    await expect(fetchOpsMe()).resolves.toEqual({
      operator_id: "op-1",
      email: "ops@lanyard.local",
      plane: "ops",
    });
    const paths = fetchMock.mock.calls.map(([url]) =>
      requestPath(url as RequestInfo),
    );
    expect(paths).toContain("/api/admin/auth/me");
    expect(paths).not.toContain("/api/auth/me");
  });

  it("returns null on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(null, { status: 401 }),
    );
    await expect(fetchOpsMe()).resolves.toBeNull();
  });
});

describe("stubOpsGoogleLogin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts to /api/admin/auth/google/stub with CSRF", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input) => {
        const path = requestPath(input);
        if (path === "/api/auth/csrf") {
          return Promise.resolve(
            new Response(JSON.stringify({ csrf_token: "csrf-ops" }), {
              status: 200,
            }),
          );
        }
        if (path === "/api/admin/auth/google/stub") {
          return Promise.resolve(
            new Response(
              JSON.stringify({
                operator_id: "ops@lanyard.local",
                email: "ops@lanyard.local",
                plane: "ops",
                provider: "google",
              }),
              { status: 200 },
            ),
          );
        }
        return Promise.resolve(new Response(null, { status: 404 }));
      });

    await expect(stubOpsGoogleLogin("ops@lanyard.local")).resolves.toEqual({
      operator_id: "ops@lanyard.local",
      email: "ops@lanyard.local",
      plane: "ops",
    });
    const paths = fetchMock.mock.calls.map(([url]) =>
      requestPath(url as RequestInfo),
    );
    expect(paths).toContain("/api/admin/auth/google/stub");
    expect(paths).not.toContain("/api/auth/google/stub");
  });
});
