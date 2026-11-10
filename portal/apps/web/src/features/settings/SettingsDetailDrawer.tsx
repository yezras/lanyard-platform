/**
 * Settings detail drawer for skill / workflow / cron (lp-a8u.8 / lp-75r.4).
 * Metadata from the list snapshot; prose bodies + skill-pack directory loaded on demand.
 */

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { CodeBlock } from "@astryxdesign/core/CodeBlock";
import {
  Dialog,
  DialogHeader,
} from "@astryxdesign/core/Dialog";
import { Divider } from "@astryxdesign/core/Divider";
import { HStack } from "@astryxdesign/core/HStack";
import { Layout, LayoutContent } from "@astryxdesign/core/Layout";
import { Markdown } from "@astryxdesign/core/Markdown";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Text } from "@astryxdesign/core/Text";
import { VStack } from "@astryxdesign/core/VStack";

import {
  fetchSettingsCronDetail,
  fetchSettingsHostContent,
  fetchSettingsHostList,
} from "../../api/settings.js";
import type {
  SettingsCron,
  SettingsCronDetail,
  SettingsHostListEntry,
  SettingsSkill,
  SettingsWorkflow,
} from "../../api/types.js";
import { useOptionalVaultDeepLink } from "../vault/VaultDeepLinkContext.js";
import {
  hasSettingsFilePath,
  isVaultVisibleSettingsPath,
  NO_FILE_PATH_MESSAGE,
  NO_HOST_CONTENT_MESSAGE,
  NO_HOST_DIRECTORY_MESSAGE,
  resolveSkillContentPath,
  resolveSkillDirectoryPath,
} from "./settingsContentPaths.js";
import { humanizeSchedule } from "./settingsFormat.js";

export type SettingsDetailTarget =
  | { kind: "skill"; item: SettingsSkill }
  | { kind: "workflow"; item: SettingsWorkflow }
  | { kind: "cron"; item: SettingsCron };

export type SettingsDetailDrawerProps = {
  target: SettingsDetailTarget | null;
  onClose: () => void;
};

function formatOptionalTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function isMarkdownMime(mime: string | undefined, path: string): boolean {
  if (mime?.includes("markdown")) return true;
  return /\.(md|markdown)$/i.test(path);
}

function BodyBlock({
  body,
  path,
  mime,
  emptyMessage,
}: {
  body: string | null;
  path?: string;
  mime?: string;
  emptyMessage: string;
}) {
  if (body === null) {
    return (
      <Text type="body" color="secondary" data-testid="settings-detail-empty-body">
        {emptyMessage}
      </Text>
    );
  }
  const asMarkdown = isMarkdownMime(mime, path ?? "");
  if (asMarkdown) {
    return (
      <div data-testid="settings-detail-markdown">
        <Markdown headingLevelStart={3}>{body}</Markdown>
      </div>
    );
  }
  return (
    <CodeBlock
      code={body}
      language={
        path?.endsWith(".json")
          ? "json"
          : path?.match(/\.ya?ml$/i)
            ? "yaml"
            : "text"
      }
      title={path ? path.split("/").pop() : "Body"}
      width="100%"
      hasCopyButton
      data-testid="settings-detail-code"
    />
  );
}

