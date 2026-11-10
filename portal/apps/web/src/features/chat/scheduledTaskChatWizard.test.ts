/**
 * Unit tests for scheduled task chat wizard (lp-jzl.9.1 / D4).
 */

import { describe, expect, it } from "vitest";

import {
  applyWizardMcqSelection,
  applyWizardTextInput,
  buildScheduledTaskCreateBody,
  buildWizardMcqId,
  createScheduledTaskWizardSession,
  isScheduledTaskWizardMcqId,
  markWizardCreateFailed,
  markWizardCreateSucceeded,
  parseHumanDaysInput,
  parseHumanTimeInput,
  parseWizardMcqId,
  wizardMcqToPortalMetadata,
  wizardSelectionToInboundMetadata,
} from "./scheduledTaskChatWizard.js";

describe("mcq_id helpers", () => {
  it("builds and parses st-<step>-<sessionId>", () => {
    const id = buildWizardMcqId("days", "abc123");
    expect(id).toBe("st-days-abc123");
    expect(parseWizardMcqId(id)).toEqual({
      step: "days",
      sessionId: "abc123",
    });
    expect(isScheduledTaskWizardMcqId(id)).toBe(true);
    expect(isScheduledTaskWizardMcqId("dept-pick-001")).toBe(false);
  });
});

describe("parseHumanTimeInput / parseHumanDaysInput", () => {
  it("parses 12h and 24h times", () => {
    expect(parseHumanTimeInput("9:00 AM")).toEqual({ hour: 9, minute: 0 });
    expect(parseHumanTimeInput("5:30 pm")).toEqual({ hour: 17, minute: 30 });
    expect(parseHumanTimeInput("12:00 PM")).toEqual({ hour: 12, minute: 0 });
    expect(parseHumanTimeInput("12:00 AM")).toEqual({ hour: 0, minute: 0 });
    expect(parseHumanTimeInput("17:00")).toEqual({ hour: 17, minute: 0 });
    expect(parseHumanTimeInput("5pm")).toEqual({ hour: 17, minute: 0 });
    expect(parseHumanTimeInput("not a time")).toBeNull();
  });

  it("parses day lists and presets", () => {
    expect(parseHumanDaysInput("Mon, Wed, Fri")).toEqual([1, 3, 5]);
    expect(parseHumanDaysInput("weekdays")).toEqual([1, 2, 3, 4, 5]);
    expect(parseHumanDaysInput("weekends")).toEqual([6, 7]);
    expect(parseHumanDaysInput("everyday")).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(parseHumanDaysInput("notadays")).toBeNull();
  });
});

