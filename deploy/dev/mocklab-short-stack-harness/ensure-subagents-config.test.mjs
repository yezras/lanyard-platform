import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  DEFAULT_HARNESS_BACKEND_HOME,
  KITCHEN_SINK_BACKEND_HOME,
  MOCKLAB_V1_SUBAGENTS_YAML,
  ensureHarnessSubagentsConfig,
  resolveHarnessBackendHome,
  subagentsEnabledFromYaml,
} from "./ensure-subagents-config.mjs";

describe("subagentsEnabledFromYaml", () => {
  it("returns null when the block is omitted", () => {
    assert.equal(subagentsEnabledFromYaml("default_model: grok\n"), null);
    assert.equal(subagentsEnabledFromYaml(""), null);
  });

  it("reads enabled true/false inside the subagents block", () => {
    assert.equal(subagentsEnabledFromYaml(MOCKLAB_V1_SUBAGENTS_YAML), true);
    assert.equal(
      subagentsEnabledFromYaml("subagents:\n  enabled: false\n  max_depth: 1\n"),
      false,
    );
  });

  it("ignores enabled on a later top-level key", () => {
    assert.equal(
      subagentsEnabledFromYaml("workflow:\n  enabled: true\n"),
      null,
    );
  });
});

describe("resolveHarnessBackendHome", () => {
  it("prefers BACKEND_HOME then LANYARD_BACKEND_HOME", () => {
    assert.equal(
      resolveHarnessBackendHome({ BACKEND_HOME: "/a/", LANYARD_BACKEND_HOME: "/b" }),
      "/a",
    );
    assert.equal(resolveHarnessBackendHome({ LANYARD_BACKEND_HOME: "/b" }), "/b");
    assert.equal(
      resolveHarnessBackendHome({}, { exists: () => false }),
      DEFAULT_HARNESS_BACKEND_HOME,
    );
  });

  it("uses kitchen-sink home when env is empty and that config exists", () => {
    assert.equal(
      resolveHarnessBackendHome({}, { exists: (p) => p === `${KITCHEN_SINK_BACKEND_HOME}/config.yaml` }),
      KITCHEN_SINK_BACKEND_HOME,
    );
  });
});

describe("ensureHarnessSubagentsConfig", () => {
  it("writes MockLab v1 subagents.enabled when config.yaml is missing", async () => {
    const home = await mkdtemp(join(tmpdir(), "harness-subagents-missing-"));
    const result = await ensureHarnessSubagentsConfig(home);
    assert.deepEqual(result, { backendHome: home, enabled: true, wrote: true });
    const body = await readFile(join(home, "config.yaml"), "utf8");
    assert.equal(subagentsEnabledFromYaml(body), true);
    assert.match(body, /default_isolation: none/);
    assert.match(body, /max_depth: 1/);
  });

  it("appends the block when other keys exist but subagents is omitted", async () => {
    const home = await mkdtemp(join(tmpdir(), "harness-subagents-append-"));
    await writeFile(join(home, "config.yaml"), "default_model: grok-4\n", "utf8");
    const result = await ensureHarnessSubagentsConfig(home);
    assert.equal(result.wrote, true);
    assert.equal(result.enabled, true);
    const body = await readFile(join(home, "config.yaml"), "utf8");
    assert.match(body, /default_model: grok-4/);
    assert.equal(subagentsEnabledFromYaml(body), true);
  });

  it("does not clobber subagents.enabled false", async () => {
    const home = await mkdtemp(join(tmpdir(), "harness-subagents-off-"));
    await writeFile(
      join(home, "config.yaml"),
      "subagents:\n  enabled: false\n",
      "utf8",
    );
    const result = await ensureHarnessSubagentsConfig(home);
    assert.deepEqual(result, { backendHome: home, enabled: false, wrote: false });
    const body = await readFile(join(home, "config.yaml"), "utf8");
    assert.equal(body, "subagents:\n  enabled: false\n");
  });

  it("leaves an already-enabled block alone", async () => {
    const home = await mkdtemp(join(tmpdir(), "harness-subagents-on-"));
    await writeFile(join(home, "config.yaml"), MOCKLAB_V1_SUBAGENTS_YAML, "utf8");
    const result = await ensureHarnessSubagentsConfig(home);
    assert.deepEqual(result, { backendHome: home, enabled: true, wrote: false });
  });
});
