/**
 * lp-kng.2.3 + lp-04r — Daytona webhook parse/HMAC/presence + HTTP receiver.
 *
 * - sandbox.state.updated payload vectors (started / stopped / error-like)
 * - Invalid HMAC rejected (unit + HTTP 401)
 * - Maps into OrchestratorInstanceStore (in-memory presence store)
 * - POST /webhooks/daytona presence updates, idempotent redelivery
 *
 * No live Daytona / AWS. Fixtures use throwaway test secrets only.
 */
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";
import { isPublicUnauthenticatedPath } from "../src/auth-mode.js";
import {
  applySandboxStateUpdatedToStore,
  assertDaytonaWebhookHmac,
  DAYTONA_WEBHOOK_EVENT_SANDBOX_STATE_UPDATED,
  DAYTONA_WEBHOOK_PATH,
  DAYTONA_WEBHOOK_SIGNATURE_HEADER,
  DaytonaWebhookParseError,
  DaytonaWebhookSignatureError,
  formatDaytonaWebhookSignatureHeader,
  handleDaytonaWebhookRequest,
  mapSandboxStateToPresenceIntent,
  normalizeDaytonaWebhookState,
  parseDaytonaWebhookSignatureHeader,
  parseSandboxStateUpdatedPayload,
  processSandboxStateUpdatedWebhook,
  signDaytonaWebhookBody,
  verifyDaytonaWebhookHmac,
  type DaytonaSandboxStateUpdatedPayload,
} from "../src/daytona-webhook.js";
import {
  createInMemoryOrchestratorInstanceStore,
  type OrchestratorInstanceRecord,
} from "../src/instance-orchestrator.js";
import type { ControlPlaneStore } from "../src/store.js";

/** Throwaway fixture secret — not a real credential. */
const TEST_SECRET = "test-daytona-webhook-secret-lp-04r";
const SANDBOX_ID = "sandbox-abc-123";
const INSTANCE_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TENANT_ID = "cccccccc-cccc-cccc-cccc-cccccccccccc";
const ORG_ID = "org-lanyard-test";
const TS = "2026-07-31T15:00:00.000Z";

/** Canonical Daytona docs example shape (started → stopped). */
function stateUpdatedPayload(
  overrides: Partial<DaytonaSandboxStateUpdatedPayload> & {
    newState: string;
    oldState?: string;
  },
): DaytonaSandboxStateUpdatedPayload {
  return {
    event: DAYTONA_WEBHOOK_EVENT_SANDBOX_STATE_UPDATED,
    timestamp: TS,
    id: SANDBOX_ID,
    organizationId: ORG_ID,
    oldState: overrides.oldState ?? "started",
    newState: overrides.newState,
    updatedAt: overrides.updatedAt ?? TS,
    ...overrides,
  };
}

function seedRecord(
  overrides: Partial<OrchestratorInstanceRecord> = {},
): OrchestratorInstanceRecord {
  return {
    instance_id: INSTANCE_ID,
    tenant_id: TENANT_ID,
    runtime_kind: "daytona",
    presence: "online",
    sandbox_id: SANDBOX_ID,
    agent_snapshot_id: "snap-agent-v1",
    s3_vault_prefix: `tenants/${TENANT_ID}/vault/`,
    last_activity_at: TS,
    mid_turn: false,
    revoked_at: null,
    ...overrides,
  };
}

function rawJson(payload: unknown): string {
  return JSON.stringify(payload);
}

function signed(rawBody: string, secret = TEST_SECRET): string {
  return formatDaytonaWebhookSignatureHeader(
    signDaytonaWebhookBody(rawBody, secret),
  );
}

