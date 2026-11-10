/**
 * Settings → New scheduled task form (lp-jzl.5).
 *
 * Fields: title, agent instructions, human schedule builder (days + time + tz),
 * enable. Submit via POST /api/settings/crons. No raw cron expression field.
 *
 * Schedule encoding: scheduleCodec (lp-jzl.2 / decision D3).
 */

import { useMemo, useState, type FormEvent } from "react";

import { Button } from "@astryxdesign/core/Button";
import { HStack } from "@astryxdesign/core/HStack";
import { Selector } from "@astryxdesign/core/Selector";
import { Text } from "@astryxdesign/core/Text";
import { TextArea } from "@astryxdesign/core/TextArea";
import { TextInput } from "@astryxdesign/core/TextInput";
import { VStack } from "@astryxdesign/core/VStack";

import type { SettingsCronCreateRequest } from "../../api/types.js";
import {
  encodeHumanSchedule,
  isValidIanaTimezone,
  type HumanSchedule,
  type IsoWeekday,
  ScheduleCodecError,
} from "./scheduleCodec.js";

const ISO_DAY_OPTIONS: { day: IsoWeekday; short: string; label: string }[] = [
  { day: 1, short: "Mon", label: "Monday" },
  { day: 2, short: "Tue", label: "Tuesday" },
  { day: 3, short: "Wed", label: "Wednesday" },
  { day: 4, short: "Thu", label: "Thursday" },
  { day: 5, short: "Fri", label: "Friday" },
  { day: 6, short: "Sat", label: "Saturday" },
  { day: 7, short: "Sun", label: "Sunday" },
];

/** Common IANA zones for the selector; browser TZ always included if missing. */
const COMMON_TIMEZONES = [
  "UTC",
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Los_Angeles",
  "America/Toronto",
  "America/Sao_Paulo",
  "Europe/London",
  "Europe/Paris",
  "Europe/Berlin",
  "Europe/Amsterdam",
  "Asia/Tokyo",
  "Asia/Shanghai",
  "Asia/Singapore",
  "Asia/Kolkata",
  "Australia/Sydney",
  "Pacific/Auckland",
] as const;

function detectBrowserTimezone(): string {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && isValidIanaTimezone(tz)) return tz;
  } catch {
    // ignore
  }
  return "UTC";
}

function parseTimeInput(value: string): { hour: number; minute: number } | null {
  const trimmed = value.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (
    !Number.isInteger(hour) ||
    !Number.isInteger(minute) ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }
  return { hour, minute };
}

