/**
 * Auth-free story for chat interactive workflow create wizard (lp-khq.8 / .12.1).
 * Mounted with `?story=workflow-chat-wizard`.
 *
 * Walks Portal MCQ + free-text NL steps (plain language; no IR/JSON jargon).
 * On confirm, simulates host save into settings.snapshot.workflows (agent tool
 * contract is exercised in unit tests via formatWorkflowCreateAgentRequest;
 * live ChatView sends that request to the agent workflow tool).
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
} from "react";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import type {
  McqChoice,
  SettingsHealthCheckResponse,
  SettingsSnapshot,
  SettingsWorkflow,
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

import { ChatTimeline } from "./ChatTimeline.js";
import {
  applyWorkflowWizardMcqSelection,
  applyWorkflowWizardTextInput,
  createWorkflowWizardSession,
  formatWorkflowCreateAgentRequest,
  markWorkflowWizardCreateFailed,
  markWorkflowWizardCreateSucceeded,
  workflowWizardStepNeedsFreeText,
  type WorkflowCreateBody,
  type WorkflowWizardMcqPrompt,
  type WorkflowWizardSession,
} from "./workflowChatWizard.js";

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

const SESSION_ID = "wfproof1";

type ProofWindow = Window & {
  __workflowWizardProof?: {
    created: boolean;
    snapshotFetchCount: number;
    lastCreateBody: unknown;
    createPostCount: number;
    lastAgentRequest: string | null;
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
    exported_at: "2026-08-13T12:00:00.000Z",
    hermes_home: null,
    source: "lanyard_agent",
    skills: [],
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
    checked_at: "2026-08-13T12:00:00.000Z",
    integrations: [],
  };
}

/** In-memory workflow inventory written by mock create. */
let mockWorkflows: SettingsWorkflow[] = [];
let mockInstalled = false;

/**
 * Simulate host workflow create (agent tool action=create) for the offline story.
 * Live ChatView sends formatWorkflowCreateAgentRequest via chat instead.
 */
function mockHostCreateWorkflow(body: WorkflowCreateBody): SettingsWorkflow {
  const id = body.name;
  const row: SettingsWorkflow = {
    id,
    name: id,
    path: `.lanyard/workflows/${id}.json`,
    description: body.description,
    enabled: true,
    updated_at: new Date().toISOString(),
  };
  mockWorkflows = [...mockWorkflows.filter((w) => w.id !== id), row];
  return row;
}

function installWorkflowWizardProofFetchMock(): void {
  const win = proofWindow();
  if (!win) return;
  win.__workflowWizardProof = {
    created: false,
    snapshotFetchCount: 0,
    lastCreateBody: null,
    createPostCount: 0,
    lastAgentRequest: null,
  };
  mockWorkflows = [];

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
      const state = win.__workflowWizardProof!;
      state.snapshotFetchCount += 1;
      const snap = baseSnapshot();
      snap.workflows = [...mockWorkflows];
      snap.exported_at = new Date().toISOString();
      return jsonResponse(snap);
    }

    if (path.endsWith("/api/connectors") && methodUp === "GET") {
      return jsonResponse({ connectors: [] });
    }

    if (path.endsWith("/api/settings/health-check")) {
      return jsonResponse(healthResponse());
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

    // Chat POST unused for local MCQ steps; create uses mockHostCreateWorkflow.
    if (path.includes("/api/chat/") && methodUp === "POST") {
      return jsonResponse({ ok: true });
    }

    return originalFetch(input, init);
  };
}