describe("sandbox.state.updated parse (lp-kng.2.3)", () => {
  it("parses Daytona docs-shaped started→stopped vector", () => {
    const body = {
      event: "sandbox.state.updated",
      timestamp: "2025-12-19T10:30:00.000Z",
      id: "sandbox123",
      organizationId: "org123",
      oldState: "started",
      newState: "stopped",
      updatedAt: "2025-12-19T10:30:00.000Z",
    };
    const parsed = parseSandboxStateUpdatedPayload(body);
    expect(parsed.event).toBe(DAYTONA_WEBHOOK_EVENT_SANDBOX_STATE_UPDATED);
    expect(parsed.id).toBe("sandbox123");
    expect(parsed.oldState).toBe("started");
    expect(parsed.newState).toBe("stopped");
    expect(parsed.organizationId).toBe("org123");
  });

  it("rejects wrong event type", () => {
    expect(() =>
      parseSandboxStateUpdatedPayload({
        event: "sandbox.created",
        timestamp: TS,
        id: SANDBOX_ID,
        organizationId: ORG_ID,
        oldState: "creating",
        newState: "started",
        updatedAt: TS,
      }),
    ).toThrow(DaytonaWebhookParseError);
  });

  it("rejects missing newState", () => {
    expect(() =>
      parseSandboxStateUpdatedPayload({
        event: "sandbox.state.updated",
        timestamp: TS,
        id: SANDBOX_ID,
        organizationId: ORG_ID,
        oldState: "started",
        updatedAt: TS,
      }),
    ).toThrow(/newState/);
  });

  it("rejects non-object body", () => {
    expect(() => parseSandboxStateUpdatedPayload(null)).toThrow(
      DaytonaWebhookParseError,
    );
    expect(() => parseSandboxStateUpdatedPayload("x")).toThrow(
      DaytonaWebhookParseError,
    );
  });
});

describe("HMAC verify (lp-kng.2.3)", () => {
  it("accepts valid sha256= hex signature over raw body", () => {
    const body = rawJson(stateUpdatedPayload({ newState: "stopped" }));
    const header = signed(body);
    expect(header.startsWith("sha256=")).toBe(true);
    expect(verifyDaytonaWebhookHmac(body, header, TEST_SECRET)).toBe(true);
    expect(() =>
      assertDaytonaWebhookHmac(body, header, TEST_SECRET),
    ).not.toThrow();
  });

  it("accepts raw hex signature (no prefix)", () => {
    const body = rawJson(stateUpdatedPayload({ newState: "started" }));
    const hex = signDaytonaWebhookBody(body, TEST_SECRET);
    expect(verifyDaytonaWebhookHmac(body, hex, TEST_SECRET)).toBe(true);
  });

  it("rejects invalid HMAC in unit test", () => {
    const body = rawJson(stateUpdatedPayload({ newState: "stopped" }));
    const bad = formatDaytonaWebhookSignatureHeader(
      signDaytonaWebhookBody(body, "wrong-secret"),
    );
    expect(verifyDaytonaWebhookHmac(body, bad, TEST_SECRET)).toBe(false);
    expect(() => assertDaytonaWebhookHmac(body, bad, TEST_SECRET)).toThrow(
      DaytonaWebhookSignatureError,
    );
  });

  it("rejects tampered body with otherwise valid secret", () => {
    const body = rawJson(stateUpdatedPayload({ newState: "stopped" }));
    const header = signed(body);
    const tampered = body.replace("stopped", "started");
    expect(verifyDaytonaWebhookHmac(tampered, header, TEST_SECRET)).toBe(
      false,
    );
  });

  it("rejects missing / empty / malformed signature header", () => {
    const body = rawJson(stateUpdatedPayload({ newState: "error" }));
    expect(verifyDaytonaWebhookHmac(body, null, TEST_SECRET)).toBe(false);
    expect(verifyDaytonaWebhookHmac(body, "", TEST_SECRET)).toBe(false);
    expect(verifyDaytonaWebhookHmac(body, "not-hex", TEST_SECRET)).toBe(false);
    expect(() =>
      assertDaytonaWebhookHmac(body, undefined, TEST_SECRET),
    ).toThrow(DaytonaWebhookSignatureError);
  });

  it("processSandboxStateUpdatedWebhook rejects bad HMAC before store write", async () => {
    const store = createInMemoryOrchestratorInstanceStore([seedRecord()]);
    const body = rawJson(stateUpdatedPayload({ newState: "stopped" }));
    await expect(
      processSandboxStateUpdatedWebhook({
        rawBody: body,
        signatureHeader: signed(body, "other"),
        secret: TEST_SECRET,
        store,
      }),
    ).rejects.toThrow(DaytonaWebhookSignatureError);

    const still = await store.get(INSTANCE_ID);
    expect(still?.presence).toBe("online");
    expect(still?.sandbox_id).toBe(SANDBOX_ID);
  });

  it("signature header constant is the documented wire name", () => {
    expect(DAYTONA_WEBHOOK_SIGNATURE_HEADER).toBe("x-daytona-signature");
    expect(parseDaytonaWebhookSignatureHeader("sha256=a")).toBeNull(); // odd length
    expect(parseDaytonaWebhookSignatureHeader("sha256=not-hex!!")).toBeNull();
    expect(parseDaytonaWebhookSignatureHeader("sha256=abcd")).toBe("abcd");
  });
});

