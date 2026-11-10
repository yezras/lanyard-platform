import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createHermesProject,
  createProject,
  fetchHermesProjects,
  fetchProjects,
  hermesProjectToProject,
} from "./hermesProjects.js";

vi.mock("./client.js", () => ({
  apiFetch: vi.fn(),
}));

import { apiFetch } from "./client.js";

const demoHermes = {
  id: "p_demo",
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
};

describe("hermesProjectToProject", () => {
  it("maps Hermes primary_path to vault_path for chat UI", () => {
    expect(hermesProjectToProject(demoHermes)).toEqual({
      project_id: "p_demo",
      name: "Demo",
      vault_path: "/home/operator/Demo",
      parent_project_id: null,
    });
  });
});

describe("fetchHermesProjects / fetchProjects", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns projects from preferred /api/agent/projects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ projects: [demoHermes] }),
      }),
    );

    await expect(fetchHermesProjects()).resolves.toEqual([demoHermes]);
    expect(fetch).toHaveBeenCalledWith("/api/agent/projects", {
      credentials: "include",
    });

    await expect(fetchProjects()).resolves.toEqual([
      {
        project_id: "p_demo",
        name: "Demo",
        vault_path: "/home/operator/Demo",
        parent_project_id: null,
      },
    ]);
  });

  it("throws when the list is unavailable (non-OK) so UI can be honest", async () => {
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

  it("returns an empty list when host has zero projects (honest empty)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ projects: [] }),
      }),
    );

    await expect(fetchProjects()).resolves.toEqual([]);
  });
});

describe("createHermesProject / createProject", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("POSTs name and folders via apiFetch", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => demoHermes,
    } as Response);

    await expect(
      createHermesProject({
        name: "Demo",
        folders: ["/home/operator/Demo"],
      }),
    ).resolves.toEqual(demoHermes);

    expect(apiFetch).toHaveBeenCalledWith("/api/agent/projects", {
      method: "POST",
      body: JSON.stringify({
        name: "Demo",
        folders: ["/home/operator/Demo"],
      }),
    });
  });

  it("createProject maps vault_path to Hermes folders", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: true,
      json: async () => demoHermes,
    } as Response);

    await expect(
      createProject({ name: "Demo", vault_path: "/home/operator/Demo" }),
    ).resolves.toEqual({
      project_id: "p_demo",
      name: "Demo",
      vault_path: "/home/operator/Demo",
      parent_project_id: null,
    });
  });

  it("throws when the API returns an error", async () => {
    vi.mocked(apiFetch).mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({
        error:
          "hermes CLI not found (hermes). For host-backed project create set BRAIN_RPC_ENABLED=1",
      }),
    } as Response);

    await expect(
      createHermesProject({ name: "X", folders: ["~/X"] }),
    ).rejects.toThrow(/hermes CLI not found|BRAIN_RPC_ENABLED/);
  });
});
