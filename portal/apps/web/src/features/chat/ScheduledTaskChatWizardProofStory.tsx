/**
 * Auth-free story for chat interactive scheduled-task create wizard (lp-jzl.9.1).
 * Mounted with `?story=scheduled-task-chat-wizard`.
 *
 * Walks Portal MCQ bubbles (portal_event mcq → mcq_selection) via the pure
 * wizard state machine. On confirm, POSTs /api/settings/crons with structured
 * schedule from scheduleCodec (no raw cron from user) and refreshes Settings
 * inventory so the new task appears without reload.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import { createSettingsCron } from "../../api/settings.js";
import type {
  McqChoice,
  SettingsCron,
  SettingsHealthCheckResponse,
  SettingsSnapshot,
} from "../../api/types.js";
import type { ChatTimelineItem } from "../../hooks/useChatEvents.js";
import {
  PortalHonestyProvider,
  type PortalHonestyContextValue,
} from "../honesty/index.js";
import {
  SettingsSnapshotProvider,
  useSettingsSnapshot,
} from "../settings/SettingsSnapshotContext.js";
import { SettingsView } from "../settings/SettingsView.js";
import { humanizeSchedule } from "../settings/settingsFormat.js";

import { ChatTimeline } from "./ChatTimeline.js";
import {
  applyWizardMcqSelection,
  createScheduledTaskWizardSession,
  markWizardCreateFailed,
  markWizardCreateSucceeded,
  type ScheduledTaskWizardMcqPrompt,
  type ScheduledTaskWizardSession,
} from "./scheduledTaskChatWizard.js";

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

const splitStyle: CSSProperties = {
  flex: 1,
  minHeight: 0,
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) minmax(0, 1fr)",
  gap: 0,
};

const paneStyle: CSSProperties = {
  minHeight: 0,
  overflow: "auto",
  borderRight: "1px solid var(--border-primary, rgba(0,0,0,0.12))",
  padding: "var(--spacing-3, 0.75rem)",
};

const SESSION_ID = "proof1";

type ProofWindow = Window & {
  __scheduledTaskWizardProof?: {
    created: boolean;
    snapshotFetchCount: number;
    lastCreateBody: unknown;
    createPostCount: number;
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

function baseSnapshot(): SettingsSnapshot {
  return {
    exported_at: "2026-08-09T12:00:00.000Z",
    hermes_home: null,
    source: "lanyard_agent",
    // lp-jzl.9.2: same skills inventory as Settings (optional attach on create).
    skills: [
      {
        id: "post-meeting-triage",
        name: "Post-meeting triage",
        enabled: true,
        path: "skills/crm/post-meeting-triage",
      },
      {
        id: "draft-reply",
        name: "Draft reply",
        enabled: true,
        path: "skills/email/draft-reply",
      },
    ],
    crons: [],
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
    checked_at: "2026-08-09T12:00:00.000Z",
    integrations: [],
  };
}

/** In-memory jobs written by POST /api/settings/crons mock. */
let mockJobs: SettingsCron[] = [];
let mockInstalled = false;

