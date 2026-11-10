import { describe, expect, it } from "vitest";

import {
  cronDowToIsoWeekday,
  decodeCronToHumanSchedule,
  encodeHumanSchedule,
  formatCronDowField,
  formatHumanScheduleDisplay,
  isValidIanaTimezone,
  isoWeekdayToCronDow,
  parseCronDowField,
  ScheduleCodecError,
  type HumanSchedule,
} from "./scheduleCodec.js";

describe("iso ↔ cron DOW mapping", () => {
  it("maps ISO Mon–Sat to cron 1–6 and ISO Sunday to cron 0", () => {
    expect(isoWeekdayToCronDow(1)).toBe(1);
    expect(isoWeekdayToCronDow(5)).toBe(5);
    expect(isoWeekdayToCronDow(6)).toBe(6);
    expect(isoWeekdayToCronDow(7)).toBe(0);
  });

  it("maps cron 0 and 7 to ISO Sunday", () => {
    expect(cronDowToIsoWeekday(0)).toBe(7);
    expect(cronDowToIsoWeekday(7)).toBe(7);
    expect(cronDowToIsoWeekday(1)).toBe(1);
    expect(cronDowToIsoWeekday(6)).toBe(6);
    expect(cronDowToIsoWeekday(8)).toBeNull();
  });
});

describe("isValidIanaTimezone", () => {
  it("accepts common IANA zones and UTC", () => {
    expect(isValidIanaTimezone("UTC")).toBe(true);
    expect(isValidIanaTimezone("America/New_York")).toBe(true);
    expect(isValidIanaTimezone("Europe/London")).toBe(true);
    expect(isValidIanaTimezone("  Pacific/Auckland  ")).toBe(true);
  });

  it("rejects empty and unknown zones", () => {
    expect(isValidIanaTimezone("")).toBe(false);
    expect(isValidIanaTimezone("   ")).toBe(false);
    expect(isValidIanaTimezone("Not/A_Real_Zone")).toBe(false);
    expect(isValidIanaTimezone("America/NewYork")).toBe(false);
  });
});

