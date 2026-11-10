/**
 * Admin shell model (lp-hdzm.3): one superadmin tenant workspace.
 *
 * Empty superadmin: Tenants, Registry. With tenant: plus Connectors, Users,
 * Ops (Hermes roles). No Home. Click Tenants clears selection. Click a
 * tenant lands on connectors.
 *
 * Hash grammar:
 *   #/tenants | #/registry | #/{slug}/{page}
 *   #/{slug}/connectors/{id} | #/{slug}/users/{id}
 * Reserved tenant slugs: registry, admin.
 */

export type AdminRole = "superadmin" | "tenant_admin";

export type AdminPageId =
  | "connectors"
  | "connector-detail"
  | "users"
  | "tenants"
  | "registry"
  | "instances"
  | "roles"
  | "audit"
  | "secrets";

export const ADMIN_PAGE_LABELS: Record<AdminPageId, string> = {
  connectors: "Connectors",
  "connector-detail": "Connectors",
  users: "Users",
  tenants: "Tenants",
  registry: "Registry",
  instances: "Instances",
  roles: "Hermes roles",
  audit: "Audit",
  secrets: "Provider secrets",
};

export const RESERVED_TENANT_SLUGS = ["registry", "admin"] as const;

export type AdminNavItem = { page: AdminPageId; label: string };

export type AdminNavSection = {
  /** null renders an untitled section; "Ops" is the quieter superadmin group. */
  title: string | null;
  items: AdminNavItem[];
};

export type AdminHashParse = {
  tenantSlug: string | null;
  page: AdminPageId | null;
  connectorId: string | null;
  userId: string | null;
};

export type AdminShellLocation = {
  page: AdminPageId;
  tenantSlug: string | null;
  connectorId: string | null;
  userId: string | null;
};

export type AdminHashDetail = {
  connectorId?: string | null;
  userId?: string | null;
};

const PLATFORM_PAGES: readonly AdminPageId[] = ["tenants", "registry"];
const TENANT_HASH_PAGES: readonly AdminPageId[] = [
  "connectors",
  "users",
  "instances",
  "roles",
  "audit",
  "secrets",
];

const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const DETAIL_ID_RE = /^[a-z0-9][a-z0-9_-]*$/;

const EMPTY_PARSE: AdminHashParse = {
  tenantSlug: null,
  page: null,
  connectorId: null,
  userId: null,
};

function item(page: AdminPageId): AdminNavItem {
  return { page, label: ADMIN_PAGE_LABELS[page] };
}

function isReservedSlug(slug: string): boolean {
  return (RESERVED_TENANT_SLUGS as readonly string[]).includes(slug);
}

function isPlatformPage(page: AdminPageId): boolean {
  return (PLATFORM_PAGES as readonly AdminPageId[]).includes(page);
}

function asTenantHashPage(value: string): AdminPageId | null {
  return TENANT_HASH_PAGES.find((id) => id === value) ?? null;
}

export function sidenavSections(input: {
  role: AdminRole;
  hasTenant: boolean;
}): AdminNavSection[] {
  if (input.role === "tenant_admin") {
    return [
      {
        title: null,
        items: [item("connectors"), item("users")],
      },
    ];
  }

  const mainItems: AdminNavItem[] = input.hasTenant
    ? [item("tenants"), item("registry"), item("connectors"), item("users")]
    : [item("tenants"), item("registry")];

  const sections: AdminNavSection[] = [{ title: null, items: mainItems }];
  if (input.hasTenant) {
    sections.push({
      title: "Ops",
      items: [
        item("instances"),
        item("roles"),
        item("audit"),
        item("secrets"),
      ],
    });
  }
  return sections;
}

export function sidenavItemPages(input: {
  role: AdminRole;
  hasTenant: boolean;
}): AdminPageId[] {
  return sidenavSections(input).flatMap((section) =>
    section.items.map((navItem) => navItem.page),
  );
}

/** Default landing page per role/tenant state. */
export function defaultAdminPage(input: {
  role: AdminRole;
  hasTenant: boolean;
}): AdminPageId {
  return input.role === "tenant_admin" || input.hasTenant
    ? "connectors"
    : "tenants";
}

