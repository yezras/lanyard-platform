/**
 * Scheduled-task ops pane body (lp-lv9.5).
 *
 * Mounted inside the chat activity side-pane host when a job stream is
 * selected. Shows schedule, last/next run, last status, On/Off slider, and
 * job instructions (read-only or editable when the host allows full update).
 *
 * Off = no future fires; does not cancel an in-flight run.
 */

import { useCallback, useEffect, useMemo, useState } from "react";

import { Badge } from "@astryxdesign/core/Badge";
import { Button } from "@astryxdesign/core/Button";
import { Divider } from "@astryxdesign/core/Divider";
import { HStack } from "@astryxdesign/core/HStack";
import { Markdown } from "@astryxdesign/core/Markdown";
import { MetadataList, MetadataListItem } from "@astryxdesign/core/MetadataList";
import { Spinner } from "@astryxdesign/core/Spinner";
import { Switch } from "@astryxdesign/core/Switch";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { VStack } from "@astryxdesign/core/VStack";

import {
  fetchSettingsCronDetail,
  patchSettingsCron,
} from "../../../api/settings.js";
import type { SettingsCron, SettingsCronDetail } from "../../../api/types.js";
import { humanizeSchedule } from "../../settings/settingsFormat.js";

export type ScheduledTaskConfigPaneProps = {
  /** Host cron / job id bound to the selected stream. */
  jobId: string;
  /**
   * Snapshot list row when available (schedule, enabled, timestamps).
   * Detail fetch fills prompt / missing fields.
   */
  cron?: SettingsCron | null;
  /**
   * When true, instructions are editable via PATCH cron.update.
   * When false/unknown-false, show read-only prose.
   */
  canEditInstructions?: boolean;
  /**
   * Optimistic snapshot patch after a successful enable toggle
   * (keeps Settings inventory in sync).
   */
  onCronUpdated?: (cron: SettingsCron) => void;
};

function formatOptionalTimestamp(iso: string | null | undefined): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

function formatStatus(value: string | null | undefined): string {
  if (typeof value !== "string") return "—";
  const trimmed = value.trim();
  return trimmed || "—";
}

function resolveInstructions(
  detail: SettingsCronDetail | null,
  cron: SettingsCron | null | undefined,
): string {
  const fromDetail =
    typeof detail?.prompt === "string" ? detail.prompt.trim() : "";
  if (fromDetail) return fromDetail;
  const fromCron = typeof cron?.prompt === "string" ? cron.prompt.trim() : "";
  return fromCron;
}

/**
 * True when a chat thread should host the scheduled-task config pane.
 */
export function isScheduledTaskThread(
  thread:
    | {
        kind?: string | null;
        scheduled_job_id?: string | null;
      }
    | null
    | undefined,
): boolean {
  if (!thread) return false;
  if (thread.kind === "scheduled_task") return true;
  return Boolean(
    typeof thread.scheduled_job_id === "string" &&
      thread.scheduled_job_id.trim(),
  );
}