function formatTimeInput(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export type NewScheduledTaskFormProps = {
  /** When true, form controls are disabled (submit in flight). */
  isSubmitting?: boolean;
  /** Submit error message to show under the form. */
  errorMessage?: string | null;
  onCancel: () => void;
  /**
   * Called with the wire body for POST /api/settings/crons.
   * Parent owns API call + snapshot update.
   */
  onSubmit: (body: SettingsCronCreateRequest) => void | Promise<void>;
};

export function NewScheduledTaskForm({
  isSubmitting = false,
  errorMessage = null,
  onCancel,
  onSubmit,
}: NewScheduledTaskFormProps) {
  const browserTz = useMemo(() => detectBrowserTimezone(), []);
  const timezoneOptions = useMemo(() => {
    const set = new Set<string>(COMMON_TIMEZONES);
    set.add(browserTz);
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [browserTz]);

  const [title, setTitle] = useState("");
  const [instructions, setInstructions] = useState("");
  const [daysOfWeek, setDaysOfWeek] = useState<IsoWeekday[]>([1, 2, 3, 4, 5]);
  const [timeValue, setTimeValue] = useState("09:00");
  const [timezone, setTimezone] = useState(browserTz);
  const [localError, setLocalError] = useState<string | null>(null);

  function toggleDay(day: IsoWeekday) {
    setDaysOfWeek((prev) => {
      if (prev.includes(day)) {
        const next = prev.filter((d) => d !== day);
        return next;
      }
      return [...prev, day].sort((a, b) => a - b) as IsoWeekday[];
    });
  }

  function selectPreset(preset: "weekdays" | "weekends" | "everyday") {
    if (preset === "weekdays") setDaysOfWeek([1, 2, 3, 4, 5]);
    else if (preset === "weekends") setDaysOfWeek([6, 7]);
    else setDaysOfWeek([1, 2, 3, 4, 5, 6, 7]);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLocalError(null);

    const name = title.trim();
    const prompt = instructions.trim();
    if (!name) {
      setLocalError("Title is required.");
      return;
    }
    if (!prompt) {
      setLocalError("Agent instructions are required.");
      return;
    }
    if (daysOfWeek.length === 0) {
      setLocalError("Select at least one day.");
      return;
    }
    const time = parseTimeInput(timeValue);
    if (!time) {
      setLocalError("Enter a valid time as HH:MM (24-hour).");
      return;
    }
    if (!isValidIanaTimezone(timezone)) {
      setLocalError("Choose a valid timezone.");
      return;
    }

    const human: HumanSchedule = {
      daysOfWeek,
      time,
      timezone,
    };

    let encoded;
    try {
      encoded = encodeHumanSchedule(human);
    } catch (err) {
      const message =
        err instanceof ScheduleCodecError
          ? err.message
          : err instanceof Error
            ? err.message
            : "Could not build schedule.";
      setLocalError(message);
      return;
    }

    const body: SettingsCronCreateRequest = {
      name,
      prompt,
      enabled: true,
      schedule: {
        kind: encoded.kind,
        expr: encoded.expr,
        display: encoded.display,
        timezone: encoded.timezone,
      },
    };

    await onSubmit(body);
  }

  const displayError = localError ?? errorMessage;

  return (
    <form
      data-testid="new-scheduled-task-form"
      onSubmit={(e) => void handleSubmit(e)}
      noValidate
    >
      <VStack gap={4} align="start" style={{ width: "100%", maxWidth: 560 }}>
        <TextInput
          label="Title"
          value={title}
          onChange={setTitle}
          placeholder="Weekly vault digest"
          isDisabled={isSubmitting}
          htmlName="scheduled-task-title"
          data-testid="new-scheduled-task-title"
        />

        <TextArea
          label="Agent instructions"
          value={instructions}
          onChange={setInstructions}
          rows={4}
          isDisabled={isSubmitting}
          htmlName="scheduled-task-instructions"
          data-testid="new-scheduled-task-instructions"
        />

        <VStack gap={2} align="start" style={{ width: "100%" }}>
          <Text type="body" weight="semibold">
            Schedule
          </Text>

          <HStack gap={2} style={{ flexWrap: "wrap" }}>
            <Button
              type="button"
              label="Weekdays"
              size="sm"
              variant="ghost"
              isDisabled={isSubmitting}
              onClick={() => selectPreset("weekdays")}
              data-testid="new-scheduled-task-preset-weekdays"
            />
            <Button
              type="button"
              label="Weekends"
              size="sm"
              variant="ghost"
              isDisabled={isSubmitting}
              onClick={() => selectPreset("weekends")}
              data-testid="new-scheduled-task-preset-weekends"
            />
            <Button
              type="button"
              label="Every day"
              size="sm"
              variant="ghost"
              isDisabled={isSubmitting}
              onClick={() => selectPreset("everyday")}
              data-testid="new-scheduled-task-preset-everyday"
            />
          </HStack>

          <div
            role="group"
            aria-label="Days of the week"
            data-testid="new-scheduled-task-days"
            style={{ display: "flex", flexWrap: "wrap", gap: 8 }}
          >
            {ISO_DAY_OPTIONS.map(({ day, short, label }) => {
              const selected = daysOfWeek.includes(day);
              return (
                <Button
                  key={day}
                  type="button"
                  label={short}
                  size="sm"
                  variant={selected ? "secondary" : "ghost"}
                  isDisabled={isSubmitting}
                  aria-pressed={selected}
                  aria-label={label}
                  data-testid={`new-scheduled-task-day-${day}`}
                  onClick={() => toggleDay(day)}
                />
              );
            })}
          </div>

          <TextInput
            label="Time"
            value={timeValue}
            onChange={setTimeValue}
            placeholder="09:00"
            isDisabled={isSubmitting}
            htmlName="scheduled-task-time"
            data-testid="new-scheduled-task-time"
          />

          <Selector
            label="Timezone"
            options={timezoneOptions}
            value={timezone}
            onChange={(value) => {
              if (typeof value === "string") setTimezone(value);
            }}
            isDisabled={isSubmitting}
            data-testid="new-scheduled-task-timezone"
          />
        </VStack>

        {displayError ? (
          <Text
            type="supporting"
            color="secondary"
            data-testid="new-scheduled-task-error"
            role="alert"
          >
            {displayError}
          </Text>
        ) : null}

        <HStack gap={3}>
          <Button
            type="submit"
            label="Create scheduled task"
            variant="primary"
            isLoading={isSubmitting}
            isDisabled={isSubmitting}
            data-testid="new-scheduled-task-submit"
          />
          <Button
            type="button"
            label="Cancel"
            variant="ghost"
            isDisabled={isSubmitting}
            onClick={onCancel}
            data-testid="new-scheduled-task-cancel"
          />
        </HStack>
      </VStack>
    </form>
  );
}

/** Exported for tests — format default time string. */
export { formatTimeInput, parseTimeInput, detectBrowserTimezone };