function installWizardProofFetchMock(): void {
  const win = proofWindow();
  if (!win) return;
  win.__scheduledTaskWizardProof = {
    created: false,
    snapshotFetchCount: 0,
    lastCreateBody: null,
    createPostCount: 0,
  };
  mockJobs = [];

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
    const methodUp = method.toUpperCase();

    if (path.endsWith("/api/auth/csrf")) {
      return jsonResponse({ csrf_token: "story-csrf-token" });
    }

    if (path.endsWith("/api/settings/snapshot") && methodUp === "GET") {
      const state = win.__scheduledTaskWizardProof!;
      state.snapshotFetchCount += 1;
      const snap = baseSnapshot();
      snap.crons = [...mockJobs];
      snap.exported_at = new Date().toISOString();
      return jsonResponse(snap);
    }

    if (path.endsWith("/api/connectors") && methodUp === "GET") {
      return jsonResponse({ connectors: [] });
    }

    if (path.endsWith("/api/settings/health-check")) {
      return jsonResponse(healthResponse());
    }

    if (path.endsWith("/api/settings/crons") && methodUp === "POST") {
      const state = win.__scheduledTaskWizardProof!;
      state.createPostCount += 1;
      let body: Record<string, unknown> = {};
      try {
        const raw = init?.body;
        if (typeof raw === "string") body = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        body = {};
      }
      state.lastCreateBody = body;

      const name =
        typeof body.name === "string" && body.name.trim()
          ? body.name.trim()
          : "Untitled";
      const prompt =
        (typeof body.prompt === "string" && body.prompt) ||
        (typeof body.instructions === "string" && body.instructions) ||
        "";
      const schedule = body.schedule;
      // Prefer structured display for list cell; fall back to string.
      let scheduleField: SettingsCron["schedule"] = "Custom schedule";
      if (typeof schedule === "string" && schedule.trim()) {
        scheduleField = schedule.trim();
      } else if (schedule && typeof schedule === "object") {
        const s = schedule as {
          display?: string;
          expr?: string;
          kind?: string;
          timezone?: string;
        };
        scheduleField = {
          kind: s.kind ?? "cron",
          expr: s.expr,
          display: s.display,
          timezone: s.timezone,
        };
      }

      const id =
        (typeof body.id === "string" && body.id.trim()) ||
        (typeof body.cron_id === "string" && body.cron_id.trim()) ||
        `st-proof-${mockJobs.length + 1}`;

      const skills = Array.isArray(body.skills)
        ? body.skills.filter(
            (s): s is string => typeof s === "string" && s.trim().length > 0,
          )
        : undefined;

      const cron: SettingsCron = {
        id,
        name,
        schedule: scheduleField,
        enabled: body.enabled !== false,
        path: "cron/jobs.json",
        prompt: typeof prompt === "string" ? prompt : undefined,
        ...(skills?.length ? { skills } : {}),
        state: "scheduled",
        last_run_at: null,
        next_run_at: null,
        last_status: null,
      };
      mockJobs = [...mockJobs.filter((j) => j.id !== id), cron];
      state.created = true;
      return jsonResponse({ cron, source: "lanyard_agent" }, 201);
    }

    if (path.includes("/api/settings/content") || path.includes("/api/settings/list")) {
      return jsonResponse(
        {
          error: "No host home available for settings content",
          code: "no_host_home",
        },
        404,
      );
    }

    if (path.includes("/api/settings/crons/") && path.endsWith("/detail")) {
      return jsonResponse(
        {
          error: "No host home available for cron job detail",
          code: "no_host_home",
        },
        404,
      );
    }

    if (path.includes("/api/settings/crons/") && methodUp === "PATCH") {
      return jsonResponse({
        cron: mockJobs[0] ?? {
          id: "noop",
          name: "noop",
          schedule: "—",
          enabled: true,
        },
        source: "lanyard_agent",
      });
    }

    // Chat MCQ post is not used in this offline story (wizard is local).
    if (path.includes("/api/chat/") && methodUp === "POST") {
      return jsonResponse({ ok: true });
    }

    return originalFetch(input, init);
  };
}

function timelineFromMcq(
  items: ChatTimelineItem[],
  prompt: ScheduledTaskWizardMcqPrompt,
  messageId: string,
): ChatTimelineItem[] {
  // Disable prior MCQs
  const disabled = items.map((item) =>
    item.type === "mcq" ? { ...item, disabled: true } : item,
  );
  return [
    ...disabled,
    {
      type: "mcq",
      mcqId: prompt.mcq_id,
      messageId,
      content: prompt.content,
      choices: prompt.choices,
      selectedChoiceId: null,
      disabled: false,
    },
  ];
}

function appendUser(
  items: ChatTimelineItem[],
  content: string,
  id: string,
): ChatTimelineItem[] {
  return [
    ...items.map((item) =>
      item.type === "mcq" ? { ...item, disabled: true } : item,
    ),
    {
      type: "user",
      id,
      content,
    },
  ];
}

function appendAssistant(
  items: ChatTimelineItem[],
  content: string,
  id: string,
): ChatTimelineItem[] {
  return [
    ...items,
    {
      type: "assistant_turn",
      id,
      segments: [],
      toolCalls: [],
      content,
      isStreaming: false,
      citations: [],
    },
  ];
}

