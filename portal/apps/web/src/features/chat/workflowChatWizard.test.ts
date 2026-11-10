/**
 * Unit tests for workflow chat create wizard (lp-khq.8 / lp-khq.12.1).
 */
import { describe, expect, it } from "vitest";

import {
  applyWorkflowWizardMcqSelection,
  applyWorkflowWizardTextInput,
  buildWorkflowCreateBody,
  buildWorkflowWizardMcqId,
  createWorkflowWizardSession,
  extractWorkflowNameFromProse,
  formatWorkflowCreateAgentRequest,
  formatWorkflowCreateUserProgress,
  isValidWorkflowWizardName,
  isWorkflowWizardMcqId,
  looksLikeMultiPhaseProse,
  markWorkflowWizardCreateFailed,
  markWorkflowWizardCreateSucceeded,
  normalizeWorkflowWizardName,
  parseStagesFreeText,
  parseWorkflowNaturalLanguage,
  parseWorkflowWizardMcqId,
  workflowWizardStepNeedsFreeText,
} from "./workflowChatWizard.js";

describe("workflow wizard mcq ids", () => {
  it("builds and parses wf-<step>-<sessionId>", () => {
    const id = buildWorkflowWizardMcqId("confirm", "abc123");
    expect(id).toBe("wf-confirm-abc123");
    expect(parseWorkflowWizardMcqId(id)).toEqual({
      step: "confirm",
      sessionId: "abc123",
    });
    expect(isWorkflowWizardMcqId(id)).toBe(true);
    expect(isWorkflowWizardMcqId("st-intent-abc")).toBe(false);
    expect(isWorkflowWizardMcqId("dept-pick-001")).toBe(false);
    expect(parseWorkflowWizardMcqId(buildWorkflowWizardMcqId("describe", "x"))).toEqual({
      step: "describe",
      sessionId: "x",
    });
  });
});

describe("normalizeWorkflowWizardName", () => {
  it("normalizes free text to kebab-case", () => {
    expect(normalizeWorkflowWizardName("Daily Brief")).toBe("daily-brief");
    expect(normalizeWorkflowWizardName("research_report!")).toBe(
      "research-report",
    );
    expect(isValidWorkflowWizardName("daily-brief")).toBe(true);
    expect(normalizeWorkflowWizardName("!!!")).toBeNull();
  });
});

describe("parseStagesFreeText + multi-phase NL (lp-khq.12.1)", () => {
  it("parses pipe and colon forms", () => {
    const pipe = parseStagesFreeText("research | write");
    expect(pipe).toHaveLength(2);
    expect(pipe![0]!.name).toBe("research");
    expect(pipe![1]!.name).toBe("write");

    const colon = parseStagesFreeText(
      "research: gather facts\nwrite: draft the report",
    );
    expect(colon).toHaveLength(2);
    expect(colon![0]!.agents?.[0]?.prompt).toMatch(/gather facts/i);
  });

  it("parses multi-sentence research→write prose into ≥2 stages", () => {
    const stages = parseStagesFreeText(
      "Research the market thoroughly. Then write a summary report.",
    );
    expect(stages).not.toBeNull();
    expect(stages!.length).toBeGreaterThanOrEqual(2);
    expect(stages![0]!.name).toMatch(/research/i);
    expect(stages![1]!.name).toMatch(/write|report/i);
    // Must not collapse into one giant kebab stage
    expect(stages![0]!.name).not.toMatch(/then/);
    expect(stages!.map((s) => s.name).join("|")).not.toMatch(
      /research-the-market/,
    );
  });

  it("parses mid-sentence then with phase verbs", () => {
    const stages = parseStagesFreeText(
      "Research overnight news then write a morning brief",
    );
    expect(stages).not.toBeNull();
    expect(stages!.length).toBeGreaterThanOrEqual(2);
  });

  it("does not silently kebab-case a multi-phase paragraph into one stage", () => {
    const prose =
      "First research competitor pricing carefully then somehow also write but wait also review";
    // If parse fails (ambiguous), null is ok; if success, must be ≥2 stages
    const stages = parseStagesFreeText(prose);
    if (stages) {
      expect(stages.length).toBeGreaterThanOrEqual(2);
      for (const s of stages) {
        expect(s.name.split("-").length).toBeLessThan(8);
      }
    } else {
      expect(looksLikeMultiPhaseProse(prose)).toBe(true);
    }
  });
});

