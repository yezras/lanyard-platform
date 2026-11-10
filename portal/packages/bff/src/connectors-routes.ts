import type { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import {
  InvalidConnectorEnumError,
  buildNeedsAuthWizard,
  connectorIdForArgv,
  decideConnectorChatUse,
  spaPendingConnectorUse,
} from "@lanyard/connectors";

import {
  CONNECTOR_IDS,
  assertConnectorSpaJson,
  connectorOAuthStartState,
  connectorOAuthStartUrl,
  hubspotPinFromEntitlements,
  isConnectorId,
  isOauthConnectorId,
  parseConnectorId,
  requireConnectorAdmin,
  requireConnectorTenantUser,
  teamGrantMatrix,
  toSpaConnectorStatus,
  toSpaTeamMemberConnector,
  type SpaTeamMember,
} from "./connectors.js";
import {
  IllegalApprovalDecisionError,
  IllegalStickyError,
  PendingConnectorUseStore,
  allowResult,
  decidePendingCommand,
  decideResult,
  evaluatePendingCommand,
  patchStickyMap,
  promptResult,
  stickyFromConnection,
} from "./connector-approval.js";
import {
  consumePendingConnectorUse,
  MemoryPendingConnectorUseStore,
} from "./pending-connector-use.js";
import {
  ControlPlaneRequestError,
  type ConnectorId,
} from "./control-plane-client.js";
import {
  connectorOAuthCallbackHtml,
  connectorOAuthCallbackJson,
  connectorOAuthCallbackRedirectPath,
  createPkcePair,
  parseConnectorOAuthState,
} from "./connector-oauth.js";
import { buildGoogleConnectorAuthorizeUrl } from "./google-connector-oauth.js";
import { buildHubSpotConnectorAuthorizeUrl } from "./hubspot-connector-oauth.js";
import { csrfProtection } from "./middleware/csrf.js";
import { resolveOAuthRedirectOrigin } from "./oauth-redirect.js";
import {
  readOpsSessionId,
  readSessionId,
  resolveSessionUser,
  signOAuthState,
  verifyOAuthState,
} from "./session.js";
import type { BffBindings, BffVariables } from "./types.js";
import { WhatsAppExportError } from "@lanyard/connectors";
import { runWhatsAppPairing } from "./whatsapp-pairing.js";

const DEFAULT_WACLI_STORE_DIR = "/var/lib/company-brain-backend/wacli";

/**
 * Best-effort lazy inject for first-use (lp-xhf4.21).
 * User sandbox only; tenant box never receives connector secrets.
 * Never fails the chat/approval wizard even if sandbox is not online yet.
 */
async function tryInjectUserConnector(
  bindings: BffBindings,
  tenantId: string,
  userId: string,
  connectorId: ConnectorId,
): Promise<void> {
  try {
    await bindings.authClient.injectUserConnector({
      tenantId,
      userId,
      connectorId,
    });
  } catch {
    // Best-effort: scheduled-task path already proves inject works.
    // Chat still returns ready; next use retries after wake.
  }
}

const putGrantSchema = z.object({
  role_id: z.string().min(1).max(128),
  connector_id: z.custom<ConnectorId>(isConnectorId, {
    message: "Unknown connector",
  }),
  enabled: z.boolean(),
});

/** Tenant admin may clear the HubSpot pin only; next connect re-pins. */
const clearHubSpotPinSchema = z.object({
  hubspot_portal_id: z.null(),
});

const oauthStartSchema = z
  .object({
    thread_id: z.string().min(1).max(128).optional(),
  })
  .optional();

const evaluateApprovalSchema = z.object({
  argv: z.array(z.string().max(4096)).max(64),
  thread_id: z.string().min(1).max(128).optional(),
  tool_name: z.string().max(128).optional(),
  tool_call_id: z.string().max(128).optional(),
});

const decideApprovalSchema = z.object({
  decision: z.enum(["always", "approve_this_call", "reject"]),
});

const patchStickySchema = z.object({
  action_class: z.string().min(1).max(64),
  enabled: z.boolean(),
});

const chatUseSchema = z.object({
  thread_id: z.string().min(1).max(128),
  tool: z.string().min(1).max(128).optional(),
  args: z.array(z.string().max(8_192)).max(64),
});

function throwControlPlane(error: unknown): never {
  if (error instanceof ControlPlaneRequestError) {
    throw new HTTPException(error.status as ContentfulStatusCode, {
      message: error.message,
    });
  }
  throw error;
}

function throwApprovalError(error: unknown): never {
  if (
    error instanceof IllegalApprovalDecisionError ||
    error instanceof IllegalStickyError ||
    error instanceof InvalidConnectorEnumError
  ) {
    throw new HTTPException(400, { message: error.message });
  }
  throwControlPlane(error);
}

export function registerConnectorRoutes(
  api: Hono<{ Variables: BffVariables }>,
  bindings: BffBindings,
): void {
  const pendingUses =
    bindings.pendingConnectorUses ?? new PendingConnectorUseStore();
  const pendingStore =
    bindings.pendingConnectorUseStore ?? new MemoryPendingConnectorUseStore();

  api.get("/connectors", async (c) => {
    const tenant = c.get("tenant");
    const user = requireConnectorTenantUser(c);
    try {
      const granted = await bindings.authClient.listUserGrantedConnectors({
        tenantId: tenant.tenant_id,
        userId: user.user_id,
      });
      const body = { connectors: granted.map(toSpaConnectorStatus) };
      assertConnectorSpaJson(body);
      return c.json(body);
    } catch (error) {
      throwControlPlane(error);
    }
  });

  api.get("/connectors/team", async (c) => {
    const tenant = c.get("tenant");
    requireConnectorAdmin(c);
    try {
      const [members, rolesResult, entitlements] = await Promise.all([
        bindings.authClient.listTenantMembers(tenant.tenant_id),
        bindings.authClient.listRoles(tenant.tenant_id),
        bindings.authClient.listConnectorEntitlements(tenant.tenant_id),
      ]);
      const grantLists = await Promise.all(
        rolesResult.roles.map(async (role) => {
          const grants = await bindings.authClient.listRoleConnectorGrants(
            tenant.tenant_id,
            role.role_id,
          );
          return [role.role_id, grants] as const;
        }),
      );
      const teamMembers: SpaTeamMember[] = await Promise.all(
        members.map(async (member) => {
          const connections = await bindings.authClient.listUserConnectors(
            tenant.tenant_id,
            member.user_id,
          );
          const byId = new Map(
            connections.map((row) => [row.connector_id, row]),
          );
          return {
            user_id: member.user_id,
            email: member.email,
            connectors: CONNECTOR_IDS.map((connectorId) =>
              toSpaTeamMemberConnector(
                connectorId,
                byId.get(connectorId) ?? null,
              ),
            ),
          };
        }),
      );
      const body = {
        members: teamMembers,
        grants: teamGrantMatrix(rolesResult.roles, new Map(grantLists)),
        hubspot_portal_id: hubspotPinFromEntitlements(entitlements),
      };
      assertConnectorSpaJson(body);
      return c.json(body);
    } catch (error) {
      throwControlPlane(error);
    }
  });

  api.put("/connectors/grants", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    requireConnectorAdmin(c);
    const body = putGrantSchema.parse(await c.req.json());
    try {
      const grant = await bindings.authClient.upsertRoleConnectorGrant({
        tenantId: tenant.tenant_id,
        roleId: body.role_id,
        connectorId: body.connector_id,
        enabled: body.enabled,
      });
      const spa = {
        role_id: grant.role_id,
        connector_id: grant.connector_id,
        enabled: grant.enabled,
      };
      assertConnectorSpaJson(spa);
      return c.json(spa);
    } catch (error) {
      throwControlPlane(error);
    }
  });

  api.put("/connectors/hubspot/pin", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    requireConnectorAdmin(c);
    clearHubSpotPinSchema.parse(await c.req.json());
    try {
      const entitlements = await bindings.authClient.listConnectorEntitlements(
        tenant.tenant_id,
      );
      const hubspot = entitlements.find(
        (row) => row.connector_id === "hubspot",
      );
      if (hubspot) {
        await bindings.authClient.upsertConnectorEntitlement({
          tenantId: tenant.tenant_id,
          connectorId: "hubspot",
          enabled: hubspot.enabled,
          hubspotPortalId: null,
        });
      }
      const spa = { hubspot_portal_id: null };
      assertConnectorSpaJson(spa);
      return c.json(spa);
    } catch (error) {
      throwControlPlane(error);
    }
  });

  api.post(
    "/connectors/:connectorId/chat-use",
    csrfProtection,
    async (c) => {
      const tenant = c.get("tenant");
      const user = requireConnectorTenantUser(c);
      const connectorId = parseConnectorId(c.req.param("connectorId"));
      const body = chatUseSchema.parse(await c.req.json());
      const argv =
        body.tool && body.args[0] !== body.tool
          ? [body.tool, ...body.args]
          : body.args;
      try {
        const access = await bindings.authClient.getUserConnectorAccess({
          tenantId: tenant.tenant_id,
          userId: user.user_id,
          connectorId,
        });
        const decision = decideConnectorChatUse({
          tenant_id: tenant.tenant_id,
          user_id: user.user_id,
          thread_id: body.thread_id,
          connector_id: connectorId,
          argv,
          connection_status: access.connection?.status ?? "not_connected",
        });
        if (decision.kind === "ready") {
          // lp-xhf4.21: first-use lazy inject onto the user sandbox before the
          // agent runs gws/hs/wacli. Best-effort; tenant printenv stays clean.
          await tryInjectUserConnector(
            bindings,
            tenant.tenant_id,
            user.user_id,
            connectorId,
          );
          const payload = { kind: "ready" as const, connector_id: connectorId };
          assertConnectorSpaJson(payload);
          return c.json(payload);
        }
        await pendingStore.put(decision.pending);
        const payload = {
          kind: "needs_auth" as const,
          connector_id: connectorId,
          wizard: buildNeedsAuthWizard({
            connector_id: connectorId,
            thread_id: body.thread_id,
          }),
          pending: spaPendingConnectorUse(decision.pending),
        };
        assertConnectorSpaJson(payload);
        return c.json(payload);
      } catch (error) {
        throwControlPlane(error);
      }
    },
  );

  api.post(
    "/connectors/:connectorId/pending/resume",
    csrfProtection,
    async (c) => {
      const tenant = c.get("tenant");
      const user = requireConnectorTenantUser(c);
      const connectorId = parseConnectorId(c.req.param("connectorId"));
      const decision = await consumePendingConnectorUse({
        store: pendingStore,
        tenantId: tenant.tenant_id,
        userId: user.user_id,
        connectorId,
        source: "chat",
      });
      if (decision.kind === "resume") {
        await tryInjectUserConnector(
          bindings,
          tenant.tenant_id,
          user.user_id,
          connectorId,
        );
      }
      assertConnectorSpaJson(decision);
      return c.json(decision);
    },
  );

  api.post(
    "/connectors/:connectorId/pending/cancel",
    csrfProtection,
    async (c) => {
      const tenant = c.get("tenant");
      const user = requireConnectorTenantUser(c);
      const connectorId = parseConnectorId(c.req.param("connectorId"));
      const decision = await consumePendingConnectorUse({
        store: pendingStore,
        tenantId: tenant.tenant_id,
        userId: user.user_id,
        connectorId,
        cancelled: true,
        source: "chat",
      });
      assertConnectorSpaJson(decision);
      return c.json(decision);
    },
  );

  api.post(
    "/connectors/:connectorId/oauth/start",
    csrfProtection,
    async (c) => {
      const tenant = c.get("tenant");
      const user = requireConnectorTenantUser(c);
      const connectorId = parseConnectorId(c.req.param("connectorId"));
      if (!isOauthConnectorId(connectorId)) {
        throw new HTTPException(400, {
          message: "Connector does not use OAuth",
        });
      }
      const rawBody = await c.req.json().catch(() => ({}));
      const body = oauthStartSchema.parse(rawBody);

      if (connectorId === "google" || connectorId === "hubspot") {
        const clientId =
          connectorId === "google"
            ? bindings.config.googleClientId
            : bindings.config.hubspotClientId;
        if (!clientId) {
          throw new HTTPException(503, {
            message:
              connectorId === "google"
                ? "Google connector OAuth is not configured (GOOGLE_CLIENT_ID)"
                : "HubSpot connector OAuth is not configured (HUBSPOT_CLIENT_ID)",
          });
        }
        const originResult = resolveOAuthRedirectOrigin({
          hostHeader: c.req.header("host"),
          tenantHost: tenant.host,
          tenantSlug: tenant.tenant_slug,
          appHosts: bindings.appHosts ?? [],
          secureCookies: bindings.config.secureCookies,
        });
        if (!originResult.ok) {
          throw new HTTPException(400, {
            message: "OAuth redirect host is not allowlisted",
          });
        }
        const redirectUri = `${originResult.origin}${connectorOAuthCallbackRedirectPath(connectorId)}`;
        const pkce = createPkcePair();
        const state = signOAuthState(
          connectorOAuthStartState({
            connectorId,
            tenantId: tenant.tenant_id,
            userId: user.user_id,
            threadId: body?.thread_id,
            redirectUri,
            codeVerifier: pkce.verifier,
          }),
          bindings.config.sessionSecret,
        );
        const url =
          connectorId === "google"
            ? buildGoogleConnectorAuthorizeUrl({
                clientId,
                redirectUri,
                state,
                codeChallenge: pkce.challenge,
              })
            : buildHubSpotConnectorAuthorizeUrl({
                clientId,
                redirectUri,
                state,
                codeChallenge: pkce.challenge,
              });
        const payload = {
          connector_id: connectorId,
          url,
        };
        assertConnectorSpaJson(payload);
        return c.json(payload);
      }

      const state = signOAuthState(
        connectorOAuthStartState({
          connectorId,
          tenantId: tenant.tenant_id,
          userId: user.user_id,
          threadId: body?.thread_id,
        }),
        bindings.config.sessionSecret,
      );
      const payload = {
        connector_id: connectorId,
        url: connectorOAuthStartUrl(connectorId, state),
      };
      assertConnectorSpaJson(payload);
      return c.json(payload);
    },
  );

  api.get("/connectors/:connectorId/oauth/callback", async (c) => {
    let tenant = c.get("tenant");
    const connectorId = parseConnectorId(c.req.param("connectorId"));
    if (!isOauthConnectorId(connectorId)) {
      throw new HTTPException(400, {
        message: "OAuth callback is only implemented for google and hubspot",
      });
    }
    if (readOpsSessionId(c)) {
      throw new HTTPException(401, { message: "Not authenticated" });
    }

    const providerError = c.req.query("error");
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!state) {
      throw new HTTPException(400, { message: "Missing OAuth state" });
    }
    const parsedState = parseConnectorOAuthState(
      verifyOAuthState(state, bindings.config.sessionSecret),
      connectorId,
    );

    let user: ReturnType<typeof requireConnectorTenantUser>;
    const isDeferred = Boolean(c.get("connectorOAuthTenantDeferred"));
    if (isDeferred) {
      if (!parsedState) {
        throw new HTTPException(401, { message: "Invalid OAuth state" });
      }
      const resolved = await bindings.tenantResolver.resolveById(
        parsedState.tenant_id,
      );
      if (!resolved) {
        throw new HTTPException(404, { message: "Unknown tenant" });
      }
      c.set("tenant", resolved);
      tenant = resolved;
      const sessionId = readSessionId(c);
      const resolvedUser = await resolveSessionUser(
        bindings.sessions,
        sessionId,
        tenant.tenant_id,
      );
      if (!resolvedUser) {
        throw new HTTPException(401, { message: "Not authenticated" });
      }
      if (parsedState.user_id !== resolvedUser.user_id) {
        throw new HTTPException(401, { message: "Invalid OAuth state" });
      }
      c.set("user", resolvedUser);
      c.set("rbac", null);
      user = resolvedUser;
    } else {
      user = requireConnectorTenantUser(c);
      if (!parsedState || parsedState.tenant_id !== tenant.tenant_id) {
        throw new HTTPException(401, { message: "Invalid OAuth state" });
      }
      if (parsedState.user_id !== user.user_id) {
        throw new HTTPException(401, { message: "Invalid OAuth state" });
      }
    }

    const accept = c.req.header("accept") ?? "";
    const prefersJson =
      /\bapplication\/json\b/i.test(accept) && !/\btext\/html\b/i.test(accept);
    const respond = (view: Parameters<typeof connectorOAuthCallbackJson>[0]) => {
      const json = connectorOAuthCallbackJson(view);
      assertConnectorSpaJson(json);
      if (prefersJson) {
        return c.json(json, view.status === "error" ? 400 : 200);
      }
      return c.html(connectorOAuthCallbackHtml(view));
    };

    if (providerError) {
      return respond({
        connector_id: connectorId,
        status: "error",
        account_label: null,
        error: providerError,
      });
    }
    if (!code) {
      throw new HTTPException(400, {
        message:
          connectorId === "google"
            ? "Missing Google OAuth code"
            : "Missing HubSpot OAuth code",
      });
    }

    try {
      const connection = await bindings.authClient.completeConnectorOAuth({
        tenantId: tenant.tenant_id,
        userId: user.user_id,
        connectorId,
        code: code!,
        redirectUri: parsedState!.redirect_uri,
        codeVerifier: parsedState!.code_verifier,
      });
      const json = {
        connector_id: connectorId,
        status: connection.status,
        account_label: connection.account_label,
      };
      assertConnectorSpaJson(json);
      if (prefersJson) {
        return c.json(json);
      }
      return c.html(
        connectorOAuthCallbackHtml({
          connector_id: connectorId,
          status: "connected",
          account_label: connection.account_label,
        }),
      );
    } catch (error) {
      throwControlPlane(error);
    }
  });

  api.post(
    "/connectors/approval/evaluate",
    csrfProtection,
    async (c) => {
      const tenant = c.get("tenant");
      const user = requireConnectorTenantUser(c);
      const body = evaluateApprovalSchema.parse(await c.req.json());
      try {
        const connectorId = connectorIdForArgv(body.argv);
        let sticky = {};
        if (connectorId) {
          const access = await bindings.authClient.getUserConnectorAccess({
            tenantId: tenant.tenant_id,
            userId: user.user_id,
            connectorId,
          });
          sticky = stickyFromConnection(access.connection?.sticky);
        }
        const evaluation = evaluatePendingCommand(body.argv, sticky);
        if (evaluation.outcome === "allow") {
          if (evaluation.connector_id) {
            await tryInjectUserConnector(
              bindings,
              tenant.tenant_id,
              user.user_id,
              evaluation.connector_id,
            );
          }
          const payload = allowResult(evaluation);
          assertConnectorSpaJson(payload);
          return c.json(payload);
        }
        const pending = pendingUses.put({
          tenant_id: tenant.tenant_id,
          user_id: user.user_id,
          thread_id: body.thread_id ?? null,
          argv: [...body.argv],
          tool_name: body.tool_name ?? null,
          tool_call_id: body.tool_call_id ?? null,
          action_class: evaluation.action_class,
          gate: evaluation.gate,
          mapped: evaluation.mapped,
          connector_id: evaluation.connector_id,
        });
        const payload = promptResult(evaluation, pending.approval_id);
        assertConnectorSpaJson(payload);
        return c.json(payload);
      } catch (error) {
        throwApprovalError(error);
      }
    },
  );

  api.post(
    "/connectors/approval/:approvalId/decide",
    csrfProtection,
    async (c) => {
      const tenant = c.get("tenant");
      const user = requireConnectorTenantUser(c);
      const approvalId = c.req.param("approvalId");
      const body = decideApprovalSchema.parse(await c.req.json());
      const pending = pendingUses.get(approvalId);
      if (
        !pending ||
        pending.tenant_id !== tenant.tenant_id ||
        pending.user_id !== user.user_id
      ) {
        throw new HTTPException(404, { message: "Approval not found" });
      }
      try {
        const evaluation = evaluatePendingCommand(pending.argv, {});
        const applied = decidePendingCommand(evaluation, body.decision);
        if (applied.persist_sticky && pending.connector_id) {
          const access = await bindings.authClient.getUserConnectorAccess({
            tenantId: tenant.tenant_id,
            userId: user.user_id,
            connectorId: pending.connector_id,
          });
          const sticky = patchStickyMap(
            stickyFromConnection(access.connection?.sticky),
            applied.persist_sticky,
            true,
          );
          await bindings.authClient.upsertUserConnector({
            tenantId: tenant.tenant_id,
            userId: user.user_id,
            connectorId: pending.connector_id,
            sticky: sticky,
          });
        }
        pendingUses.delete(pending.approval_id);
        const payload = decideResult(applied);
        assertConnectorSpaJson(payload);
        return c.json(payload);
      } catch (error) {
        throwApprovalError(error);
      }
    },
  );

  api.patch(
    "/connectors/:connectorId/sticky",
    csrfProtection,
    async (c) => {
      const tenant = c.get("tenant");
      const user = requireConnectorTenantUser(c);
      const connectorId = parseConnectorId(c.req.param("connectorId"));
      const body = patchStickySchema.parse(await c.req.json());
      try {
        const access = await bindings.authClient.getUserConnectorAccess({
          tenantId: tenant.tenant_id,
          userId: user.user_id,
          connectorId,
        });
        if (!access.connection) {
          throw new HTTPException(404, {
            message: "Connector connection not found",
          });
        }
        const sticky = patchStickyMap(
          stickyFromConnection(access.connection.sticky),
          body.action_class,
          body.enabled,
        );
        const updated = await bindings.authClient.upsertUserConnector({
          tenantId: tenant.tenant_id,
          userId: user.user_id,
          connectorId,
          sticky,
        });
        const spa = toSpaConnectorStatus({
          ...access,
          connection: updated,
        });
        assertConnectorSpaJson(spa);
        return c.json(spa);
      } catch (error) {
        throwApprovalError(error);
      }
    },
  );

  api.post(
    "/connectors/:connectorId/disconnect",
    csrfProtection,
    async (c) => {
      const tenant = c.get("tenant");
      const user = requireConnectorTenantUser(c);
      const connectorId = parseConnectorId(c.req.param("connectorId"));
      try {
        const result = await bindings.authClient.deleteUserConnector({
          tenantId: tenant.tenant_id,
          userId: user.user_id,
          connectorId,
        });
        const body = {
          connector_id: connectorId,
          status: "not_connected" as const,
          revoke_attempted: result.revoke_attempted,
        };
        assertConnectorSpaJson(body);
        return c.json(body);
      } catch (error) {
        throwControlPlane(error);
      }
    },
  );

  api.post(
    "/connectors/:connectorId/refresh",
    csrfProtection,
    async (c) => {
      const tenant = c.get("tenant");
      const user = requireConnectorTenantUser(c);
      const connectorId = parseConnectorId(c.req.param("connectorId"));
      try {
        const result = await bindings.authClient.refreshUserConnector({
          tenantId: tenant.tenant_id,
          userId: user.user_id,
          connectorId,
        });
        const body = {
          connector_id: connectorId,
          status: result.status,
          account_label: result.account_label,
          wizard: result.wizard,
        };
        assertConnectorSpaJson(body);
        return c.json(body);
      } catch (error) {
        throwControlPlane(error);
      }
    },
  );

  const pairSchema = z
    .object({
      thread_id: z.string().min(1).max(128).optional(),
    })
    .optional();

  api.post("/connectors/whatsapp/pair", csrfProtection, async (c) => {
    const tenant = c.get("tenant");
    const user = requireConnectorTenantUser(c);
    const rawBody = await c.req.json().catch(() => ({}));
    const body = pairSchema.parse(rawBody);
    const host = bindings.whatsappPairingHost;
    if (!host) {
      throw new HTTPException(409, {
        message: "WhatsApp pairing host is not available",
      });
    }
    try {
      const access = await bindings.authClient.getUserConnectorAccess({
        tenantId: tenant.tenant_id,
        userId: user.user_id,
        connectorId: "whatsapp",
      });
      if (!access.entitled || !access.role_granted) {
        throw new HTTPException(403, { message: "WhatsApp is not available" });
      }
      await bindings.authClient.upsertUserConnector({
        tenantId: tenant.tenant_id,
        userId: user.user_id,
        connectorId: "whatsapp",
        status: "pairing",
      });
      const sandbox_id =
        bindings.whatsappPairingSandboxId?.trim() || "user-sandbox";
      const result = await runWhatsAppPairing({
        ports: {
          host,
          sandbox_id,
          store_dir: bindings.whatsappStoreDir ?? DEFAULT_WACLI_STORE_DIR,
          thread_id: body?.thread_id,
          publish: (event) => {
            if (body?.thread_id) {
              bindings.threadLiveEvents?.publish(body.thread_id, event);
              bindings.chatThreads.appendHistory(body.thread_id, {
                type: "connector.qr",
                chat_id: body.thread_id,
                pairing_id: event.pairing_id,
                code: event.code,
                phase: event.phase,
                ts: event.ts,
                connector_id: "whatsapp",
                content: event.content,
                metadata: event.metadata,
                created_at: event.created_at,
              });
            }
          },
        },
      });
      if (result.status === "connected" && result.session_db_base64) {
        const connection = await bindings.authClient.upsertUserConnector({
          tenantId: tenant.tenant_id,
          userId: user.user_id,
          connectorId: "whatsapp",
          status: "connected",
          accountLabel: result.account_label,
          secrets: { whatsapp_session_db: result.session_db_base64 },
        });
        const spa = {
          connector_id: "whatsapp" as const,
          status: connection.status,
          account_label: connection.account_label,
          pairing_id: result.pairing_id,
          llm_status: result.llm_status,
        };
        assertConnectorSpaJson(spa);
        expectNoQrInLlmStatus(spa.llm_status, result.portal_events);
        return c.json(spa);
      }
      const status =
        result.status === "needs_reauth"
          ? "needs_reauth"
          : result.status === "pairing"
            ? "pairing"
            : "needs_reauth";
      await bindings.authClient.upsertUserConnector({
        tenantId: tenant.tenant_id,
        userId: user.user_id,
        connectorId: "whatsapp",
        status,
      });
      const spa = {
        connector_id: "whatsapp" as const,
        status,
        account_label: null as string | null,
        pairing_id: result.pairing_id,
        llm_status: result.llm_status,
        error:
          result.status === "failed"
            ? result.portal_events.at(-1)?.message
            : undefined,
      };
      assertConnectorSpaJson(spa);
      expectNoQrInLlmStatus(spa.llm_status, result.portal_events);
      return c.json(spa, result.status === "failed" ? 409 : 200);
    } catch (error) {
      if (error instanceof HTTPException) {
        throw error;
      }
      if (error instanceof WhatsAppExportError) {
        throw new HTTPException(400, { message: error.message });
      }
      throwControlPlane(error);
    }
  });
}

function expectNoQrInLlmStatus(
  llmStatus: string,
  events: Array<{ code?: string }>,
): void {
  for (const event of events) {
    if (event.code && event.code.length > 0 && llmStatus.includes(event.code)) {
      throw new Error("QR payload must not appear in llm_status");
    }
  }
}