function timelineFromMcq(
  items: ChatTimelineItem[],
  prompt: WorkflowWizardMcqPrompt,
  messageId: string,
): ChatTimelineItem[] {
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
  session: WorkflowWizardSession;
  onRestart: () => void;
}) {
  const { snapshot, isLoading, scheduleInventoryRefresh } =
    useSettingsSnapshot();
  const workflowNames =
    (snapshot?.workflows ?? []).map((w) => w.name).join(", ") || "(none)";

  // Open Workflows section in Settings rail so inventory paints.
  useEffect(() => {
    let attempts = 0;
    const id = window.setInterval(() => {
      attempts += 1;
      const btn = Array.from(document.querySelectorAll("button")).find((el) => {
        const label = (el.getAttribute("aria-label") ?? el.textContent ?? "").trim();
        return label === "Workflows" || /^Workflows$/i.test(label);
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
    <div style={chromeStyle} data-testid="wf-wizard-proof-chrome">
      <VStack gap={2} align="start">
        <Heading level={2}>Workflow chat wizard (lp-khq.8)</Heading>
        <Text type="supporting" color="secondary">
          Step:{" "}
          <strong data-testid="wf-wizard-step">{session.step}</strong>
          {" · "}
          Mode: {session.mode}
          {" · "}
          Snapshot loading: {String(isLoading)}
          {" · "}
          Workflows:{" "}
          <span data-testid="wf-wizard-workflow-names">{workflowNames}</span>
        </Text>
        <Text type="supporting" data-testid="wf-wizard-status">
          {session.statusMessage}
        </Text>
        <HStack gap={2}>
          <Button
            label="Restart wizard"
            variant="secondary"
            size="sm"
            onClick={onRestart}
            data-testid="wf-wizard-restart"
          />
          <Button
            label="Refresh inventory"
            variant="secondary"
            size="sm"
            onClick={() => scheduleInventoryRefresh()}
            data-testid="wf-wizard-refresh-inventory"
          />
        </HStack>
      </VStack>
    </div>
  );
}

function FreeTextComposer({
  disabled,
  onSubmit,
}: {
  disabled: boolean;
  onSubmit: (text: string) => void;
}) {
  const [value, setValue] = useState("");
  return (
    <form
      data-testid="wf-wizard-free-text"
      onSubmit={(e: FormEvent) => {
        e.preventDefault();
        const t = value.trim();
        if (!t || disabled) return;
        onSubmit(t);
        setValue("");
      }}
      style={{
        display: "flex",
        gap: "0.5rem",
        marginTop: "0.75rem",
        alignItems: "flex-end",
      }}
    >
      <textarea
        data-testid="wf-wizard-free-text-input"
        aria-label="Workflow wizard free text"
        value={value}
        disabled={disabled}
        rows={3}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Describe the workflow in plain language…"
        style={{
          flex: 1,
          minWidth: 0,
          padding: "0.5rem 0.75rem",
          borderRadius: 6,
          border: "1px solid var(--border-primary, rgba(0,0,0,0.16))",
          resize: "vertical",
          font: "inherit",
        }}
      />
      <Button
        label="Send"
        size="sm"
        isDisabled={disabled || !value.trim()}
        data-testid="wf-wizard-free-text-send"
        onClick={() => {
          const t = value.trim();
          if (!t || disabled) return;
          onSubmit(t);
          setValue("");
        }}
      />
    </form>
  );
}

function WizardBody() {
  const { scheduleInventoryRefresh } = useSettingsSnapshot();
  const [seq, setSeq] = useState(0);
  const boot = useMemo(
    () =>
      createWorkflowWizardSession({
        sessionId: SESSION_ID,
        mode: "guided",
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restart via key/seq
    [seq],
  );
  const [session, setSession] = useState<WorkflowWizardSession>(
    () => boot.session,
  );
  const sessionRef = useRef(session);
  sessionRef.current = session;
  const [items, setItems] = useState<ChatTimelineItem[]>(() => {
    const intro: ChatTimelineItem = {
      type: "assistant_turn",
      id: "intro",
      segments: [],
      toolCalls: [],
      content:
        "I'll help you create a **workflow**. Describe what it should do in plain language — I'll turn that into steps for you.",
      isStreaming: false,
      citations: [],
    };
    if (!boot.firstMcq) return [intro];
    return timelineFromMcq([intro], boot.firstMcq, `msg-${boot.firstMcq.mcq_id}`);
  });
  const [busy, setBusy] = useState(false);

  const restart = useCallback(() => {
    setSeq((n) => n + 1);
  }, []);

  useEffect(() => {
    const next = createWorkflowWizardSession({
      sessionId: SESSION_ID,
      mode: "guided",
    });
    setSession(next.session);
    const intro: ChatTimelineItem = {
      type: "assistant_turn",
      id: `intro-${seq}`,
      segments: [],
      toolCalls: [],
      content:
        "I'll help you create a **workflow**. Describe what it should do in plain language — I'll turn that into steps for you.",
      isStreaming: false,
      citations: [],
    };
    if (next.firstMcq) {
      setItems(
        timelineFromMcq(intro ? [intro] : [], next.firstMcq, `msg-${next.firstMcq.mcq_id}-${seq}`),
      );
    } else {
      setItems([intro]);
    }
  }, [seq]);

  const applyResult = useCallback(
    async (result: ReturnType<typeof applyWorkflowWizardMcqSelection>) => {
      if (!result.ok) {
        setSession(result.session);
        setItems((prev) =>
          appendAssistant(prev, result.error, `err-${Date.now()}`),
        );
        return;
      }

      let nextSession = result.session;

      if (result.shouldCreate && result.session.createBody) {
        const body = result.session.createBody;
        const win = proofWindow();
        if (win?.__workflowWizardProof) {
          win.__workflowWizardProof.createPostCount += 1;
          win.__workflowWizardProof.lastCreateBody = body;
          win.__workflowWizardProof.lastAgentRequest =
            formatWorkflowCreateAgentRequest(body);
        }
        try {
          // Mock host create + inventory upsert (parity with live confirm path).
          const created = mockHostCreateWorkflow(body);
          if (win?.__workflowWizardProof) {
            win.__workflowWizardProof.created = true;
          }
          nextSession = markWorkflowWizardCreateSucceeded(
            result.session,
            created.name,
          );
          setItems((prev) =>
            appendAssistant(
              prev,
              `Created **${created.name}**. It is listed under **Tools → Workflows** and available via \`$ ${created.name}\`. Type \`$ ${created.name}\` or ask me to launch it when you want a run.`,
              `ok-${created.id}`,
            ),
          );
          // Host confirmed save → force inventory refresh (lp-khq.12.2).
          scheduleInventoryRefresh();
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Create failed";
          nextSession = markWorkflowWizardCreateFailed(result.session, message);
          setItems((prev) => {
            let next = appendAssistant(
              prev,
              `Create failed: ${message}`,
              `fail-${Date.now()}`,
            );
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
            "Cancelled — no workflow created.",
            `cancel-${Date.now()}`,
          ),
        );
      } else if (
        workflowWizardStepNeedsFreeText(
          result.session.step,
          result.session.activeMcq,
        )
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
    },
    [scheduleInventoryRefresh],
  );

  const handleMcqSelect = useCallback(
    async (input: {
      mcqId: string;
      choice: McqChoice;
      promptMessageId?: string;
    }) => {
      if (busy) return;
      setBusy(true);
      try {
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

        const result = applyWorkflowWizardMcqSelection(sessionRef.current, {
          mcq_id: input.mcqId,
          choice_id: input.choice.id,
          choice_label: input.choice.label,
        });
        await applyResult(result);
      } finally {
        setBusy(false);
      }
    },
    [applyResult, busy],
  );

  const handleFreeText = useCallback(
    async (text: string) => {
      if (busy) return;
      setBusy(true);
      try {
        setItems((prev) =>
          appendUser(prev, text, `user-text-${Date.now()}`),
        );
        const result = applyWorkflowWizardTextInput(sessionRef.current, text);
        await applyResult(result);
      } finally {
        setBusy(false);
      }
    },
    [applyResult, busy],
  );

  const needsFreeText = workflowWizardStepNeedsFreeText(
    session.step,
    session.activeMcq,
  );

  return (
    <>
      <WizardChrome session={session} onRestart={restart} />
      <div style={splitStyle} data-testid="wf-wizard-split">
        <div style={paneStyle} data-testid="wf-wizard-chat-pane">
          <Heading level={3}>Chat</Heading>
          <ChatTimeline
            items={items}
            onMcqSelect={(input) => void handleMcqSelect(input)}
          />
          {needsFreeText ? (
            <FreeTextComposer disabled={busy} onSubmit={(t) => void handleFreeText(t)} />
          ) : null}
        </div>
        <div
          style={{ ...paneStyle, borderRight: "none" }}
          data-testid="wf-wizard-settings-pane"
        >
          <SettingsView isActive />
        </div>
      </div>
    </>
  );
}

/**
 * Offline proof: guided workflow wizard → host inventory entry (mock save).
 */
export function WorkflowChatWizardProofStory() {
  installWorkflowWizardProofFetchMock();

  const honestyValue: PortalHonestyContextValue = useMemo(
    () => ({
      brainRpcEnabled: true,
      isReady: true,
      ui: { affordances: {}, can: {} },
      backendCapabilities: {
        features: {},
        brain_rpc_methods: ["settings.snapshot"],
        ui_affordances: {},
      },
    }),
    [],
  );

  return (
    <PortalHonestyProvider value={honestyValue}>
      <SettingsSnapshotProvider inventoryRefreshDebounceMs={50}>
        <div data-testid="wf-wizard-proof-story" style={rootStyle}>
          <WizardBody />
        </div>
      </SettingsSnapshotProvider>
    </PortalHonestyProvider>
  );
}
