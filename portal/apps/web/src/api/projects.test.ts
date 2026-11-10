/**
 * Chat directory client is Hermes-backed; full coverage lives in hermesProjects.test.ts.
 * This file keeps a smoke suite on the public projects re-export surface.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { createProject, fetchProjects } from "./projects.js";

vi.mock("./client.js", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "./client.js";

describe("fetchProjects (Hermes-backed)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns projects from preferred /api/agent/projects", async () => {
    const hermes = [
      {
        id: "p1",
        slug: "demo",
        name: "Demo",
        primary_path: "/home/operator/Demo",
        folders: [
          {
            path: "/home/operator/Demo",
            label: null,
            is_primary: true,
          },
        ],
      },
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ projects: hermes }),
      }),
    );

    await expect(fetchProjects()).resolves.toEqual([
      {
        project_id: "p1",
        name: "Demo",
        vault_path: "/home/operator/Demo",
        parent_project_id: null,
      },
    ]);
    expect(fetch).toHaveBeenCalledWith("/api/agent/projects", {
      credentials: "include",
    });
  });

  it("throws when the list is unavailable so Directory can be honest", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 503,
      }),
    );

    await expect(fetchProjects()).rejects.toThrow(
      /Failed to list agent projects \(503\)/,
    );
  });
});

describe("createProject (Hermes-backed)", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("POSTs via preferred /api/agent/projects using vault_path as folder", async () => {
    const hermes = {
      id: "p-new",
      slug: "beta",
      name: "Beta",
      primary_path: "/home/operator/Beta",
      folders: [
        {
          path: "/home/operator/Beta",
          label: null,
          is_primary: true,
        },
      ],
    };
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => hermes,
    } as Response);

    await expect(
      createProject({ name: "Beta", vault_path: "/home/operator/Beta" }),
    ).resolves.toEqual({
      project_id: "p-new",
      name: "Beta",
      vault_path: "/home/operator/Beta",
      parent_project_id: null,
    });

    expect(apiFetch).toHaveBeenCalledWith("/api/agent/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "Beta",
        folders: ["/home/operator/Beta"],
      }),
    });
  });

  it("throws when the API returns an error", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "Invalid folder" }),
    } as Response);

    await expect(
      createProject({ name: "X", vault_path: "bad" }),
    ).rejects.toThrow("Invalid folder");
  });
});