describe("createScheduledTaskWizardSession happy path (MCQ only)", () => {
  it("walks intent → template → days → time → tz → confirm → create without cron", () => {
    const { session: s0, firstMcq } = createScheduledTaskWizardSession({
      sessionId: "sess1",
      defaultTimezone: "America/New_York",
    });
    expect(firstMcq?.portal_event).toBe("mcq");
    expect(firstMcq?.mcq_id).toBe("st-intent-sess1");
    expect(firstMcq?.choices.some((c) => /scheduled task/i.test(c.label))).toBe(
      true,
    );

    // Intent yes
    let r = applyWizardMcqSelection(s0, {
      mcq_id: firstMcq!.mcq_id,
      choice_id: "yes",
      choice_label: "Yes, create scheduled task",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nextMcq?.step).toBe("instructions_template");
    expect(r.shouldCreate).toBe(false);

    // Template weekly digest
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "weekly_digest",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.draft.name).toBe("Weekly digest");
    expect(r.session.draft.prompt).toMatch(/vault changes/i);
    expect(r.nextMcq?.step).toBe("days");
    // No cron in choices
    for (const c of r.nextMcq!.choices) {
      expect(c.label.toLowerCase()).not.toMatch(/cron/);
      expect(c.id).not.toMatch(/\d+ \d+ \* \*/);
    }

    // Days weekdays
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "weekdays",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.draft.daysOfWeek).toEqual([1, 2, 3, 4, 5]);
    expect(r.nextMcq?.step).toBe("time");

    // Time 9:00 AM
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "09:00",
      choice_label: "9:00 AM",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.draft.time).toEqual({ hour: 9, minute: 0 });
    expect(r.nextMcq?.step).toBe("timezone");

    // TZ use default
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "use_default",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.draft.timezone).toBe("America/New_York");
    expect(r.nextMcq?.step).toBe("confirm");
    expect(r.nextMcq?.content).toMatch(/Weekly digest/);
    expect(r.nextMcq?.content).toMatch(/Weekdays/);
    expect(r.nextMcq?.content.toLowerCase()).not.toMatch(
      /\b\d+ \d+ \* \* [0-9,\-]+\b/,
    );

    // Confirm create
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "create",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shouldCreate).toBe(true);
    expect(r.session.readyToCreate).toBe(true);
    expect(r.session.createBody).toBeTruthy();
    expect(r.session.createBody!.name).toBe("Weekly digest");
    expect(r.session.createBody!.prompt).toMatch(/vault/i);
    expect(r.session.createBody!.schedule.kind).toBe("cron");
    expect(r.session.createBody!.schedule.expr).toBe("0 9 * * 1-5");
    expect(r.session.createBody!.schedule.timezone).toBe("America/New_York");
    expect(r.session.createBody!.schedule.display).toMatch(/Weekdays/);
    // User never typed expr — codec produced it
    expect(r.session.createBody!.schedule.display).not.toBe(
      r.session.createBody!.schedule.expr,
    );

    const done = markWizardCreateSucceeded(r.session, "st-weekly-digest");
    expect(done.step).toBe("done");
    expect(done.createdJobId).toBe("st-weekly-digest");
    expect(done.statusMessage).toMatch(/Scheduled task created/i);
  });

  it("timezone MCQ with default UTC has a single Use UTC choice", () => {
    const { session: s0 } = createScheduledTaskWizardSession({
      sessionId: "tzutc",
      defaultTimezone: "UTC",
      skipIntent: true,
    });
    let r = applyWizardMcqSelection(s0, {
      mcq_id: buildWizardMcqId("instructions_template", "tzutc"),
      choice_id: "weekly_digest",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "weekdays",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "09:00",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nextMcq?.step).toBe("timezone");
    const labels = (r.nextMcq?.choices ?? []).map((c) => c.label);
    expect(labels.filter((l) => l === "Use UTC")).toHaveLength(1);
    expect(labels).toContain("Choose another…");
    expect(labels).not.toContain("Use America/New_York");
  });

  it("timezone MCQ other then free-text IANA advances", () => {
    const { session: s0 } = createScheduledTaskWizardSession({
      sessionId: "tzother",
      defaultTimezone: "America/New_York",
      skipIntent: true,
    });
    let r = applyWizardMcqSelection(s0, {
      mcq_id: buildWizardMcqId("instructions_template", "tzother"),
      choice_id: "weekly_digest",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "weekdays",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "09:00",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Pick "other" → free-text timezone (activeMcq cleared, step stays timezone).
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "other",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nextMcq).toBeNull();
    expect(r.session.step).toBe("timezone");
    expect(r.session.activeMcq).toBeNull();
    expect(r.session.statusMessage).toMatch(/IANA timezone/i);

    r = applyWizardTextInput(r.session, "America/Chicago");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.draft.timezone).toBe("America/Chicago");
    // Skills empty → confirm
    expect(r.nextMcq?.step).toBe("confirm");
  });

  it("markWizardCreateFailed restores confirm MCQ for retry", () => {
    const { session: s0 } = createScheduledTaskWizardSession({
      sessionId: "fail1",
      defaultTimezone: "UTC",
      skipIntent: true,
    });
    let r = applyWizardMcqSelection(s0, {
      mcq_id: buildWizardMcqId("instructions_template", "fail1"),
      choice_id: "weekly_digest",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "weekdays",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "09:00",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "utc",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "create",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shouldCreate).toBe(true);
    expect(r.session.step).toBe("creating");

    const failed = markWizardCreateFailed(r.session, "network down");
    expect(failed.step).toBe("confirm");
    expect(failed.readyToCreate).toBe(false);
    expect(failed.error).toMatch(/network down/i);
    expect(failed.activeMcq).toBeTruthy();
    expect(failed.activeMcq?.step).toBe("confirm");
    expect(failed.activeMcq?.choices.some((c) => c.id === "create")).toBe(
      true,
    );

    // Retry create from restored confirm MCQ.
    const retry = applyWizardMcqSelection(failed, {
      mcq_id: failed.activeMcq!.mcq_id,
      choice_id: "create",
    });
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;
    expect(retry.shouldCreate).toBe(true);
    expect(retry.session.step).toBe("creating");
  });

  it("cancel at intent leaves no create body", () => {
    const { session, firstMcq } = createScheduledTaskWizardSession({
      sessionId: "c1",
      defaultTimezone: "UTC",
    });
    const r = applyWizardMcqSelection(session, {
      mcq_id: firstMcq!.mcq_id,
      choice_id: "no",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.step).toBe("cancelled");
    expect(r.shouldCreate).toBe(false);
    expect(r.session.createBody).toBeNull();
  });

  it("custom instructions + custom days + custom time via free text", () => {
    const { session: s0 } = createScheduledTaskWizardSession({
      sessionId: "custom1",
      defaultTimezone: "UTC",
      skipIntent: true,
    });

    let r = applyWizardMcqSelection(s0, {
      mcq_id: buildWizardMcqId("instructions_template", "custom1"),
      choice_id: "custom",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.step).toBe("instructions_text");
    expect(r.nextMcq).toBeNull();

    r = applyWizardTextInput(
      r.session,
      "Standup notes\nCollect async standup from the team vault.",
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.draft.name).toBe("Standup notes");
    expect(r.session.draft.prompt).toMatch(/standup/i);
    expect(r.nextMcq?.step).toBe("days");

    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "custom",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.step).toBe("days_custom");

    r = applyWizardTextInput(r.session, "Mon, Wed, Fri");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.draft.daysOfWeek).toEqual([1, 3, 5]);

    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "custom",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    r = applyWizardTextInput(r.session, "3:30 PM");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.draft.time).toEqual({ hour: 15, minute: 30 });

    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "utc",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "create",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shouldCreate).toBe(true);
    expect(r.session.createBody!.schedule.expr).toBe("30 15 * * 1,3,5");
  });

  it("rejects free-text that looks like a raw cron expression on schedule steps", () => {
    const { session: s0 } = createScheduledTaskWizardSession({
      sessionId: "cron1",
      defaultTimezone: "UTC",
      skipIntent: true,
    });
    let r = applyWizardMcqSelection(s0, {
      mcq_id: buildWizardMcqId("instructions_template", "cron1"),
      choice_id: "weekly_digest",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "custom",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r = applyWizardTextInput(r.session, "0 9 * * 1-5");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/not a cron/i);
  });
});

