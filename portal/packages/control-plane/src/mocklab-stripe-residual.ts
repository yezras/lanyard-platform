/**
 * Mock Lab Stripe residual prove runner (lp-hdzm.31).
 *
 * Superadmin paste → CP Class C row → harness GET /v1/customers 2xx.
 * Guest fs stays empty across a sandbox wipe (re-wake, no re-prompt).
 * Member omit fail-closes. Never writes the token into evidence.
 */
import { REDACTED } from "@lanyard/shared";

import {
  CLASS_C_AUTHORIZATION_HEADER,
  assertClassCNotInProviderWakeEnv,
  assertClassCNotOnGuestFs,
  buildClassCHttpAttach,
  classCTokenFromAttach,
  type ClassCFetch,
  type ClassCHttpAttach,
  type ClassCHttpRequest,
} from "./class-c-attach.js";
import { createInMemoryGuestConnectorStore } from "./connector-user-sandbox.js";
import { fingerprintSecretValue } from "./daytona-env-redact.js";
import {
  HarnessToolForbiddenError,
  dispatchHarnessOpenApiTool,
  filterHarnessExposedTools,
  listHarnessExposedTools,
  type HarnessToolCaller,
} from "./harness-tool-dispatch.js";
import { fromSpec } from "./openapi-adapter.js";
import type { ControlPlaneStore } from "./store.js";
import {
  MOCK_LAB_STRIPE_CONNECTOR_ID,
  MOCK_LAB_STRIPE_OPENAPI_SIX_TUPLE,
  MOCK_LAB_TENANT_SLUG,
  assertOneRemoteSurface,
  mockLabStripeConnectorId,
  mockLabStripeOpenApiSnapshot,
  parseMockLabStripeSixTuple,
  publicSixTuple,
  surfaceIdForTuple,
  type MockLabStripeSixTuple,
} from "./mocklab-stripe-six-tuple.js";

export const MOCK_LAB_STRIPE_RESIDUAL_BEAD = "lp-hdzm.31" as const;

const OMITTED_TOOL = "GetAccount";

export type MockLabStripeResidualChecks = {
  six_tuple: boolean;
  one_surface: boolean;
  cp_row: boolean;
  tool_2xx: boolean;
  no_token_on_sandbox: boolean;
  rewake_no_prompt: boolean;
  member_omit_fail_closed: boolean;
};

export type MockLabStripeResidualEvidence = {
  bead_id: typeof MOCK_LAB_STRIPE_RESIDUAL_BEAD;
  tuple: ReturnType<typeof publicSixTuple>;
  checks: MockLabStripeResidualChecks;
  http_status: number | null;
  rewake_http_status: number | null;
  member_omit_status: number | null;
  guest_files_wake: string[];
  guest_files_rewake: string[];
  cp_fingerprint: string | null;
  fetch_mode: "stub" | "live";
  authorization_logged: string | null;
  token_leaked: boolean;
};

export type MockLabStripeResidualInput = {
  store: ControlPlaneStore;
  token: string;
  tuple?: MockLabStripeSixTuple;
  fetch?: ClassCFetch;
  fetchMode?: "stub" | "live";
};

function allChecks(checks: MockLabStripeResidualChecks): boolean {
  return Object.values(checks).every(Boolean);
}

function stubStripeFetch(): ClassCFetch {
  return async (req) => {
    if (!req.headers?.[CLASS_C_AUTHORIZATION_HEADER]) {
      return { status: 401, headers: {}, body: '{"error":"missing_auth"}' };
    }
    if (req.url.includes("/v1/customers")) {
      return { status: 200, headers: {}, body: '{"object":"list","data":[]}' };
    }
    if (req.url.includes("/v1/account")) {
      return { status: 200, headers: {}, body: '{"id":"acct_stub"}' };
    }
    return { status: 404, headers: {}, body: "{}" };
  };
}

function recordingFetch(inner: ClassCFetch): {
  fetch: ClassCFetch;
  seen: ClassCHttpRequest[];
} {
  const seen: ClassCHttpRequest[] = [];
  return {
    seen,
    fetch: async (req) => {
      seen.push(req);
      return inner(req);
    },
  };
}

function evidenceLeakedToken(
  evidence: MockLabStripeResidualEvidence,
  token: string,
): boolean {
  if (!token) {
    return false;
  }
  return JSON.stringify(evidence).includes(token);
}

function memberCaller(allowlist: readonly string[]): HarnessToolCaller {
  return {
    onboarded: true,
    granted: true,
    role: "member",
    subsetKind: "allowlist",
    allowlist,
  };
}