describe("encodeHumanSchedule", () => {
  it("encodes Mon–Fri 9:00 America/New_York", () => {
    const schedule: HumanSchedule = {
      daysOfWeek: [1, 2, 3, 4, 5],
      time: { hour: 9, minute: 0 },
      timezone: "America/New_York",
    };
    const encoded = encodeHumanSchedule(schedule);
    expect(encoded.kind).toBe("cron");
    expect(encoded.expr).toBe("0 9 * * 1-5");
    expect(encoded.timezone).toBe("America/New_York");
    expect(encoded.display).toBe(
      "Weekdays at 9:00 AM (America/New_York)",
    );
  });

  it("encodes a single day (Monday 09:00)", () => {
    const encoded = encodeHumanSchedule({
      daysOfWeek: [1],
      time: { hour: 9, minute: 0 },
      timezone: "UTC",
    });
    expect(encoded.expr).toBe("0 9 * * 1");
    expect(encoded.display).toBe("Weekly on Monday at 9:00 AM (UTC)");
  });

  it("maps ISO Sunday to cron 0 and weekends to 0,6", () => {
    const encoded = encodeHumanSchedule({
      daysOfWeek: [6, 7],
      time: { hour: 18, minute: 30 },
      timezone: "America/Los_Angeles",
    });
    expect(encoded.expr).toBe("30 18 * * 0,6");
    expect(encoded.display).toBe(
      "Weekends at 6:30 PM (America/Los_Angeles)",
    );
  });

  it("encodes Sunday-only with cron DOW 0 (not 7)", () => {
    const encoded = encodeHumanSchedule({
      daysOfWeek: [7],
      time: { hour: 10, minute: 15 },
      timezone: "UTC",
    });
    expect(encoded.expr).toBe("15 10 * * 0");
    expect(encoded.display).toBe("Weekly on Sunday at 10:15 AM (UTC)");
  });

  it("encodes every day", () => {
    const encoded = encodeHumanSchedule({
      daysOfWeek: [1, 2, 3, 4, 5, 6, 7],
      time: { hour: 8, minute: 0 },
      timezone: "Europe/Berlin",
    });
    expect(encoded.expr).toBe("0 8 * * 0-6");
    expect(encoded.display).toBe("Every day at 8:00 AM (Europe/Berlin)");
  });

  it("dedupes and sorts days in ISO order", () => {
    const encoded = encodeHumanSchedule({
      daysOfWeek: [5, 1, 3, 1],
      time: { hour: 12, minute: 0 },
      timezone: "UTC",
    });
    expect(encoded.expr).toBe("0 12 * * 1,3,5");
    expect(encoded.display).toContain("Monday");
    expect(encoded.display).toContain("Wednesday");
    expect(encoded.display).toContain("Friday");
  });

  it("fails closed on empty daysOfWeek", () => {
    expect(() =>
      encodeHumanSchedule({
        daysOfWeek: [],
        time: { hour: 9, minute: 0 },
        timezone: "UTC",
      }),
    ).toThrow(ScheduleCodecError);
    try {
      encodeHumanSchedule({
        daysOfWeek: [],
        time: { hour: 9, minute: 0 },
        timezone: "UTC",
      });
    } catch (e) {
      expect(e).toBeInstanceOf(ScheduleCodecError);
      expect((e as ScheduleCodecError).code).toBe("empty_days");
    }
  });

  it("fails closed on invalid hour/minute", () => {
    expect(() =>
      encodeHumanSchedule({
        daysOfWeek: [1],
        time: { hour: 24, minute: 0 },
        timezone: "UTC",
      }),
    ).toThrow(/hour/i);

    expect(() =>
      encodeHumanSchedule({
        daysOfWeek: [1],
        time: { hour: 9, minute: 60 },
        timezone: "UTC",
      }),
    ).toThrow(/minute/i);

    expect(() =>
      encodeHumanSchedule({
        daysOfWeek: [1],
        time: { hour: 9.5 as number, minute: 0 },
        timezone: "UTC",
      }),
    ).toThrow(ScheduleCodecError);
  });

  it("fails closed on invalid / empty timezone", () => {
    expect(() =>
      encodeHumanSchedule({
        daysOfWeek: [1],
        time: { hour: 9, minute: 0 },
        timezone: "",
      }),
    ).toThrow(ScheduleCodecError);

    expect(() =>
      encodeHumanSchedule({
        daysOfWeek: [1],
        time: { hour: 9, minute: 0 },
        timezone: "Not/A_Zone",
      }),
    ).toThrow(/timezone/i);
  });

  it("fails closed on invalid ISO weekday values", () => {
    expect(() =>
      encodeHumanSchedule({
        daysOfWeek: [0 as 1],
        time: { hour: 9, minute: 0 },
        timezone: "UTC",
      }),
    ).toThrow(ScheduleCodecError);
  });
});

