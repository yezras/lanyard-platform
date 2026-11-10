import { Outlet, createFileRoute } from "@tanstack/react-router";

import { AdminShell } from "../layout/AdminShell.js";

/**
 * TEMP: login is disabled for the admin skeleton. Restore `fetchClaims` and
 * redirect to `/login` before shipping.
 */
export const Route = createFileRoute("/_protected")({
  component: ProtectedLayout,
});

function ProtectedLayout() {
  return (
    <AdminShell>
      <Outlet />
    </AdminShell>
  );
}
