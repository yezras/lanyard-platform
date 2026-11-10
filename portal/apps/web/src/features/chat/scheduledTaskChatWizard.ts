/**
 * Chat interactive create wizard for scheduled tasks (lp-jzl.9.1 / D4).
 * Skills step from settings.snapshot inventory: lp-jzl.9.2.
 *
 * Pure TypeScript — no React dependency. Agent or Portal story drives MCQ
 * portal_event prompts; selections arrive as mcq_selection (or equivalent).
 * Schedule is collected as HumanSchedule and encoded via scheduleCodec —
 * never as a raw cron string from the user.
 *
 * Normative shape:
 * docs/plans/0012-scheduled-tasks/decision-vocabulary-human-schedule-wizard.md (D4)
 */

import type { McqChoice } from "../../api/types.js";
import {
  encodeHumanSchedule,
  type EncodedCronSchedule,
  type HumanSchedule,
  type IsoWeekday,
  isValidIanaTimezone,
} from "../settings/scheduleCodec.js";
import {
  applySkillMcqChoice,
  buildSkillMcqChoices,
  skillIdsForJobWrite,
  shouldPromptForSkills,
  summarizeAttachedSkills,
  type InventorySkill,
} from "../settings/scheduledTaskSkills.js";

// ---------------------------------------------------------------------------
// Step / session model
// ---------------------------------------------------------------------------

/** Wizard step ids (mcq_id prefix uses these: st-<step>-<sessionId>). */
export type ScheduledTaskWizardStep =
  | "intent"
  | "instructions_template"
  | "instructions_text"
  | "days"
  | "days_custom"
  | "time"
  | "time_custom"
  | "timezone"
  | "skills"
  | "confirm"
  | "creating"
  | "done"
  | "cancelled";

/** Collected draft fields before create. */
export type ScheduledTaskWizardDraft = {
  name?: string;
  prompt?: string;
  daysOfWeek?: IsoWeekday[];
  time?: { hour: number; minute: number };
  timezone?: string;
  skills?: string[];
};

export type ScheduledTaskWizardMcqPrompt = {
  /** Outbound portal_event value. */
  portal_event: "mcq";
  mcq_id: string;
  content: string;
  choices: McqChoice[];
  /** Current step for this prompt. */
  step: ScheduledTaskWizardStep;
};

export type ScheduledTaskCreateBody = {
  name: string;
  prompt: string;
  enabled: boolean;
  schedule: EncodedCronSchedule;
  skills?: string[];
  /** Optional client-provided id. */
  id?: string;
};

export type ScheduledTaskWizardSession = {
  sessionId: string;
  step: ScheduledTaskWizardStep;
  draft: ScheduledTaskWizardDraft;
  /** Default browser/host timezone when known. */
  defaultTimezone: string | null;
  /**
   * settings.snapshot skills inventory (same as Settings). Used for optional
   * skill attachment (lp-jzl.9.2). Empty → skills step is skipped.
   */
  skillInventory: InventorySkill[];
  /** Last emitted MCQ (if waiting on selection). */
  activeMcq: ScheduledTaskWizardMcqPrompt | null;
  /** Human-readable status for chrome/proof. */
  statusMessage: string;
  /** True when create body is ready (after confirm Create). */
  readyToCreate: boolean;
  /** Built create body once ready (or after successful encode). */
  createBody: ScheduledTaskCreateBody | null;
  /** Created job id when host returns one (optional tracking). */
  createdJobId: string | null;
  error: string | null;
};

export type McqSelectionInput = {
  mcq_id: string;
  choice_id: string;
  choice_label?: string;
};

export type WizardApplyResult =
  | {
      ok: true;
      session: ScheduledTaskWizardSession;
      /** Next MCQ to emit (null when waiting for free text / create / done). */
      nextMcq: ScheduledTaskWizardMcqPrompt | null;
      /** When true, caller should POST createBody and refresh inventory. */
      shouldCreate: boolean;
    }
  | { ok: false; session: ScheduledTaskWizardSession; error: string };

// ---------------------------------------------------------------------------
// mcq_id helpers
// ---------------------------------------------------------------------------

const MCQ_ID_PREFIX = "st";

/** Build stable mcq_id: st-<step>-<sessionId> */
export function buildWizardMcqId(
  step: ScheduledTaskWizardStep,
  sessionId: string,
): string {
  return `${MCQ_ID_PREFIX}-${step}-${sessionId}`;
}

