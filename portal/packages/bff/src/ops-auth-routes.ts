import {
  APP_HOST,
  PLATFORM_ADMIN_API_PREFIX,
  PLATFORM_ADMIN_UI_BASE,
} from "@lanyard/shared";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import { isLocalDevMode } from "./local-dev.js";
import { csrfProtection } from "./middleware/csrf.js";
import { resolveOAuthRedirectOrigin } from "./oauth-redirect.js";
import {
  MemoryOperatorDirectory,
  type OperatorDirectory,
} from "./operator-directory.js";
import { OpsGoogleAuthError, type OpsGoogleVerifier } from "./ops-google.js";
import {
  clearOpsSessionCookie,
  MemoryOpsSessionStore,
  resolveAllowlistedOpsSessionUser,
  setOpsSessionCookie,
  type OpsSessionStore,
  type OpsVariables,
} from "./ops-session.js";
import {
  createCsrfToken,
  readOpsSessionId,
  setCsrfCookie,
  signOAuthState,
  verifyOAuthState,
} from "./session.js";
import { registerOpsAdminShellRoutes } from "./ops-admin-stubs.js";
import { registerOpsConnectorRoutes } from "./ops-connectors-routes.js";
import { registerOpsRegistryRoutes } from "./ops-registry-routes.js";
import { registerOpsClassCSecretRoutes } from "./ops-class-c-secrets-routes.js";
import { registerOpsSecretRoutes } from "./ops-secrets-routes.js";
import { registerOpsTenantRoutes } from "./ops-tenants-routes.js";
import { registerOpsUserRoutes } from "./ops-users-routes.js";
import type { BffBindings } from "./types.js";

export const OPS_GOOGLE_CALLBACK_PATH = `${PLATFORM_ADMIN_API_PREFIX}/auth/google/callback`;
export type { OpsVariables };

const stubSchema = z.object({
  email: z.string().email(),
});

function defaultOpsSessions(bindings: BffBindings): OpsSessionStore {
  return bindings.opsSessions ?? new MemoryOpsSessionStore();
}

function defaultOperatorDirectory(bindings: BffBindings): OperatorDirectory {
  return bindings.operatorDirectory ?? new MemoryOperatorDirectory();
}

async function establishOpsSession(
  bindings: BffBindings,
  store: OpsSessionStore,
  c: Parameters<typeof setOpsSessionCookie>[0],
  input: { operatorId: string; email: string },
): Promise<void> {
  const session = await store.create(input);
  const csrfToken = createCsrfToken();
  setOpsSessionCookie(c, session.sessionId, bindings.config.secureCookies);
  setCsrfCookie(c, csrfToken, bindings.config.secureCookies);
}

function prefersJsonResponse(accept: string): boolean {
  const prefersJson = /\bapplication\/json\b/i.test(accept);
  const prefersHtml = /\btext\/html\b/i.test(accept);
  return prefersJson && !prefersHtml;
}