describe("presence map intents (started / stopped / error-like)", () => {
  it("started while waking → wake_succeeded → online", () => {
    const intent = mapSandboxStateToPresenceIntent("started", "waking");
    expect(intent.reason).toBe("wake_succeeded");
    expect(intent.next_presence).toBe("online");
    expect(intent.clear_sandbox_id).toBe(false);
  });

  it("Started (Title Case) normalizes like started", () => {
    expect(normalizeDaytonaWebhookState("Started")).toBe("started");
    const intent = mapSandboxStateToPresenceIntent("Started", "waking");
    expect(intent.reason).toBe("wake_succeeded");
  });

  it("started while online is no-op", () => {
    const intent = mapSandboxStateToPresenceIntent("started", "online");
    expect(intent.reason).toBeNull();
  });

  it("started while offline is ignored (no illegal offline→online)", () => {
    const intent = mapSandboxStateToPresenceIntent("started", "offline");
    expect(intent.reason).toBeNull();
  });

  it("stopped while online → offline + clear sandbox_id", () => {
    const intent = mapSandboxStateToPresenceIntent("stopped", "online");
    expect(intent.reason).toBe("idle_stop");
    expect(intent.next_presence).toBe("offline");
    expect(intent.clear_sandbox_id).toBe(true);
  });

  it("archived / deleted / paused map to offline", () => {
    for (const state of ["archived", "deleted", "paused"] as const) {
      const intent = mapSandboxStateToPresenceIntent(state, "online");
      expect(intent.next_presence).toBe("offline");
      expect(intent.clear_sandbox_id).toBe(true);
    }
  });

  it("stopped while waking → wake_abandoned → offline", () => {
    const intent = mapSandboxStateToPresenceIntent("stopped", "waking");
    expect(intent.reason).toBe("wake_abandoned");
    expect(intent.next_presence).toBe("offline");
  });

  it("error while waking → wake_failed → error", () => {
    const intent = mapSandboxStateToPresenceIntent("error", "waking");
    expect(intent.reason).toBe("wake_failed");
    expect(intent.next_presence).toBe("error");
  });

  it("error while online → runtime_error → error", () => {
    const intent = mapSandboxStateToPresenceIntent("error", "online");
    expect(intent.reason).toBe("runtime_error");
    expect(intent.next_presence).toBe("error");
    expect(intent.clear_sandbox_id).toBe(false);
  });

  it("build_failed is error-like", () => {
    const intent = mapSandboxStateToPresenceIntent("build_failed", "waking");
    expect(intent.reason).toBe("wake_failed");
    expect(intent.next_presence).toBe("error");
  });

  it("transitional creating/starting ignored", () => {
    for (const state of ["creating", "starting", "stopping", "pulling_snapshot"]) {
      const intent = mapSandboxStateToPresenceIntent(state, "waking");
      expect(intent.reason).toBeNull();
    }
  });
});

