/**
 * lp-hdzm.31 — CP-backed Mock Lab Stripe residual: paste, CP row, 2xx,
 * no token on sandbox, re-wake no prompt, member omit fail-closed.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { REDACTED } from "@lanyard/shared";

import {
  proveMockLabStripeResidual,
  stripeResidualPassed,
} from "../src/mocklab-stripe-residual.js";
import { ControlPlaneStore } from "../src/store.js";
import { createTestStore } from "./pg-test-store.js";

const TOKEN = "sk_test_lp_hdzm31_cp_row";

describe("Mock Lab Stripe residual CP (lp-hdzm.31)", () => {
  let store: ControlPlaneStore;

  beforeEach(async () => {
    store = await createTestStore();
  });

  afterEach(async () => {
    await store?.close();
  });

  it("records the 6-tuple with a CP row and empty guest across re-wake", async () => {
    const evidence = await proveMockLabStripeResidual({
      store,
      token: TOKEN,
      fetchMode: "stub",
    });
    expect(stripeResidualPassed(evidence)).toBe(true);
    expect(evidence.bead_id).toBe("lp-hdzm.31");
    expect(evidence.tuple).toMatchObject({
      domain: "stripe.com",
      surface: "openapi",
      principal: "tenant",
      tool: "GET /v1/customers",
      paste: "superadmin",
    });
    expect(evidence.checks).toEqual({
      six_tuple: true,
      one_surface: true,
      cp_row: true,
      tool_2xx: true,
      no_token_on_sandbox: true,
      rewake_no_prompt: true,
      member_omit_fail_closed: true,
    });
    expect(evidence.http_status).toBe(200);
    expect(evidence.rewake_http_status).toBe(200);
    expect(evidence.member_omit_status).toBe(403);
    expect(evidence.guest_files_wake).toEqual([]);
    expect(evidence.guest_files_rewake).toEqual([]);
    expect(evidence.authorization_logged).toBe(REDACTED);
    expect(evidence.token_leaked).toBe(false);
    expect(JSON.stringify(evidence)).not.toContain(TOKEN);
  });
});
