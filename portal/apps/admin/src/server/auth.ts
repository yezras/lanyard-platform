import { createServerFn } from "@tanstack/react-start";
import { getAuthClaims } from "@lanyard/auth/server";

/**
 * Used by route guards only. It reports whether a BFF session exists; it does
 * not authorize platform-admin access (`platformAdminMiddleware` does that).
 */
export const fetchClaims = createServerFn({ method: "GET" }).handler(
  async () => {
    return getAuthClaims();
  },
);
