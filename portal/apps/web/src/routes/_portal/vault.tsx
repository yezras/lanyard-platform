import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_portal/vault")({
  validateSearch: (search: Record<string, unknown>): { path?: string } => ({
    path: typeof search.path === "string" ? search.path : undefined,
  }),
  component: () => null,
});
