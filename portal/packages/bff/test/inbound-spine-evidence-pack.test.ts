/**
 * lp-k5c4.10 — Phase 9 evidence pack: typed checks + HOLD fences.
 *
 * Live Taste/toolbox/cron live in artifacts/mocklab/lp-k5c4/. This file
 * encodes the pack's domain (spineEnabled, classifier, HOLD) so CI can
 * fail closed without AWS apply.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { classifySandboxNeed } from "../src/inbound-sandbox-need.js";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../../..");
const evidenceDir = join(repoRoot, "artifacts/mocklab/lp-k5c4");
const prove = join(repoRoot, "deploy/scripts/prove-mocklab-inbound-spine.sh");
const smoke = join(repoRoot, "deploy/scripts/smoke-mocklab-inbound-spine.sh");
const latest = join(evidenceDir, "live-proof-evidence-latest.json");

describe("lp-k5c4.10 evidence pack files", () => {
  it("prove/smoke/README exist and forbid terraform apply", () => {
    for (const path of [
      prove,
      smoke,
      join(evidenceDir, "README.md"),
      join(evidenceDir, "run_live_probe.py"),
    ]) {
      expect(existsSync(path), path).toBe(true);
    }
    const proveText = readFileSync(prove, "utf8");
    expect(proveText).toMatch(/Does not terraform apply/i);
    expect(proveText).toMatch(/Does not restage/i);
    expect(proveText).toMatch(/lp-k5c4\.10/);
    const readme = readFileSync(join(evidenceDir, "README.md"), "utf8");
    expect(readme).toMatch(/No secrets/);
    expect(readme).toMatch(/HOLD/);
  });
});

describe("lp-k5c4.10 spineEnabled predicate (persist harness, env relay)", () => {
  it("source gate is HARNESS_URL wired → spine (lp-k5c4.13 Phase 10, no persist branch)", () => {
    const src = readFileSync(
      join(repoRoot, "portal/packages/bff/src/inbound-spine.ts"),
      "utf8",
    );
    // lp-k5c4.13: request path no longer branches on tenantChatDelivery
    expect(src).toContain("return input.harnessUrlWired");
    expect(src).toContain('return { kind: "spine" }');
    expect(src).toContain("envChatDelivery");
    // Deprecated param should remain for rollback but not be used for spine decision
    expect(src).not.toContain('tenantChatDelivery === "harness" && input.harnessUrlWired');
  });

  it("classifies Taste none and toolbox/cron-tool_only as toolbox", () => {
    expect(
      classifySandboxNeed({
        source: "web",
        text: "Do not use tools. Reply with exactly this one line: pong lp-k5c4.10-taste",
      }),
    ).toBe("none");
    expect(
      classifySandboxNeed({
        source: "web",
        text: "Please parse_document /mnt/vault/AGENTS.md and use bash.",
      }),
    ).toBe("toolbox");
    expect(
      classifySandboxNeed({
        source: "cron",
        text: "nightly vault digest",
        sandboxCreateProfile: "tool_only",
      }),
    ).toBe("toolbox");
  });
});

describe("lp-k5c4.10 committed evidence JSON", () => {
  it("is PASS with HOLD + Taste + zero deliverInbound when present", () => {
    if (!existsSync(latest)) return;
    const data = JSON.parse(readFileSync(latest, "utf8")) as {
      bead_id?: string;
      result?: string;
      hold?: { terraform_apply?: boolean; restage?: boolean; status?: string };
      persist?: { chat_delivery?: string; process_env_chat_delivery?: string };
      taste?: { http_status?: number; sse?: { hung?: boolean; outcome?: string } };
      toolbox?: { path?: string; cold_create?: boolean };
      hop?: { deliverInbound_calls?: number };
      checks?: Record<string, boolean>;
    };
    expect(data.bead_id).toBe("lp-k5c4.10");
    expect(data.result).toBe("PASS");
    expect(data.hold?.terraform_apply).toBe(false);
    expect(data.hold?.restage).toBe(false);
    expect(data.hold?.status).toBe("lifted_for_proof_only");
    expect(data.persist?.chat_delivery).toBe("harness");
    expect(data.persist?.process_env_chat_delivery).toBe("relay");
    expect(data.taste?.http_status).toBe(200);
    expect(data.taste?.sse?.hung).not.toBe(true);
    expect(["completed", "stall_error"]).toContain(data.taste?.sse?.outcome);
    expect(data.toolbox?.path).not.toBe("cold_create");
    expect(data.toolbox?.cold_create).not.toBe(true);
    expect(data.hop?.deliverInbound_calls).toBe(0);
    expect(data.checks?.["hop.deliverInbound_zero"]).toBe(true);
    expect(data.checks?.["hold.no_terraform_apply"]).toBe(true);
  });
});