/**
 * Parse st-<step>-<sessionId>[~round]. Returns null when not a scheduled-task
 * wizard id. Optional `~N` suffix disambiguates multi-select re-prompts
 * (skills chain) without changing the logical session id.
 */
export function parseWizardMcqId(
  mcqId: string,
): { step: ScheduledTaskWizardStep; sessionId: string } | null {
  const raw = typeof mcqId === "string" ? mcqId.trim() : "";
  if (!raw.startsWith(`${MCQ_ID_PREFIX}-`)) return null;
  const rest = raw.slice(MCQ_ID_PREFIX.length + 1);
  const dash = rest.indexOf("-");
  if (dash <= 0 || dash === rest.length - 1) return null;
  const step = rest.slice(0, dash) as ScheduledTaskWizardStep;
  let sessionId = rest.slice(dash + 1);
  // Strip optional multi-select round suffix: st-skills-sess~2
  const tilde = sessionId.indexOf("~");
  if (tilde > 0) {
    sessionId = sessionId.slice(0, tilde);
  }
  if (!sessionId) return null;
  const known: ScheduledTaskWizardStep[] = [
    "intent",
    "instructions_template",
    "instructions_text",
    "days",
    "days_custom",
    "time",
    "time_custom",
    "timezone",
    "skills",
    "confirm",
    "creating",
    "done",
    "cancelled",
  ];
  if (!known.includes(step)) return null;
  return { step, sessionId };
}

/** True when mcq_id belongs to the scheduled-task chat wizard family. */
export function isScheduledTaskWizardMcqId(mcqId: string): boolean {
  return parseWizardMcqId(mcqId) !== null;
}

// ---------------------------------------------------------------------------
// Choice catalogs (D4 presets — no cron strings)
// ---------------------------------------------------------------------------

export const INTENT_CHOICES: readonly McqChoice[] = [
  { id: "yes", label: "Yes, create scheduled task" },
  { id: "no", label: "No, cancel" },
] as const;

export const INSTRUCTION_TEMPLATE_CHOICES: readonly McqChoice[] = [
  {
    id: "weekly_digest",
    label: "Weekly digest",
  },
  {
    id: "vault_index",
    label: "Vault index",
  },
  {
    id: "custom",
    label: "Custom…",
  },
] as const;

export const DAYS_PRESET_CHOICES: readonly McqChoice[] = [
  { id: "weekdays", label: "Weekdays (Mon–Fri)" },
  { id: "weekends", label: "Weekends (Sat–Sun)" },
  { id: "everyday", label: "Every day" },
  { id: "custom", label: "Choose specific days…" },
] as const;

/** ISO weekday multi-path: sequential yes/no when custom days. */
export const DAY_TOGGLE_CHOICES: readonly McqChoice[] = [
  { id: "yes", label: "Yes" },
  { id: "no", label: "No" },
  { id: "done", label: "Done selecting days" },
] as const;

export const TIME_PRESET_CHOICES: readonly McqChoice[] = [
  { id: "09:00", label: "9:00 AM" },
  { id: "12:00", label: "12:00 PM" },
  { id: "17:00", label: "5:00 PM" },
  { id: "custom", label: "Pick another time…" },
] as const;

export const CONFIRM_CHOICES: readonly McqChoice[] = [
  { id: "create", label: "Create scheduled task" },
  { id: "edit_schedule", label: "Edit schedule" },
  { id: "cancel", label: "Cancel" },
] as const;

const TEMPLATE_PROMPTS: Record<
  string,
  { name: string; prompt: string }
> = {
  weekly_digest: {
    name: "Weekly digest",
    prompt: "Summarize last week's vault changes for the team.",
  },
  vault_index: {
    name: "Vault index",
    prompt: "Refresh the vault search index.",
  },
};

const ISO_DAY_LABELS: Record<IsoWeekday, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  }
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** Detect browser IANA timezone when available. */
export function detectBrowserTimezone(): string | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (typeof tz === "string" && isValidIanaTimezone(tz)) return tz;
  } catch {
    /* ignore */
  }
  return null;
}

function daysFromPreset(id: string): IsoWeekday[] | null {
  switch (id) {
    case "weekdays":
      return [1, 2, 3, 4, 5];
    case "weekends":
      return [6, 7];
    case "everyday":
      return [1, 2, 3, 4, 5, 6, 7];
    default:
      return null;
  }
}