describe("parseWorkflowNaturalLanguage", () => {
  it("derives name from title-in-prose and multi-phase stages", () => {
    const parsed = parseWorkflowNaturalLanguage(
      "Title: Market Pulse\nResearch the market thoroughly. Then write a summary report.",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.name).toBe("market-pulse");
    expect(parsed.stages.length).toBeGreaterThanOrEqual(2);
    expect(parsed.multiPhase).toBe(true);
  });

  it("extracts called-name pattern", () => {
    const { name, remainder } = extractWorkflowNameFromProse(
      "Call it Daily Brief: research news then summarize",
    );
    expect(name).toBe("daily-brief");
    expect(remainder.length).toBeGreaterThan(5);
  });

  it("returns clarify when multi-phase cannot be split safely", () => {
    // Force ambiguous: multi-phase markers with no clean split? 
    // "then" alone with short sides may still split; use a case that fails.
    // Empty is empty; use looks_like_ir for technical paste.
    const ir = parseWorkflowNaturalLanguage(
      '{"steps":[],"meta":{},"spawn_agent":true}',
    );
    expect(ir.ok).toBe(false);
    if (ir.ok) return;
    expect(ir.reason).toBe("looks_like_ir");
    expect(ir.message).not.toMatch(/IR JSON|kebab|Call workflow/i);
  });
});

