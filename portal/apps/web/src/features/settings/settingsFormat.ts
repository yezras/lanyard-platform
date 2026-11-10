import type {
  SettingsCronSchedule,
  SettingsSnapshot,
} from "../../api/types.js";

/** Human label for settings.snapshot `source` (never claim fixture for host RPC tags). */
export function formatSettingsSourceLabel(
  source: SettingsSnapshot["source"] | null | undefined,
): string {
  switch (source) {
    case "fixture":
      return "Fixture JSON (not host-backed)";
    case "brain_rpc":
      return "Agent settings";
    case "backend":
      return "Backend discovery (host/local)";
    case "lanyard_agent":
      return "Lanyard Agent host";
    case "hermes":
      return "Live discovery (host/local)";
    case undefined:
    case null:
    case "":
      return "Unknown";
    default:
      return `Host settings (${source})`;
  }
}

/**
 * Light client-side schedule humanizer for fixture/raw values that still look
 * like expressions. Prefer host `schedule.display` / already-prose strings.
 * Never show undecodable raw expressions as the primary label (lp-jzl.4 / D2).
 * Accepts structured create/update schedule objects (lp-jzl.3 / lp-jzl.9.1).
 */
export function humanizeSchedule(
  schedule: string | SettingsCronSchedule | null | undefined,
): string {
  if (schedule == null) return "—";
  if (typeof schedule === "object") {
    const display =
      typeof schedule.display === "string" ? schedule.display.trim() : "";
    if (display) return display;
    const expr = typeof schedule.expr === "string" ? schedule.expr.trim() : "";
    if (expr) return humanizeSchedule(expr);
    return "Custom schedule";
  }
  const trimmed = schedule.trim();
  if (!trimmed) return "—";
  // Already human prose (letters beyond typical expression tokens / nicknames).
  if (/[a-zA-Z]/.test(trimmed) && !trimmed.startsWith("@")) {
    return trimmed;
  }
  if (trimmed.startsWith("@")) {
    const nick: Record<string, string> = {
      "@yearly": "Yearly",
      "@annually": "Yearly",
      "@monthly": "Monthly",
      "@weekly": "Weekly",
      "@daily": "Daily",
      "@midnight": "Daily at midnight",
      "@hourly": "Hourly",
    };
    return nick[trimmed.toLowerCase()] ?? "Custom schedule";
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length < 5) {
    // Short opaque tokens that are not 5-field expressions.
    return looksLikeCronExpression(trimmed) ? "Custom schedule" : trimmed;
  }
  const [min, hour, dom, mon, dow] = parts;
  const everyMin = min.match(/^\*\/(\d+)$/);
  if (everyMin && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    const n = Number(everyMin[1]);
    return n === 1 ? "Every minute" : `Every ${n} minutes`;
  }
  if (min === "0" && hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return "Hourly";
  }
  if (
    /^\d+$/.test(min) &&
    /^\d+$/.test(hour) &&
    dom === "*" &&
    mon === "*" &&
    dow === "*"
  ) {
    const h = Number(hour);
    const m = Number(min);
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `Daily at ${h12}:${String(m).padStart(2, "0")} ${period}`;
  }
  // Weekdays Mon–Fri at fixed time (common 5-field pattern).
  if (
    /^\d+$/.test(min) &&
    /^\d+$/.test(hour) &&
    dom === "*" &&
    mon === "*" &&
    (dow === "1-5" || dow === "1,2,3,4,5")
  ) {
    const h = Number(hour);
    const m = Number(min);
    const period = h >= 12 ? "PM" : "AM";
    const h12 = h % 12 === 0 ? 12 : h % 12;
    return `Weekdays at ${h12}:${String(m).padStart(2, "0")} ${period}`;
  }
  // Undecodable expression — never surface raw as the only Schedule label.
  return "Custom schedule";
}

function looksLikeCronExpression(value: string): boolean {
  // Digits, *, /, -, ,, and spaces — no prose words.
  return /^[\d*/,\-\s]+$/.test(value);
}