export async function proveMockLabStripeResidual(
  input: MockLabStripeResidualInput,
): Promise<MockLabStripeResidualEvidence> {
  const tuple = parseMockLabStripeSixTuple(
    input.tuple ?? MOCK_LAB_STRIPE_OPENAPI_SIX_TUPLE,
  );
  if (tuple.surface.kind !== "openapi") {
    throw new Error("this residual proves the OpenAPI GET /v1/customers arm");
  }
  const connectorId = mockLabStripeConnectorId();
  const snapshot = mockLabStripeOpenApiSnapshot();
  const remote = assertOneRemoteSurface(snapshot);
  const from = fromSpec(remote.spec ?? {});
  if (from.kind !== "exposed") {
    throw new Error("stripe openapi spec refused");
  }
  const list = from.tools.find((tool) => tool.name === tuple.surface.tool.name);
  const omitted = from.tools.find((tool) => tool.name === OMITTED_TOOL);
  if (!list || !omitted) {
    throw new Error("expected GetCustomers and GetAccount on the proof spec");
  }

  const tenant = await input.store.createTenant({
    slug: MOCK_LAB_TENANT_SLUG,
    display_name: "Mock Lab",
    actor: "ops@example.com",
  });
  await input.store.insertCanonicalConnector({
    id: MOCK_LAB_STRIPE_CONNECTOR_ID,
    domain: tuple.domain,
    label: "Stripe",
    source: "integrations.sh",
    source_entry_id: "integrations.sh:stripe.com",
    snapshot,
    actor: "ops@example.com",
  });
  await input.store.upsertTenantConnectorEntitlement({
    tenant_id: tenant.tenant_id,
    connector_id: connectorId,
    enabled: true,
    surfaces: [surfaceIdForTuple(tuple)],
    actor: "ops@example.com",
  });
  const admin = await input.store.provisionOpsTenantUser({
    tenant_id: tenant.tenant_id,
    display_name: "Ada Admin",
    email: "ada@mocklab.test",
    role: "tenant_admin",
  });
  const member = await input.store.provisionOpsTenantUser({
    tenant_id: tenant.tenant_id,
    display_name: "Pat Member",
    email: "pat@mocklab.test",
    role: "member",
  });
  await input.store.setPersonConnectorGrant({
    tenant_id: tenant.tenant_id,
    user_id: admin.user_id,
    connector_id: MOCK_LAB_STRIPE_CONNECTOR_ID,
    granted: true,
    actor: "ops@example.com",
  });
  await input.store.setPersonConnectorGrant({
    tenant_id: tenant.tenant_id,
    user_id: member.user_id,
    connector_id: MOCK_LAB_STRIPE_CONNECTOR_ID,
    granted: true,
    actor: "ops@example.com",
  });
  await input.store.setConnectorMemberSubset({
    tenant_id: tenant.tenant_id,
    connector_id: MOCK_LAB_STRIPE_CONNECTOR_ID,
    allowed_tools: [tuple.surface.tool.name],
    actor: "ops@example.com",
  });

  const paste = await input.store.upsertClassCSecret({
    tenant_id: tenant.tenant_id,
    connector_id: connectorId,
    surface_id: surfaceIdForTuple(tuple),
    payload: { auth_kind: tuple.auth_kind, value: input.token },
    actor: "ops@example.com",
  });

  const inner = input.fetch ?? stubStripeFetch();
  const recorder = recordingFetch(inner);
  const guestWake = createInMemoryGuestConnectorStore();
  const sandboxWake = "sbx-mocklab-stripe-wake";
  const payload = await input.store.getClassCSecretPayload(
    tenant.tenant_id,
    connectorId,
    surfaceIdForTuple(tuple),
  );
  const attach: ClassCHttpAttach = buildClassCHttpAttach({
    tenant_id: tenant.tenant_id,
    connector_id: connectorId,
    surface_id: surfaceIdForTuple(tuple),
    payload,
  });
  assertClassCNotInProviderWakeEnv(attach, {
    STRIPE_SECRET_KEY: input.token,
    OPENAI_API_KEY: "sk-openai-not-class-c",
  });

  const allowed = await dispatchHarnessOpenApiTool({
    caller: memberCaller([tuple.surface.tool.name]),
    connector_id: MOCK_LAB_STRIPE_CONNECTOR_ID,
    tool: list,
    args: { limit: 1 },
    attach,
    fetch: recorder.fetch,
    baseUrl: from.base_url ?? "https://api.stripe.com",
    guest: guestWake,
    sandbox_id: sandboxWake,
  });
  assertClassCNotOnGuestFs(guestWake, sandboxWake, attach);

  await guestWake.wipe(sandboxWake);
  const guestRewake = createInMemoryGuestConnectorStore();
  const sandboxRewake = "sbx-mocklab-stripe-rewake";
  const payloadAgain = await input.store.getClassCSecretPayload(
    tenant.tenant_id,
    connectorId,
    surfaceIdForTuple(tuple),
  );
  const attachAgain = buildClassCHttpAttach({
    tenant_id: tenant.tenant_id,
    connector_id: connectorId,
    surface_id: surfaceIdForTuple(tuple),
    payload: payloadAgain,
  });
  const rewake = await dispatchHarnessOpenApiTool({
    caller: memberCaller([tuple.surface.tool.name]),
    connector_id: MOCK_LAB_STRIPE_CONNECTOR_ID,
    tool: list,
    args: { limit: 1 },
    attach: attachAgain,
    fetch: recorder.fetch,
    baseUrl: from.base_url ?? "https://api.stripe.com",
    guest: guestRewake,
    sandbox_id: sandboxRewake,
  });
  assertClassCNotOnGuestFs(guestRewake, sandboxRewake, attachAgain);

  const exposed = listHarnessExposedTools({
    connector_id: MOCK_LAB_STRIPE_CONNECTOR_ID,
    snapshot,
  });
  const tree = filterHarnessExposedTools(
    memberCaller([tuple.surface.tool.name]),
    exposed,
  );
  const beforeOmit = recorder.seen.length;
  let memberOmitStatus: number | null = null;
  try {
    await dispatchHarnessOpenApiTool({
      caller: memberCaller([tuple.surface.tool.name]),
      connector_id: MOCK_LAB_STRIPE_CONNECTOR_ID,
      tool: omitted,
      args: {},
      attach,
      fetch: recorder.fetch,
      baseUrl: from.base_url ?? "https://api.stripe.com",
    });
  } catch (error) {
    if (error instanceof HarnessToolForbiddenError) {
      memberOmitStatus = error.http_status;
    } else {
      throw error;
    }
  }

  const evidence: MockLabStripeResidualEvidence = {
    bead_id: MOCK_LAB_STRIPE_RESIDUAL_BEAD,
    tuple: publicSixTuple(tuple),
    checks: {
      six_tuple: tuple.domain === "stripe.com" && tuple.principal === "tenant",
      one_surface: remote.kind === "openapi" && snapshot.surfaces.length === 1,
      cp_row:
        paste.present &&
        paste.fingerprint === fingerprintSecretValue(input.token) &&
        paste.surface_id === "api",
      tool_2xx: allowed.call.response.status === 200,
      no_token_on_sandbox:
        guestWake.listFiles(sandboxWake).length === 0 &&
        Object.keys(guestWake.printenv(sandboxWake)).length === 0 &&
        guestRewake.listFiles(sandboxRewake).length === 0,
      rewake_no_prompt:
        classCTokenFromAttach(attachAgain) === classCTokenFromAttach(attach) &&
        rewake.call.response.status === 200,
      member_omit_fail_closed:
        memberOmitStatus === 403 &&
        recorder.seen.length === beforeOmit &&
        tree.map((tool) => tool.name).join(",") === tuple.surface.tool.name,
    },
    http_status: allowed.call.response.status,
    rewake_http_status: rewake.call.response.status,
    member_omit_status: memberOmitStatus,
    guest_files_wake: guestWake.listFiles(sandboxWake),
    guest_files_rewake: guestRewake.listFiles(sandboxRewake),
    cp_fingerprint: paste.fingerprint,
    fetch_mode: input.fetchMode ?? "stub",
    authorization_logged:
      allowed.call.logged.headers?.[CLASS_C_AUTHORIZATION_HEADER] ?? null,
    token_leaked: false,
  };
  evidence.token_leaked = evidenceLeakedToken(evidence, input.token);
  if (evidence.token_leaked) {
    throw new Error("Stripe residual evidence leaked the Class C token");
  }
  if (evidence.authorization_logged !== REDACTED) {
    throw new Error("Authorization must be redacted in logged headers");
  }
  if (!allChecks(evidence.checks)) {
    throw new Error(
      `Stripe residual checks failed: ${JSON.stringify(evidence.checks)}`,
    );
  }
  return evidence;
}

export function stripeResidualPassed(
  evidence: MockLabStripeResidualEvidence,
): boolean {
  return allChecks(evidence.checks) && evidence.token_leaked === false;
}
