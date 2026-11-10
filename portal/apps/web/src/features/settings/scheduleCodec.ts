/**
 * Human schedule ↔ 5-field cron codec (lp-jzl.2).
 *
 * Normative model: docs/plans/0012-scheduled-tasks/decision-vocabulary-human-schedule-wizard.md (D3).
 * Pure TypeScript — no React/UI dependency.
 *
 * Day-of-week mapping:
 *   ISO 1=Mon … 7=Sun  →  cron 1=Mon … 6=Sat, 0=Sun
 * Encode always uses 0 for Sunday (never 7). Decode accepts cron 0 or 7 as Sunday.
 */

/** ISO-8601 weekday: 1=Monday … 7=Sunday. */
export type IsoWeekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Human schedule for recurring weekly-pattern tasks (MVP). */
export type HumanSchedule = {
  /** ISO weekday numbers 1=Monday … 7=Sunday. At least one. */
  daysOfWeek: IsoWeekday[];
  /** Local wall-clock time in the chosen timezone. */
  time: {
    hour: number; // 0–23
    minute: number; // 0–59
  };
  /** IANA timezone id (e.g. "America/New_York", "UTC"). Required on write. */
  timezone: string;
};

/** Encoded form compatible with product store schedule.kind = "cron". */
export type EncodedCronSchedule = {
  kind: "cron";
  expr: string;
  display: string;
  timezone: string;
};

export type DecodeHumanScheduleResult =
  | { ok: true; schedule: HumanSchedule }
  | { ok: false; reason: string };

export class ScheduleCodecError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ScheduleCodecError";
    this.code = code;
  }
}

const ISO_WEEKDAYS: readonly IsoWeekday[] = [1, 2, 3, 4, 5, 6, 7];

const ISO_DAY_NAMES: Record<IsoWeekday, string> = {
  1: "Monday",
  2: "Tuesday",
  3: "Wednesday",
  4: "Thursday",
  5: "Friday",
  6: "Saturday",
  7: "Sunday",
};

/** ISO weekday → cron DOW digit (0=Sunday … 6=Saturday). */
export function isoWeekdayToCronDow(day: IsoWeekday): number {
  return day === 7 ? 0 : day;
}

/** Cron DOW digit (0 or 7 = Sunday) → ISO weekday. */
export function cronDowToIsoWeekday(cronDow: number): IsoWeekday | null {
  if (cronDow === 0 || cronDow === 7) return 7;
  if (cronDow >= 1 && cronDow <= 6) return cronDow as IsoWeekday;
  return null;
}

/** True when `tz` is a recognized IANA timezone id. */
export function isValidIanaTimezone(tz: string): boolean {
  const trimmed = typeof tz === "string" ? tz.trim() : "";
  if (!trimmed) return false;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return true;
  } catch {
    return false;
  }
}

function assertIntegerInRange(
  value: unknown,
  min: number,
  max: number,
  code: string,
  label: string,
): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new ScheduleCodecError(code, `${label} must be an integer`);
  }
  if (value < min || value > max) {
    throw new ScheduleCodecError(
      code,
      `${label} must be between ${min} and ${max} (got ${value})`,
    );
  }
  return value;
}

function normalizeDaysOfWeek(days: unknown): IsoWeekday[] {
  if (!Array.isArray(days) || days.length === 0) {
    throw new ScheduleCodecError(
      "empty_days",
      "daysOfWeek must contain at least one weekday",
    );
  }
  const seen = new Set<IsoWeekday>();
  for (const d of days) {
    if (typeof d !== "number" || !Number.isInteger(d) || d < 1 || d > 7) {
      throw new ScheduleCodecError(
        "invalid_day",
        `Invalid ISO weekday ${String(d)}; expected 1–7`,
      );
    }
    seen.add(d as IsoWeekday);
  }
  // Stable ISO order Mon→Sun for encode/display.
  return ISO_WEEKDAYS.filter((d) => seen.has(d));
}

/**
 * Collapse sorted unique cron DOW digits into a compact field
 * (ranges for consecutive, commas otherwise). Prefer 0 for Sunday.
 */
