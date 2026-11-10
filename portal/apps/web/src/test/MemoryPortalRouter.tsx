import { type ReactNode } from "react";
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from "@tanstack/react-router";
import { render, type RenderResult } from "@testing-library/react";

export async function renderWithPortalRouter(
  ui: ReactNode,
  options: { path?: string } = {},
): Promise<RenderResult> {
  const path = options.path ?? "/chat";
  const rootRoute = createRootRoute({
    component: function Root() {
      return (
        <>
          {ui}
          <Outlet />
        </>
      );
    },
  });
  const routeTree = rootRoute.addChildren([
    createRoute({ getParentRoute: () => rootRoute, path: "/" }),
    createRoute({ getParentRoute: () => rootRoute, path: "/chat" }),
    createRoute({
      getParentRoute: () => rootRoute,
      path: "/vault",
      validateSearch: (search: Record<string, unknown>) => ({
        path: typeof search.path === "string" ? search.path : undefined,
      }),
    }),
    createRoute({ getParentRoute: () => rootRoute, path: "/settings" }),
  ]);
  const router = createRouter({
    routeTree,
    history: createMemoryHistory({ initialEntries: [path] }),
    defaultPendingMs: 0,
    defaultPendingMinMs: 0,
  });
  await router.load();
  return render(<RouterProvider router={router} />);
}