/**
 * Deep-link parse. Returns null parts for absent/garbage input — callers
 * run `resolveAdminLocation` so unknown or unscoped hashes bounce to Tenants.
 */
export function parseAdminHash(hash: string): AdminHashParse {
  const parts = hash.replace(/^#\/?/, "").split("/").filter(Boolean);
  if (parts.length === 0) {
    return EMPTY_PARSE;
  }

  const [first, second, third] = parts;

  if (first === "registry" || first === "tenants") {
    if (parts.length === 1) {
      return { ...EMPTY_PARSE, page: first };
    }
    return EMPTY_PARSE;
  }

  if (isReservedSlug(first)) {
    return EMPTY_PARSE;
  }

  if (parts.length === 1) {
    const page = asTenantHashPage(first);
    return page ? { ...EMPTY_PARSE, page } : EMPTY_PARSE;
  }

  const page = asTenantHashPage(second ?? "");
  const validSlug = SLUG_RE.test(first) && !isReservedSlug(first) ? first : null;
  if (!validSlug || !page) {
    return { ...EMPTY_PARSE, tenantSlug: validSlug };
  }

  if (page === "connectors" && third && DETAIL_ID_RE.test(third)) {
    return {
      tenantSlug: validSlug,
      page: "connector-detail",
      connectorId: third,
      userId: null,
    };
  }
  if (page === "users" && third && DETAIL_ID_RE.test(third)) {
    return {
      tenantSlug: validSlug,
      page: "users",
      connectorId: null,
      userId: third,
    };
  }
  return {
    tenantSlug: validSlug,
    page,
    connectorId: null,
    userId: null,
  };
}

export function adminHashFor(
  page: AdminPageId,
  tenantSlug: string | null,
  detail?: AdminHashDetail,
): string {
  if (isPlatformPage(page)) {
    return `#/${page}`;
  }
  if (!tenantSlug) {
    return "#/tenants";
  }
  if (page === "connector-detail" && detail?.connectorId) {
    return `#/${tenantSlug}/connectors/${detail.connectorId}`;
  }
  if (page === "users" && detail?.userId) {
    return `#/${tenantSlug}/users/${detail.userId}`;
  }
  const hashPage = page === "connector-detail" ? "connectors" : page;
  return `#/${tenantSlug}/${hashPage}`;
}

/**
 * Fail closed: unknown pages, reserved slugs, missing tenant for a scoped
 * hash, or an unknown slug bounce to Tenants (superadmin) or Connectors
 * (tenant admin). Never a white page.
 */
export function resolveAdminLocation(input: {
  parsed: AdminHashParse;
  role: AdminRole;
  knownTenantSlugs: ReadonlySet<string>;
}): AdminShellLocation {
  const bounceTenants = (): AdminShellLocation => ({
    page: "tenants",
    tenantSlug: null,
    connectorId: null,
    userId: null,
  });
  const bounceConnectors = (slug: string): AdminShellLocation => ({
    page: "connectors",
    tenantSlug: slug,
    connectorId: null,
    userId: null,
  });

  if (input.role === "tenant_admin") {
    const slug = [...input.knownTenantSlugs][0] ?? null;
    if (!slug) {
      return bounceTenants();
    }
    if (
      input.parsed.page &&
      !isPlatformPage(input.parsed.page) &&
      (input.parsed.page === "connectors" ||
        input.parsed.page === "connector-detail" ||
        input.parsed.page === "users")
    ) {
      return {
        page: input.parsed.page,
        tenantSlug: slug,
        connectorId: input.parsed.connectorId,
        userId: input.parsed.userId,
      };
    }
    return bounceConnectors(slug);
  }

  if (
    input.parsed.page &&
    isPlatformPage(input.parsed.page) &&
    !input.parsed.tenantSlug
  ) {
    return {
      page: input.parsed.page,
      tenantSlug: null,
      connectorId: null,
      userId: null,
    };
  }

  const slug = input.parsed.tenantSlug;
  if (
    slug &&
    input.knownTenantSlugs.has(slug) &&
    input.parsed.page &&
    !isPlatformPage(input.parsed.page)
  ) {
    return {
      page: input.parsed.page,
      tenantSlug: slug,
      connectorId: input.parsed.connectorId,
      userId: input.parsed.userId,
    };
  }

  return bounceTenants();
}