export function formatCronDowField(cronDows: number[]): string {
  const unique = [...new Set(cronDows.map((n) => (n === 7 ? 0 : n)))].sort(
    (a, b) => a - b,
  );
  if (unique.length === 0) {
    throw new ScheduleCodecError("empty_days", "No day-of-week values to encode");
  }
  if (unique.some((n) => n < 0 || n > 6 || !Number.isInteger(n))) {
    throw new ScheduleCodecError("invalid_day", "Invalid cron day-of-week digit");
  }

  const ranges: string[] = [];
  let start = unique[0]!;
  let end = start;
  for (let i = 1; i < unique.length; i++) {
    const n = unique[i]!;
    if (n === end + 1) {
      end = n;
      continue;
    }
    ranges.push(start === end ? String(start) : `${start}-${end}`);
    start = end = n;
  }
  ranges.push(start === end ? String(start) : `${start}-${end}`);
  return ranges.join(",");
}

function formatClock12(hour: number, minute: number): string {
  const period = hour >= 12 ? "PM" : "AM";
  const h12 = hour % 12 === 0 ? 12 : hour % 12;
  return `${h12}:${String(minute).padStart(2, "0")} ${period}`;
}

function daysLabel(days: IsoWeekday[]): string {
  const set = new Set(days);
  const isWeekdays =
    set.size === 5 && [1, 2, 3, 4, 5].every((d) => set.has(d as IsoWeekday));
  if (isWeekdays) return "Weekdays";

  const isWeekends = set.size === 2 && set.has(6) && set.has(7);
  if (isWeekends) return "Weekends";

  const isEveryday = set.size === 7;
  if (isEveryday) return "Every day";

  if (days.length === 1) {
    return `Weekly on ${ISO_DAY_NAMES[days[0]!]}`;
  }

  const names = days.map((d) => ISO_DAY_NAMES[d]);
  if (names.length === 2) {
    return `Weekly on ${names[0]} and ${names[1]}`;
  }
  return `Weekly on ${names.slice(0, -1).join(", ")}, and ${names[names.length - 1]}`;
}

/**
 * Build a product-facing display string including timezone.
 * Matches decision examples (Weekdays / Weekends / Weekly on …).
 */
export function formatHumanScheduleDisplay(schedule: HumanSchedule): string {
  const days = normalizeDaysOfWeek(schedule.daysOfWeek);
  const hour = assertIntegerInRange(
    schedule.time?.hour,
    0,
    23,
    "invalid_hour",
    "hour",
  );
  const minute = assertIntegerInRange(
    schedule.time?.minute,
    0,
    59,
    "invalid_minute",
    "minute",
  );
  const tz = schedule.timezone?.trim() ?? "";
  if (!isValidIanaTimezone(tz)) {
    throw new ScheduleCodecError(
      "invalid_timezone",
      `Unknown or empty IANA timezone: ${JSON.stringify(schedule.timezone)}`,
    );
  }

  const clock = formatClock12(hour, minute);
  const label = daysLabel(days);
  if (label === "Weekdays" || label === "Weekends" || label === "Every day") {
    return `${label} at ${clock} (${tz})`;
  }
  // "Weekly on Monday at 9:00 AM (…)"
  return `${label} at ${clock} (${tz})`;
}

/**
 * Encode HumanSchedule → 5-field cron expression + display + timezone.
 * Fails closed on empty days, invalid time, or unknown IANA timezone.
 *
 * Wall-clock minute/hour are written as selected in `timezone` (no UTC conversion).
 */
export function encodeHumanSchedule(schedule: HumanSchedule): EncodedCronSchedule {
  const days = normalizeDaysOfWeek(schedule.daysOfWeek);
  const hour = assertIntegerInRange(
    schedule.time?.hour,
    0,
    23,
    "invalid_hour",
    "hour",
  );
  const minute = assertIntegerInRange(
    schedule.time?.minute,
    0,
    59,
    "invalid_minute",
    "minute",
  );
  const timezone = schedule.timezone?.trim() ?? "";
  if (!isValidIanaTimezone(timezone)) {
    throw new ScheduleCodecError(
      "invalid_timezone",
      `Unknown or empty IANA timezone: ${JSON.stringify(schedule.timezone)}`,
    );
  }

  const cronDows = days.map(isoWeekdayToCronDow);
  const dowField = formatCronDowField(cronDows);
  const expr = `${minute} ${hour} * * ${dowField}`;
  const display = formatHumanScheduleDisplay({
    daysOfWeek: days,
    time: { hour, minute },
    timezone,
  });

  return { kind: "cron", expr, display, timezone };
}

