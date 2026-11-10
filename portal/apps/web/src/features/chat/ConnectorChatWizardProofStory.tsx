/**
 * Auth-free story for chat Connect wizard + Connectors page (lp-xhf4.8).
 * Mounted with `?story=connector-chat-wizard`.
 */
import {
  useCallback,
  useMemo,
  useState,
  type CSSProperties,
} from "react";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Heading, Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import type { McqChoice } from "../../api/types.js";
import type { ChatTimelineItem } from "../../hooks/useChatEvents.js";
import { ConnectorsPage } from "../settings/ConnectorsPage.js";
import {
  buildConnectorsPageModel,
  type SpaConnectorStatus,
} from "../settings/connectorsCatalog.js";

import { ChatTimeline } from "./ChatTimeline.js";
import {
  applyConnectorOAuthSuccess,
  applyConnectorWizardChoice,
  connectorWizardChoices,
  createConnectorChatWizardSession,
  formatConnectorResumePrompt,
  markConnectorOAuthOpened,
  markConnectorResumeFinished,
  openConnectorOAuthTab,
  type ConnectorChatWizardSession,
} from "./connectorChatWizard.js";

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

const AUTHORIZE_URL =
  "https://accounts.google.com/o/oauth2/v2/auth?state=story-oauth";

type ProofWindow = Window & {
  __connectorChatWizardProof?: {
    chatUseCount: number;
    pageConnectCount: number;
    lastResume: string | null;
    lastOAuthStartBody: string | null;
    lastOpenTarget: string | null;
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

function installProofFetchMock(): void {
  const win = proofWindow();
  if (!win) return;
  win.__connectorChatWizardProof = {
    chatUseCount: 0,
    pageConnectCount: 0,
    lastResume: null,
    lastOAuthStartBody: null,
    lastOpenTarget: null,
  };
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
    const state = win.__connectorChatWizardProof!;
    if (path.endsWith("/api/auth/csrf")) {
      return jsonResponse({ csrf_token: "story-csrf-token" });
    }
    if (path.endsWith("/api/connectors") && methodUp === "GET") {
      return jsonResponse({
        connectors: [
          {
            connector_id: "google",
            status: "not_connected",
            account_label: null,
            sticky: {},
            entitled: true,
            role_granted: true,
            hubspot_portal_id: null,
          },
          {
            connector_id: "hubspot",
            status: "not_connected",
            account_label: null,
            sticky: {},
            entitled: true,
            role_granted: true,
            hubspot_portal_id: null,
          },
          {
            connector_id: "whatsapp",
            status: "not_connected",
            account_label: null,
            sticky: {},
            entitled: true,
            role_granted: true,
            hubspot_portal_id: null,
          },
        ],
      });
    }
    if (path.endsWith("/api/connectors/google/oauth/start") && methodUp === "POST") {
      const raw = typeof init?.body === "string" ? init.body : "{}";
      state.lastOAuthStartBody = raw;
      const parsed = JSON.parse(raw) as { thread_id?: string };
      if (!parsed.thread_id) {
        state.pageConnectCount += 1;
      }
      return jsonResponse({
        connector_id: "google",
        url: AUTHORIZE_URL,
      });
    }
    if (path.endsWith("/api/connectors/google/chat-use") && methodUp === "POST") {
      state.chatUseCount += 1;
      return jsonResponse({
        kind: "needs_auth",
        connector_id: "google",
        wizard: {
          portal_event: "needs_auth",
          mcq_id: "cc-needs_auth-google-th-proof",
          content:
            "Connect Google to continue this tool. The chat stays here — Google opens in a new tab.",
          choices: [
            { id: "connect", label: "Connect Google" },
            { id: "cancel", label: "Cancel" },
          ],
        },
        pending: {
          tool: "gws",
          args: ["gmail", "users", "drafts", "create", "--to", "ada@example.com"],
          action_class: "gmail.draft",
          expires_at: Date.now() + 600_000,
          thread_id: "th-proof",
        },
      });
    }
    if (path.endsWith("/api/connectors/google/pending/resume") && methodUp === "POST") {
      const resume = {
        kind: "resume",
        connector_id: "google",
        tool: "gws",
        args: ["gmail", "users", "drafts", "create", "--to", "ada@example.com"],
        thread_id: "th-proof",
      };
      state.lastResume = formatConnectorResumePrompt(resume.tool, resume.args);
      return jsonResponse(resume);
    }
    if (path.endsWith("/api/connectors/google/pending/cancel") && methodUp === "POST") {
      state.lastResume = "Google connected. The pending tool was not sent.";
      return jsonResponse({
        kind: "connected_no_resume",
        connector_id: "google",
        reason: "cancelled",
        message: "Google connected. The pending tool was not sent.",
      });
    }
    return originalFetch(input, init);
  };
}

function seedItems(session: ConnectorChatWizardSession): ChatTimelineItem[] {
  return [
    {
      type: "user",
      id: "user-gmail",
      content: "Draft an email to Ada",
      status: "sent",
    },
    {
      type: "assistant_turn",
      id: "tool-gmail",
      segments: [],
      toolCalls: [
        {
          key: "gws-1",
          name: "gws-gmail-send",
          technicalName: "bash",
          target: "gws gmail users messages send --to ada@example.com",
          status: "error",
          errorMessage: "403 unauthorized",
        },
      ],
      content: "",
      isStreaming: false,
      citations: [],
    },
    {
      type: "mcq",
      mcqId: session.sessionId,
      messageId: `msg-${session.sessionId}`,
      content: session.statusMessage,
      choices: connectorWizardChoices("google"),
      selectedChoiceId: null,
      disabled: false,
    },
  ];
}

function WizardBody() {
  const [session, setSession] = useState<ConnectorChatWizardSession>(() =>
    createConnectorChatWizardSession({
      connectorId: "google",
      threadId: "th-proof",
      tool: "gws",
      args: ["gmail", "users", "drafts", "create", "--to", "ada@example.com"],
      expiresAt: Date.now() + 600_000,
    }),
  );
  const [items, setItems] = useState<ChatTimelineItem[]>(() => seedItems(session));
  const [lastAction, setLastAction] = useState("needs_auth");
  const [pageConnects, setPageConnects] = useState(0);

  const connectorStatuses: SpaConnectorStatus[] = useMemo(
    () => [
      {
        connector_id: "google",
        status: "not_connected",
        account_label: null,
        sticky: {},
        entitled: true,
        role_granted: true,
        hubspot_portal_id: null,
      },
      {
        connector_id: "hubspot",
        status: "not_connected",
        account_label: null,
        sticky: {},
        entitled: true,
        role_granted: true,
        hubspot_portal_id: null,
      },
      {
        connector_id: "whatsapp",
        status: "not_connected",
        account_label: null,
        sticky: {},
        entitled: true,
        role_granted: true,
        hubspot_portal_id: null,
      },
    ],
    [],
  );

  const connectorModel = useMemo(
    () =>
      buildConnectorsPageModel({
        connectors: connectorStatuses,
        skills: [
          {
            id: "gws-gmail-send",
            name: "gws-gmail-send",
            path: "skills/gws/gmail/gws-gmail-send",
            enabled: true,
          },
        ],
      }),
    [connectorStatuses],
  );

  const appendAssistant = useCallback((content: string) => {
    setItems((current) => [
      ...current.map((item) =>
        item.type === "mcq" ? { ...item, disabled: true } : item,
      ),
      {
        type: "assistant_turn",
        id: `asst-${current.length}`,
        segments: [],
        toolCalls: [],
        content,
        isStreaming: false,
        citations: [],
      },
    ]);
  }, []);

  const handleMcq = useCallback(
    (input: { mcqId: string; choice: McqChoice }) => {
      const result = applyConnectorWizardChoice(session, {
        mcq_id: input.mcqId,
        choice_id: input.choice.id,
      });
      if (!result.ok) {
        setLastAction(result.error);
        return;
      }
      setSession(result.session);
      setItems((current) =>
        current.map((item) =>
          item.type === "mcq" && item.mcqId === input.mcqId
            ? { ...item, selectedChoiceId: input.choice.id, disabled: true }
            : item,
        ),
      );
      if (result.assistantMessage) {
        appendAssistant(result.assistantMessage);
      }
      if (result.shouldOpenOAuth) {
        const opened = openConnectorOAuthTab(AUTHORIZE_URL);
        const next = markConnectorOAuthOpened(result.session, {
          url: AUTHORIZE_URL,
          opened: opened.opened,
        });
        setSession(next);
        const win = proofWindow();
        if (win?.__connectorChatWizardProof) {
          win.__connectorChatWizardProof.lastOpenTarget = "_blank";
          win.__connectorChatWizardProof.lastOAuthStartBody = JSON.stringify({
            thread_id: "th-proof",
          });
        }
        setLastAction(opened.opened ? "waiting_oauth" : "popup_blocked");
      } else if (result.shouldCancelPending) {
        const win = proofWindow();
        if (win?.__connectorChatWizardProof) {
          win.__connectorChatWizardProof.lastResume =
            "Google connected. The pending tool was not sent.";
        }
        setLastAction("cancelled_no_send");
      }
    },
    [appendAssistant, session],
  );

  const simulateSuccess = useCallback(() => {
    const result = applyConnectorOAuthSuccess(session);
    if (!result.ok) return;
    setSession(result.session);
    if (result.assistantMessage) {
      appendAssistant(result.assistantMessage);
    }
    if (result.shouldResume) {
      const prompt = formatConnectorResumePrompt(session.tool, session.args);
      const win = proofWindow();
      if (win?.__connectorChatWizardProof) {
        win.__connectorChatWizardProof.lastResume = prompt;
      }
      appendAssistant(prompt);
      setSession(markConnectorResumeFinished(result.session, true));
      setLastAction("resumed_stored_tool");
      return;
    }
    setLastAction("connected_no_send");
  }, [appendAssistant, session]);

  const handlePageConnect = useCallback(() => {
    const opened = openConnectorOAuthTab(AUTHORIZE_URL);
    const win = proofWindow();
    if (win?.__connectorChatWizardProof) {
      win.__connectorChatWizardProof.pageConnectCount += 1;
      win.__connectorChatWizardProof.lastOAuthStartBody = "{}";
      win.__connectorChatWizardProof.lastOpenTarget = opened.opened
        ? "_blank"
        : null;
    }
    setPageConnects((n) => n + 1);
    setLastAction("page_connect_no_pending");
  }, []);

  const proof = proofWindow()?.__connectorChatWizardProof;

  return (
    <>
      <div data-testid="cc-wizard-proof-chrome" style={chromeStyle}>
        <Heading level={2}>Chat Connect wizard</Heading>
        <HStack gap={3} wrap="wrap">
          <Text type="supporting" data-testid="cc-wizard-step">
            {session.step}
          </Text>
          <Text type="supporting" data-testid="cc-wizard-last-action">
            {lastAction}
          </Text>
          <Text type="supporting" data-testid="cc-wizard-resume">
            {proof?.lastResume ?? "(none)"}
          </Text>
          <Text type="supporting" data-testid="cc-wizard-page-connects">
            page:{pageConnects}
          </Text>
          <Button
            label="Simulate OAuth success"
            size="sm"
            onClick={simulateSuccess}
          />
        </HStack>
      </div>
      <div style={splitStyle}>
        <div data-testid="cc-wizard-chat-pane" style={paneStyle}>
          <ChatTimeline items={items} onMcqSelect={handleMcq} />
        </div>
        <div data-testid="cc-wizard-connectors-pane" style={paneStyle}>
          <VStack gap={3}>
            <Text type="body">Connectors</Text>
            <ConnectorsPage
              model={connectorModel}
              loadError={null}
              connectingId={null}
              busyId={null}
              togglingSkillId={null}
              togglingMcpName={null}
              onConnect={() => handlePageConnect()}
              onDisconnect={() => {}}
              onRefresh={() => {}}
              onReconnect={() => handlePageConnect()}
              clearingStickyKey={null}
              onToggleSkill={() => {}}
              onToggleMcp={() => {}}
              onClearSticky={() => {}}
              onOpenDetail={() => {}}
              team={null}
              togglingGrantKey={null}
              pinBusy={false}
              teamError={null}
              onToggleGrant={() => {}}
              onClearHubSpotPin={() => {}}
            />
          </VStack>
        </div>
      </div>
    </>
  );
}

export function ConnectorChatWizardProofStory() {
  installProofFetchMock();
  return (
    <div data-testid="cc-wizard-proof-story" style={rootStyle}>
      <WizardBody />
    </div>
  );
}