export function ScheduledTaskConfigPane({
  jobId,
  cron = null,
  canEditInstructions = false,
  onCronUpdated,
}: ScheduledTaskConfigPaneProps) {
  const [detail, setDetail] = useState<SettingsCronDetail | null>(null);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  const [enabled, setEnabled] = useState<boolean>(cron?.enabled ?? true);
  const [isToggling, setIsToggling] = useState(false);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const [instructionsDraft, setInstructionsDraft] = useState("");
  const [isSavingInstructions, setIsSavingInstructions] = useState(false);
  const [instructionsError, setInstructionsError] = useState<string | null>(
    null,
  );
  const [instructionsSaved, setInstructionsSaved] = useState(false);

  // Keep local enabled in sync with snapshot / detail.
  useEffect(() => {
    if (detail?.enabled !== undefined) {
      setEnabled(Boolean(detail.enabled));
      return;
    }
    if (cron?.enabled !== undefined) {
      setEnabled(Boolean(cron.enabled));
    }
  }, [cron?.enabled, detail?.enabled, jobId]);

  // Load on-demand job detail (prompt / timestamps) when job changes.
  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setDetailError(null);
    setInstructionsSaved(false);

    const id = jobId.trim();
    if (!id) {
      setIsLoadingDetail(false);
      setInstructionsDraft("");
      return;
    }

    setIsLoadingDetail(true);
    void fetchSettingsCronDetail(id)
      .then((res) => {
        if (cancelled) return;
        setDetail(res);
        const text = resolveInstructions(res, cron);
        setInstructionsDraft(text);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setDetail(null);
        setDetailError(
          err instanceof Error ? err.message : "Failed to load job detail",
        );
        setInstructionsDraft(resolveInstructions(null, cron));
      })
      .finally(() => {
        if (!cancelled) setIsLoadingDetail(false);
      });

    return () => {
      cancelled = true;
    };
    // Intentionally only re-fetch when jobId changes; cron list row is fallback.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- jobId is the load key
  }, [jobId]);

  // If detail is absent but snapshot gains a prompt, seed the draft once empty.
  useEffect(() => {
    if (instructionsDraft) return;
    const fromCron = typeof cron?.prompt === "string" ? cron.prompt.trim() : "";
    if (fromCron) setInstructionsDraft(fromCron);
  }, [cron?.prompt, instructionsDraft]);

  const schedule = detail?.schedule ?? cron?.schedule;
  const lastRun = detail?.last_run_at ?? cron?.last_run_at;
  const nextRun = detail?.next_run_at ?? cron?.next_run_at;
  const lastStatus = cron?.last_status ?? cron?.state ?? null;
  const name = detail?.name ?? cron?.name ?? jobId;

  const savedInstructions = useMemo(
    () => resolveInstructions(detail, cron),
    [detail, cron],
  );
  const instructionsDirty =
    canEditInstructions &&
    instructionsDraft.trim() !== savedInstructions.trim();

  const handleToggle = useCallback(
    async (next: boolean) => {
      const id = jobId.trim();
      if (!id || isToggling) return;
      setIsToggling(true);
      setToggleError(null);
      const prev = enabled;
      setEnabled(next);
      try {
        const result = await patchSettingsCron(id, next);
        setEnabled(Boolean(result.cron.enabled));
        onCronUpdated?.(result.cron);
        // Off disables future fires only — in-flight runs are not cancelled.
      } catch (err) {
        setEnabled(prev);
        setToggleError(
          err instanceof Error
            ? err.message
            : "Failed to update scheduled task",
        );
      } finally {
        setIsToggling(false);
      }
    },
    [enabled, isToggling, jobId, onCronUpdated],
  );

  const handleSaveInstructions = useCallback(async () => {
    const id = jobId.trim();
    if (!id || !canEditInstructions || isSavingInstructions) return;
    const prompt = instructionsDraft.trim();
    if (!prompt) {
      setInstructionsError("Instructions cannot be empty.");
      return;
    }
    setIsSavingInstructions(true);
    setInstructionsError(null);
    setInstructionsSaved(false);
    try {
      const result = await patchSettingsCron(id, { prompt });
      onCronUpdated?.(result.cron);
      setDetail((prev) =>
        prev
          ? { ...prev, prompt: result.cron.prompt ?? prompt }
          : {
              id: result.cron.id,
              name: result.cron.name,
              prompt: result.cron.prompt ?? prompt,
              enabled: result.cron.enabled,
              schedule:
                typeof result.cron.schedule === "string"
                  ? result.cron.schedule
                  : result.cron.schedule?.display ??
                    result.cron.schedule?.expr,
            },
      );
      setInstructionsDraft(result.cron.prompt ?? prompt);
      setInstructionsSaved(true);
    } catch (err) {
      setInstructionsError(
        err instanceof Error
          ? err.message
          : "Failed to save instructions",
      );
    } finally {
      setIsSavingInstructions(false);
    }
  }, [
    canEditInstructions,
    instructionsDraft,
    isSavingInstructions,
    jobId,
    onCronUpdated,
  ]);

  if (!jobId.trim()) {
    return (
      <VStack gap={2} data-testid="scheduled-task-config-pane">
        <Text type="body" color="secondary">
          This chat is not bound to a scheduled task job.
        </Text>
      </VStack>
    );
  }

  return (
    <VStack
      gap={4}
      data-testid="scheduled-task-config-pane"
      data-job-id={jobId}
      style={{ minWidth: 0 }}
    >
      <VStack gap={1} style={{ minWidth: 0 }}>
        <Text type="label" weight="semibold" maxLines={2}>
          {name}
        </Text>
        <Text type="supporting" color="secondary" maxLines={1}>
          Job · {jobId}
        </Text>
      </VStack>

      <div data-testid="scheduled-task-config-enabled">
        <Switch
          label={enabled ? "On" : "Off"}
          // No fire/pause helper under the switch (lp-pxr.3) — On/Off only.
          value={enabled}
          onChange={(next) => void handleToggle(next)}
          isDisabled={isToggling}
          labelPosition="start"
          labelSpacing="spread"
        />
        {toggleError ? (
          <Text
            type="supporting"
            color="critical"
            data-testid="scheduled-task-config-toggle-error"
          >
            {toggleError}
          </Text>
        ) : null}
      </div>

      <Divider />

      <MetadataList data-testid="scheduled-task-config-meta">
        <MetadataListItem label="Schedule">
          <span data-testid="scheduled-task-config-schedule">
            {humanizeSchedule(schedule)}
          </span>
        </MetadataListItem>
        <MetadataListItem label="Last run">
          <span data-testid="scheduled-task-config-last-run">
            {formatOptionalTimestamp(lastRun)}
          </span>
        </MetadataListItem>
        <MetadataListItem label="Next run">
          <span data-testid="scheduled-task-config-next-run">
            {enabled ? formatOptionalTimestamp(nextRun) : "— (paused)"}
          </span>
        </MetadataListItem>
        <MetadataListItem label="Last status">
          <span data-testid="scheduled-task-config-last-status">
            {lastStatus ? (
              <Badge
                label={formatStatus(lastStatus)}
                variant={
                  /error|fail/i.test(String(lastStatus))
                    ? "critical"
                    : /ok|success|complete/i.test(String(lastStatus))
                      ? "success"
                      : "neutral"
                }
              />
            ) : (
              "—"
            )}
          </span>
        </MetadataListItem>
      </MetadataList>

      <Divider />

      <VStack gap={2} data-testid="scheduled-task-config-instructions">
        {isLoadingDetail ? (
          <Spinner data-testid="scheduled-task-config-loading" />
        ) : canEditInstructions ? (
          <>
            {/* Single label only — no redundant "Instructions" supporting line (lp-pxr.3). */}
            <TextArea
              label="Agent instructions"
              value={instructionsDraft}
              onChange={(value) => {
                setInstructionsDraft(value);
                setInstructionsSaved(false);
                setInstructionsError(null);
              }}
              rows={6}
              isDisabled={isSavingInstructions}
              htmlName="scheduled-task-config-instructions"
              data-testid="scheduled-task-config-instructions-input"
            />
            <HStack gap={2} vAlign="center">
              <Button
                label="Save instructions"
                size="sm"
                variant="secondary"
                isDisabled={!instructionsDirty || isSavingInstructions}
                isLoading={isSavingInstructions}
                onClick={() => void handleSaveInstructions()}
                data-testid="scheduled-task-config-save-instructions"
              />
              {instructionsSaved ? (
                <Text
                  type="supporting"
                  color="secondary"
                  data-testid="scheduled-task-config-instructions-saved"
                >
                  Saved
                </Text>
              ) : null}
            </HStack>
            {instructionsError ? (
              <Text
                type="supporting"
                color="critical"
                data-testid="scheduled-task-config-instructions-error"
              >
                {instructionsError}
              </Text>
            ) : null}
          </>
        ) : savedInstructions ? (
          <VStack gap={1}>
            <Text type="label" weight="semibold">
              Agent instructions
            </Text>
            <div data-testid="scheduled-task-config-instructions-readonly">
              <Markdown headingLevelStart={3}>{savedInstructions}</Markdown>
            </div>
          </VStack>
        ) : (
          <VStack gap={1}>
            <Text type="label" weight="semibold">
              Agent instructions
            </Text>
            <Text
              type="body"
              color="secondary"
              data-testid="scheduled-task-config-instructions-empty"
            >
              {detailError
                ? "No instructions available from host for this job."
                : "No instructions available from host for this job."}
            </Text>
          </VStack>
        )}
      </VStack>
    </VStack>
  );
}