describe("decodeCronToHumanSchedule", () => {
  it("decodes Mon–Fri 9am with explicit timezone", () => {
    const result = decodeCronToHumanSchedule("0 9 * * 1-5", {
      timezone: "America/New_York",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.schedule.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(result.schedule.time).toEqual({ hour: 9, minute: 0 });
    expect(result.schedule.timezone).toBe("America/New_York");
  });

  it("decodes single day and Sunday (cron 0 → ISO 7)", () => {
    const mon = decodeCronToHumanSchedule("0 9 * * 1", { timezone: "UTC" });
    expect(mon.ok).toBe(true);
    if (mon.ok) {
      expect(mon.schedule.daysOfWeek).toEqual([1]);
    }

    const sun = decodeCronToHumanSchedule("15 10 * * 0", { timezone: "UTC" });
    expect(sun.ok).toBe(true);
    if (sun.ok) {
      expect(sun.schedule.daysOfWeek).toEqual([7]);
      expect(sun.schedule.time).toEqual({ hour: 10, minute: 15 });
    }

    const sun7 = decodeCronToHumanSchedule("0 9 * * 7", { timezone: "UTC" });
    expect(sun7.ok).toBe(true);
    if (sun7.ok) {
      expect(sun7.schedule.daysOfWeek).toEqual([7]);
    }
  });

  it("decodes weekends 0,6 and every-day *", () => {
    const weekends = decodeCronToHumanSchedule("30 18 * * 0,6", {
      timezone: "America/Los_Angeles",
    });
    expect(weekends.ok).toBe(true);
    if (weekends.ok) {
      expect(weekends.schedule.daysOfWeek).toEqual([6, 7]);
    }

    const daily = decodeCronToHumanSchedule("0 8 * * *", {
      timezone: "Europe/Berlin",
    });
    expect(daily.ok).toBe(true);
    if (daily.ok) {
      expect(daily.schedule.daysOfWeek).toEqual([1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it("uses defaultTimezone when job timezone is missing", () => {
    const result = decodeCronToHumanSchedule("0 9 * * 1-5", {
      defaultTimezone: "America/Chicago",
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.schedule.timezone).toBe("America/Chicago");
    }
  });

  it("fails closed when timezone is missing and no default", () => {
    const result = decodeCronToHumanSchedule("0 9 * * 1-5");
    expect(result).toEqual({
      ok: false,
      reason: "missing_or_invalid_timezone",
    });
  });

  it("fails closed on invalid default timezone", () => {
    const result = decodeCronToHumanSchedule("0 9 * * 1-5", {
      defaultTimezone: "Fake/Zone",
    });
    expect(result.ok).toBe(false);
  });

  it("returns not-ok for non-weekly / complex patterns (display fallback path)", () => {
    expect(decodeCronToHumanSchedule("*/15 * * * *", { timezone: "UTC" }).ok).toBe(
      false,
    );
    expect(decodeCronToHumanSchedule("0 * * * *", { timezone: "UTC" }).ok).toBe(
      false,
    );
    expect(decodeCronToHumanSchedule("0 9 1 * *", { timezone: "UTC" }).ok).toBe(
      false,
    );
    expect(decodeCronToHumanSchedule("@daily", { timezone: "UTC" }).ok).toBe(
      false,
    );
    expect(decodeCronToHumanSchedule("", { timezone: "UTC" }).ok).toBe(false);
  });

  it("round-trips encode → decode for decision examples", () => {
    const samples: HumanSchedule[] = [
      {
        daysOfWeek: [1, 2, 3, 4, 5],
        time: { hour: 9, minute: 0 },
        timezone: "America/New_York",
      },
      {
        daysOfWeek: [1],
        time: { hour: 9, minute: 0 },
        timezone: "UTC",
      },
      {
        daysOfWeek: [6, 7],
        time: { hour: 18, minute: 30 },
        timezone: "America/New_York",
      },
      {
        daysOfWeek: [7],
        time: { hour: 0, minute: 0 },
        timezone: "Pacific/Auckland",
      },
    ];

    for (const input of samples) {
      const encoded = encodeHumanSchedule(input);
      const decoded = decodeCronToHumanSchedule(encoded.expr, {
        timezone: encoded.timezone,
      });
      expect(decoded.ok).toBe(true);
      if (!decoded.ok) continue;
      expect(decoded.schedule.daysOfWeek).toEqual(
        [...new Set(input.daysOfWeek)].sort((a, b) => a - b),
      );
      expect(decoded.schedule.time).toEqual(input.time);
      expect(decoded.schedule.timezone).toBe(input.timezone);
      // Re-encode yields same expr
      expect(encodeHumanSchedule(decoded.schedule).expr).toBe(encoded.expr);
    }
  });
});

describe("parseCronDowField / formatCronDowField", () => {
  it("parses ranges and lists", () => {
    expect(parseCronDowField("1-5")).toEqual([1, 2, 3, 4, 5]);
    expect(parseCronDowField("0,6")).toEqual([6, 7]);
    expect(parseCronDowField("mon,wed,fri")).toEqual([1, 3, 5]);
  });

  it("formats consecutive cron digits as ranges", () => {
    expect(formatCronDowField([1, 2, 3, 4, 5])).toBe("1-5");
    expect(formatCronDowField([0, 6])).toBe("0,6");
    expect(formatCronDowField([7])).toBe("0"); // ISO Sunday input as 7 → 0
  });
});

describe("formatHumanScheduleDisplay", () => {
  it("includes timezone in display string", () => {
    expect(
      formatHumanScheduleDisplay({
        daysOfWeek: [1, 2, 3, 4, 5],
        time: { hour: 9, minute: 0 },
        timezone: "America/New_York",
      }),
    ).toBe("Weekdays at 9:00 AM (America/New_York)");
  });
});
