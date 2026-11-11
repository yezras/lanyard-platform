/**
 * 0017 SLO CI catalog (lp-vqr0.13). T1–T9 are the frozen ruler.
 *
 * CI path is the package scripts already used in PRs:
 *   pnpm --filter @lanyard/control-plane test
 *   pnpm --filter @lanyard/bff test
 * No live Daytona. Changing IDs or named tests requires updating
 * docs/plans/0017-sandbox-first-chat-speed/testing.md.
 */

export const SLO_CI_IDS = [
  "T1",
  "T2",
  "T3",
  "T4",
  "T5",
  "T6",
  "T7",
  "T8",
  "T9",
] as const;

export type SloCiId = (typeof SLO_CI_IDS)[number];

export const SLO_CI_TESTING_MD =
  "docs/plans/0017-sandbox-first-chat-speed/testing.md";

export const SLO_CI_SECTION_HEADING = "## CI encoding (T1–T9)";

export const SLO_CI_PACKAGE_TEST_SCRIPT = "vitest run";

export type SloCiVitestPackage = "@lanyard/control-plane" | "@lanyard/bff";

export type SloCiNamedCase = {
  id: SloCiId;
  package: SloCiVitestPackage;
  /** Repo-relative path from the monorepo root. */
  file: string;
  namedTest: string;
  alsoContains?: readonly string[];
};

export type SloCiNaCase = {
  id: SloCiId;
  package: "n/a";
  reason: string;
  freezeFile: string;
  freezeNeedles: readonly string[];
};

export type SloCiCase = SloCiNamedCase | SloCiNaCase;

export const SLO_CI_CASES: Record<SloCiId, SloCiCase> = {
  T1: {
    id: "T1",
    package: "@lanyard/control-plane",
    file: "portal/packages/control-plane/test/send-bound-stopped.test.ts",
    namedTest: "T1 bound stopped ensure_online never cold_create (lp-vqr0.6)",
    alsoContains: [
      "real harness spy: create is not called; path is start_from_stopped; <5s",
    ],
  },
  T2: {
    id: "T2",
    package: "@lanyard/control-plane",
    file: "portal/packages/control-plane/test/warm-pool-snapshot-wake.test.ts",
    namedTest: "lp-vqr0.10 T2 warm pool claim + replenish (real harness)",
    alsoContains: [
      "claim on cold need binds instance, starts, path warm_pool, create_count 0",
      "warm pool empty miss still cold_create (metrics increment)",
    ],
  },
  T3: {
    id: "T3",
    package: "@lanyard/control-plane",
    file: "portal/packages/control-plane/test/ensure-online-relay.test.ts",
    namedTest: "agent_ready vs vault_writable (lp-vqr0.4 / T3)",
    alsoContains: [
      "Relay connected + vault not writable still yields presence online",
    ],
  },
  T4: {
    id: "T4",
    package: "@lanyard/bff",
    file: "portal/packages/bff/test/ensure-online-chat.test.ts",
    namedTest: "chat POST detaches from delayed ensure_online (lp-vqr0.8 T4)",
    alsoContains: [
      "delayed wake: POST 202 agent_starting in <15s; deliver after flight",
    ],
  },
  T5: {
    id: "T5",
    package: "@lanyard/bff",
    file: "portal/packages/bff/test/ensure-online-chat.test.ts",
    namedTest: "T5 ENSURE_ONLINE_ON_CHAT bound stopped never creates (lp-vqr0.6)",
  },
  T6: {
    id: "T6",
    package: "@lanyard/bff",
    file: "portal/packages/bff/test/chat-delivery.test.ts",
    namedTest: "harness no-tool turn skips sandbox wake (lp-vqr0.11 T6)",
    alsoContains: ["tool turn still ensure_online via toolbox bind"],
  },
  T7: {
    id: "T7",
    package: "@lanyard/bff",
    file: "portal/packages/bff/test/ensure-online-speculative.test.ts",
    namedTest: "POST /api/chat/ensure-online (T7)",
    alsoContains: [
      "after speculative completes, Send is already_online (no second create)",
    ],
  },
  T8: {
    id: "T8",
    package: "n/a",
    reason:
      "Guest entrypoint smoke is bash deploy/daytona/agent-gateway/smoke-entrypoint.sh, not a control-plane or BFF vitest. CI path stays the package test scripts. Freeze still requires the smoke file and T8 case names.",
    freezeFile: "deploy/daytona/agent-gateway/smoke-entrypoint.sh",
    freezeNeedles: [
      "T8 post-mount not-writable",
      "T8 default POST_MOUNT wait is 0",
      "T8 does not claim lp-puzc fixed",
    ],
  },
  T9: {
    id: "T9",
    package: "@lanyard/control-plane",
    file: "portal/packages/control-plane/test/slo-harness.test.ts",
    namedTest: "0017 real harness SLO harness (T9)",
    alsoContains: [
      "records time_to_agent_ready_ms by path and prints the histogram",
    ],
  },
};

export function sloCiCaseList(): SloCiCase[] {
  return SLO_CI_IDS.map((id) => SLO_CI_CASES[id]);
}

const LIVE_DAYTONA_IMPORT =
  /(?:^|\n)\s*(?:import|export)[\s\S]*?\bfrom\s+["'](?:[^"']*daytona-sdk-client|@daytona(?:\/[^"']*)?)["']/;

/** True when source imports the paid Daytona SDK rather than real harness. */
export function hasLiveDaytonaImport(source: string): boolean {
  return LIVE_DAYTONA_IMPORT.test(source);
}
