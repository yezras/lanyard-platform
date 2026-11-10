export const PORTAL_VIEWS = ["chat", "vault", "settings"] as const;
export type PortalView = (typeof PORTAL_VIEWS)[number];

export function isPortalView(value: string | undefined): value is PortalView {
  return value === "chat" || value === "vault" || value === "settings";
}

/** Last path segment → portal tab. Unknown paths default to chat. */
export function portalViewFromPathname(pathname: string): PortalView {
  const last = pathname.split("/").filter(Boolean).at(-1);
  return isPortalView(last) ? last : "chat";
}