/**
 * Parse a human time string into 24h hour/minute.
 * Accepts "9:00 AM", "17:00", "5pm", "12:30pm".
 */
export function parseHumanTimeInput(
  text: string,
): { hour: number; minute: number } | null {
  const raw = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!raw) return null;

  // HH:MM 24h
  const m24 = raw.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
  if (m24) {
    return { hour: Number(m24[1]), minute: Number(m24[2]) };
  }

  // h:mm am/pm or h am/pm
  const m12 = raw.match(/^([1-9]|1[0-2])(?::([0-5]\d))?\s*(am|pm)$/);
  if (m12) {
    let hour = Number(m12[1]);
    const minute = m12[2] ? Number(m12[2]) : 0;
    const period = m12[3];
    if (period === "am") {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
    return { hour, minute };
  }

  // Compact "5pm" / "930am"
  const compact = raw.match(/^([1-9]|1[0-2])([0-5]\d)?(am|pm)$/);
  if (compact) {
    let hour = Number(compact[1]);
    const minute = compact[2] ? Number(compact[2]) : 0;
    const period = compact[3];
    if (period === "am") {
      if (hour === 12) hour = 0;
    } else if (hour !== 12) {
      hour += 12;
    }
    return { hour, minute };
  }

  return null;
}

/**
 * Parse free-text day list ("Mon, Wed, Fri" / "monday wednesday") into ISO days.
 */
export function parseHumanDaysInput(text: string): IsoWeekday[] | null {
  const raw = text.trim().toLowerCase();
  if (!raw) return null;

  if (raw === "weekdays" || raw === "weekday") return [1, 2, 3, 4, 5];
  if (raw === "weekends" || raw === "weekend") return [6, 7];
  if (
    raw === "everyday" ||
    raw === "every day" ||
    raw === "daily" ||
    raw === "all"
  ) {
    return [1, 2, 3, 4, 5, 6, 7];
  }

  const tokens = raw.split(/[\s,;/|]+/).filter(Boolean);
  const map: Record<string, IsoWeekday> = {
    mon: 1,
    monday: 1,
    tue: 2,
    tues: 2,
    tuesday: 2,
    wed: 3,
    weds: 3,
    wednesday: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    thursday: 4,
    fri: 5,
    friday: 5,
    sat: 6,
    saturday: 6,
    sun: 7,
    sunday: 7,
  };
  const seen = new Set<IsoWeekday>();
  for (const t of tokens) {
    const d = map[t];
    if (!d) return null;
    seen.add(d);
  }
  if (seen.size === 0) return null;
  return ([1, 2, 3, 4, 5, 6, 7] as IsoWeekday[]).filter((d) => seen.has(d));
}

