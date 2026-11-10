import { HTTPException } from "hono/http-exception";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { CognitoAuthError } from "./cognito-auth.js";
import { ControlPlaneRequestError } from "./control-plane-client.js";
import { isLocalDevMode } from "./local-dev.js";
import type { BffBindings, TenantContext } from "./types.js";

/** Local-dev slug, or CI/test opt-in. Production still requires Cognito. */
function allowLocalPassword(bindings: BffBindings): boolean {
  return (
    isLocalDevMode(bindings) ||
    process.env.BFF_ALLOW_LOCAL_PASSWORD === "true"
  );
}

export type PasswordAuthUser = {
  user_id: string;
  email: string;
  tenant_id: string;
};

export async function authenticatePassword(
  bindings: BffBindings,
  tenant: TenantContext,
  email: string,
  password: string,
): Promise<PasswordAuthUser> {
  if (bindings.cognito) {
    try {
      const cognitoUser = await bindings.cognito.authenticate(email, password);
      const portalUser = await bindings.authClient.getUserByEmail(
        tenant.tenant_id,
        cognitoUser.email,
      );
      if (!portalUser) {
        throw new HTTPException(401, {
          message: "No portal account for this user",
        });
      }
      return {
        user_id: portalUser.user_id,
        email: portalUser.email,
        tenant_id: tenant.tenant_id,
      };
    } catch (error) {
      if (error instanceof HTTPException) throw error;
      if (error instanceof CognitoAuthError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }
  }

  if (allowLocalPassword(bindings)) {
    try {
      const user = await bindings.authClient.login({
        tenantId: tenant.tenant_id,
        email,
        password,
      });
      return {
        user_id: user.user_id,
        email: user.email,
        tenant_id: tenant.tenant_id,
      };
    } catch (error) {
      if (error instanceof ControlPlaneRequestError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }
  }

  throw new HTTPException(503, {
    message: "Password sign-in requires Cognito (COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, COGNITO_REGION)",
  });
}

export async function registerPassword(
  bindings: BffBindings,
  tenant: TenantContext,
  email: string,
  password: string,
): Promise<PasswordAuthUser> {
  if (bindings.cognito) {
    try {
      await bindings.cognito.register(email, password);
    } catch (error) {
      if (error instanceof CognitoAuthError) {
        throw new HTTPException(error.status as ContentfulStatusCode, {
          message: error.message,
        });
      }
      throw error;
    }
  } else if (!allowLocalPassword(bindings)) {
    throw new HTTPException(503, {
      message: "Registration requires Cognito (COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, COGNITO_REGION)",
    });
  }

  try {
    const user = await bindings.authClient.registerUser({
      tenantId: tenant.tenant_id,
      email,
      password,
    });
    return {
      user_id: user.user_id,
      email: user.email,
      tenant_id: tenant.tenant_id,
    };
  } catch (error) {
    if (error instanceof ControlPlaneRequestError) {
      throw new HTTPException(error.status as ContentfulStatusCode, {
        message: error.message,
      });
    }
    throw error;
  }
}