describe("maps into presence store interface (lp-kng.2.3)", () => {
  it("vector: stopped updates online → offline and clears sandbox_id", async () => {
    const store = createInMemoryOrchestratorInstanceStore([seedRecord()]);
    const payload = stateUpdatedPayload({
      oldState: "started",
      newState: "stopped",
    });

    const result = await applySandboxStateUpdatedToStore(store, payload);
    expect(result.outcome).toBe("applied");
    expect(result.applied).toBe(true);
    expect(result.updated?.presence).toBe("offline");
    expect(result.updated?.sandbox_id).toBeNull();

    const got = await store.get(INSTANCE_ID);
    expect(got?.presence).toBe("offline");
    expect(got?.sandbox_id).toBeNull();
    // Durable fields preserved
    expect(got?.s3_vault_prefix).toBe(`tenants/${TENANT_ID}/vault/`);
    expect(got?.instance_id).toBe(INSTANCE_ID);
  });

  it("vector: started promotes waking → online (keeps sandbox_id)", async () => {
    const store = createInMemoryOrchestratorInstanceStore([
      seedRecord({ presence: "waking", sandbox_id: SANDBOX_ID }),
    ]);
    const payload = stateUpdatedPayload({
      oldState: "starting",
      newState: "started",
    });

    const result = await applySandboxStateUpdatedToStore(store, payload);
    expect(result.outcome).toBe("applied");
    expect(result.updated?.presence).toBe("online");
    expect(result.updated?.sandbox_id).toBe(SANDBOX_ID);
  });

  it("vector: error while online → error (sandbox_id retained for ops)", async () => {
    const store = createInMemoryOrchestratorInstanceStore([seedRecord()]);
    const payload = stateUpdatedPayload({
      oldState: "started",
      newState: "error",
    });

    const result = await applySandboxStateUpdatedToStore(store, payload);
    expect(result.outcome).toBe("applied");
    expect(result.updated?.presence).toBe("error");
    expect(result.updated?.sandbox_id).toBe(SANDBOX_ID);
  });

  it("vector: error while waking → error", async () => {
    const store = createInMemoryOrchestratorInstanceStore([
      seedRecord({ presence: "waking" }),
    ]);
    const payload = stateUpdatedPayload({
      oldState: "creating",
      newState: "error",
    });

    const result = await applySandboxStateUpdatedToStore(store, payload);
    expect(result.applied).toBe(true);
    expect(result.updated?.presence).toBe("error");
  });

  it("unknown sandbox_id does not invent an instance", async () => {
    const store = createInMemoryOrchestratorInstanceStore([
      seedRecord({ sandbox_id: "other-sandbox" }),
    ]);
    const result = await applySandboxStateUpdatedToStore(
      store,
      stateUpdatedPayload({ newState: "stopped" }),
    );
    expect(result.outcome).toBe("unknown_sandbox");
    expect(result.applied).toBe(false);
    expect((await store.get(INSTANCE_ID))?.presence).toBe("online");
  });

  it("full process path: valid HMAC + stopped → store offline", async () => {
    const store = createInMemoryOrchestratorInstanceStore([seedRecord()]);
    const payload = stateUpdatedPayload({ newState: "stopped" });
    const body = rawJson(payload);

    const result = await processSandboxStateUpdatedWebhook({
      rawBody: body,
      signatureHeader: signed(body),
      secret: TEST_SECRET,
      store,
    });

    expect(result.outcome).toBe("applied");
    expect((await store.get(INSTANCE_ID))?.presence).toBe("offline");
  });

  it("second stopped after clear is unknown_sandbox (binding gone)", async () => {
    const store = createInMemoryOrchestratorInstanceStore([seedRecord()]);
    await applySandboxStateUpdatedToStore(
      store,
      stateUpdatedPayload({ newState: "stopped" }),
    );
    // After clear, second event with same sandbox_id no longer matches.
    const second = await applySandboxStateUpdatedToStore(
      store,
      stateUpdatedPayload({ newState: "stopped" }),
    );
    expect(second.outcome).toBe("unknown_sandbox");
    expect((await store.get(INSTANCE_ID))?.presence).toBe("offline");
  });

  it("stop-like while already offline with stale sandbox_id is no-op intent", async () => {
    const store = createInMemoryOrchestratorInstanceStore([
      seedRecord({ presence: "offline", sandbox_id: SANDBOX_ID }),
    ]);
    const result = await applySandboxStateUpdatedToStore(
      store,
      stateUpdatedPayload({ newState: "stopped" }),
    );
    expect(result.outcome).toBe("ignored");
    expect(result.applied).toBe(false);
    expect((await store.get(INSTANCE_ID))?.presence).toBe("offline");
  });
});

