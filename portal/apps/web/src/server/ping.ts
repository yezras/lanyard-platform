import { createServerFn } from "@tanstack/react-start";

/** Drop target for tenant Start server functions. Client APIs still go through the BFF. */
export const ping = createServerFn({ method: "GET" }).handler(async () => ({
  ok: true as const,
}));
