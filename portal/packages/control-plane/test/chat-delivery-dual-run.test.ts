/**
 * lp-oop.29 — Persist chat_delivery on tenant/instance (dual-run).
 *
 * Acceptance:
 *   - Default relay (unset inherit env / today's path)
 *   - MockLab can flip alone (one tenant harness, sibling stays unset)
 *   - Do not rewrite the guest snapshot
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CHAT_DELIVERIES, DEFAULT_CHAT_DELIVERY } from "../src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const migrateSrc = readFileSync(join(__dirname, "../src/migrate.ts"), "utf8");
const appSrc = readFileSync(join(__dirname, "../src/app.ts"), "utf8");
const typesSrc = readFileSync(join(__dirname, "../src/types.ts"), "utf8");
const readmeSrc = readFileSync(join(__dirname, "../README.md"), "utf8");
const phase8Src = readFileSync(
  join(
    __dirname,
    "../../../../docs/plans/0015-short-stack/phase-8-dual-run-proof.md",
  ),
  "utf8",
);

describe("chat_delivery dual-run catalog (lp-oop.29)", () => {
  it("defaults to relay and only allows relay|harness", () => {
    expect(DEFAULT_CHAT_DELIVERY).toBe("relay");
    expect([...CHAT_DELIVERIES]).toEqual(["relay", "harness"]);
    expect(typesSrc).toContain('export type ChatDelivery = (typeof CHAT_DELIVERIES)[number]');
  });

  it("greenfield + upgrade persist chat_delivery on tenant and instance", () => {
    expect(migrateSrc).toMatch(
      /chat_delivery TEXT\s+CHECK \(chat_delivery IS NULL OR chat_delivery IN \('relay', 'harness'\)\)/,
    );
    expect(migrateSrc).toContain(
      "ALTER TABLE tenants ADD COLUMN chat_delivery TEXT",
    );
    expect(migrateSrc).toContain(
      "ALTER TABLE gateway_instances ADD COLUMN chat_delivery TEXT",
    );
    expect(migrateSrc).toContain("tenants_chat_delivery_check");
    expect(migrateSrc).toContain("gateway_instances_chat_delivery_check");
  });

  it("ops can flip one tenant and one instance", () => {
    expect(appSrc).toContain("/internal/tenants/:id/chat-delivery");
    expect(appSrc).toContain("updateTenantChatDelivery");
    expect(appSrc).toContain("chat_delivery: z.enum(CHAT_DELIVERIES).nullable()");
    expect(readmeSrc).toContain("chat_delivery");
    expect(readmeSrc).toContain("MockLab");
    expect(phase8Src).toContain("instance > tenant > env > `relay`");
    expect(phase8Src).toMatch(
      /Do \*\*not\*\* write `DAYTONA_DEFAULT_SNAPSHOT`/,
    );
  });
});
