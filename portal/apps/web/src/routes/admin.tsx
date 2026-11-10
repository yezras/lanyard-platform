import { createFileRoute } from "@tanstack/react-router";

import { AuthenticatedOpsConsole } from "../layout/AuthenticatedOpsConsole.js";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [{ title: "Lanyard Admin" }],
  }),
  component: AuthenticatedOpsConsole,
});
