import { describe, expect, it } from "vitest";

import {
  deriveScheduledTaskCompositeStatus,
  indexCronsByJobId,
  mapHostLastStatus,
  resolveScheduledTaskSideNavStatus,
} from "./scheduledTaskStatus.js";
import { statusDotFromThreadStatus } from "./threadResponseStatus.js";

describe("mapHostLastStatus", () => {
  it("maps success outcomes", () => {
    for (const raw of ["ok", "success", "completed", "complete", "Succeeded"]) {
      expect(mapHostLastStatus(raw)).toBe("success");
    }
  });

  it("maps error outcomes", () => {
    for (const raw of ["error", "failed", "failure", "timeout", "timed_out"]) {
      expect(mapHostLastStatus(raw)).toBe("error");
    }
  });

  it("maps running states to generating", () => {
    for (const raw of ["running", "in_progress", "in-progress", "started"]) {
      expect(mapHostLastStatus(raw)).toBe("generating");
    }
  });

  it("returns neutral for empty / unknown", () => {
    expect(mapHostLastStatus(null)).toBe("neutral");
    expect(mapHostLastStatus(undefined)).toBe("neutral");
    expect(mapHostLastStatus("")).toBe("neutral");
    expect(mapHostLastStatus("scheduled")).toBe("neutral");
    expect(mapHostLastStatus("paused")).toBe("neutral");
  });
});

describe("deriveScheduledTaskCompositeStatus", () => {
  it("live fire / stream open → generating (pulsing path)", () => {
    expect(
      deriveScheduledTaskCompositeStatus({
        liveStatus: "generating",
        enabled: true,
        lastStatus: "error",
      }),
    ).toBe("generating");
  });

  it("host running state → generating even without live status", () => {
    expect(
      deriveScheduledTaskCompositeStatus({
        liveStatus: null,
        enabled: true,
        state: "running",
        lastStatus: "ok",
      }),
    ).toBe("generating");
  });

  it("last host failure shows error when idle and enabled", () => {
    expect(
      deriveScheduledTaskCompositeStatus({
        liveStatus: undefined,
        enabled: true,
        lastStatus: "error",
      }),
    ).toBe("error");
    expect(
      deriveScheduledTaskCompositeStatus({
        liveStatus: "neutral",
        enabled: true,
        lastStatus: "failed",
      }),
    ).toBe("error");
  });

  it("last host success shows success when idle", () => {
    expect(
      deriveScheduledTaskCompositeStatus({
        enabled: true,
        lastStatus: "ok",
      }),
    ).toBe("success");
  });

  it("disabled job shows Off, not error, even if last run failed", () => {
    expect(
      deriveScheduledTaskCompositeStatus({
        liveStatus: undefined,
        enabled: false,
        lastStatus: "error",
      }),
    ).toBe("off");
    expect(
      deriveScheduledTaskCompositeStatus({
        liveStatus: "error",
        enabled: false,
        lastStatus: "failed",
      }),
    ).toBe("off");
    expect(
      deriveScheduledTaskCompositeStatus({
        enabled: false,
        lastStatus: "ok",
      }),
    ).toBe("off");
  });

  it("live generating still wins over disabled (in-flight fire)", () => {
    expect(
      deriveScheduledTaskCompositeStatus({
        liveStatus: "generating",
        enabled: false,
        lastStatus: "error",
      }),
    ).toBe("generating");
  });

  it("enabled undefined is not Off", () => {
    expect(
      deriveScheduledTaskCompositeStatus({
        enabled: undefined,
        lastStatus: "error",
      }),
    ).toBe("error");
  });

  it("falls back to live success when host has no last_status", () => {
    expect(
      deriveScheduledTaskCompositeStatus({
        liveStatus: "success",
        enabled: true,
        lastStatus: null,
      }),
    ).toBe("success");
  });

  it("returns neutral when nothing observed", () => {
    expect(deriveScheduledTaskCompositeStatus({})).toBe("neutral");
    expect(
      deriveScheduledTaskCompositeStatus({
        enabled: true,
        lastStatus: null,
      }),
    ).toBe("neutral");
  });
});

describe("statusDotFromThreadStatus (off)", () => {
  it("maps off to neutral label Off without pulse", () => {
    expect(statusDotFromThreadStatus("off")).toEqual({
      variant: "neutral",
      label: "Off",
    });
  });

  it("maps generating to pulsing accent", () => {
    expect(statusDotFromThreadStatus("generating")).toMatchObject({
      variant: "accent",
      isPulsing: true,
      label: "Generating…",
    });
  });
});

describe("indexCronsByJobId + resolveScheduledTaskSideNavStatus", () => {
  it("joins cron metadata by scheduled_job_id", () => {
    const map = indexCronsByJobId([
      {
        id: "cron-a",
        enabled: false,
        last_status: "error",
        state: null,
      },
      {
        id: "cron-b",
        enabled: true,
        last_status: "ok",
        state: null,
      },
    ]);

    expect(
      resolveScheduledTaskSideNavStatus({
        scheduledJobId: "cron-a",
        liveStatus: undefined,
        cronsById: map,
      }),
    ).toBe("off");

    expect(
      resolveScheduledTaskSideNavStatus({
        scheduledJobId: "cron-b",
        liveStatus: undefined,
        cronsById: map,
      }),
    ).toBe("success");

    expect(
      resolveScheduledTaskSideNavStatus({
        scheduledJobId: "cron-b",
        liveStatus: "generating",
        cronsById: map,
      }),
    ).toBe("generating");
  });

  it("missing job id yields neutral (no false Off)", () => {
    const map = indexCronsByJobId([]);
    expect(
      resolveScheduledTaskSideNavStatus({
        scheduledJobId: "missing",
        cronsById: map,
      }),
    ).toBe("neutral");
  });
});