describe("buildScheduledTaskCreateBody", () => {
  it("encodes HumanSchedule via codec", () => {
    const body = buildScheduledTaskCreateBody({
      name: "Test",
      prompt: "Do the thing",
      daysOfWeek: [1, 2, 3, 4, 5],
      time: { hour: 9, minute: 0 },
      timezone: "America/New_York",
    });
    expect(body.schedule.expr).toBe("0 9 * * 1-5");
    expect(body.enabled).toBe(true);
  });

  it("stores skill ids from inventory on create body (lp-jzl.9.2)", () => {
    const inventory = [
      {
        id: "post-meeting-triage",
        name: "Post-meeting triage",
        enabled: true,
        path: "skills/crm/post-meeting-triage",
      },
    ];
    const body = buildScheduledTaskCreateBody(
      {
        name: "Test",
        prompt: "Do the thing",
        daysOfWeek: [1],
        time: { hour: 9, minute: 0 },
        timezone: "UTC",
        skills: ["post-meeting-triage"],
      },
      { skillInventory: inventory },
    );
    expect(body.skills).toEqual(["post-meeting-triage"]);
  });

  it("fails closed on skill ids not in inventory", () => {
    expect(() =>
      buildScheduledTaskCreateBody(
        {
          name: "Test",
          prompt: "Do the thing",
          daysOfWeek: [1],
          time: { hour: 9, minute: 0 },
          timezone: "UTC",
          skills: ["ghost"],
        },
        { skillInventory: [] },
      ),
    ).toThrow(/Unknown skill id/i);
  });

  it("fails closed on incomplete draft", () => {
    expect(() =>
      buildScheduledTaskCreateBody({
        name: "x",
        prompt: "y",
      }),
    ).toThrow(/Schedule/i);
  });
});