function formatClock12(hour: number, minute: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${period}`;
}

function summarizeDraft(
  draft: ScheduledTaskWizardDraft,
  skillInventory: InventorySkill[] = [],
): string {
  const name = draft.name?.trim() || "Untitled task";
  const prompt = draft.prompt?.trim() || "(no instructions)";
  const promptShort =
    prompt.length > 80 ? `${prompt.slice(0, 77)}…` : prompt;
  let schedule = "Schedule not set";
  if (
    draft.daysOfWeek?.length &&
    draft.time &&
    draft.timezone &&
    isValidIanaTimezone(draft.timezone)
  ) {
    try {
      const enc = encodeHumanSchedule({
        daysOfWeek: draft.daysOfWeek,
        time: draft.time,
        timezone: draft.timezone,
      });
      schedule = enc.display;
    } catch {
      schedule = `${draft.daysOfWeek.map((d) => ISO_DAY_LABELS[d]).join(", ")} at ${formatClock12(draft.time.hour, draft.time.minute)} (${draft.timezone})`;
    }
  }
  const skillsLine = summarizeAttachedSkills(draft.skills, skillInventory);
  return `**${name}**\n${schedule}\nInstructions: ${promptShort}\nSkills: ${skillsLine}`;
}

function mcq(
  step: ScheduledTaskWizardStep,
  sessionId: string,
  content: string,
  choices: readonly McqChoice[],
): ScheduledTaskWizardMcqPrompt {
  return {
    portal_event: "mcq",
    mcq_id: buildWizardMcqId(step, sessionId),
    content,
    choices: choices.map((c) => ({ ...c })),
    step,
  };
}

function timezoneChoices(defaultTz: string | null): McqChoice[] {
  if (defaultTz && isValidIanaTimezone(defaultTz)) {
    // When the browser default is already UTC, skip a second "Use UTC" chip
    // (duplicate accessible names break findByRole in jsdom/CI).
    const choices: McqChoice[] = [
      { id: "use_default", label: `Use ${defaultTz}` },
    ];
    if (defaultTz !== "UTC") {
      choices.push({ id: "utc", label: "Use UTC" });
    }
    choices.push({ id: "other", label: "Choose another…" });
    return choices;
  }
  return [
    { id: "utc", label: "Use UTC" },
    { id: "america_new_york", label: "America/New_York" },
    { id: "america_los_angeles", label: "America/Los_Angeles" },
    { id: "europe_london", label: "Europe/London" },
    { id: "other", label: "Type an IANA timezone…" },
  ];
}

function withMcq(
  session: ScheduledTaskWizardSession,
  prompt: ScheduledTaskWizardMcqPrompt,
  statusMessage: string,
): ScheduledTaskWizardSession {
  return {
    ...session,
    step: prompt.step,
    activeMcq: prompt,
    statusMessage,
    readyToCreate: false,
    error: null,
  };
}

function waitingText(
  session: ScheduledTaskWizardSession,
  step: ScheduledTaskWizardStep,
  statusMessage: string,
): ScheduledTaskWizardSession {
  return {
    ...session,
    step,
    activeMcq: null,
    statusMessage,
    readyToCreate: false,
    error: null,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type CreateWizardOptions = {
  sessionId?: string;
  /** Browser/host default IANA timezone. */
  defaultTimezone?: string | null;
  /** Skip optional intent confirm (start at instructions). */
  skipIntent?: boolean;
  /** Seed draft fields (e.g. prefilled name from NL intent). */
  seed?: Partial<ScheduledTaskWizardDraft>;
  /**
   * settings.snapshot skills (vault / host inventory). Same source as Settings.
   * When empty/omitted, the skills step is skipped (optional attach).
   */
  skillInventory?: InventorySkill[] | null;
};

/**
 * Start a new scheduled-task create wizard session and emit the first MCQ.
 */
export function createScheduledTaskWizardSession(
  options: CreateWizardOptions = {},
): {
  session: ScheduledTaskWizardSession;
  firstMcq: ScheduledTaskWizardMcqPrompt | null;
} {
  const sessionId = options.sessionId?.trim() || newSessionId();
  const defaultTimezone =
    options.defaultTimezone === undefined
      ? detectBrowserTimezone()
      : options.defaultTimezone;
  const skillInventory = Array.isArray(options.skillInventory)
    ? options.skillInventory.map((s) => ({ ...s }))
    : [];

  let session: ScheduledTaskWizardSession = {
    sessionId,
    step: "intent",
    draft: { ...(options.seed ?? {}) },
    defaultTimezone,
    skillInventory,
    activeMcq: null,
    statusMessage: "Starting scheduled task wizard…",
    readyToCreate: false,
    createBody: null,
    createdJobId: null,
    error: null,
  };

  if (options.skipIntent) {
    const prompt = mcq(
      "instructions_template",
      sessionId,
      "What should this scheduled task do?",
      INSTRUCTION_TEMPLATE_CHOICES,
    );
    session = withMcq(session, prompt, "Choose a template or Custom…");
    return { session, firstMcq: prompt };
  }

  const prompt = mcq(
    "intent",
    sessionId,
    "Create a scheduled task? (recurring schedule — not a one-shot chat)",
    INTENT_CHOICES,
  );
  session = withMcq(session, prompt, "Confirm you want a scheduled task");
  return { session, firstMcq: prompt };
}

/**
 * Build create POST body from a complete draft. Encodes HumanSchedule →
 * structured schedule (expr/display/timezone). Throws if incomplete/invalid.
 * Never accepts a user-supplied cron string.
 *
 * When `skillInventory` is provided, skill ids are validated against the
 * snapshot inventory (lp-jzl.9.2) and only known ids are stored on the job.
 */
export function buildScheduledTaskCreateBody(
  draft: ScheduledTaskWizardDraft,
  options: { skillInventory?: InventorySkill[] | null } = {},
): ScheduledTaskCreateBody {
  const name = draft.name?.trim();
  const prompt = draft.prompt?.trim();
  if (!name) {
    throw new Error("Scheduled task name is required");
  }
  if (!prompt) {
    throw new Error("Scheduled task instructions are required");
  }
  if (!draft.daysOfWeek?.length || !draft.time || !draft.timezone) {
    throw new Error("Schedule (days, time, timezone) is required");
  }

  const human: HumanSchedule = {
    daysOfWeek: draft.daysOfWeek,
    time: draft.time,
    timezone: draft.timezone,
  };
  // Fail closed via codec — no raw cron path.
  const schedule = encodeHumanSchedule(human);

  const body: ScheduledTaskCreateBody = {
    name,
    prompt,
    enabled: true,
    schedule,
  };
  if (draft.skills?.length) {
    if (options.skillInventory !== undefined) {
      const skills = skillIdsForJobWrite(draft.skills, options.skillInventory);
      if (skills?.length) body.skills = skills;
    } else {
      body.skills = [...draft.skills];
    }
  }
  return body;
}

/**
 * Outbound portal_event metadata object for agent → portal send.
 */
export function wizardMcqToPortalMetadata(
  prompt: ScheduledTaskWizardMcqPrompt,
): {
  portal_event: "mcq";
  mcq_id: string;
  choices: McqChoice[];
} {
  return {
    portal_event: "mcq",
    mcq_id: prompt.mcq_id,
    choices: prompt.choices,
  };
}

/**
 * Inbound mcq_selection metadata shape (portal → agent), for docs/tests.
 */
export function wizardSelectionToInboundMetadata(
  selection: McqSelectionInput,
): {
  portal_inbound: "mcq_selection";
  mcq_id: string;
  choice_id: string;
  choice_label?: string;
} {
  return {
    portal_inbound: "mcq_selection",
    mcq_id: selection.mcq_id,
    choice_id: selection.choice_id,
    ...(selection.choice_label
      ? { choice_label: selection.choice_label }
      : {}),
  };
}

function advanceAfterInstructions(
  session: ScheduledTaskWizardSession,
): WizardApplyResult {
  const prompt = mcq(
    "days",
    session.sessionId,
    "Which days should this scheduled task run?",
    DAYS_PRESET_CHOICES,
  );
  const next = withMcq(session, prompt, "Choose days (presets — no cron)");
  return { ok: true, session: next, nextMcq: prompt, shouldCreate: false };
}

function advanceAfterDays(
  session: ScheduledTaskWizardSession,
): WizardApplyResult {
  const prompt = mcq(
    "time",
    session.sessionId,
    "What time of day should it run? (local time)",
    TIME_PRESET_CHOICES,
  );
  const next = withMcq(session, prompt, "Choose a time (12h labels)");
  return { ok: true, session: next, nextMcq: prompt, shouldCreate: false };
}

function advanceAfterTime(
  session: ScheduledTaskWizardSession,
): WizardApplyResult {
  const prompt = mcq(
    "timezone",
    session.sessionId,
    session.defaultTimezone
      ? `Which timezone? (detected ${session.defaultTimezone})`
      : "Which timezone should this scheduled task use?",
    timezoneChoices(session.defaultTimezone),
  );
  const next = withMcq(session, prompt, "Confirm timezone");
  return { ok: true, session: next, nextMcq: prompt, shouldCreate: false };
}

/**
 * After timezone: optional skills step from snapshot inventory (lp-jzl.9.2).
 * Skipped when inventory has no attachable (enabled) skills.
 */
function advanceAfterTimezone(
  session: ScheduledTaskWizardSession,
): WizardApplyResult {
  if (!shouldPromptForSkills(session.skillInventory)) {
    return advanceToConfirm({
      ...session,
      draft: { ...session.draft, skills: session.draft.skills ?? [] },
    });
  }
  const prompt = mcq(
    "skills",
    session.sessionId,
    "Attach skills from your inventory? (optional — same list as Settings → Skills)",
    buildSkillMcqChoices(session.skillInventory, session.draft.skills ?? []),
  );
  const next = withMcq(
    session,
    prompt,
    "Optional skill attachment from snapshot inventory",
  );
  return { ok: true, session: next, nextMcq: prompt, shouldCreate: false };
}

function advanceToConfirm(
  session: ScheduledTaskWizardSession,
): WizardApplyResult {
  const summary = summarizeDraft(session.draft, session.skillInventory);
  const prompt = mcq(
    "confirm",
    session.sessionId,
    `Review and create this scheduled task:\n\n${summary}`,
    CONFIRM_CHOICES,
  );
  const next = withMcq(session, prompt, "Confirm create");
  return { ok: true, session: next, nextMcq: prompt, shouldCreate: false };
}

/**
 * Apply an MCQ selection (portal_inbound mcq_selection) to the wizard.
 * Ignores selections for other sessions or stale steps.
 */
export function applyWizardMcqSelection(
  session: ScheduledTaskWizardSession,
  selection: McqSelectionInput,
): WizardApplyResult {
  if (
    session.step === "done" ||
    session.step === "cancelled" ||
    session.step === "creating"
  ) {
    return {
      ok: false,
      session,
      error: `Wizard is ${session.step}; cannot apply selection`,
    };
  }

  const parsed = parseWizardMcqId(selection.mcq_id);
  if (!parsed || parsed.sessionId !== session.sessionId) {
    return {
      ok: false,
      session,
      error: "mcq_id does not match this scheduled-task wizard session",
    };
  }

  // Stale step selection: ignore with soft error so agent can re-prompt.
  if (parsed.step !== session.step && session.activeMcq) {
    // Allow activeMcq.step to be authoritative when step was advanced but
    // activeMcq not cleared (defensive).
    if (session.activeMcq.mcq_id !== selection.mcq_id) {
      return {
        ok: false,
        session,
        error: `Unexpected mcq step ${parsed.step}; wizard is on ${session.step}`,
      };
    }
  }

  const choiceId = selection.choice_id.trim();
  if (!choiceId) {
    return { ok: false, session, error: "choice_id is required" };
  }

  switch (parsed.step) {
    case "intent": {
      if (choiceId === "no" || choiceId === "cancel") {
        const next: ScheduledTaskWizardSession = {
          ...session,
          step: "cancelled",
          activeMcq: null,
          statusMessage: "Cancelled — no scheduled task created.",
          readyToCreate: false,
          createBody: null,
          error: null,
        };
        return { ok: true, session: next, nextMcq: null, shouldCreate: false };
      }
      if (choiceId === "yes") {
        const prompt = mcq(
          "instructions_template",
          session.sessionId,
          "What should this scheduled task do?",
          INSTRUCTION_TEMPLATE_CHOICES,
        );
        const next = withMcq(
          session,
          prompt,
          "Choose a template or Custom…",
        );
        return {
          ok: true,
          session: next,
          nextMcq: prompt,
          shouldCreate: false,
        };
      }
      return { ok: false, session, error: `Unknown intent choice: ${choiceId}` };
    }

    case "instructions_template": {
      if (choiceId === "custom") {
        const next = waitingText(
          session,
          "instructions_text",
          "Reply with a short title and what the task should do (free text — not a cron string).",
        );
        return { ok: true, session: next, nextMcq: null, shouldCreate: false };
      }
      const tmpl = TEMPLATE_PROMPTS[choiceId];
      if (!tmpl) {
        return {
          ok: false,
          session,
          error: `Unknown template: ${choiceId}`,
        };
      }
      const draft = {
        ...session.draft,
        name: session.draft.name ?? tmpl.name,
        prompt: session.draft.prompt ?? tmpl.prompt,
      };
      return advanceAfterInstructions({ ...session, draft });
    }

    case "days": {
      if (choiceId === "custom") {
        const next = waitingText(
          session,
          "days_custom",
          "Reply with days (e.g. Mon, Wed, Fri) — or weekdays / weekends / everyday.",
        );
        return { ok: true, session: next, nextMcq: null, shouldCreate: false };
      }
      const days = daysFromPreset(choiceId);
      if (!days) {
        return { ok: false, session, error: `Unknown days choice: ${choiceId}` };
      }
      return advanceAfterDays({
        ...session,
        draft: { ...session.draft, daysOfWeek: days },
      });
    }

    case "time": {
      if (choiceId === "custom") {
        const next = waitingText(
          session,
          "time_custom",
          "Reply with a time (e.g. 3:30 PM or 15:30) — not a cron expression.",
        );
        return { ok: true, session: next, nextMcq: null, shouldCreate: false };
      }
      const m = choiceId.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
      if (!m) {
        return { ok: false, session, error: `Unknown time choice: ${choiceId}` };
      }
      return advanceAfterTime({
        ...session,
        draft: {
          ...session.draft,
          time: { hour: Number(m[1]), minute: Number(m[2]) },
        },
      });
    }

    case "timezone": {
      let timezone: string | null = null;
      if (choiceId === "use_default" && session.defaultTimezone) {
        timezone = session.defaultTimezone;
      } else if (choiceId === "utc") {
        timezone = "UTC";
      } else if (choiceId === "america_new_york") {
        timezone = "America/New_York";
      } else if (choiceId === "america_los_angeles") {
        timezone = "America/Los_Angeles";
      } else if (choiceId === "europe_london") {
        timezone = "Europe/London";
      } else if (choiceId === "other") {
        const next = waitingText(
          session,
          "timezone",
          "Reply with an IANA timezone id (e.g. America/Chicago).",
        );
        // Keep step timezone but clear active MCQ so free-text apply works.
        return { ok: true, session: next, nextMcq: null, shouldCreate: false };
      } else if (isValidIanaTimezone(choiceId)) {
        timezone = choiceId.trim();
      } else if (
        selection.choice_label &&
        isValidIanaTimezone(selection.choice_label)
      ) {
        timezone = selection.choice_label.trim();
      }

      if (!timezone || !isValidIanaTimezone(timezone)) {
        return {
          ok: false,
          session,
          error: `Unknown or invalid timezone choice: ${choiceId}`,
        };
      }
      return advanceAfterTimezone({
        ...session,
        draft: { ...session.draft, timezone },
      });
    }

    case "skills": {
      const applied = applySkillMcqChoice(
        choiceId,
        session.skillInventory,
        session.draft.skills ?? [],
      );
      if (!applied.ok) {
        return { ok: false, session, error: applied.error };
      }
      const withSkills: ScheduledTaskWizardSession = {
        ...session,
        draft: { ...session.draft, skills: applied.skills },
      };
      if (applied.complete) {
        return advanceToConfirm(withSkills);
      }
      // Multi-select chain: re-prompt with remaining skills.
      // Unique mcq_id per round (`~N`) so chat timeline keys stay unique.
      const round = applied.skills.length;
      const roundSessionKey = `${session.sessionId}~${round}`;
      const prompt = mcq(
        "skills",
        roundSessionKey,
        `Skill attached. Add another, or finish? (selected: ${applied.skills.join(", ")})`,
        buildSkillMcqChoices(session.skillInventory, applied.skills),
      );
      // mcq() embeds session key in mcq_id; logical sessionId stays on session.
      const next = withMcq(
        withSkills,
        prompt,
        "Optional skill attachment (add more or Done)",
      );
      return { ok: true, session: next, nextMcq: prompt, shouldCreate: false };
    }

    case "confirm": {
      if (choiceId === "cancel") {
        const next: ScheduledTaskWizardSession = {
          ...session,
          step: "cancelled",
          activeMcq: null,
          statusMessage: "Cancelled — no scheduled task created.",
          readyToCreate: false,
          createBody: null,
          error: null,
        };
        return { ok: true, session: next, nextMcq: null, shouldCreate: false };
      }
      if (choiceId === "edit_schedule") {
        return advanceAfterInstructions(session);
      }
      if (choiceId === "create") {
        try {
          const createBody = buildScheduledTaskCreateBody(session.draft, {
            skillInventory: session.skillInventory,
          });
          const next: ScheduledTaskWizardSession = {
            ...session,
            step: "creating",
            activeMcq: null,
            statusMessage: "Creating scheduled task…",
            readyToCreate: true,
            createBody,
            error: null,
          };
          return {
            ok: true,
            session: next,
            nextMcq: null,
            shouldCreate: true,
          };
        } catch (err) {
          const message =
            err instanceof Error ? err.message : "Failed to build create body";
          return {
            ok: false,
            session: { ...session, error: message },
            error: message,
          };
        }
      }
      return {
        ok: false,
        session,
        error: `Unknown confirm choice: ${choiceId}`,
      };
    }

    default:
      return {
        ok: false,
        session,
        error: `Step ${parsed.step} expects free text, not MCQ selection`,
      };
  }
}

/**
 * Apply free-text user reply for instructions / custom days / custom time / TZ.
 * Never treats the text as a cron expression.
 */
export function applyWizardTextInput(
  session: ScheduledTaskWizardSession,
  text: string,
): WizardApplyResult {
  const value = text.trim();
  if (!value) {
    return { ok: false, session, error: "Empty reply" };
  }

  // Reject obvious cron paste attempts on free-text schedule steps.
  const looksLikeCron =
    /^[\d*/,\-\s]+$/.test(value) && value.split(/\s+/).length >= 5;

  switch (session.step) {
    case "instructions_text": {
      // First line = name if short; whole text = prompt. Heuristic for MVP.
      const lines = value.split(/\n+/).map((l) => l.trim()).filter(Boolean);
      let name = session.draft.name;
      let prompt = value;
      if (lines.length >= 2 && lines[0]!.length <= 60) {
        name = lines[0];
        prompt = lines.slice(1).join("\n");
      } else if (!name) {
        // Derive a short name from first ~40 chars.
        name =
          value.length > 40
            ? `${value.slice(0, 37).trim()}…`
            : value;
      }
      return advanceAfterInstructions({
        ...session,
        draft: { ...session.draft, name, prompt },
      });
    }

    case "days_custom": {
      if (looksLikeCron) {
        return {
          ok: false,
          session,
          error:
            "Please list weekdays (e.g. Mon, Wed, Fri) — not a cron expression.",
        };
      }
      const days = parseHumanDaysInput(value);
      if (!days) {
        return {
          ok: false,
          session,
          error:
            "Could not parse days. Try: Mon, Wed, Fri — or weekdays / weekends / everyday.",
        };
      }
      return advanceAfterDays({
        ...session,
        draft: { ...session.draft, daysOfWeek: days },
      });
    }

    case "time_custom": {
      if (looksLikeCron) {
        return {
          ok: false,
          session,
          error: "Please enter a clock time (e.g. 3:30 PM) — not a cron expression.",
        };
      }
      const time = parseHumanTimeInput(value);
      if (!time) {
        return {
          ok: false,
          session,
          error: "Could not parse time. Try 9:00 AM, 17:00, or 5pm.",
        };
      }
      return advanceAfterTime({
        ...session,
        draft: { ...session.draft, time },
      });
    }

    case "timezone": {
      // Free-text IANA when "other" was chosen.
      if (!session.activeMcq) {
        if (looksLikeCron) {
          return {
            ok: false,
            session,
            error: "Please enter an IANA timezone (e.g. America/Chicago).",
          };
        }
        if (!isValidIanaTimezone(value)) {
          return {
            ok: false,
            session,
            error: `Unknown IANA timezone: ${value}`,
          };
        }
        return advanceAfterTimezone({
          ...session,
          draft: { ...session.draft, timezone: value },
        });
      }
      return {
        ok: false,
        session,
        error: "Wizard expects an MCQ selection for the current step",
      };
    }

    default:
      return {
        ok: false,
        session,
        error: `Step ${session.step} does not accept free text`,
      };
  }
}

/**
 * Mark wizard complete after successful create (inventory refresh is caller's job).
 */
export function markWizardCreateSucceeded(
  session: ScheduledTaskWizardSession,
  createdJobId?: string | null,
): ScheduledTaskWizardSession {
  const id = createdJobId?.trim() || session.createBody?.name || "task";
  return {
    ...session,
    step: "done",
    activeMcq: null,
    readyToCreate: false,
    createdJobId: createdJobId?.trim() || session.createdJobId,
    statusMessage: `Scheduled task created: ${id}`,
    error: null,
  };
}

/**
 * Mark wizard failed after create error (no fake success).
 * Restores the confirm MCQ so the host can re-emit chips for retry/edit/cancel.
 */
export function markWizardCreateFailed(
  session: ScheduledTaskWizardSession,
  error: string,
): ScheduledTaskWizardSession {
  const summary = summarizeDraft(session.draft, session.skillInventory);
  const prompt = mcq(
    "confirm",
    session.sessionId,
    `Review and create this scheduled task:\n\n${summary}`,
    CONFIRM_CHOICES,
  );
  return {
    ...session,
    step: "confirm",
    activeMcq: prompt,
    readyToCreate: false,
    statusMessage: `Create failed: ${error}`,
    error,
  };
}