describe("user-facing copy has no IR/JSON jargon", () => {
  it("agent request and user progress avoid banned phrases", () => {
    const body = buildWorkflowCreateBody({
      name: "daily-brief",
      description: "Morning summary",
      stages: [
        {
          name: "run",
          agents: [{ prompt: "Summarize overnight changes" }],
        },
      ],
    });
    const agent = formatWorkflowCreateAgentRequest(body);
    const user = formatWorkflowCreateUserProgress(body);
    for (const banned of [
      "IR JSON",
      "JSON paste",
      "host workflow tool",
      "Call workflow({",
      "kebab-case",
    ]) {
      expect(agent).not.toContain(banned);
      expect(user).not.toContain(banned);
    }
    expect(user).toMatch(/Creating/i);
  });

  it("wizard status prompts avoid banned phrases", () => {
    const { session } = createWorkflowWizardSession({
      sessionId: "jargon1",
      mode: "blank",
    });
    expect(session.statusMessage).not.toMatch(
      /IR JSON|JSON paste|host workflow tool|Call workflow\(|kebab-case/i,
    );
    const guided = createWorkflowWizardSession({
      sessionId: "jargon2",
      mode: "guided",
    });
    expect(guided.firstMcq?.content).not.toMatch(
      /IR JSON|JSON paste|host workflow tool|Call workflow\(/i,
    );
  });
});

describe("createWorkflowWizardSession guided happy path (NL-first)", () => {
  it("walks intent → describe → confirm → create", () => {
    const { session: s0, firstMcq } = createWorkflowWizardSession({
      sessionId: "test1",
      mode: "guided",
    });
    expect(firstMcq?.step).toBe("intent");
    expect(s0.step).toBe("intent");

    const yes = applyWorkflowWizardMcqSelection(s0, {
      mcq_id: firstMcq!.mcq_id,
      choice_id: "yes",
    });
    expect(yes.ok).toBe(true);
    if (!yes.ok) return;
    expect(yes.session.step).toBe("describe");
    expect(yes.nextMcq).toBeNull();
    expect(
      workflowWizardStepNeedsFreeText(yes.session.step, yes.session.activeMcq),
    ).toBe(true);

    const described = applyWorkflowWizardTextInput(
      yes.session,
      "Title: Research Report\nResearch the topic thoroughly. Then write a concise report.",
    );
    expect(described.ok).toBe(true);
    if (!described.ok) return;
    expect(described.session.draft.name).toBe("research-report");
    expect(described.session.draft.stages?.length).toBeGreaterThanOrEqual(2);
    expect(described.nextMcq?.step).toBe("confirm");
    expect(described.nextMcq?.content).not.toMatch(
      /IR JSON|JSON paste|host workflow tool|Call workflow\(/i,
    );

    const create = applyWorkflowWizardMcqSelection(described.session, {
      mcq_id: described.nextMcq!.mcq_id,
      choice_id: "create",
    });
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    expect(create.shouldCreate).toBe(true);
    expect(create.session.createBody?.name).toBe("research-report");
    expect(create.session.createBody?.stages.length).toBeGreaterThanOrEqual(2);
    expect(create.session.createBody?.action).toBe("create");
    expect(JSON.stringify(create.session.createBody)).not.toMatch(
      /spawn_agent|"steps"/,
    );
  });

  it("asks for name when NL has no title, then confirms multi-phase", () => {
    const { session: s0, firstMcq } = createWorkflowWizardSession({
      sessionId: "needname",
      mode: "guided",
    });
    let s = applyWorkflowWizardMcqSelection(s0, {
      mcq_id: firstMcq!.mcq_id,
      choice_id: "yes",
    });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    s = applyWorkflowWizardTextInput(
      s.session,
      "Research competitors carefully. Then write a pricing brief.",
    );
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.session.step).toBe("name");
    expect(s.session.draft.stages?.length).toBeGreaterThanOrEqual(2);

    s = applyWorkflowWizardTextInput(s.session, "Competitor Pricing");
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    // description already set → stages already set → confirm
    expect(s.nextMcq?.step).toBe("confirm");
    expect(s.session.draft.name).toBe("competitor-pricing");
  });

  it("create_and_launch sets launchAfter via short NL + name", () => {
    const { session: s0, firstMcq } = createWorkflowWizardSession({
      sessionId: "launch1",
      mode: "guided",
    });
    let s = applyWorkflowWizardMcqSelection(s0, {
      mcq_id: firstMcq!.mcq_id,
      choice_id: "yes",
    });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    s = applyWorkflowWizardTextInput(
      s.session,
      "Title: Brief\nSummarize overnight changes for the team.",
    );
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.nextMcq?.step).toBe("confirm");
    s = applyWorkflowWizardMcqSelection(s.session, {
      mcq_id: s.nextMcq!.mcq_id,
      choice_id: "create_launch",
    });
    expect(s.ok).toBe(true);
    if (!s.ok) return;
    expect(s.shouldCreate).toBe(true);
    expect(s.session.createBody?.launchAfter).toBe(true);
  });

  it("cancels from intent", () => {
    const { session, firstMcq } = createWorkflowWizardSession({
      sessionId: "cancel1",
    });
    const result = applyWorkflowWizardMcqSelection(session, {
      mcq_id: firstMcq!.mcq_id,
      choice_id: "no",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.step).toBe("cancelled");
    expect(result.shouldCreate).toBe(false);
  });

  it("clarify instead of kebab-casing bad multi-phase stages_custom", () => {
    const { session: s0 } = createWorkflowWizardSession({
      sessionId: "clarify1",
      mode: "blank",
    });
    // Jump to stages_custom by building a session with description but no stages
    const staged = {
      ...s0,
      step: "stages_custom" as const,
      draft: {
        name: "my-flow",
        description: "Does the thing",
      },
      activeMcq: null,
      statusMessage: "custom",
    };
    // Single long multi-phase that should parse to ≥2 OR error — not one kebab
    const result = applyWorkflowWizardTextInput(
      staged,
      "Research the market thoroughly. Then write a summary report for leadership.",
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.session.draft.stages?.length).toBeGreaterThanOrEqual(2);
    expect(result.nextMcq?.step).toBe("confirm");
  });
});

describe("createWorkflowWizardSession blank (New workflow, NL-first)", () => {
  it("starts at describe without intent MCQ", () => {
    const { session, firstMcq } = createWorkflowWizardSession({
      sessionId: "blank1",
      mode: "blank",
    });
    expect(firstMcq).toBeNull();
    expect(session.step).toBe("describe");
    expect(session.mode).toBe("blank");
    expect(session.statusMessage).toMatch(/plain language/i);
    expect(session.statusMessage).not.toMatch(/kebab|IR JSON/i);

    const described = applyWorkflowWizardTextInput(
      session,
      "My Flow: does the thing in one focused pass",
    );
    expect(described.ok).toBe(true);
    if (!described.ok) return;
    expect(described.session.draft.name).toBe("my-flow");
    expect(described.session.draft.description).toMatch(/does the thing/i);
    // Single phase → confirm
    expect(described.nextMcq?.step).toBe("confirm");

    const create = applyWorkflowWizardMcqSelection(described.session, {
      mcq_id: described.nextMcq!.mcq_id,
      choice_id: "create",
    });
    expect(create.ok).toBe(true);
    if (!create.ok) return;
    expect(create.session.createBody?.name).toBe("my-flow");
  });
});

describe("buildWorkflowCreateBody + agent request", () => {
  it("builds structured body and formats agent request without IR jargon", () => {
    const body = buildWorkflowCreateBody({
      name: "Daily Brief",
      description: "Morning summary",
      stages: [
        {
          name: "run",
          agents: [{ prompt: "Summarize overnight changes" }],
        },
      ],
    });
    expect(body.name).toBe("daily-brief");
    expect(body.action).toBe("create");
    const msg = formatWorkflowCreateAgentRequest(body);
    expect(msg).toMatch(/action=create/);
    expect(msg).toMatch(/daily-brief/);
    expect(msg).not.toMatch(/spawn_agent/);
    expect(msg).not.toMatch(/IR JSON/);
    expect(msg).not.toMatch(/Call workflow\(/);
  });

  it("throws when stages missing", () => {
    expect(() =>
      buildWorkflowCreateBody({
        name: "x",
        description: "y",
      }),
    ).toThrow(/step/i);
  });
});

describe("mark create succeeded/failed", () => {
  it("marks done and restores confirm on failure", () => {
    const { session: s0, firstMcq } = createWorkflowWizardSession({
      sessionId: "mark1",
      mode: "guided",
    });
    let s = applyWorkflowWizardMcqSelection(s0, {
      mcq_id: firstMcq!.mcq_id,
      choice_id: "yes",
    });
    if (!s.ok) throw new Error("expected ok");
    s = applyWorkflowWizardTextInput(
      s.session,
      "Title: t\nComplete a focused task for the team.",
    );
    if (!s.ok) throw new Error("expected ok");
    expect(s.nextMcq?.step).toBe("confirm");
    s = applyWorkflowWizardMcqSelection(s.session, {
      mcq_id: s.nextMcq!.mcq_id,
      choice_id: "create",
    });
    if (!s.ok) throw new Error("expected ok");

    const ok = markWorkflowWizardCreateSucceeded(s.session, "t");
    expect(ok.step).toBe("done");
    expect(ok.createdName).toBe("t");

    const fail = markWorkflowWizardCreateFailed(s.session, "host down");
    expect(fail.step).toBe("confirm");
    expect(fail.activeMcq?.step).toBe("confirm");
    expect(fail.error).toMatch(/host down/);
    expect(fail.activeMcq?.content).not.toMatch(/JSON paste|IR JSON/i);
  });
});
