import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Keep `/?story=…` working for Playwright / ui-testing story URLs.
 * Dropping search on redirect made SSR paint the story then client land on
 * unauthenticated /chat (hydration mismatch) — blocks OnlyOffice story proofs.
 */
export const Route = createFileRoute("/")({
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/chat", search });
  },
});
