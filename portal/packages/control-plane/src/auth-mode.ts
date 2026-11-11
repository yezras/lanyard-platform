/**
 * Control-plane access auth mode (G1.1 + G1.2).
 *
 * - development: fail-closed by default. When CONTROL_PLANE_SERVICE_TOKEN is
 *   set, BFF-facing routes require that service credential. Unauthenticated
 *   open mode is **opt-in only** via CONTROL_PLANE_DEV_OPEN=1 (local stacks /
 *   unit tests). Google stub credentials allowed when not production.
 * - production: fail-closed — require CONTROL_PLANE_SERVICE_TOKEN (or ops token
 *   for elevated ops tooling) on every non-health route; Google ID tokens must
 *   be cryptographically verified; stubs rejected. DEV_OPEN is ignored.
 *
 * Network boundary (G1.3): the control plane must never attach to a public ALB.
 * App-layer service auth is defense-in-depth for private-network callers.
 */

export type ControlPlaneAuthMode = "development" | "production";

export function resolveAuthMode(
  env: NodeJS.ProcessEnv = process.env,
  explicit?: ControlPlaneAuthMode,
): ControlPlaneAuthMode {
  if (explicit === "production" || explicit === "development") {
    return explicit;
  }

  const raw = env.CONTROL_PLANE_AUTH_MODE?.trim().toLowerCase();
  if (raw === "production" || raw === "development") {
    return raw;
  }

  // Safe default for real deploys that forget the explicit flag.
  if (env.NODE_ENV === "production") {
    return "production";
  }

  return "development";
}

/**
 * Explicit local-dev open mode: allow unauthenticated non-health routes when
 * no service token is configured. Requires CONTROL_PLANE_DEV_OPEN=1|true|yes|on
 * (or createApp `{ devOpen: true }`). Never honored when authMode is production.
 */
export function resolveDevOpenMode(
  env: NodeJS.ProcessEnv = process.env,
  explicit?: boolean,
): boolean {
  if (explicit === true) {
    return true;
  }
  if (explicit === false) {
    return false;
  }
  const raw = env.CONTROL_PLANE_DEV_OPEN?.trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

/**
 * Paths reachable without service/ops credentials.
 * In production:
 * - GET /health — k8s/private probes
 * - POST /webhooks/daytona — Daytona HMAC webhook (lp-04r); signature is the
 *   app-layer credential (see daytona-webhook.ts). CP remains private-network
 *   (G1.3); this only skips the BFF service-token gate.
 * Login and Google callback require BFF service credentials in production (G1.2)
 * because the control plane is private and BFF is the only legitimate browser edge.
 */
export function isPublicUnauthenticatedPath(
  method: string,
  path: string,
): boolean {
  if (method === "GET" && path === "/health") {
    return true;
  }
  // lp-04r: Daytona cannot present CONTROL_PLANE_SERVICE_TOKEN.
  if (method === "POST" && path === "/webhooks/daytona") {
    return true;
  }
  return false;
}

/**
 * User credential exchange paths (browser → BFF → CP).
 * Still require service credentials in production; listed for docs/tests.
 */
export function isUserAuthPath(method: string, path: string): boolean {
  if (method === "POST" && path === "/auth/login") {
    return true;
  }
  if (method === "POST" && path === "/auth/google/callback") {
    return true;
  }
  return false;
}
