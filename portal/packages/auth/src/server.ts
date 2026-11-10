import { getCookies, getRequestHeader } from "@tanstack/react-start/server";
import { ForbiddenError, UnauthorizedError } from "@lanyard/shared";
import type { PlatformIdentity, SessionUser } from "@lanyard/shared";

import {
  bffAdminAuthMeUrl,
  bffAuthMeUrl,
  bffBaseUrl,
  OPS_SESSION_COOKIE,
  SESSION_COOKIE,
} from "./bff-session.ts";

export {
  createIdentityUser,
  deleteIdentityUser,
  updateIdentityUserEmail,
} from "./identity-admin.ts";
export type { IdentityUser } from "./identity-admin.ts";

export type AuthClaims = {
  /** Control-plane user id from the BFF session (not Cognito `sub`). */
  sub: string;
  email: string;
  tenantId: string;
};

type AuthMeBody = {
  user_id?: string;
  email?: string;
  tenant_id?: string;
};

type OpsAuthMeBody = {
  operator_id?: string;
  email?: string;
  plane?: string;
  /** Illegal on an ops session. Presence fail-closes. */
  tenant_id?: string;
};

function pathnameFromReferer(referer: string | undefined): string | null {
  if (!referer) return null;
  try {
    return new URL(referer).pathname;
  } catch {
    return null;
  }
}

/**
 * Verifies the BFF `lanyard_session` cookie via GET /api/auth/me.
 * Returns null so route guards can redirect instead of throwing.
 */
export async function getAuthClaims(): Promise<AuthClaims | null> {
  const cookies = getCookies();
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) return null;

  const url = bffAuthMeUrl({
    bffUrl: bffBaseUrl(),
    refererPath: pathnameFromReferer(getRequestHeader("referer")),
    devTenantSlug: process.env.DEV_TENANT_SLUG ?? null,
  });

  const cookieHeader = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");

  let res: Response;
  try {
    res = await fetch(url, {
      headers: {
        cookie: cookieHeader,
        accept: "application/json",
      },
    });
  } catch {
    return null;
  }
  if (!res.ok) return null;

  const body = (await res.json()) as AuthMeBody;
  if (!body.user_id || !body.email || !body.tenant_id) return null;

  return {
    sub: body.user_id,
    email: body.email.trim().toLowerCase(),
    tenantId: body.tenant_id,
  };
}

/**
 * Product-db user for tenant Start functions. Joins BFF session email to
 * Prisma `User.email` (Cognito `sub` is `User.authUserId`, not the session id).
 */
export async function requireSessionUser(): Promise<SessionUser> {
  const claims = await getAuthClaims();
  if (!claims) throw new UnauthorizedError();

  const { prisma } = await import("@lanyard/db");
  const user = await prisma.user.findUnique({
    where: { email: claims.email },
    select: {
      id: true,
      authUserId: true,
      email: true,
      businessId: true,
      isAdmin: true,
    },
  });

  if (!user) {
    throw new ForbiddenError("This account is not linked to a business yet.");
  }

  return user;
}

export async function requireBusinessAdmin(): Promise<SessionUser> {
  const user = await requireSessionUser();
  if (!user.isAdmin) throw new ForbiddenError("Administrator access required.");
  return user;
}

/**
 * Platform operator check. Reads `lanyard_ops_session` via BFF
 * GET /api/admin/auth/me. Deliberately ignores tenant `lanyard_session`
 * and Prisma `User.isAdmin`.
 */
export async function requirePlatformAdmin(): Promise<PlatformIdentity> {
  const cookies = getCookies();
  const sessionId = cookies[OPS_SESSION_COOKIE];
  if (!sessionId) throw new UnauthorizedError();

  const cookieHeader = Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");

  let res: Response;
  try {
    res = await fetch(bffAdminAuthMeUrl(), {
      headers: {
        cookie: cookieHeader,
        accept: "application/json",
      },
    });
  } catch {
    throw new UnauthorizedError();
  }
  if (res.status === 401) throw new UnauthorizedError();
  if (res.status === 403) throw new ForbiddenError("Superadmin access required.");
  if (!res.ok) throw new UnauthorizedError();

  const body = (await res.json()) as OpsAuthMeBody;
  if (
    body.plane !== "ops" ||
    !body.operator_id ||
    !body.email ||
    body.tenant_id
  ) {
    throw new UnauthorizedError();
  }

  return {
    authUserId: body.operator_id,
    email: body.email.trim().toLowerCase(),
    impersonatingBusinessId: null,
  };
}
