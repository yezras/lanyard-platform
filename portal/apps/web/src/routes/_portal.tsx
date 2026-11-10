import { createFileRoute } from "@tanstack/react-router";

import { AuthenticatedPortal } from "../layout/AuthenticatedPortal.js";

export const Route = createFileRoute("/_portal")({
  component: AuthenticatedPortal,
});