describe("handleDaytonaWebhookRequest (lp-04r HTTP mapping)", () => {
  it("returns 503 when secret is not configured", async () => {
    const store = createInMemoryOrchestratorInstanceStore([seedRecord()]);
    const body = rawJson(stateUpdatedPayload({ newState: "stopped" }));
    const result = await handleDaytonaWebhookRequest({
      rawBody: body,
      signatureHeader: signed(body),
      secret: "",
      store,
    });
    expect(result.status).toBe(503);
    expect(result.body.outcome).toBe("not_configured");
    expect(result.body.applied).toBe(false);
    expect((await store.get(INSTANCE_ID))?.presence).toBe("online");
  });

  it("rejects bad signatures with 401 and does not write store", async () => {
    const store = createInMemoryOrchestratorInstanceStore([seedRecord()]);
    const body = rawJson(stateUpdatedPayload({ newState: "stopped" }));
    const result = await handleDaytonaWebhookRequest({
      rawBody: body,
      signatureHeader: signed(body, "wrong-secret"),
      secret: TEST_SECRET,
      store,
    });
    expect(result.status).toBe(401);
    expect(result.body.outcome).toBe("signature_invalid");
    expect(result.body.ok).toBe(false);
    expect((await store.get(INSTANCE_ID))?.presence).toBe("online");
    expect((await store.get(INSTANCE_ID))?.sandbox_id).toBe(SANDBOX_ID);
  });

  it("applies started while waking → online", async () => {
    const store = createInMemoryOrchestratorInstanceStore([
      seedRecord({ presence: "waking" }),
    ]);
    const body = rawJson(
      stateUpdatedPayload({ oldState: "starting", newState: "started" }),
    );
    const result = await handleDaytonaWebhookRequest({
      rawBody: body,
      signatureHeader: signed(body),
      secret: TEST_SECRET,
      store,
    });
    expect(result.status).toBe(200);
    expect(result.body.ok).toBe(true);
    expect(result.body.outcome).toBe("applied");
    expect(result.body.applied).toBe(true);
    expect(result.body.instance_id).toBe(INSTANCE_ID);
    expect(result.body.presence).toBe("online");
    expect(result.body.sandbox_id).toBe(SANDBOX_ID);
  });

  it("applies stopped → offline and clears sandbox_id", async () => {
    const store = createInMemoryOrchestratorInstanceStore([seedRecord()]);
    const body = rawJson(stateUpdatedPayload({ newState: "stopped" }));
    const result = await handleDaytonaWebhookRequest({
      rawBody: body,
      signatureHeader: signed(body),
      secret: TEST_SECRET,
      store,
    });
    expect(result.status).toBe(200);
    expect(result.body.outcome).toBe("applied");
    expect(result.body.presence).toBe("offline");
    expect(result.body.sandbox_id).toBeNull();
  });

  it("is idempotent: second identical stopped delivery ACKs without clobber", async () => {
    const store = createInMemoryOrchestratorInstanceStore([seedRecord()]);
    const body = rawJson(stateUpdatedPayload({ newState: "stopped" }));
    const header = signed(body);

    const first = await handleDaytonaWebhookRequest({
      rawBody: body,
      signatureHeader: header,
      secret: TEST_SECRET,
      store,
    });
    expect(first.body.outcome).toBe("applied");

    const second = await handleDaytonaWebhookRequest({
      rawBody: body,
      signatureHeader: header,
      secret: TEST_SECRET,
      store,
    });
    // Binding cleared on first stop → second is unknown_sandbox (still 200).
    expect(second.status).toBe(200);
    expect(second.body.applied).toBe(false);
    expect(second.body.outcome).toBe("unknown_sandbox");
    expect((await store.get(INSTANCE_ID))?.presence).toBe("offline");
  });

  it("idempotent started while already online is ignored 200", async () => {
    const store = createInMemoryOrchestratorInstanceStore([
      seedRecord({ presence: "online" }),
    ]);
    const body = rawJson(
      stateUpdatedPayload({ oldState: "starting", newState: "started" }),
    );
    const result = await handleDaytonaWebhookRequest({
      rawBody: body,
      signatureHeader: signed(body),
      secret: TEST_SECRET,
      store,
    });
    expect(result.status).toBe(200);
    expect(result.body.outcome).toBe("ignored");
    expect(result.body.applied).toBe(false);
    expect((await store.get(INSTANCE_ID))?.presence).toBe("online");
  });

  it("ACKs unsupported verified events as 200 unsupported_event", async () => {
    const store = createInMemoryOrchestratorInstanceStore([seedRecord()]);
    const body = rawJson({
      event: "sandbox.created",
      timestamp: TS,
      id: SANDBOX_ID,
      organizationId: ORG_ID,
      state: "started",
      sandboxClass: "container",
      createdAt: TS,
    });
    const result = await handleDaytonaWebhookRequest({
      rawBody: body,
      signatureHeader: signed(body),
      secret: TEST_SECRET,
      store,
    });
    expect(result.status).toBe(200);
    expect(result.body.outcome).toBe("unsupported_event");
    expect(result.body.applied).toBe(false);
    expect((await store.get(INSTANCE_ID))?.presence).toBe("online");
  });

  it("returns 400 for invalid sandbox.state.updated shape", async () => {
    const store = createInMemoryOrchestratorInstanceStore([seedRecord()]);
    const body = rawJson({
      event: "sandbox.state.updated",
      timestamp: TS,
      // missing id / states
      organizationId: ORG_ID,
    });
    const result = await handleDaytonaWebhookRequest({
      rawBody: body,
      signatureHeader: signed(body),
      secret: TEST_SECRET,
      store,
    });
    expect(result.status).toBe(400);
    expect(result.body.outcome).toBe("parse_error");
  });
});

