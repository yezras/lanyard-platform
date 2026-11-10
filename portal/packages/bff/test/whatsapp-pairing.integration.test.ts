import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createApp as createControlPlaneApp } from "../../control-plane/src/app.js";
import { ControlPlaneStore } from "../../control-plane/src/store.js";
import { createTestStore } from "../../control-plane/test/pg-test-store.js";
import { createApp } from "../src/app.js";
import { CONNECTOR_SPA_FORBIDDEN_KEYS } from "../src/connectors.js";
import { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { createThreadLiveEventsHub } from "../src/thread-live-events.js";
import type { TenantContext } from "../src/types.js";
import { createFixtureWhatsAppPairingHost } from "../src/whatsapp-pairing.js";
import {
  cookieHeader,
  createTestBindings,
  parseSetCookie,
} from "./test-helpers.js";

type JsonBody = Record<string, unknown>;

const QR = "2@LIVE-QR-PAYLOAD-FROM-EVENTS";
const SESSION = Buffer.from("cp-session-db").toString("base64");

async function jsonRequest(
  app: ReturnType<typeof createApp>,
  path: string,
  init: RequestInit & {
    host?: string;
    cookies?: Record<string, string>;
    csrf?: boolean;
  } = {},
): Promise<{
  status: number;
  body: JsonBody;
  raw: string;
  cookies: Record<string, string>;
}> {
  const headers = new Headers(init.headers);
  if (init.host) headers.set("host", init.host);
  if (init.cookies && Object.keys(init.cookies).length > 0) {
    headers.set("cookie", cookieHeader(init.cookies));
  }
  if (init.csrf && init.cookies?.lanyard_csrf) {
    headers.set("x-csrf-token", init.cookies.lanyard_csrf);
  }
  const response = await app.request(path, { ...init, headers });
  const raw = await response.text();
  return {
    status: response.status,
    body: JSON.parse(raw) as JsonBody,
    raw,
    cookies: {
      ...init.cookies,
      ...parseSetCookie(response.headers.get("set-cookie")),
    },
  };
}

describe("BFF WhatsApp pair (lp-xhf4.11)", () => {
  let store: ControlPlaneStore;
  let bffApp: ReturnType<typeof createApp>;
  let tenantDemo: TenantContext;
  let memberCookies: Record<string, string> = {};
  let memberUserId = "";
  let live = createThreadLiveEventsHub();
  const published: unknown[] = [];

  beforeEach(async () => {
    published.length = 0;
    live = createThreadLiveEventsHub();
    store = await createTestStore();
    const controlPlaneApp = createControlPlaneApp(store, { devOpen: true });
    const createdDemo = await store.createTenant({
      slug: "demo",
      display_name: "Demo",
    });
    tenantDemo = {
      tenant_id: createdDemo.tenant_id,
      tenant_slug: createdDemo.tenant_slug,
      display_name: createdDemo.display_name,
      host: createdDemo.host,
    };
    const authClient = new ControlPlaneAuthClient(
      "http://control-plane.test",
      (input, init) => {
        const url = new URL(input);
        return controlPlaneApp.request(url.pathname + url.search, init);
      },
    );
    live.subscribe("th-wa", (event) => {
      published.push(event);
    });
    bffApp = createApp(
      createTestBindings(
        { demo: tenantDemo },
        {
          authClient,
          threadLiveEvents: live,
          whatsappPairingHost: createFixtureWhatsAppPairingHost({
            stderr_lines: [
              JSON.stringify({
                event: "qr_code",
                data: { code: QR },
                ts: 11,
              }),
            ],
            session_db_base64: SESSION,
          }),
          whatsappPairingSandboxId: "sbx-alice",
        },
      ),
    );
    const memberRole = await store.createRole({
      tenant_id: tenantDemo.tenant_id,
      name: "member",
      hermes_profile: "contributor",
      path_prefixes: ["/"],
    });
    const csrf = await jsonRequest(bffApp, "/api/auth/csrf", {
      host: tenantDemo.host,
    });
    const reg = await jsonRequest(bffApp, "/api/auth/register", {
      method: "POST",
      host: tenantDemo.host,
      cookies: csrf.cookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "alice@demo.test",
        password: "password123",
      }),
    });
    memberUserId = reg.body.user_id as string;
    memberCookies = reg.cookies;
    await store.setUserRoles({
      tenant_id: tenantDemo.tenant_id,
      user_id: memberUserId,
      role_ids: [memberRole.role_id],
    });
    await store.upsertTenantConnectorEntitlement({
      tenant_id: tenantDemo.tenant_id,
      connector_id: "whatsapp",
      enabled: true,
    });
    await store.upsertRoleConnectorGrant({
      tenant_id: tenantDemo.tenant_id,
      role_id: memberRole.role_id,
      connector_id: "whatsapp",
      enabled: true,
    });
  });

  afterEach(async () => {
    await store.close();
  });

  it("pairs via wacli events, stores session.db, and never leaks QR or wacli.db", async () => {
    const paired = await jsonRequest(bffApp, "/api/connectors/whatsapp/pair", {
      method: "POST",
      host: tenantDemo.host,
      cookies: memberCookies,
      csrf: true,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ thread_id: "th-wa" }),
    });
    expect(paired.status).toBe(200);
    expect(paired.body.status).toBe("connected");
    expect(paired.body.account_label).toBe("+15551212");
    expect(paired.raw).not.toContain(QR);
    expect(paired.raw).not.toContain(SESSION);
    expect(paired.raw).not.toContain("wacli.db");
    for (const key of CONNECTOR_SPA_FORBIDDEN_KEYS) {
      expect(paired.body).not.toHaveProperty(key);
    }

    const secrets = await store.getUserConnectorSecrets(
      tenantDemo.tenant_id,
      memberUserId,
      "whatsapp",
    );
    expect(secrets.whatsapp_session_db).toBe(SESSION);
    expect(JSON.stringify(secrets)).not.toContain("wacli.db");

    const liveEvent = published.find(
      (row) =>
        row &&
        typeof row === "object" &&
        (row as { type?: string }).type === "connector.qr",
    ) as { code?: string; content?: string; metadata?: { code?: string } };
    expect(liveEvent?.code).toBe(QR);
    expect(liveEvent?.content).not.toContain(QR);
  });
});
