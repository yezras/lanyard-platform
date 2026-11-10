/**
 * Auth-free story for browser QA of NL cron create → Settings inventory refresh
 * (lp-uxy.4). Mounted with `?story=nl-cron-create-settings`.
 *
 * Query params:
 *   - `mode=create` (default) — features.cron true; simulate agent create
 *   - `mode=capability-off` — features.cron false + cron_manager unsupported
 *
 * Installs an in-browser fetch mock for settings.snapshot (and related GETs).
 * Click **Simulate agent cronjob create** to complete a `cronjob` tool event,
 * debounce-refresh inventory, and show the new job without a full page reload.
 * No live LA/Hermes pin or mocklab DNS required.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import type {
  SettingsHealthCheckResponse,
  SettingsSnapshot,
} from "../../api/types.js";
import { humanToolActivityLabel } from "../chat/chatToolCallMapper.js";
import {
  PortalHonestyProvider,
  type PortalHonestyContextValue,
} from "../honesty/index.js";

import {
  isInventoryMutatingToolEvent,
  SettingsSnapshotProvider,
  useSettingsSnapshot,
} from "./SettingsSnapshotContext.js";
import { SettingsView } from "./SettingsView.js";

const rootStyle: CSSProperties = {
  height: "100dvh",
  width: "100%",
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
};

const chromeStyle: CSSProperties = {
  flexShrink: 0,
  padding: "var(--spacing-3, 0.75rem) var(--spacing-4, 1rem)",
  borderBottom: "1px solid var(--border-primary, rgba(0,0,0,0.12))",
  background: "var(--bg-secondary, #f6f7f9)",
};

const bodyStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflow: "auto",
};

const NEW_JOB = {
  id: "daily-vault-index",
  name: "Daily vault index",
  schedule: "0 3 * * *",
  enabled: true,
  path: "cron/jobs.json",
  last_run_at: null as string | null,
  next_run_at: "2026-08-05T03:00:00.000Z",
};

/** Pre-existing row so capability-off mode still shows Crons nav + honesty notice. */
const EXISTING_JOB_CAPABILITY_OFF = {
  id: "la-vault-index",
  name: "LA vault index refresh",
  schedule: "0 4 * * *",
  enabled: true,
  path: "cron/jobs.json",
  last_run_at: "2026-08-04T04:00:00.000Z",
  next_run_at: "2026-08-05T04:00:00.000Z",
};

function storyMode(): "create" | "capability-off" {
  if (typeof window === "undefined") return "create";
  const mode = new URLSearchParams(window.location.search).get("mode");
  return mode === "capability-off" ? "capability-off" : "create";
}

function baseSnapshot(mode: "create" | "capability-off"): SettingsSnapshot {
  return {
    exported_at: "2026-08-04T12:00:00.000Z",
    hermes_home: null,
    source: "lanyard_agent",
    // Seed one skill so Tools Skills inventory paints a table (lp-lv9.6 harness).
    skills: [
      {
        id: "post-meeting-triage",
        name: "Post-meeting triage",
        enabled: true,
        path: "skills/crm/post-meeting-triage",
      },
    ],
    // capability-off: seed a job so snapshot still carries cron inventory for Agents.
    crons: mode === "capability-off" ? [EXISTING_JOB_CAPABILITY_OFF] : [],
    mcp_servers: [],
    models: [
      {
        provider: "xai",
        model: "grok-3",
        is_active: true,
        connected: true,
      },
    ],
    integrations: [],
    workflows: [],
  };
}

function healthResponse(): SettingsHealthCheckResponse {
  return {
    checked_at: "2026-08-04T12:00:00.000Z",
    integrations: [],
  };
}

type ProofWindow = Window & {
  __nlCronCreateProof?: {
    createSimulated: boolean;
    snapshotFetchCount: number;
    lastToolMutating: boolean | null;
    mode: "create" | "capability-off";
  };
};