describe("POST /webhooks/daytona Hono route (lp-04r)", () => {
  function createWebhookApp(
    instances: ReturnType<typeof createInMemoryOrchestratorInstanceStore>,
    secret = TEST_SECRET,
  ) {
    // Minimal store stub — webhook uses injected orchestratorInstances.
    const store = {} as unknown as ControlPlaneStore;
    return createApp(store, {
      devOpen: true,
      daytonaWebhookSecret: secret,
      orchestratorInstances: instances,
    });
  }

  it("exposes path as public-unauthenticated (HMAC is the gate)", () => {
    expect(DAYTONA_WEBHOOK_PATH).toBe("/webhooks/daytona");
    expect(isPublicUnauthenticatedPath("POST", DAYTONA_WEBHOOK_PATH)).toBe(
      true,
    );
    expect(isPublicUnauthenticatedPath("GET", DAYTONA_WEBHOOK_PATH)).toBe(
      false,
    );
  });

  it("HTTP: valid HMAC + stopped updates presence", async () => {
    const instances = createInMemoryOrchestratorInstanceStore([seedRecord()]);
    const app = createWebhookApp(instances);
    const body = rawJson(stateUpdatedPayload({ newState: "stopped" }));

    const res = await app.request(DAYTONA_WEBHOOK_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [DAYTONA_WEBHOOK_SIGNATURE_HEADER]: signed(body),
      },
      body,
    });
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(200);
    expect(json.outcome).toBe("applied");
    expect(json.presence).toBe("offline");
    expect(json.sandbox_id).toBeNull();
    expect((await instances.get(INSTANCE_ID))?.presence).toBe("offline");
  });

  it("HTTP: bad HMAC → 401, no presence change", async () => {
    const instances = createInMemoryOrchestratorInstanceStore([seedRecord()]);
    const app = createWebhookApp(instances);
    const body = rawJson(stateUpdatedPayload({ newState: "stopped" }));

    const res = await app.request(DAYTONA_WEBHOOK_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [DAYTONA_WEBHOOK_SIGNATURE_HEADER]: signed(body, "bad"),
      },
      body,
    });
    const json = (await res.json()) as Record<string, unknown>;

    expect(res.status).toBe(401);
    expect(json.outcome).toBe("signature_invalid");
    expect((await instances.get(INSTANCE_ID))?.presence).toBe("online");
  });

  it("HTTP: missing signature header → 401", async () => {
    const instances = createInMemoryOrchestratorInstanceStore([seedRecord()]);
    const app = createWebhookApp(instances);
    const body = rawJson(stateUpdatedPayload({ newState: "error" }));

    const res = await app.request(DAYTONA_WEBHOOK_PATH, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
    expect(res.status).toBe(401);
  });

  it("HTTP: replay of same body is safe (second 200)", async () => {
    const instances = createInMemoryOrchestratorInstanceStore([
      seedRecord({ presence: "waking" }),
    ]);
    const app = createWebhookApp(instances);
    const body = rawJson(
      stateUpdatedPayload({ oldState: "starting", newState: "started" }),
    );
    const headers = {
      "content-type": "application/json",
      [DAYTONA_WEBHOOK_SIGNATURE_HEADER]: signed(body),
    };

    const first = await app.request(DAYTONA_WEBHOOK_PATH, {
      method: "POST",
      headers,
      body,
    });
    const second = await app.request(DAYTONA_WEBHOOK_PATH, {
      method: "POST",
      headers,
      body,
    });

    expect(first.status).toBe(200);
    expect((await first.json() as { outcome: string }).outcome).toBe(
      "applied",
    );
    expect(second.status).toBe(200);
    expect((await second.json() as { outcome: string }).outcome).toBe(
      "ignored",
    );
    expect((await instances.get(INSTANCE_ID))?.presence).toBe("online");
  });

  it("HTTP: secret not configured → 503", async () => {
    const instances = createInMemoryOrchestratorInstanceStore([seedRecord()]);
    const app = createWebhookApp(instances, "");
    const body = rawJson(stateUpdatedPayload({ newState: "stopped" }));

    const res = await app.request(DAYTONA_WEBHOOK_PATH, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        [DAYTONA_WEBHOOK_SIGNATURE_HEADER]: signed(body),
      },
      body,
    });
    expect(res.status).toBe(503);
    expect((await res.json() as { outcome: string }).outcome).toBe(
      "not_configured",
    );
  });
});
