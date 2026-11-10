import { createRouter } from "@tanstack/react-router";

import { tenantUiLocationRewrite } from "./api/tenantBase.js";
import { routeTree } from "./routeTree.gen.js";

export function getRouter() {
  const router = createRouter({
    routeTree,
    // Do NOT set `basepath` here: Start hydrateStart overwrites it with
    // TSS_ROUTER_BASEPATH ("" for static packs). Use rewrite instead (lp-zuh.12.6).
    rewrite: tenantUiLocationRewrite(),
    scrollRestoration: true,
    defaultPreload: "intent",
    defaultPreloadStaleTime: 0,
  });

  return router;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
}