function WizardChrome({
  session,
  onRestart,
}: {
  session: ScheduledTaskWizardSession;
  onRestart: () => void;
}) {
  const { snapshot, isLoading, scheduleInventoryRefresh } =
    useSettingsSnapshot();
  const cronNames =
    (snapshot?.crons ?? []).map((c) => c.name).join(", ") || "(none)";
  const scheduleLabels = (snapshot?.crons ?? [])
    .map((c) => humanizeSchedule(c.schedule))
    .join(" · ");

  // lp-lv9.6: Tools has no Scheduled tasks section. Open Skills so the inventory
  // rail paints; cron inventory is proven via story chrome job-names probe.
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

  return (
    <div style={chromeStyle} data-testid="st-wizard-proof-chrome">
      <VStack gap={2} align="start">
        <Heading level={2}>
          Scheduled task chat wizard (lp-jzl.9.1 / lp-lv9.6)
        </Heading>
        <Text type="supporting" color="secondary">
          Step:{" "}
          <strong data-testid="st-wizard-step">{session.step}</strong>
          {" · "}
          Snapshot loading: {String(isLoading)}
          {" · "}
          Jobs:{" "}
          <span data-testid="st-wizard-job-names">{cronNames}</span>
          {scheduleLabels ? (
            <>
              {" · "}
              Schedules:{" "}
              <span data-testid="st-wizard-job-schedules">{scheduleLabels}</span>
            </>
          ) : null}
        </Text>
        <Text type="supporting" data-testid="st-wizard-status">
          {session.statusMessage}
        </Text>
        <HStack gap={2}>
          <Button
            label="Restart wizard"
            variant="secondary"
            size="sm"
            onClick={onRestart}
            data-testid="st-wizard-restart"
          />
          <Button
            label="Refresh inventory"
            variant="secondary"
            size="sm"
            onClick={() => scheduleInventoryRefresh()}
            data-testid="st-wizard-refresh-inventory"
          />
        </HStack>
      </VStack>
    </div>
  );
}