export function createOpsAuthApp(
  bindings: BffBindings,
): Hono<{ Variables: OpsVariables }> {
  const opsSessions = defaultOpsSessions(bindings);
  const operatorDirectory = defaultOperatorDirectory(bindings);
  const admin = new Hono<{ Variables: OpsVariables }>();

  admin.use("*", async (c, next) => {
    const operator = await resolveAllowlistedOpsSessionUser(
      opsSessions,
      (email) => operatorDirectory.lookupByEmail(email),
      readOpsSessionId(c),
    );
    c.set("opsOperator", operator);
    await next();
  });

  admin.get("/auth/csrf", (c) => {
    const token = createCsrfToken();
    setCsrfCookie(c, token, bindings.config.secureCookies);
    return c.json({ csrf_token: token });
  });

  admin.get("/auth/google", (c) => {
    if (!bindings.config.googleClientId) {
      throw new HTTPException(503, {
        message: "Google sign-in is not configured (GOOGLE_CLIENT_ID)",
      });
    }

    const originResult = resolveOAuthRedirectOrigin({
      hostHeader: c.req.header("host"),
      tenantHost: APP_HOST,
      tenantSlug: "",
      appHosts: bindings.appHosts ?? [],
      secureCookies: bindings.config.secureCookies,
    });
    if (!originResult.ok) {
      throw new HTTPException(400, {
        message: "OAuth redirect host is not allowlisted",
      });
    }

    const redirectUri = `${originResult.origin}${OPS_GOOGLE_CALLBACK_PATH}`;
    const state = signOAuthState(
      {
        plane: "ops",
        redirect_uri: redirectUri,
      },
      bindings.config.sessionSecret,
    );

    const params = new URLSearchParams({
      client_id: bindings.config.googleClientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      prompt: "select_account",
    });

    return c.redirect(
      `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
      302,
    );
  });

  admin.get("/auth/google/callback", async (c) => {
    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) {
      throw new HTTPException(400, {
        message: "Missing Google OAuth code or state",
      });
    }

    const parsedState = verifyOAuthState(state, bindings.config.sessionSecret);
    if (!parsedState || parsedState.plane !== "ops") {
      throw new HTTPException(403, { message: "Invalid OAuth state" });
    }

    const redirectUri = parsedState.redirect_uri;
    if (!redirectUri) {
      throw new HTTPException(400, { message: "OAuth state missing redirect_uri" });
    }

    const verifier: OpsGoogleVerifier | undefined = bindings.opsGoogleVerifier;
    if (!verifier) {
      throw new HTTPException(503, {
        message: "Google sign-in is not configured (GOOGLE_CLIENT_SECRET)",
      });
    }

    let identity;
    try {
      identity = await verifier.exchangeAuthorizationCode(code, redirectUri);
    } catch (error) {
      if (error instanceof OpsGoogleAuthError) {
        throw new HTTPException(403, { message: error.message });
      }
      throw error;
    }

    const operator = await operatorDirectory.lookupByEmail(identity.email);
    if (!operator) {
      throw new HTTPException(403, {
        message: "This Google account is not an allowlisted platform operator",
      });
    }

    await establishOpsSession(bindings, opsSessions, c, {
      operatorId: operator.operatorId,
      email: operator.email,
    });

    const body = {
      operator_id: operator.operatorId,
      email: operator.email,
      plane: "ops" as const,
      provider: "google",
    };

    if (prefersJsonResponse(c.req.header("accept") ?? "")) {
      return c.json(body);
    }
    return c.redirect(PLATFORM_ADMIN_UI_BASE, 302);
  });

  admin.post("/auth/google/stub", csrfProtection, async (c) => {
    if (!isLocalDevMode(bindings)) {
      throw new HTTPException(404, { message: "Not found" });
    }

    const body = stubSchema.parse(await c.req.json());
    const operator = await operatorDirectory.lookupByEmail(body.email);
    if (!operator) {
      throw new HTTPException(403, {
        message: "This Google account is not an allowlisted platform operator",
      });
    }

    await establishOpsSession(bindings, opsSessions, c, {
      operatorId: operator.operatorId,
      email: operator.email,
    });

    return c.json({
      operator_id: operator.operatorId,
      email: operator.email,
      plane: "ops",
      provider: "google",
    });
  });

  admin.get("/auth/me", (c) => {
    const operator = c.get("opsOperator");
    if (!operator) {
      throw new HTTPException(401, { message: "Not authenticated" });
    }
    return c.json(operator);
  });

  admin.post("/auth/logout", csrfProtection, async (c) => {
    const sessionId = readOpsSessionId(c);
    if (sessionId) {
      await opsSessions.delete(sessionId);
    }
    clearOpsSessionCookie(c, bindings.config.secureCookies);
    return c.json({ ok: true });
  });

  registerOpsAdminShellRoutes(admin);
  registerOpsUserRoutes(admin, bindings);
  registerOpsConnectorRoutes(admin, bindings);
  registerOpsRegistryRoutes(admin, bindings);
  registerOpsTenantRoutes(admin, bindings);

  registerOpsSecretRoutes(admin, bindings);
  registerOpsClassCSecretRoutes(admin, bindings);

  return admin;
}
