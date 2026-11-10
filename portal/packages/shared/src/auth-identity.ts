/**
 * Product-db identity for Start server functions (`portal_app`).
 * Distinct from the BFF session user (`user_id` / `tenant_id` on control-plane).
 *
 * `businessId` is the tenant boundary: any query that reads or writes tenant
 * data must be scoped by it.
 */
export type SessionUser = {
  id: string;
  authUserId: string;
  email: string;
  businessId: string;
  /** Administrator within their own business, not across the platform. */
  isAdmin: boolean;
};

/** Platform operators. Distinct from a business admin; never inferred from SessionUser. */
export type PlatformIdentity = {
  authUserId: string;
  email: string;
  impersonatingBusinessId: string | null;
};
