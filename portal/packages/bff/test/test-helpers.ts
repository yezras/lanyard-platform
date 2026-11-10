import { ChatThreadStore } from "../src/chat-store.js";
import { FakeCognitoPasswordAuth } from "../src/cognito-fake.js";
import { ControlPlaneAuthClient } from "../src/control-plane-client.js";
import { createFixtureConnectorSource } from "../src/integrations-sh-fixture.js";
import { fixtureMcpInitializeProbe } from "../src/registry-snapshot.js";
import { RelayClient } from "../src/relay-client.js";
import { defaultSettingsSnapshotPath } from "../src/settings-snapshot.js";
import { createFixtureStagingStorageProvider } from "../src/staging/fixture-provider.js";
import { SessionStore } from "../src/session.js";
import { createFixtureVaultContentProvider } from "../src/vault/fixture-provider.js";
import { createFixtureVaultIndexProvider } from "../src/vault/fixture-index.js";
import type { BffBindings, TenantContext, TenantResolver } from "../src/types.js";

export function createTestBindings(
  tenants: Record<string, TenantContext>,
  overrides: Partial<BffBindings> = {},
): BffBindings {
  const tenantResolver: TenantResolver = {
    async resolveBySlug(slug: string) {
      return tenants[slug] ?? null;
    },
    async resolveById(id: string) {
      return Object.values(tenants).find((t) => t.tenant_id === id) ?? null;
    },
  };

  return {
    tenantResolver,
    devTenantSlug: undefined,
    authClient: new ControlPlaneAuthClient("http://control-plane.test"),
    cognito: new FakeCognitoPasswordAuth(),
    relayClient: new RelayClient(
      "http://relay.test",
      "test-relay-internal-token",
    ),
    chatThreads: new ChatThreadStore(),
    sessions: new SessionStore(),
    vaultContentProvider: createFixtureVaultContentProvider(),
    vaultIndexProvider: createFixtureVaultIndexProvider(),
    stagingStorageProvider: createFixtureStagingStorageProvider(),
    connectorSource: createFixtureConnectorSource(),
    registryCompileDeps: {
      probeMcpInitialize: fixtureMcpInitializeProbe,
    },
    settingsSnapshotPath: defaultSettingsSnapshotPath(),
    // Keep settings deterministic in tests (fixture + mock health).
    settingsPreferFixture: true,
    config: {
      sessionSecret: "test-session-secret",
      secureCookies: false,
      googleClientId: "test-google-client-id",
      googleRedirectPath: "/api/auth/google/callback",
      hubspotClientId: "test-hubspot-client-id",
      relayUrl: "http://relay.test",
      relayInternalToken: "test-relay-internal-token",
      harnessServiceToken: "test-harness-service-token",
      stagingMaxUploadBytes: 1024 * 1024,
    },
    ...overrides,
  };
}

export function parseSetCookie(header: string | null): Record<string, string> {
  if (!header) {
    return {};
  }

  const cookies: Record<string, string> = {};
  for (const part of header.split(/,(?=\s*[^;]+=)/)) {
    const [pair] = part.split(";");
    if (!pair) continue;
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    cookies[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
  }
  return cookies;
}

export function cookieHeader(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}