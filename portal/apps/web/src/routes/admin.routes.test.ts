import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));

describe("ops /admin routes", () => {
  it("registers /admin on the web route tree, not a second app", () => {
    const routeTree = readFileSync(join(here, "../routeTree.gen.ts"), "utf8");
    expect(routeTree).toContain("routes/admin");
    expect(routeTree).toMatch(/fullPath:\s*'\/admin'/);
    expect(routeTree).toContain("'/admin'");
  });

  it("keeps the ops route off PortalShell and tenant /api/auth/me", () => {
    const adminRoute = readFileSync(join(here, "admin.tsx"), "utf8");
    expect(adminRoute).toContain("AuthenticatedOpsConsole");
    expect(adminRoute).not.toContain("PortalShell");
    expect(adminRoute).not.toContain("AuthenticatedPortal");
    expect(adminRoute).not.toContain("/api/auth/me");
  });
});
