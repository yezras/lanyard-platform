import { createMiddleware } from "@tanstack/react-start";

/**
 * Attaches the authenticated product-db user to a server function's context.
 *
 * `./server.ts` is imported dynamically so Prisma and Cognito stay off the
 * synchronous import graph and cannot be pulled into a client bundle.
 */
export const authMiddleware = createMiddleware({ type: "function" }).server(
  async ({ next }) => {
    const { requireSessionUser } = await import("./server.ts");
    return next({ context: { user: await requireSessionUser() } });
  },
);

export const businessAdminMiddleware = createMiddleware({
  type: "function",
}).server(async ({ next }) => {
  const { requireBusinessAdmin } = await import("./server.ts");
  return next({ context: { user: await requireBusinessAdmin() } });
});

export const platformAdminMiddleware = createMiddleware({
  type: "function",
}).server(async ({ next }) => {
  const { requirePlatformAdmin } = await import("./server.ts");
  return next({ context: { admin: await requirePlatformAdmin() } });
});