function WizardBody() {
  const { scheduleInventoryRefresh, snapshot } = useSettingsSnapshot();
  const skillInventory = snapshot?.skills ?? baseSnapshot().skills;
  const [seq, setSeq] = useState(0);
  const boot = useMemo(
    () =>
      createScheduledTaskWizardSession({
        sessionId: SESSION_ID,
        defaultTimezone: "America/New_York",
        skillInventory,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart via key/seq
    [seq],
  );
  const [session, setSession] = useState<ScheduledTaskWizardSession>(
    () => boot.session,
  );
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [items, setItems] = useState<ChatTimelineItem[]>(() => {
    if (!boot.firstMcq) return [];
    return timelineFromMcq(
      [
        {
          type: "assistant_turn",
          id: "intro",
          segments: [],
          toolCalls: [],
          content:
            "I'll help you create a **scheduled task** with interactive steps — no cron expressions needed.",
          isStreaming: false,
          citations: [],
        },
      ],
      boot.firstMcq,
      `msg-${boot.firstMcq.mcq_id}`,
    );
  });
  const [busy, setBusy] = useState(false);

  const restart = useCallback(() => {
    setSeq((n) => n + 1);
  }, []);

  // Re-seed when seq changes
  useEffect(() => {
    const next = createScheduledTaskWizardSession({
      sessionId: SESSION_ID,
      defaultTimezone: "America/New_York",
      skillInventory: skillInventory ?? baseSnapshot().skills,
    });
    setSession(next.session);
    if (next.firstMcq) {
      setItems(
        timelineFromMcq(
          [
            {
              type: "assistant_turn",
              id: `intro-${seq}`,
              segments: [],
              toolCalls: [],
              content:
                "I'll help you create a **scheduled task** with interactive steps — no cron expressions needed.",
              isStreaming: false,
              citations: [],
            },
          ],
          next.firstMcq,
          `msg-${next.firstMcq.mcq_id}-${seq}`,
        ),
      );
    } else {
      setItems([]);
    }
  }, [seq]);

  const handleMcqSelect = useCallback(
    async (input: {
      mcqId: string;
      choice: McqChoice;
      promptMessageId?: string;
    }) => {
      if (busy) return;
      setBusy(true);
      try {
        // Mark selection on timeline
        setItems((prev) => {
          const withSelect = prev.map((item) => {
            if (item.type === "mcq" && item.mcqId === input.mcqId) {
              return {
                ...item,
                selectedChoiceId: input.choice.id,
                disabled: true,
              };
            }
            return item;
          });
          return appendUser(
            withSelect,
            input.choice.label,
            `user-${input.mcqId}-${input.choice.id}`,
          );
        });

        const result = applyWizardMcqSelection(sessionRef.current, {
          mcq_id: input.mcqId,
          choice_id: input.choice.id,
          choice_label: input.choice.label,
        });

        if (!result.ok) {
          setSession(result.session);
          setItems((prev) =>
            appendAssistant(
              prev,
              result.error,
              `err-${Date.now()}`,
            ),
          );
          return;
        }

        let nextSession = result.session;

        if (result.shouldCreate && result.session.createBody) {
          try {
            const created = await createSettingsCron(result.session.createBody);
            nextSession = markWizardCreateSucceeded(
              result.session,
              created.cron.id,
            );
            setItems((prev) =>
              appendAssistant(
                prev,
                `Created scheduled task **${created.cron.name}** (${humanizeSchedule(created.cron.schedule)}). It is in the scheduled-task inventory (Agents → Scheduled Tasks; not Tools).`,
                `ok-${created.cron.id}`,
              ),
            );
            scheduleInventoryRefresh();
          } catch (err) {
            const message =
              err instanceof Error ? err.message : "Create failed";
            nextSession = markWizardCreateFailed(result.session, message);
            setItems((prev) => {
              let next = appendAssistant(
                prev,
                `Create failed: ${message}`,
                `fail-${Date.now()}`,
              );
              // Re-emit confirm chips for retry / edit / cancel.
              if (nextSession.activeMcq) {
                next = timelineFromMcq(
                  next,
                  nextSession.activeMcq,
                  `msg-${nextSession.activeMcq.mcq_id}-retry-${next.length}`,
                );
              }
              return next;
            });
          }
        } else if (result.nextMcq) {
          // Unique message id even when mcq_id is stable (skills multi-select chain).
          setItems((prev) =>
            timelineFromMcq(
              prev,
              result.nextMcq!,
              `msg-${result.nextMcq!.mcq_id}-${prev.length}`,
            ),
          );
        } else if (result.session.step === "cancelled") {
          setItems((prev) =>
            appendAssistant(
              prev,
              "Cancelled — no scheduled task created.",
              `cancel-${Date.now()}`,
            ),
          );
        } else if (
          result.session.step === "instructions_text" ||
          result.session.step === "days_custom" ||
          result.session.step === "time_custom" ||
          // Timezone free-text after MCQ "other" (activeMcq cleared).
          (result.session.step === "timezone" && !result.session.activeMcq)
        ) {
          setItems((prev) =>
            appendAssistant(
              prev,
              result.session.statusMessage,
              `text-prompt-${result.session.step}-${prev.length}`,
            ),
          );
        }

        setSession(nextSession);
      } finally {
        setBusy(false);
      }
    },
    [busy, scheduleInventoryRefresh],
  );

  return (
    <>
      <WizardChrome session={session} onRestart={restart} />
      <div style={splitStyle} data-testid="st-wizard-split">
        <div style={paneStyle} data-testid="st-wizard-chat-pane">
          <Heading level={3}>Chat</Heading>
          <ChatTimeline
            items={items}
            onMcqSelect={(input) => void handleMcqSelect(input)}
          />
        </div>
        <div style={{ ...paneStyle, borderRight: "none" }} data-testid="st-wizard-settings-pane">
          <SettingsView isActive />
        </div>
      </div>
    </>
  );
}

export function ScheduledTaskChatWizardProofStory() {
  installWizardProofFetchMock();

  const honestyValue: PortalHonestyContextValue = useMemo(
    () => ({
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
          "cron.create",
          "cron.update",
        ],
        ui_affordances: { cron_manager: "supported" },
      },
    }),
    [],
  );

  return (
    <PortalHonestyProvider value={honestyValue}>
      <SettingsSnapshotProvider inventoryRefreshDebounceMs={50}>
        <div data-testid="st-wizard-proof-story" style={rootStyle}>
          <WizardBody />
        </div>
      </SettingsSnapshotProvider>
    </PortalHonestyProvider>
  );
}
