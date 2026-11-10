import { useEffect, useRef, useState } from "react";

import {
  BuildingOffice2Icon,
  CubeIcon,
  DocumentTextIcon,
  KeyIcon,
  ServerStackIcon,
  ShieldCheckIcon,
  Squares2X2Icon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import {
  SideNav,
  SideNavHeading,
  SideNavItem,
  SideNavSection,
} from "@astryxdesign/core/SideNav";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import { VStack } from "@astryxdesign/core/VStack";
import type { IconType } from "@astryxdesign/core/Icon";

import type { OpsTenantSummary } from "../api/opsAdmin.js";
import { fetchOpsTenants } from "../api/opsAdmin.js";
import {
  fetchOpsAdminContext,
  type OpsAdminContext,
} from "../api/opsAdminContext.js";
import { logoutOps, type OpsOperator } from "../api/opsAuth.js";
import { OpsAuditPage } from "../features/admin/OpsAuditPage.js";
import { OpsConnectorsPage } from "../features/admin/OpsConnectorsPage.js";
import { OpsConnectorDetailPage } from "../features/admin/OpsConnectorDetailPage.js";
import { OpsInstancesPage } from "../features/admin/OpsInstancesPage.js";
import { OpsConnectorRegistryPage } from "../features/admin/OpsConnectorRegistryPage.js";
import { OpsRolesPage } from "../features/admin/OpsRolesPage.js";
import { OpsSecretsPage } from "../features/admin/OpsSecretsPage.js";
import { OpsTenantsPage } from "../features/admin/OpsTenantsPage.js";
import { OpsUsersPage } from "../features/admin/OpsUsersPage.js";
import {
  ADMIN_PAGE_LABELS,
  adminHashFor,
  parseAdminHash,
  resolveAdminLocation,
  sidenavSections,
  type AdminHashDetail,
  type AdminNavItem,
  type AdminPageId,
  type AdminShellLocation,
} from "../features/admin/opsAdminShell.js";
import type { OpsConnectorId } from "../features/admin/opsConnectors.js";

const NAV_ICONS: Record<AdminPageId, IconType> = {
  connectors: Squares2X2Icon,
  "connector-detail": Squares2X2Icon,
  users: UsersIcon,
  tenants: BuildingOffice2Icon,
  registry: CubeIcon,
  instances: ServerStackIcon,
  roles: ShieldCheckIcon,
  audit: DocumentTextIcon,
  secrets: KeyIcon,
};

function LanyardLogo() {
  return (
    <img
      src="/brand/Lanyard_Icon_blue.svg"
      alt=""
      width={28}
      height={28}
      aria-hidden="true"
    />
  );
}

type OpsConsoleProps = {
  operator: OpsOperator;
  onLogout?: () => void;
};

let writingAdminHash = false;

function writeAdminHash(hash: string, mode: "push" | "replace") {
  if (window.location.hash === hash && mode === "replace") {
    return;
  }
  writingAdminHash = true;
  try {
    const url = new URL(window.location.href);
    url.hash = hash;
    if (mode === "push") {
      window.history.pushState(null, "", url.href);
    } else {
      window.history.replaceState(null, "", url.href);
    }
    if (window.location.hash !== hash) {
      window.location.hash = hash;
    }
  } finally {
    writingAdminHash = false;
  }
}

function TenantChip({
  tenant,
  role,
  tenants,
  onSwitch,
}: {
  tenant: OpsTenantSummary;
  role: "superadmin" | "tenant_admin";
  tenants: OpsTenantSummary[];
  onSwitch?: (tenant: OpsTenantSummary) => void;
}) {
  const canSwitch = role === "superadmin" && Boolean(onSwitch) && tenants.length > 0;
  return (
    <div
      data-testid="admin-tenant-chip"
      style={{
        border: "1px solid var(--color-border)",
        borderRadius: 8,
        background: "var(--color-background-surface)",
        padding: "var(--spacing-2) var(--spacing-3)",
        margin: "0 var(--spacing-2)",
      }}
    >
      {canSwitch ? (
        <VStack gap={0}>
          <select
            aria-label="Selected tenant"
            data-testid="admin-tenant-switcher"
            value={tenant.tenant_slug}
            onChange={(event) => {
              const next = tenants.find(
                (row) => row.tenant_slug === event.target.value,
              );
              if (next) {
                onSwitch?.(next);
              }
            }}
          >
            {tenants.map((row) => (
              <option key={row.tenant_id} value={row.tenant_slug}>
                {row.display_name}
              </option>
            ))}
          </select>
          <Text type="supporting" color="secondary">
            selected tenant
          </Text>
        </VStack>
      ) : (
        <VStack gap={0}>
          <Text type="body" weight="semibold">
            {tenant.display_name}
          </Text>
          <Text type="supporting" color="secondary">
            {role === "tenant_admin" ? "your tenant" : "selected tenant"}
          </Text>
        </VStack>
      )}
    </div>
  );
}

export function OpsConsole({ operator, onLogout }: OpsConsoleProps) {
  const [context, setContext] = useState<OpsAdminContext | null>(null);
  const [contextError, setContextError] = useState<string | null>(null);
  const [page, setPage] = useState<AdminPageId>("tenants");
  const [selectedTenant, setSelectedTenant] = useState<OpsTenantSummary | null>(
    null,
  );
  const [tenants, setTenants] = useState<OpsTenantSummary[]>([]);
  const [openConnector, setOpenConnector] = useState<OpsConnectorId | null>(
    null,
  );
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  const tenantsRef = useRef(tenants);
  const selectedTenantRef = useRef(selectedTenant);
  const contextRef = useRef(context);
  tenantsRef.current = tenants;
  selectedTenantRef.current = selectedTenant;
  contextRef.current = context;

  function knownSlugs(
    role: OpsAdminContext["role"],
    tenantList: OpsTenantSummary[],
    tenantAdminTenant?: OpsTenantSummary,
  ): Set<string> {
    if (role === "tenant_admin" && tenantAdminTenant) {
      return new Set([tenantAdminTenant.tenant_slug]);
    }
    return new Set(tenantList.map((row) => row.tenant_slug));
  }

  function applyLocation(
    location: AdminShellLocation,
    tenantList: OpsTenantSummary[],
    options: { keepTenantOnRegistry?: boolean } = {},
  ) {
    setPage(location.page);
    setOpenConnector(location.connectorId);
    setOpenUserId(location.page === "users" ? location.userId : null);
    if (location.page === "tenants") {
      setSelectedTenant(null);
      return;
    }
    if (location.tenantSlug) {
      const match =
        tenantList.find((row) => row.tenant_slug === location.tenantSlug) ??
        (contextRef.current?.role === "tenant_admin"
          ? contextRef.current.tenant
          : null);
      if (match) {
        setSelectedTenant(match);
      }
      return;
    }
    if (location.page === "registry" && options.keepTenantOnRegistry) {
      return;
    }
  }

  function hashFor(
    nextPage: AdminPageId,
    tenant: OpsTenantSummary | null,
    detail?: AdminHashDetail,
  ): string {
    return adminHashFor(
      nextPage,
      nextPage === "tenants" || nextPage === "registry"
        ? null
        : (tenant?.tenant_slug ?? null),
      detail,
    );
  }

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await fetchOpsAdminContext();
        if (cancelled) {
          return;
        }
        setContextError(null);

        let tenantList: OpsTenantSummary[] = [];
        if (next.role === "superadmin") {
          try {
            tenantList = await fetchOpsTenants();
          } catch {
            tenantList = [];
          }
        }
        if (cancelled) {
          return;
        }
        setTenants(tenantList);

        const parsed = parseAdminHash(window.location.hash);
        const location = resolveAdminLocation({
          parsed,
          role: next.role,
          knownTenantSlugs: knownSlugs(
            next.role,
            tenantList,
            next.role === "tenant_admin" ? next.tenant : undefined,
          ),
        });
        contextRef.current = next;
        applyLocation(location, tenantList);
        const resolvedTenant =
          location.tenantSlug
            ? tenantList.find((row) => row.tenant_slug === location.tenantSlug) ??
              (next.role === "tenant_admin" ? next.tenant : null)
            : next.role === "tenant_admin"
              ? next.tenant
              : null;
        if (next.role === "tenant_admin") {
          setSelectedTenant(next.tenant);
        }
        writeAdminHash(
          hashFor(location.page, resolvedTenant, {
            connectorId: location.connectorId,
            userId: location.userId,
          }),
          "replace",
        );
        setContext(next);
      } catch (err) {
        if (!cancelled) {
          setContextError(
            err instanceof Error ? err.message : "Admin context failed",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    function onHashChange() {
      if (writingAdminHash) {
        return;
      }
      const current = contextRef.current;
      if (!current) {
        return;
      }
      const tenantList = tenantsRef.current;
      const parsed = parseAdminHash(window.location.hash);
      const location = resolveAdminLocation({
        parsed,
        role: current.role,
        knownTenantSlugs: knownSlugs(
          current.role,
          tenantList,
          current.role === "tenant_admin" ? current.tenant : undefined,
        ),
      });
      applyLocation(location, tenantList, { keepTenantOnRegistry: true });
      if (current.role === "tenant_admin") {
        setSelectedTenant(current.tenant);
      }
      const tenant =
        location.tenantSlug
          ? tenantList.find((row) => row.tenant_slug === location.tenantSlug) ??
            (current.role === "tenant_admin" ? current.tenant : null)
          : location.page === "registry"
            ? selectedTenantRef.current
            : current.role === "tenant_admin"
              ? current.tenant
              : null;
      const canonical = hashFor(location.page, tenant, {
        connectorId: location.connectorId,
        userId: location.userId,
      });
      writeAdminHash(canonical, "replace");
    }
    window.addEventListener("hashchange", onHashChange);
    window.addEventListener("popstate", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
      window.removeEventListener("popstate", onHashChange);
    };
  }, []);

  const role = context?.role ?? "superadmin";
  const activeTenant =
    context?.role === "tenant_admin" ? context.tenant : selectedTenant;

  function navigate(next: AdminPageId) {
    if (next === "tenants") {
      setSelectedTenant(null);
      setOpenConnector(null);
      setOpenUserId(null);
      setPage("tenants");
      writeAdminHash("#/tenants", "push");
      return;
    }
    if (next === "registry") {
      setOpenConnector(null);
      setOpenUserId(null);
      setPage("registry");
      writeAdminHash("#/registry", "push");
      return;
    }
    setPage(next);
    if (next !== "connectors" && next !== "connector-detail") {
      setOpenConnector(null);
    }
    setOpenUserId(null);
    writeAdminHash(hashFor(next, activeTenant), "push");
  }

  function enterTenant(tenant: OpsTenantSummary) {
    setSelectedTenant(tenant);
    setOpenConnector(null);
    setOpenUserId(null);
    setPage("connectors");
    writeAdminHash(adminHashFor("connectors", tenant.tenant_slug), "push");
  }

  function switchTenant(tenant: OpsTenantSummary) {
    const nextPage = page === "connector-detail" ? "connectors" : page;
    setSelectedTenant(tenant);
    setOpenConnector(null);
    setOpenUserId(null);
    setPage(nextPage);
    writeAdminHash(hashFor(nextPage, tenant), "push");
  }

  async function handleLogout() {
    try {
      await logoutOps();
    } finally {
      onLogout?.();
    }
  }

  if (contextError) {
    return (
      <div style={{ height: "100dvh", padding: "var(--spacing-6)" }}>
        <VStack gap={3}>
          <Text type="body" weight="semibold">
            Admin context unavailable
          </Text>
          <Text type="body" color="secondary" data-testid="admin-context-error">
            {contextError}
          </Text>
          <Button
            type="button"
            label="Sign out"
            variant="secondary"
            size="sm"
            onClick={() => {
              void handleLogout();
            }}
          />
        </VStack>
      </div>
    );
  }

  if (!context) {
    return (
      <div style={{ height: "100dvh" }}>
        <AppShell
          contentPadding={4}
          topNav={
            <TopNav
              label="Lanyard Admin"
              heading={<TopNavHeading heading="Lanyard Admin" />}
            />
          }
        >
          <Spinner label="Loading admin context…" />
        </AppShell>
      </div>
    );
  }

  const sections = sidenavSections({ role, hasTenant: activeTenant !== null });
  const showChip = activeTenant !== null && page !== "registry";

  function renderPage() {
    switch (page) {
      case "connectors":
        return activeTenant ? (
          <OpsConnectorsPage
            tenant={activeTenant}
            onOpenConnector={(connectorId) => {
              setOpenConnector(connectorId);
              setPage("connector-detail");
              writeAdminHash(
                adminHashFor("connector-detail", activeTenant.tenant_slug, {
                  connectorId,
                }),
                "push",
              );
            }}
          />
        ) : null;
      case "connector-detail":
        return activeTenant && openConnector ? (
          <OpsConnectorDetailPage
            tenant={activeTenant}
            connectorId={openConnector}
            onBack={() => {
              setOpenConnector(null);
              setPage("connectors");
              writeAdminHash(
                adminHashFor("connectors", activeTenant.tenant_slug),
                "push",
              );
            }}
          />
        ) : null;
      case "users":
        return activeTenant ? (
          <OpsUsersPage
            tenant={activeTenant}
            userId={openUserId}
            onOpenUser={(nextUserId) => {
              setOpenUserId(nextUserId);
              writeAdminHash(
                adminHashFor("users", activeTenant.tenant_slug, {
                  userId: nextUserId,
                }),
                "push",
              );
            }}
            onBack={() => {
              setOpenUserId(null);
              writeAdminHash(
                adminHashFor("users", activeTenant.tenant_slug),
                "push",
              );
            }}
          />
        ) : null;
      case "tenants":
        return (
          <OpsTenantsPage
            selectedTenantId={activeTenant?.tenant_id ?? null}
            onSelectTenant={enterTenant}
          />
        );
      case "registry":
        return <OpsConnectorRegistryPage />;
      case "instances":
        return activeTenant ? (
          <OpsInstancesPage tenant={activeTenant} />
        ) : null;
      case "roles":
        return activeTenant ? <OpsRolesPage tenant={activeTenant} /> : null;
      case "audit":
        return activeTenant ? <OpsAuditPage tenant={activeTenant} /> : null;
      case "secrets":
        return activeTenant ? <OpsSecretsPage tenant={activeTenant} /> : null;
      default: {
        const _exhaustive: never = page;
        return _exhaustive;
      }
    }
  }

  function renderNavItem(navItem: AdminNavItem) {
    const isSelected =
      navItem.page === page ||
      (page === "connector-detail" && navItem.page === "connectors");
    return (
      <SideNavItem
        key={navItem.page}
        label={navItem.label}
        icon={NAV_ICONS[navItem.page]}
        isSelected={isSelected}
        data-testid={`admin-nav-${navItem.page}`}
        onClick={() => navigate(navItem.page)}
      />
    );
  }

  return (
    <div style={{ height: "100dvh" }}>
      <AppShell
        contentPadding={4}
        topNav={
          <TopNav
            label="Lanyard Admin"
            heading={<TopNavHeading heading={ADMIN_PAGE_LABELS[page]} />}
            endContent={
              <HStack gap={3} align="center">
                <Text type="body" color="secondary">
                  {operator.email}
                </Text>
                <Button
                  type="button"
                  label="Sign out"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void handleLogout();
                  }}
                />
              </HStack>
            }
          />
        }
        sideNav={
          <SideNav
            aria-label="Lanyard Admin sections"
            header={<SideNavHeading icon={<LanyardLogo />} heading="Lanyard Admin" />}
            topContent={
              showChip && activeTenant ? (
                <TenantChip
                  tenant={activeTenant}
                  role={role}
                  tenants={tenants}
                  onSwitch={role === "superadmin" ? switchTenant : undefined}
                />
              ) : null
            }
          >
            {sections.map((section, index) => (
              <SideNavSection
                key={section.title ?? `section-${index}`}
                title={section.title ?? "Main"}
                isHeaderHidden={section.title === null}
              >
                {section.items.map(renderNavItem)}
              </SideNavSection>
            ))}
          </SideNav>
        }
      >
        {renderPage()}
      </AppShell>
    </div>
  );
}