function proofWindow(): ProofWindow | null {
  if (typeof window === "undefined") return null;
  return window as ProofWindow;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

let mockInstalled = false;

function installNlCronCreateProofFetchMock(mode: "create" | "capability-off"): void {
  // Re-bind mode on each mount (vitest reuses the module; keep fetch mock once).
  const win = proofWindow();
  if (!win) return;
  if (!win.__nlCronCreateProof) {
    win.__nlCronCreateProof = {
      createSimulated: false,
      snapshotFetchCount: 0,
      lastToolMutating: null,
      mode,
    };
  } else {
    win.__nlCronCreateProof.mode = mode;
    win.__nlCronCreateProof.createSimulated = false;
    win.__nlCronCreateProof.snapshotFetchCount = 0;
    win.__nlCronCreateProof.lastToolMutating = null;
  }

  if (mockInstalled) return;
  mockInstalled = true;

  const originalFetch = window.fetch.bind(window);

  window.fetch = async (input, init) => {
    const url = new URL(requestUrl(input), window.location.href);
    const path = url.pathname;
    const method =
      init?.method ??
      (typeof input !== "string" && !(input instanceof URL)
        ? input.method
        : "GET");

    if (path.endsWith("/api/settings/snapshot") && method.toUpperCase() === "GET") {
      const state = win.__nlCronCreateProof!;
      state.snapshotFetchCount += 1;
      const snap = baseSnapshot(state.mode);
      if (state.createSimulated) {
        const existing = snap.crons ?? [];
        const hasNew = existing.some((c) => c.id === NEW_JOB.id);
        snap.crons = hasNew ? existing : [...existing, NEW_JOB];
        snap.exported_at = new Date().toISOString();
      }
      return jsonResponse(snap);
    }

    if (path.endsWith("/api/connectors") && method.toUpperCase() === "GET") {
      return jsonResponse({ connectors: [] });
    }

    if (path.endsWith("/api/settings/health-check")) {
      return jsonResponse(healthResponse());
    }

    if (path.includes("/api/settings/content") || path.includes("/api/settings/list")) {
      return jsonResponse(
        { error: "No host home available for settings content", code: "no_host_home" },
        404,
      );
    }

    if (path.includes("/api/settings/crons/") && path.endsWith("/detail")) {
      return jsonResponse(
        { error: "No host home available for cron job detail", code: "no_host_home" },
        404,
      );
    }

    // PATCH cron enable/disable — accept no-op for story.
    if (path.includes("/api/settings/crons/") && method.toUpperCase() === "PATCH") {
      return jsonResponse({
        ok: true,
        cron: NEW_JOB,
      });
    }

    return originalFetch(input, init);
  };
}

function StoryChrome({ mode }: { mode: "create" | "capability-off" }) {
  const { scheduleInventoryRefresh, snapshot, isLoading } = useSettingsSnapshot();
  const [status, setStatus] = useState<string>(
    "Ready — simulate create; inventory job names update without Tools crons UI (lp-lv9.6).",
  );
  const cronNames = (snapshot?.crons ?? []).map((c) => c.name).join(", ") || "(none)";

  // lp-lv9.6: Tools has no Scheduled tasks section. Optional: open Skills so the
  // inventory rail is painted while cron inventory is proven via story chrome only.
  useEffect(() => {
    let attempts = 0;
    const id = window.setInterval(() => {
      attempts += 1;
      const btn = Array.from(document.querySelectorAll("button")).find((el) => {
        const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
        return label === "Connectors" || /^Connectors$/i.test(label);
      });
      if (btn) {
        btn.click();
        window.clearInterval(id);
      } else if (attempts > 40) {
        window.clearInterval(id);
      }
    }, 50);
    return () => window.clearInterval(id);
  }, []);

  const onSimulateCreate = useCallback(() => {
    const event = {
      type: "tool_progress" as const,
      tool_name: "cronjob",
      tool_status: "complete" as const,
      metadata: { action: "create", id: NEW_JOB.id },
    };
    const mutating = isInventoryMutatingToolEvent(event);
    const win = proofWindow();
    if (win?.__nlCronCreateProof) {
      win.__nlCronCreateProof.lastToolMutating = mutating;
      win.__nlCronCreateProof.createSimulated = true;
    }

    if (!mutating) {
      setStatus("FAIL: cronjob create not recognized as inventory mutator");
      return;
    }

    setStatus(
      `Tool complete (${humanToolActivityLabel("cron_create")}) → inventory refresh…`,
    );
    scheduleInventoryRefresh();

    window.setTimeout(() => {
      // Guard: vitest may tear down jsdom before this fires (unhandled "window is not defined").
      if (typeof globalThis.window === "undefined") return;
      try {
        setStatus(
          "Inventory refresh scheduled — job names chrome should list Daily vault index without reload (crons UI lives under Agents, not Tools).",
        );
      } catch {
        /* environment gone */
      }
    }, 80);
  }, [scheduleInventoryRefresh]);

  return (
    <div style={chromeStyle} data-testid="nl-cron-create-proof-chrome">
      <VStack gap={2} align="start">
        <Heading level={2}>NL cron create → inventory refresh (lp-uxy.4 / lp-lv9.6)</Heading>
        <Text type="supporting" color="secondary">
          Mode: <strong data-testid="nl-cron-create-mode">{mode}</strong>
          {" · "}
          Tool label create:{" "}
          <span data-testid="nl-cron-create-tool-label">
            {humanToolActivityLabel("cron_create")}
          </span>
          {" · "}
          Snapshot loading: {String(isLoading)}
          {" · "}
          Jobs: <span data-testid="nl-cron-create-job-names">{cronNames}</span>
        </Text>
        <HStack gap={2}>
          <Button
            label="Simulate agent cronjob create"
            variant="primary"
            size="sm"
            onClick={onSimulateCreate}
            data-testid="nl-cron-create-simulate"
          />
        </HStack>
        <Text type="supporting" data-testid="nl-cron-create-status">
          {status}
        </Text>
      </VStack>
    </div>
  );
}

export function NlCronCreateSettingsProofStory() {
  const mode = useMemo(() => storyMode(), []);
  installNlCronCreateProofFetchMock(mode);

  const honestyValue: PortalHonestyContextValue = useMemo(() => {
    if (mode === "capability-off") {
      return {
        brainRpcEnabled: true,
        isReady: true,
        ui: { affordances: { cron_manager: "unsupported" }, can: {} },
        backendCapabilities: {
          features: { cron: false },
          brain_rpc_methods: ["settings.snapshot", "settings.patch"],
          ui_affordances: { cron_manager: "unsupported" },
        },
      };
    }
    return {
      brainRpcEnabled: true,
      isReady: true,
      ui: { affordances: { cron_manager: "supported" }, can: {} },
      backendCapabilities: {
        features: { cron: true },
        brain_rpc_methods: [
          "settings.snapshot",
          "settings.patch",
          "cron.list",
          "cron.patch",
        ],
        ui_affordances: { cron_manager: "supported" },
      },
    };
  }, [mode]);

  return (
    <PortalHonestyProvider value={honestyValue}>
      <SettingsSnapshotProvider inventoryRefreshDebounceMs={50}>
        <div data-testid="nl-cron-create-settings-proof-story" style={rootStyle}>
          <StoryChrome mode={mode} />
          <div style={bodyStyle}>
            <SettingsView isActive />
          </div>
        </div>
      </SettingsSnapshotProvider>
    </PortalHonestyProvider>
  );
}
