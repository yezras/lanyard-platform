import {
  isValidTenantSlug,
  OPS_SESSION_COOKIE,
  parseTenantSlugFromPath,
  PLATFORM_ADMIN_API_PREFIX,
} from "@lanyard/shared";

/** Same cookie the BFF sets in `packages/bff/src/session.ts`. */
export const SESSION_COOKIE = "lanyard_session";

export { OPS_SESSION_COOKIE };

export function bffBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  return (env.BFF_URL ?? "http://127.0.0.1:4000").replace(/\/$/, "");
}

export function bffAuthMeUrl(input: {
  bffUrl: string;
  refererPath?: string | null;
  devTenantSlug?: string | null;
}): string {
  let slug = parseTenantSlugFromPath(input.refererPath ?? "");
  const fallback = input.devTenantSlug?.trim().toLowerCase() || null;
  if (!slug && fallback && isValidTenantSlug(fallback)) {
    slug = fallback;
  }
  const path = slug ? `/${slug}/api/auth/me` : "/api/auth/me";
  return `${input.bffUrl.replace(/\/$/, "")}${path}`;
}

/** Ops console identity. Bare `/api/admin/auth/me` — never a tenant slug path. */
export function bffAdminAuthMeUrl(
  bffUrl: string = bffBaseUrl(),
): string {
  return `${bffUrl.replace(/\/$/, "")}${PLATFORM_ADMIN_API_PREFIX}/auth/me`;
}
