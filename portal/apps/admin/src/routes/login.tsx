import { createFileRoute, redirect } from "@tanstack/react-router";

/** TEMP: login is disabled; send operators to the admin home page. */
export const Route = createFileRoute("/login")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
  component: () => null,
});
