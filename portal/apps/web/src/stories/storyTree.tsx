import { lazy, Suspense, type ReactNode } from "react";

import { App } from "../app/App.js";
import { ActivityPlaneStory } from "../features/chat/activityPane/ActivityPlaneStory.js";
import { CitationsDocumentPaneProofStory } from "../features/chat/documentPane/CitationsDocumentPaneProofStory.js";
import { DocumentPaneStory } from "../features/chat/documentPane/DocumentPaneStory.js";
import { FileRefSoftOpenProofStory } from "../features/chat/documentPane/FileRefSoftOpenProofStory.js";
import { TableBadgeLinksProofStory } from "../features/chat/tables/TableBadgeLinksProofStory.js";
import { ParseDocumentProofStory } from "../features/chat/ParseDocumentProofStory.js";
import { WebSearchResultsProofStory } from "../features/chat/WebSearchResultsProofStory.js";
import { CondensedHeaderProofStory } from "../features/chat/CondensedHeaderProofStory.js";
import { ComposerAttachMenuProofStory } from "../features/chat/ComposerAttachMenuProofStory.js";
import { ScheduledTaskChatWizardProofStory } from "../features/chat/ScheduledTaskChatWizardProofStory.js";
import { WorkflowChatWizardProofStory } from "../features/chat/WorkflowChatWizardProofStory.js";
import { GroupRoomsProofStory } from "../features/chat/GroupRoomsProofStory.js";
import { ConnectorChatWizardProofStory } from "../features/chat/ConnectorChatWizardProofStory.js";
import { NlCronCreateSettingsProofStory } from "../features/settings/NlCronCreateSettingsProofStory.js";
import { VaultLazyProofStory } from "../features/vault/VaultLazyProofStory.js";
import { FakeOpsProofStory } from "../features/admin/FakeOpsProofStory.js";

const ChartBarProofStory = lazy(async () => {
  const m = await import("../features/chat/charts/ChartBarProofStory.js");
  return { default: m.ChartBarProofStory };
});

const ChartBarPieProofStory = lazy(async () => {
  const m = await import("../features/chat/charts/ChartBarPieProofStory.js");
  return { default: m.ChartBarPieProofStory };
});

/**
 * Auth-free layout stories for Playwright / visual checks.
 * Keep `?story=` so existing ui-testing URLs continue to work.
 */
export function storyTree(story: string | null): ReactNode {
  if (story === "vault-lazy-proof") return <VaultLazyProofStory />;
  if (story === "document-pane") return <DocumentPaneStory />;
  if (story === "citations-document-pane") {
    return <CitationsDocumentPaneProofStory />;
  }
  if (story === "file-ref-soft-open") {
    return <FileRefSoftOpenProofStory />;
  }
  if (story === "activity-plane") return <ActivityPlaneStory />;
  if (story === "web-search-results") return <WebSearchResultsProofStory />;
  if (story === "parse-document") return <ParseDocumentProofStory />;
  if (story === "chart-bar-proof") {
    return (
      <Suspense fallback={<div data-testid="chart-story-loading">Loading chart…</div>}>
        <ChartBarProofStory />
      </Suspense>
    );
  }
  if (story === "chart-bar-pie") {
    return (
      <Suspense fallback={<div data-testid="chart-story-loading">Loading chart…</div>}>
        <ChartBarPieProofStory />
      </Suspense>
    );
  }
  if (story === "table-badge-links") return <TableBadgeLinksProofStory />;
  if (story === "nl-cron-create-settings") {
    return <NlCronCreateSettingsProofStory />;
  }
  if (story === "condensed-header") return <CondensedHeaderProofStory />;
  if (story === "composer-attach-menu") {
    return <ComposerAttachMenuProofStory />;
  }
  if (story === "scheduled-task-chat-wizard") {
    return <ScheduledTaskChatWizardProofStory />;
  }
  if (story === "workflow-chat-wizard") {
    return <WorkflowChatWizardProofStory />;
  }
  if (story === "group-rooms") {
    return <GroupRoomsProofStory />;
  }
  if (story === "connector-chat-wizard") {
    return <ConnectorChatWizardProofStory />;
  }
  if (story === "fakeops-admin") {
    return <FakeOpsProofStory mode="superadmin" />;
  }
  if (story === "fakeops-admin-tenant") {
    return <FakeOpsProofStory mode="tenant_admin" />;
  }
  if (story === "fakeops-admin-unauth") {
    return <FakeOpsProofStory mode="unauth" />;
  }
  return <App />;
}