/**
 * Parse a cron DOW field (digits, lists, ranges; optional sun/mon names)
 * into unique ISO weekdays. Returns null if the field cannot be represented
 * as a finite set of weekdays (e.g. `*`, step forms).
 */
export function parseCronDowField(dow: string): IsoWeekday[] | null {
  const trimmed = dow.trim().toLowerCase();
  if (!trimmed || trimmed === "*" || trimmed.includes("/")) {
    return null;
  }

  const nameToIso: Record<string, IsoWeekday> = {
    mon: 1,
    tue: 2,
    tues: 2,
    wed: 3,
    thu: 4,
    thur: 4,
    thurs: 4,
    fri: 5,
    sat: 6,
    sun: 7,
  };

  const tokenToIso = (token: string): IsoWeekday | null => {
    if (/^\d+$/.test(token)) {
      return cronDowToIsoWeekday(Number(token));
    }
    return nameToIso[token] ?? null;
  };

  const seen = new Set<IsoWeekday>();
  for (const part of trimmed.split(",")) {
    const piece = part.trim();
    if (!piece) return null;
    if (piece.includes("-")) {
      const [a, b, ...rest] = piece.split("-");
      if (rest.length > 0 || a === undefined || b === undefined) return null;
      const start = tokenToIso(a.trim());
      const end = tokenToIso(b.trim());
      if (start === null || end === null) return null;
      // Walk in cron order (Sun=0 … Sat=6) then map back to ISO.
      const startCron = isoWeekdayToCronDow(start);
      const endCron = isoWeekdayToCronDow(end);
      if (startCron <= endCron) {
        for (let c = startCron; c <= endCron; c++) {
          const iso = cronDowToIsoWeekday(c);
          if (iso === null) return null;
          seen.add(iso);
        }
      } else {
        // Wrap-around ranges are uncommon; reject fail-closed.
        return null;
      }
    } else {
      const iso = tokenToIso(piece);
      if (iso === null) return null;
      seen.add(iso);
    }
  }

  if (seen.size === 0) return null;
  return ISO_WEEKDAYS.filter((d) => seen.has(d));
}

/**
 * Decode a 5-field weekly cron expression into HumanSchedule.
 *
 * MVP: only patterns with fixed minute+hour, DOM/MON `*`, and an explicit
 * DOW set (or DOW `*` meaning every day). Complex/step/hourly forms → not ok.
 *
 * Missing timezone: use `defaultTimezone` when provided and valid; otherwise
 * fail closed (do not invent a zone).
 */
export function decodeCronToHumanSchedule(
  expr: string,
  options?: { timezone?: string | null; defaultTimezone?: string | null },
): DecodeHumanScheduleResult {
  const trimmed = typeof expr === "string" ? expr.trim() : "";
  if (!trimmed) {
    return { ok: false, reason: "empty_expression" };
  }
  if (trimmed.startsWith("@")) {
    return { ok: false, reason: "nickname_not_supported" };
  }

  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) {
    return { ok: false, reason: "expected_5_field_cron" };
  }

  const [minPart, hourPart, dom, mon, dowPart] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];

  if (dom !== "*" || mon !== "*") {
    return { ok: false, reason: "non_weekly_dom_or_month" };
  }
  if (!/^\d+$/.test(minPart) || !/^\d+$/.test(hourPart)) {
    return { ok: false, reason: "non_fixed_time" };
  }

  const minute = Number(minPart);
  const hour = Number(hourPart);
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) {
    return { ok: false, reason: "invalid_minute" };
  }
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) {
    return { ok: false, reason: "invalid_hour" };
  }

  let daysOfWeek: IsoWeekday[];
  if (dowPart === "*") {
    daysOfWeek = [...ISO_WEEKDAYS];
  } else {
    const parsed = parseCronDowField(dowPart);
    if (!parsed) {
      return { ok: false, reason: "undecodable_dow" };
    }
    daysOfWeek = parsed;
  }

  const explicit = options?.timezone?.trim() || "";
  const fallback = options?.defaultTimezone?.trim() || "";
  const timezone = explicit || fallback;
  if (!isValidIanaTimezone(timezone)) {
    return { ok: false, reason: "missing_or_invalid_timezone" };
  }

  return {
    ok: true,
    schedule: {
      daysOfWeek,
      time: { hour, minute },
      timezone,
    },
  };
}
