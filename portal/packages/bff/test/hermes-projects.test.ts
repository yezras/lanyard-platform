import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  createHermesProjectViaCli,
  createMemoryHermesProjectsStore,
  createSqliteHermesProjectsStore,
  getHermesProjectFromDb,
  hermesCliNotFoundMessage,
  HermesCliNotFoundError,
  listHermesProjectsFromDb,
  parseHermesCreateOutput,
  resolveFolderPath,
  resolveHermesBin,
  resolveHermesProjectsDbPath,
  writeHermesProjectsDbFixture,
} from "../src/hermes-projects.js";

describe("hermes-projects reader", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function tempDir(): Promise<string> {
    const dir = await mkdtemp(path.join(os.tmpdir(), "hermes-projects-"));
    tempDirs.push(dir);
    return dir;
  }

  it("resolveHermesProjectsDbPath defaults to ~/.hermes/projects.db", () => {
    expect(
      resolveHermesProjectsDbPath(undefined, {}, () => "/home/demo"),
    ).toBe("/home/demo/.hermes/projects.db");
  });

  it("resolveHermesProjectsDbPath prefers BACKEND_HOME when set", () => {
    expect(
      resolveHermesProjectsDbPath(undefined, {
        BACKEND_HOME: "/var/backend",
      }),
    ).toBe("/var/backend/projects.db");
  });

  it("resolveHermesProjectsDbPath honors HERMES_HOME and override", () => {
    expect(
      resolveHermesProjectsDbPath(undefined, {
        HERMES_HOME: "/var/hermes",
      }),
    ).toBe("/var/hermes/projects.db");
    expect(resolveHermesProjectsDbPath("/opt/h")).toBe("/opt/h/projects.db");
  });

  it("resolveFolderPath expands ~ and absolute-izes", () => {
    expect(resolveFolderPath("~/Demo", () => "/home/j")).toBe("/home/j/Demo");
    expect(resolveFolderPath("~", () => "/home/j")).toBe("/home/j");
    expect(resolveFolderPath("/tmp/x")).toBe(path.resolve("/tmp/x"));
  });

  it("returns empty list when projects.db is missing", async () => {
    const dir = await tempDir();
    const dbPath = path.join(dir, "missing.db");
    expect(listHermesProjectsFromDb(dbPath)).toEqual([]);
  });

  it("reads projects and folders from fixture projects.db", async () => {
    const dir = await tempDir();
    const dbPath = path.join(dir, "projects.db");
    writeHermesProjectsDbFixture(dbPath, [
      {
        id: "p_demo",
        slug: "demo",
        name: "Demo",
        primary_path: "/home/j/Demo",
        folders: [
          { path: "/home/j/Demo", is_primary: true },
          { path: "/home/j/Demo/docs", label: "docs", is_primary: false },
        ],
      },
      {
        id: "p_archived",
        slug: "old",
        name: "Old",
        primary_path: "/tmp/old",
        folders: [{ path: "/tmp/old", is_primary: true }],
        archived: true,
      },
    ]);

    const projects = listHermesProjectsFromDb(dbPath);
    expect(projects).toHaveLength(1);
    expect(projects[0]).toMatchObject({
      id: "p_demo",
      slug: "demo",
      name: "Demo",
      primary_path: path.resolve("/home/j/Demo"),
    });
    expect(projects[0]!.folders).toEqual([
      {
        path: path.resolve("/home/j/Demo"),
        label: null,
        is_primary: true,
      },
      {
        path: path.resolve("/home/j/Demo/docs"),
        label: "docs",
        is_primary: false,
      },
    ]);

    expect(getHermesProjectFromDb(dbPath, "p_demo")?.name).toBe("Demo");
    expect(getHermesProjectFromDb(dbPath, "missing")).toBeNull();

    const store = createSqliteHermesProjectsStore(dbPath);
    expect(store.listProjects()).toHaveLength(1);
    expect(store.getProject("p_demo")?.slug).toBe("demo");
  });

  it("uses first primary folder when primary_path column is null", async () => {
    const dir = await tempDir();
    const dbPath = path.join(dir, "projects.db");
    writeHermesProjectsDbFixture(dbPath, [
      {
        id: "p1",
        slug: "alpha",
        name: "Alpha",
        primary_path: null,
        folders: [
          { path: "/data/secondary", is_primary: false },
          { path: "/data/primary", is_primary: true },
        ],
      },
    ]);

    const project = getHermesProjectFromDb(dbPath, "p1");
    expect(project?.primary_path).toBe(path.resolve("/data/primary"));
  });

  it("memory store supports list/get/upsert", () => {
    const store = createMemoryHermesProjectsStore([
      {
        id: "p1",
        slug: "a",
        name: "A",
        primary_path: "/a",
        folders: [{ path: "/a", label: null, is_primary: true }],
      },
    ]);
    expect(store.listProjects()).toHaveLength(1);
    store.upsert({
      id: "p2",
      slug: "b",
      name: "B",
      primary_path: "/b",
      folders: [],
    });
    expect(store.getProject("p2")?.name).toBe("B");
  });

  it("parseHermesCreateOutput extracts slug and id", () => {
    expect(
      parseHermesCreateOutput("Created project portaltesttemp (p_45c4d9c9)\n"),
    ).toEqual({ slug: "portaltesttemp", id: "p_45c4d9c9" });
    expect(parseHermesCreateOutput("nope")).toBeNull();
  });

  it("resolveHermesBin prefers HERMES_BIN then bare hermes", () => {
    expect(
      resolveHermesBin({ HERMES_BIN: "/opt/custom/bin/hermes" }),
    ).toBe("/opt/custom/bin/hermes");
    expect(resolveHermesBin({}, "/explicit/hermes")).toBe("/explicit/hermes");
    // Without env or well-known executables → bare name for PATH spawn.
    expect(resolveHermesBin({})).toBe("hermes");
  });

  it("hermesCliNotFoundMessage is honest (no host-path CLI install hint)", () => {
    const msg = hermesCliNotFoundMessage("hermes");
    expect(msg).toMatch(/Creating a project on the agent is unavailable/);
    expect(msg).not.toMatch(/Brain RPC/);
    expect(msg).toMatch(/HERMES_BIN/);
    expect(msg).not.toMatch(/Install Hermes or run: hermes project create/);
    expect(msg).not.toMatch(/\/home\/portal\//);
  });

  it("createHermesProjectViaCli fails closed when binary is missing", async () => {
    const dir = await tempDir();
    const dbPath = path.join(dir, "projects.db");
    writeHermesProjectsDbFixture(dbPath, []);

    await expect(
      createHermesProjectViaCli(
        { name: "Test", folders: ["/home/portal/Test"] },
        {
          hermesBin: path.join(dir, "no-such-hermes-binary"),
          dbPath,
          env: {},
        },
      ),
    ).rejects.toBeInstanceOf(HermesCliNotFoundError);

    try {
      await createHermesProjectViaCli(
        { name: "Test", folders: ["/home/portal/Test"] },
        {
          hermesBin: path.join(dir, "no-such-hermes-binary"),
          dbPath,
          env: {},
        },
      );
    } catch (error) {
      expect(error).toBeInstanceOf(HermesCliNotFoundError);
      expect((error as Error).message).toMatch(
        /Creating a project on the agent is unavailable/,
      );
      expect((error as Error).message).not.toMatch(/Brain RPC/);
      expect((error as Error).message).not.toMatch(
        /Install Hermes or run: hermes project create "Test"/,
      );
    }
  });
});