function SkillDetail({
  item,
  onClose,
}: {
  item: SettingsSkill;
  onClose: () => void;
}) {
  const vaultDeepLink = useOptionalVaultDeepLink();
  const defaultContentPath = hasSettingsFilePath(item.path)
    ? resolveSkillContentPath(item.path!)
    : undefined;
  const directoryPath = hasSettingsFilePath(item.path)
    ? resolveSkillDirectoryPath(item.path!)
    : "";

  const [selectedPath, setSelectedPath] = useState<string | undefined>(
    defaultContentPath,
  );
  const [body, setBody] = useState<string | null>(null);
  const [mime, setMime] = useState<string | undefined>();
  const [contentPath, setContentPath] = useState<string | undefined>();
  const [emptyMessage, setEmptyMessage] = useState(NO_FILE_PATH_MESSAGE);
  const [isLoading, setIsLoading] = useState(false);

  const [dirEntries, setDirEntries] = useState<SettingsHostListEntry[] | null>(
    null,
  );
  const [dirEmptyMessage, setDirEmptyMessage] = useState(
    NO_HOST_DIRECTORY_MESSAGE,
  );
  const [isDirLoading, setIsDirLoading] = useState(false);

  // Reset selection when the skill changes.
  useEffect(() => {
    setSelectedPath(defaultContentPath);
  }, [item.id, defaultContentPath]);

  // Load selected file body.
  useEffect(() => {
    let cancelled = false;
    setBody(null);
    setMime(undefined);
    setContentPath(undefined);

    if (!selectedPath) {
      setEmptyMessage(NO_FILE_PATH_MESSAGE);
      setIsLoading(false);
      return;
    }

    setContentPath(selectedPath);
    setIsLoading(true);
    setEmptyMessage(NO_HOST_CONTENT_MESSAGE);

    void fetchSettingsHostContent(selectedPath)
      .then((res) => {
        if (cancelled) return;
        setBody(res.content);
        setMime(res.mime_type);
        setContentPath(res.path);
      })
      .catch(() => {
        if (cancelled) return;
        setBody(null);
        setEmptyMessage(NO_HOST_CONTENT_MESSAGE);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [item.id, selectedPath]);

  // Load skill-pack directory listing.
  useEffect(() => {
    let cancelled = false;
    setDirEntries(null);

    if (!directoryPath) {
      setDirEmptyMessage(
        hasSettingsFilePath(item.path)
          ? NO_HOST_DIRECTORY_MESSAGE
          : NO_FILE_PATH_MESSAGE,
      );
      setIsDirLoading(false);
      return;
    }

    setIsDirLoading(true);
    setDirEmptyMessage(NO_HOST_DIRECTORY_MESSAGE);

    void fetchSettingsHostList(directoryPath)
      .then((res) => {
        if (cancelled) return;
        setDirEntries(res.entries);
        if (res.entries.length === 0) {
          setDirEmptyMessage("This skill folder has no files.");
        }
      })
      .catch(() => {
        if (cancelled) return;
        setDirEntries(null);
        setDirEmptyMessage(NO_HOST_DIRECTORY_MESSAGE);
      })
      .finally(() => {
        if (!cancelled) setIsDirLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [item.id, item.path, directoryPath]);

  const openFile = useCallback((entry: SettingsHostListEntry) => {
    if (entry.kind !== "file") return;
    setSelectedPath(entry.path);
  }, []);

  const showVaultLink =
    vaultDeepLink != null &&
    isVaultVisibleSettingsPath(item.path) &&
    hasSettingsFilePath(item.path);

  return (
    <VStack gap={4} data-testid="settings-detail-skill">
      <MetadataList>
        <MetadataListItem label="Name">{item.name}</MetadataListItem>
        <MetadataListItem label="Id">
          <span data-testid="settings-detail-skill-id">{item.id}</span>
        </MetadataListItem>
        <MetadataListItem label="Path">
          <span data-testid="settings-detail-skill-path">
            {hasSettingsFilePath(item.path) ? item.path : "—"}
          </span>
        </MetadataListItem>
        <MetadataListItem label="Enabled">
          <span data-testid="settings-detail-skill-enabled">
            <Badge
              label={item.enabled ? "Enabled" : "Disabled"}
              variant={item.enabled ? "success" : "neutral"}
            />
          </span>
        </MetadataListItem>
      </MetadataList>

      {showVaultLink ? (
        <Button
          label="Open in Vault"
          variant="ghost"
          size="sm"
          data-testid="settings-detail-skill-open-vault"
          onClick={() => {
            // Inventory paths are skill directories; open SKILL.md body file.
            // Close detail dialog so overlay does not freeze the shell (lp-95v.2).
            const contentPath = resolveSkillContentPath(item.path!.trim());
            const vaultPath = contentPath.startsWith("/")
              ? contentPath
              : `/${contentPath}`;
            onClose();
            vaultDeepLink.openVaultPath(vaultPath);
          }}
        />
      ) : null}

      {directoryPath ? (
        <>
          <Divider />
          <VStack gap={2} data-testid="settings-detail-skill-directory">
            <Text type="supporting" color="secondary">
              Skill directory · {directoryPath}
            </Text>
            {isDirLoading ? (
              <Spinner data-testid="settings-detail-dir-loading" />
            ) : dirEntries && dirEntries.length > 0 ? (
              <VStack gap={1} align="stretch">
                {dirEntries.map((entry) => {
                  const isSelected =
                    entry.kind === "file" && entry.path === selectedPath;
                  const isFile = entry.kind === "file";
                  return (
                    <HStack
                      key={entry.path}
                      gap={2}
                      align="center"
                      style={{
                        minWidth: 0,
                        padding: "4px 6px",
                        borderRadius: 6,
                        background: isSelected
                          ? "var(--astryx-color-bg-subtle, rgba(0,0,0,0.04))"
                          : undefined,
                      }}
                    >
                      <Text
                        type="supporting"
                        color="secondary"
                        style={{ flexShrink: 0 }}
                      >
                        {entry.kind === "directory" ? "dir" : "file"}
                      </Text>
                      {isFile ? (
                        <button
                          type="button"
                          data-testid={`settings-skill-file-${entry.name}`}
                          onClick={() => openFile(entry)}
                          style={{
                            background: "none",
                            border: "none",
                            padding: 0,
                            margin: 0,
                            font: "inherit",
                            color: "inherit",
                            cursor: "pointer",
                            textAlign: "start",
                            textDecoration: isSelected ? "none" : "underline",
                            textUnderlineOffset: "2px",
                            fontWeight: isSelected ? 600 : undefined,
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                          aria-current={isSelected ? "true" : undefined}
                          aria-label={`Open ${entry.name}`}
                        >
                          {entry.name}
                        </button>
                      ) : (
                        <Text
                          type="body"
                          color="secondary"
                          data-testid={`settings-skill-dir-${entry.name}`}
                          style={{
                            minWidth: 0,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {entry.name}/
                        </Text>
                      )}
                    </HStack>
                  );
                })}
              </VStack>
            ) : (
              <Text
                type="body"
                color="secondary"
                data-testid="settings-detail-dir-empty"
              >
                {dirEmptyMessage}
              </Text>
            )}
          </VStack>
        </>
      ) : null}

      <Divider />

      <Text type="supporting" color="secondary">
        {contentPath
          ? contentPath.split("/").pop() || "File"
          : "File"}
      </Text>
      {isLoading ? (
        <Spinner data-testid="settings-detail-loading" />
      ) : (
        <BodyBlock
          body={body}
          path={contentPath}
          mime={mime}
          emptyMessage={emptyMessage}
        />
      )}
    </VStack>
  );
}

function WorkflowDetail({ item }: { item: SettingsWorkflow }) {
  const [body, setBody] = useState<string | null>(null);
  const [mime, setMime] = useState<string | undefined>();
  const [contentPath, setContentPath] = useState<string | undefined>();
  const [emptyMessage, setEmptyMessage] = useState(NO_FILE_PATH_MESSAGE);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setBody(null);
    setMime(undefined);
    setContentPath(undefined);

    // Description-only when no path: still honest about missing file body.
    if (!hasSettingsFilePath(item.path)) {
      setEmptyMessage(NO_FILE_PATH_MESSAGE);
      setIsLoading(false);
      return;
    }

    const pathToFetch = item.path!.trim();
    setContentPath(pathToFetch);
    setIsLoading(true);
    setEmptyMessage(NO_HOST_CONTENT_MESSAGE);

    void fetchSettingsHostContent(pathToFetch)
      .then((res) => {
        if (cancelled) return;
        setBody(res.content);
        setMime(res.mime_type);
        setContentPath(res.path);
      })
      .catch(() => {
        if (cancelled) return;
        setBody(null);
        setEmptyMessage(NO_HOST_CONTENT_MESSAGE);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [item.id, item.path]);

  return (
    <VStack gap={4} data-testid="settings-detail-workflow">
      <MetadataList>
        <MetadataListItem label="Name">{item.name}</MetadataListItem>
        <MetadataListItem label="Id">{item.id}</MetadataListItem>
        {hasSettingsFilePath(item.path) ? (
          <MetadataListItem label="Path">{item.path}</MetadataListItem>
        ) : null}
        <MetadataListItem label="Updated">
          {formatOptionalTimestamp(item.updated_at)}
        </MetadataListItem>
        {item.description ? (
          <MetadataListItem label="Description">{item.description}</MetadataListItem>
        ) : null}
      </MetadataList>
      <Divider />
      <Text type="supporting" color="secondary">
        Definition
      </Text>
      {isLoading ? (
        <Spinner data-testid="settings-detail-loading" />
      ) : body !== null ? (
        <BodyBlock
          body={body}
          path={contentPath}
          mime={mime}
          emptyMessage={emptyMessage}
        />
      ) : item.description && !hasSettingsFilePath(item.path) ? (
        <div data-testid="settings-detail-markdown">
          <Markdown headingLevelStart={3}>{item.description}</Markdown>
        </div>
      ) : (
        <BodyBlock
          body={null}
          emptyMessage={
            hasSettingsFilePath(item.path)
              ? emptyMessage
              : NO_FILE_PATH_MESSAGE
          }
        />
      )}
    </VStack>
  );
}

function CronDetail({ item }: { item: SettingsCron }) {
  const [detail, setDetail] = useState<SettingsCronDetail | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setIsLoading(true);

    void fetchSettingsCronDetail(item.id)
      .then((res) => {
        if (!cancelled) setDetail(res);
      })
      .catch(() => {
        if (!cancelled) setDetail(null);
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [item.id]);

  const schedule = detail?.schedule ?? item.schedule;
  const enabled = detail?.enabled ?? item.enabled;
  const lastRun = detail?.last_run_at ?? item.last_run_at;
  const nextRun = detail?.next_run_at ?? item.next_run_at;
  const command = detail?.command ?? item.command;
  const prompt = detail?.prompt ?? item.prompt;
  const payload = detail?.payload ?? item.payload;
  const path = detail?.path ?? item.path;

  const hasJobBody =
    Boolean(command) ||
    Boolean(prompt) ||
    (payload !== undefined && payload !== null);

  return (
    <div data-testid="settings-detail-scheduled-task">
      <VStack gap={4} data-testid="settings-detail-cron">
        <MetadataList>
          <MetadataListItem label="Name">{item.name}</MetadataListItem>
          <MetadataListItem label="Schedule">
            {humanizeSchedule(schedule)}
          </MetadataListItem>
          <MetadataListItem label="Enabled">
            <Badge
              label={enabled ? "Enabled" : "Disabled"}
              variant={enabled ? "success" : "neutral"}
            />
          </MetadataListItem>
          <MetadataListItem label="Last run">
            {formatOptionalTimestamp(lastRun)}
          </MetadataListItem>
          <MetadataListItem label="Next run">
            {formatOptionalTimestamp(nextRun)}
          </MetadataListItem>
          {hasSettingsFilePath(path) ? (
            <MetadataListItem label="Path">{path}</MetadataListItem>
          ) : null}
        </MetadataList>
        <Divider />
        <Text type="supporting" color="secondary">
          Job details
        </Text>
        {isLoading ? (
          <Spinner data-testid="settings-detail-loading" />
        ) : hasJobBody ? (
          <VStack gap={3}>
            {command ? (
              <MetadataList>
                <MetadataListItem label="Command">{command}</MetadataListItem>
              </MetadataList>
            ) : null}
            {prompt ? (
              <div data-testid="settings-detail-cron-prompt">
                <Text type="supporting" color="secondary">
                  Prompt
                </Text>
                <Markdown headingLevelStart={3}>{prompt}</Markdown>
              </div>
            ) : null}
            {payload !== undefined && payload !== null ? (
              <CodeBlock
                code={
                  typeof payload === "string"
                    ? payload
                    : JSON.stringify(payload, null, 2)
                }
                language="json"
                title="Payload"
                width="100%"
                hasCopyButton
                data-testid="settings-detail-cron-payload"
              />
            ) : null}
          </VStack>
        ) : (
          <Text
            type="body"
            color="secondary"
            data-testid="settings-detail-empty-body"
          >
            No command or payload available from host for this job
          </Text>
        )}
      </VStack>
    </div>
  );
}

function titleFor(target: SettingsDetailTarget): string {
  switch (target.kind) {
    case "skill":
      return target.item.name;
    case "workflow":
      return target.item.name;
    case "cron":
      return target.item.name;
  }
}

function kindLabel(kind: SettingsDetailTarget["kind"]): string {
  switch (kind) {
    case "skill":
      return "Skill";
    case "workflow":
      return "Workflow";
    case "cron":
      return "Scheduled task";
  }
}

export function SettingsDetailDrawer({
  target,
  onClose,
}: SettingsDetailDrawerProps) {
  const isOpen = target !== null;
  // Skills need room for metadata + pack directory + body (lp-75r.4).
  const dialogWidth = target?.kind === "skill" ? 560 : 480;

  return (
    <Dialog
      isOpen={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      purpose="info"
      width={dialogWidth}
      maxHeight="90vh"
      data-testid="settings-detail-drawer"
      aria-label={
        target
          ? `${kindLabel(target.kind)} details: ${titleFor(target)}`
          : "Settings item details"
      }
    >
      {target ? (
        <Layout
          header={
            <DialogHeader
              title={titleFor(target)}
              subtitle={kindLabel(target.kind)}
              onOpenChange={(open) => {
                if (!open) onClose();
              }}
            />
          }
          content={
            <LayoutContent padding={4} style={{ overflow: "auto" }}>
              {target.kind === "skill" ? (
                <SkillDetail item={target.item} onClose={onClose} />
              ) : null}
              {target.kind === "workflow" ? (
                <WorkflowDetail item={target.item} />
              ) : null}
              {target.kind === "cron" ? (
                <CronDetail item={target.item} />
              ) : null}
            </LayoutContent>
          }
        />
      ) : null}
    </Dialog>
  );
}
