import type { ReactNode } from "react";
import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";

import { Providers } from "../app/providers.js";
import { storyTree } from "../stories/storyTree.js";
import appCss from "../styles/globals.css?url";

export const Route = createRootRoute({
  validateSearch: (search: Record<string, unknown>): { story?: string } => ({
    story: typeof search.story === "string" ? search.story : undefined,
  }),
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Lanyard Portal" },
    ],
    links: [{ rel: "stylesheet", href: appCss }],
  }),
  component: RootComponent,
  shellComponent: RootDocument,
});

function RootComponent() {
  const { story } = Route.useSearch();
  if (story) {
    return storyTree(story);
  }
  return <Outlet />;
}

function RootDocument({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        <Providers>{children}</Providers>
        <Scripts />
      </body>
    </html>
  );
}
