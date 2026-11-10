/**
 * lp-vqr0.13 — BFF slice of the 0017 SLO CI freeze (T4–T7).
 *
 *   pnpm --filter @lanyard/bff test
 *
 * Named tests already run via this package's `test` script. No live Daytona.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = dirname(fileURLToPath(import.meta.url));
const TESTING_MD = resolve(
  HERE,
  "../../../../docs/plans/0017-sandbox-first-chat-speed/testing.md",
);

const LIVE_DAYTONA_IMPORT =
  /(?:^|\n)\s*(?:import|export)[\s\S]*?\bfrom\s+["'](?:[^"']*daytona-sdk-client|@daytona(?:\/[^"']*)?)["']/;

const BFF_SLO_CASES = [
  {
    id: "T4",
    file: "ensure-online-chat.test.ts",
    namedTest: "chat POST detaches from delayed ensure_online (lp-vqr0.8 T4)",
  },
  {
    id: "T5",
    file: "ensure-online-chat.test.ts",
    namedTest:
      "T5 ENSURE_ONLINE_ON_CHAT bound stopped never creates (lp-vqr0.6)",
  },
  {
    id: "T6",
    file: "chat-delivery.test.ts",
    namedTest: "harness no-tool turn skips sandbox wake (lp-vqr0.11 T6)",
  },
  {
    id: "T7",
    file: "ensure-online-speculative.test.ts",
    namedTest: "POST /api/chat/ensure-online (T7)",
  },
] as const;

describe("0017 SLO CI encoding (T4–T7)", () => {
  it("named tests exist and stay listed in testing.md", () => {
    const testing = readFileSync(TESTING_MD, "utf8");
    expect(testing).toContain("## CI encoding (T1–T9)");
    expect(testing).toContain("@lanyard/bff");
    expect(testing).toContain("pnpm --filter @lanyard/bff test");

    const pkg = JSON.parse(
      readFileSync(resolve(HERE, "../package.json"), "utf8"),
    ) as { scripts: { test: string } };
    expect(pkg.scripts.test).toBe("vitest run");

    for (const row of BFF_SLO_CASES) {
      expect(testing).toContain(`| ${row.id} |`);
      expect(testing).toContain(row.namedTest);
      const src = readFileSync(resolve(HERE, row.file), "utf8");
      expect(src).toContain(row.namedTest);
      expect(LIVE_DAYTONA_IMPORT.test(src)).toBe(false);
    }
  });
});
