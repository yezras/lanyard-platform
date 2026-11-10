import {
  forwardRef,
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import { useMediaQuery } from "@astryxdesign/core/hooks";
import { AppShell } from "@astryxdesign/core/AppShell";
import { Avatar } from "@astryxdesign/core/Avatar";
import { Button } from "@astryxdesign/core/Button";
import { EmptyState } from "@astryxdesign/core/EmptyState";
import { HoverCard } from "@astryxdesign/core/HoverCard";
import { HStack } from "@astryxdesign/core/HStack";
import { MobileNav } from "@astryxdesign/core/MobileNav";
import { Tab, TabList } from "@astryxdesign/core/TabList";
import { Text } from "@astryxdesign/core/Text";
import { TopNav, TopNavHeading } from "@astryxdesign/core/TopNav";
import { VStack } from "@astryxdesign/core/VStack";

import { logout } from "../api/auth.js";
import type { AuthUser } from "../api/types.js";
import { PortalHonestyProvider } from "../features/honesty/index.js";
import {
  ChatHistorySideNav,
  ChatThreadProvider,
} from "../features/projects/index.js";
import { ChatView } from "../features/chat/index.js";
import { SettingsSnapshotProvider } from "../features/settings/SettingsSnapshotContext.js";
import { SettingsView } from "../features/settings/SettingsView.js";
import { VaultDeepLinkProvider } from "../features/vault/VaultDeepLinkContext.js";
import { VaultView } from "../features/vault/VaultView.js";
import {
  portalViewFromPathname,
  type PortalView,
} from "./portalView.js";

export type { PortalView };

/** Tabs with migrated React feature views. Expand as feature beads land. */
export const MIGRATED_VIEWS = new Set<PortalView>(["chat", "settings", "vault"]);

const EMPTY_STATE_COPY: Record<PortalView, { title: string; description: string }> = {
  chat: {
    title: "Chat coming soon",
    description:
      "SSE chat, MCQ prompts, and file upload are being migrated to React + Astryx.",
  },
  vault: {
    title: "Vault coming soon",
    description:
      "Tree browser, document reader, and vault search are being migrated to React + Astryx.",
  },
  settings: {
    title: "Settings coming soon",
    description:
      "Snapshot and health launchpad are being migrated to React + Astryx.",
  },
};

const userChipStyle: CSSProperties = {
  border: "1px solid var(--color-border)",
  borderRadius: "var(--radius-container)",
  paddingBlock: "var(--spacing-1)",
  paddingInline: "var(--spacing-2)",
  background: "transparent",
  cursor: "pointer",
  font: "inherit",
  color: "inherit",
};

const keepAliveStyle = (active: boolean): CSSProperties => ({
  display: active ? "contents" : "none",
  height: "100%",
});

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

const UserChip = forwardRef<HTMLButtonElement, { email: string }>(
  function UserChip({ email }, ref) {
    return (
      <button
        ref={ref}
        type="button"
        style={userChipStyle}
        aria-label="Account menu"
      >
        <HStack gap={2} align="center">
          <Avatar name={email} size="xsmall" />
          <Text type="body" color="secondary">
            {email}
          </Text>
        </HStack>
      </button>
    );
  },
);

function KeepAlivePane({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  return (
    <div hidden={!active} style={keepAliveStyle(active)}>
      {children}
    </div>
  );
}

type PortalShellProps = {
  user: AuthUser;
  /** Called after logout so the app can re-resolve session (show AuthView). */
  onLogout?: () => void;
};

export function PortalShell({ user, onLogout }: PortalShellProps) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const search = useRouterState({ select: (s) => s.location.search });
  const activeView = portalViewFromPathname(pathname);
  const [isLoggingOut, setIsLoggingOut] = useState(false);
  /** Citation / shell deep-link path for Vault reader. */
  const [vaultDeepLinkPath, setVaultDeepLinkPath] = useState<string | null>(
    typeof search.path === "string" ? search.path : null,
  );
  /**
   * Monotonic key so re-clicking the same citation always re-triggers
   * VaultView's deep-link effect (React bails on identical path strings).
   */
  const [vaultDeepLinkKey, setVaultDeepLinkKey] = useState(0);
  const copy = EMPTY_STATE_COPY[activeView];
  const isMigrated = MIGRATED_VIEWS.has(activeView);
  const showChatHistory = activeView === "chat";
  const isMobileViewport = useMediaQuery("(max-width: 768px)");

  const openVaultPath = useCallback((path: string) => {
    const trimmed = path.trim();
    if (!trimmed) {
      return;
    }
    setVaultDeepLinkPath(trimmed);
    setVaultDeepLinkKey((key) => key + 1);
    void navigate({ to: "/vault", search: { path: trimmed } });
  }, [navigate]);

  const vaultDeepLink = useMemo(
    () => ({ deepLinkPath: vaultDeepLinkPath, openVaultPath }),
    [vaultDeepLinkPath, openVaultPath],
  );

  const handleSessionEnd = useCallback(async () => {
    if (isLoggingOut) {
      return;
    }
    setIsLoggingOut(true);
    try {
      await logout();
    } catch {
      // Still refresh session so a stale shell cannot linger after a failed call.
    } finally {
      setIsLoggingOut(false);
      onLogout?.();
    }
  }, [isLoggingOut, onLogout]);

  /**
   * Vault-tab deep-link (secondary escape hatch). Citation primary path now
   * opens the chat document pane (lp-5q6.14); this remains for "Open in Vault".
   */
  const handleCitationNavigate = useCallback(
    (path: string) => {
      openVaultPath(path);
    },
    [openVaultPath],
  );

  const handleVaultDeepLinkConsumed = useCallback(() => {
    setVaultDeepLinkPath(null);
  }, []);

  const profileCard = (
    <VStack gap={3} style={{ minWidth: 220, padding: "var(--spacing-1)" }}>
      <Text type="body" color="secondary">
        {user.email}
      </Text>
      <VStack gap={1}>
        <Button
          label="Settings"
          variant="ghost"
          size="sm"
          isDisabled={isLoggingOut}
          onClick={() => {
            void navigate({ to: "/settings" });
          }}
        />
        <Button
          label="Logout"
          variant="secondary"
          size="sm"
          isLoading={isLoggingOut}
          onClick={() => void handleSessionEnd()}
        />
        <Button
          label="Switch account"
          variant="ghost"
          size="sm"
          isDisabled={isLoggingOut}
          onClick={() => void handleSessionEnd()}
        />
      </VStack>
    </VStack>
  );

  return (
    <PortalHonestyProvider>
      <VaultDeepLinkProvider value={vaultDeepLink}>
        <SettingsSnapshotProvider>
          <ChatThreadProvider>
            <AppShell
              topNav={
                <TopNav
                  label="Lanyard Portal"
                  heading={
                    <TopNavHeading
                      logo={<LanyardLogo />}
                      heading="Lanyard Portal"
                    />
                  }
                  centerContent={
                    <TabList
                      value={activeView}
                      onChange={(value) => {
                        void navigate({
                          to: value === "vault" ? "/vault" : "/chat",
                        });
                      }}
                    >
                      <Tab value="chat" label="Agents" />
                      <Tab value="vault" label="Vault" />
                    </TabList>
                  }
                  endContent={
                    <HoverCard
                      placement="below"
                      alignment="end"
                      delay={0}
                      hideDelay={300}
                      hasHoverIndication={false}
                      content={profileCard}
                    >
                      <UserChip email={user.email} />
                    </HoverCard>
                  }
                />
              }
              // Always pass a sideNav node so AppShell's elevated content wrapper
              // structure stays stable. Toggling sideNav on/off remounts `children`
              // (layout tree shape changes) and would wipe keep-alive chat state.
              // Visually: chat history only when Chat is active (CSS-hidden otherwise).
              sideNav={
                <div
                  hidden={!showChatHistory}
                  style={keepAliveStyle(showChatHistory)}
                  data-portal-chat-history={
                    showChatHistory ? "visible" : "hidden"
                  }
                >
                  <ChatHistorySideNav />
                </div>
              }
              mobileNav={
                showChatHistory && isMobileViewport ? (
                  <MobileNav header="Agents">
                    <ChatHistorySideNav embedded />
                  </MobileNav>
                ) : undefined
              }
              contentPadding={
                activeView === "chat" || activeView === "vault" ? 0 : 4
              }
            >
              {MIGRATED_VIEWS.has("chat") ? (
                <KeepAlivePane active={activeView === "chat"}>
                  <ChatView
                    user={user}
                    isActive={activeView === "chat"}
                    onCitationNavigate={handleCitationNavigate}
                    onOpenInVault={openVaultPath}
                  />
                </KeepAlivePane>
              ) : null}
              {MIGRATED_VIEWS.has("vault") ? (
                <KeepAlivePane active={activeView === "vault"}>
                  <VaultView
                    deepLinkPath={vaultDeepLinkPath}
                    deepLinkKey={vaultDeepLinkKey}
                    onDeepLinkConsumed={handleVaultDeepLinkConsumed}
                  />
                </KeepAlivePane>
              ) : null}
              {MIGRATED_VIEWS.has("settings") ? (
                <KeepAlivePane active={activeView === "settings"}>
                  <SettingsView isActive={activeView === "settings"} />
                </KeepAlivePane>
              ) : null}
              {!isMigrated ? (
                <EmptyState title={copy.title} description={copy.description} />
              ) : null}
            </AppShell>
          </ChatThreadProvider>
        </SettingsSnapshotProvider>
      </VaultDeepLinkProvider>
    </PortalHonestyProvider>
  );
}
