export type AuthSignInConfig = {
  googleSignIn: boolean;
  googleDevStub: boolean;
  tenantSlug: string | null;
};

export function isLocalDevFrontend(
  hostname: string,
  tenantSlug: string | null,
): boolean {
  if (hostname === "demo.localhost") {
    return true;
  }
  if (
    (hostname === "localhost" || hostname.endsWith(".localhost")) &&
    tenantSlug === "demo"
  ) {
    return true;
  }
  return false;
}

/**
 * Browser fetch({ redirect: "manual" }) yields status 302 on some stacks, or
 * status 0 + type "opaqueredirect" (Fetch / Chromium). Both mean Google start
 * is available. HTML SPA fallbacks (200) and 503/401 must not count.
 */
export function isGoogleSignInAvailable(input: {
  googleStatus: number;
  googleResponseType?: string;
}): boolean {
  if (input.googleStatus === 302) {
    return true;
  }
  // Opaque redirect filtered response (same-origin OAuth start).
  if (
    input.googleStatus === 0 &&
    input.googleResponseType === "opaqueredirect"
  ) {
    return true;
  }
  return false;
}

export function resolveAuthSignInOptions(input: {
  hostname: string;
  tenantSlug: string | null;
  googleStatus: number;
  googleResponseType?: string;
}): AuthSignInConfig {
  const googleSignIn = isGoogleSignInAvailable({
    googleStatus: input.googleStatus,
    googleResponseType: input.googleResponseType,
  });
  const googleDevStub =
    isLocalDevFrontend(input.hostname, input.tenantSlug) && !googleSignIn;

  return {
    googleSignIn,
    googleDevStub,
    tenantSlug: input.tenantSlug,
  };
}