describe("skills step from snapshot inventory (lp-jzl.9.2)", () => {
  const inventory = [
    {
      id: "post-meeting-triage",
      name: "Post-meeting triage",
      enabled: true,
      path: "skills/crm/post-meeting-triage",
    },
    {
      id: "draft-reply",
      name: "Draft reply",
      enabled: true,
      path: "skills/email/draft-reply",
    },
  ];

  it("prompts for skills after timezone and stores ids on create", () => {
    const { session: s0, firstMcq } = createScheduledTaskWizardSession({
      sessionId: "skills1",
      defaultTimezone: "UTC",
      skillInventory: inventory,
    });
    let r = applyWizardMcqSelection(s0, {
      mcq_id: firstMcq!.mcq_id,
      choice_id: "yes",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "weekly_digest",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "weekdays",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "09:00",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "utc",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nextMcq?.step).toBe("skills");
    expect(r.nextMcq?.choices.some((c) => c.id === "post-meeting-triage")).toBe(
      true,
    );
    expect(r.nextMcq?.choices.some((c) => c.id === "none")).toBe(true);

    // Attach one skill then Done
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "post-meeting-triage",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.session.draft.skills).toEqual(["post-meeting-triage"]);
    expect(r.nextMcq?.step).toBe("skills");
    expect(r.nextMcq?.choices.some((c) => c.id === "done")).toBe(true);

    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "done",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nextMcq?.step).toBe("confirm");
    expect(r.nextMcq?.content).toMatch(/Post-meeting triage|Skills:/i);

    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "create",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.shouldCreate).toBe(true);
    expect(r.session.createBody?.skills).toEqual(["post-meeting-triage"]);
  });

  it("skips skills step when inventory is empty", () => {
    const { session: s0 } = createScheduledTaskWizardSession({
      sessionId: "noskills",
      defaultTimezone: "UTC",
      skipIntent: true,
      skillInventory: [],
    });
    let r = applyWizardMcqSelection(s0, {
      mcq_id: buildWizardMcqId("instructions_template", "noskills"),
      choice_id: "weekly_digest",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "weekdays",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "09:00",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    r = applyWizardMcqSelection(r.session, {
      mcq_id: r.nextMcq!.mcq_id,
      choice_id: "utc",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.nextMcq?.step).toBe("confirm");
  });
});

describe("wire helpers", () => {
  it("maps MCQ to portal_event metadata and selection to inbound", () => {
    const { firstMcq } = createScheduledTaskWizardSession({
      sessionId: "wire1",
      defaultTimezone: "UTC",
    });
    const meta = wizardMcqToPortalMetadata(firstMcq!);
    expect(meta.portal_event).toBe("mcq");
    expect(meta.mcq_id).toBe(firstMcq!.mcq_id);
    expect(meta.choices.length).toBeGreaterThanOrEqual(2);

    const inbound = wizardSelectionToInboundMetadata({
      mcq_id: firstMcq!.mcq_id,
      choice_id: "yes",
      choice_label: "Yes, create scheduled task",
    });
    expect(inbound.portal_inbound).toBe("mcq_selection");
    expect(inbound.choice_id).toBe("yes");
  });
});
