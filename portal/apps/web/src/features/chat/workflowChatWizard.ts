/**
 * Chat interactive create wizard for workflows (lp-khq.8 / lp-khq.12.1).
 *
 * Pure TypeScript — no React dependency. Mirrors scheduledTaskChatWizard.ts:
 * Portal owns local MCQ steps; host persistence uses the agent `workflow` tool
 * create/save contract (docs/architecture/portal-workflow-author-save-hook.md).
 *
 * Natural-language first (lp-khq.12.1):
 * - Invite free-form descriptions; parse stages/agents internally
 * - Never show IR/JSON/tool-call syntax in user-facing chat or + menu copy
 * - Plain-language summary before create; reject/repair bad multi-phase parses
 *   instead of silently kebab-casing whole paragraphs into one stage
 */

import type { McqChoice } from "../../api/types.js";

// ---------------------------------------------------------------------------
// Structured create body (agent tool contract — no raw IR)
// ---------------------------------------------------------------------------

export type WorkflowAuthoredAgent = {
  prompt: string;
  description?: string;
  role?: string;
  capability_mode?: "read-only" | "read-write" | "execute" | "all";
  isolation?: "none" | "worktree";
  label?: string;
};

export type WorkflowAuthoredStage = {
  name: string;
  description?: string;
  agents?: WorkflowAuthoredAgent[];
};

/**
 * Structured fields for workflow tool action=create|save.
 * @see docs/architecture/portal-workflow-author-save-hook.md
 */
export type WorkflowCreateBody = {
  action: "create" | "save";
  name: string;
  description: string;
  when_to_use?: string;
  stages: WorkflowAuthoredStage[];
  /** When true, after create ask host to launch by name. */
  launchAfter?: boolean;
};

// ---------------------------------------------------------------------------
// Step / session model
// ---------------------------------------------------------------------------

/** Wizard step ids (mcq_id prefix uses these: wf-<step>-<sessionId>). */
export type WorkflowWizardStep =
  | "intent"
  | "describe"
  | "name"
  | "purpose_template"
  | "purpose_text"
  | "stages"
  | "stages_custom"
  | "confirm"
  | "creating"
  | "done"
  | "cancelled";

/** How the wizard was opened from the + attach menu. */
export type WorkflowWizardMode = "guided" | "blank";

export type WorkflowWizardDraft = {
  name?: string;
  description?: string;
  when_to_use?: string;
  stages?: WorkflowAuthoredStage[];
  /** Template id when purpose came from a preset. */
  purposeTemplateId?: string;
  /** Launch after successful create. */
  launchAfter?: boolean;
  /** Raw NL description the user typed (for repair/clarify). */
  rawDescription?: string;
};

export type WorkflowWizardMcqPrompt = {
  portal_event: "mcq";
  mcq_id: string;
  content: string;
  choices: McqChoice[];
  step: WorkflowWizardStep;
};

export type WorkflowWizardSession = {
  sessionId: string;
  step: WorkflowWizardStep;
  mode: WorkflowWizardMode;
  draft: WorkflowWizardDraft;
  activeMcq: WorkflowWizardMcqPrompt | null;
  statusMessage: string;
  readyToCreate: boolean;
  createBody: WorkflowCreateBody | null;
  /** Created workflow name when host/agent confirms. */
  createdName: string | null;
  error: string | null;
};

export type WorkflowMcqSelectionInput = {
  mcq_id: string;
  choice_id: string;
  choice_label?: string;
};

export type WorkflowWizardApplyResult =
  | {
      ok: true;
      session: WorkflowWizardSession;
      nextMcq: WorkflowWizardMcqPrompt | null;
      /** When true, caller should persist createBody via host/agent path. */
      shouldCreate: boolean;
    }
  | { ok: false; session: WorkflowWizardSession; error: string };

// ---------------------------------------------------------------------------
// mcq_id helpers
// ---------------------------------------------------------------------------

const MCQ_ID_PREFIX = "wf";

/** Build stable mcq_id: wf-<step>-<sessionId> */
export function buildWorkflowWizardMcqId(
  step: WorkflowWizardStep,
  sessionId: string,
): string {
  return `${MCQ_ID_PREFIX}-${step}-${sessionId}`;
}

/**
 * Parse wf-<step>-<sessionId>. Returns null when not a workflow wizard id.
 */
export function parseWorkflowWizardMcqId(
  mcqId: string,
): { step: WorkflowWizardStep; sessionId: string } | null {
  const raw = typeof mcqId === "string" ? mcqId.trim() : "";
  if (!raw.startsWith(`${MCQ_ID_PREFIX}-`)) return null;
  const rest = raw.slice(MCQ_ID_PREFIX.length + 1);
  const dash = rest.indexOf("-");
  if (dash <= 0 || dash === rest.length - 1) return null;
  const step = rest.slice(0, dash) as WorkflowWizardStep;
  const sessionId = rest.slice(dash + 1);
  if (!sessionId) return null;
  const known: WorkflowWizardStep[] = [
    "intent",
    "describe",
    "name",
    "purpose_template",
    "purpose_text",
    "stages",
    "stages_custom",
    "confirm",
    "creating",
    "done",
    "cancelled",
  ];
  if (!known.includes(step)) return null;
  return { step, sessionId };
}

/** True when mcq_id belongs to the workflow chat wizard family. */
export function isWorkflowWizardMcqId(mcqId: string): boolean {
  return parseWorkflowWizardMcqId(mcqId) !== null;
}

// ---------------------------------------------------------------------------
// Choice catalogs
// ---------------------------------------------------------------------------

export const WORKFLOW_INTENT_CHOICES: readonly McqChoice[] = [
  { id: "yes", label: "Yes, create a workflow" },
  { id: "no", label: "No, cancel" },
] as const;

export const PURPOSE_TEMPLATE_CHOICES: readonly McqChoice[] = [
  {
    id: "research_report",
    label: "Research then report",
  },
  {
    id: "multi_review",
    label: "Multi-agent review",
  },
  {
    id: "single_task",
    label: "Single-agent task",
  },
  {
    id: "custom",
    label: "Describe in my own words…",
  },
] as const;

export const STAGES_PRESET_CHOICES: readonly McqChoice[] = [
  { id: "one_stage", label: "One step" },
  { id: "two_stage", label: "Two steps (research → write)" },
  { id: "custom", label: "Describe the steps myself…" },
] as const;

export const WORKFLOW_CONFIRM_CHOICES: readonly McqChoice[] = [
  { id: "create", label: "Create workflow" },
  { id: "create_launch", label: "Create and launch" },
  { id: "edit", label: "Edit details" },
  { id: "cancel", label: "Cancel" },
] as const;

type PurposeTemplate = {
  name: string;
  description: string;
  when_to_use?: string;
  stages: WorkflowAuthoredStage[];
};

const PURPOSE_TEMPLATES: Record<string, PurposeTemplate> = {
  research_report: {
    name: "research-report",
    description: "Research a topic, then write a concise report.",
    when_to_use: "When you need structured research with a written summary.",
    stages: [
      {
        name: "research",
        description: "Gather sources and key findings",
        agents: [
          {
            prompt:
              "Research the topic from the parent brief. Summarize findings with sources; do not invent citations.",
            role: "explore",
            capability_mode: "read-only",
            description: "Researcher",
          },
        ],
      },
      {
        name: "report",
        description: "Write the report from research notes",
        agents: [
          {
            prompt:
              "Using the research summary, write a clear report with sections and actionable takeaways.",
            role: "general-purpose",
            capability_mode: "read-write",
            description: "Writer",
          },
        ],
      },
    ],
  },
  multi_review: {
    name: "multi-agent-review",
    description: "Parallel review from two agents, then synthesize.",
    when_to_use: "When you want independent review perspectives before a summary.",
    stages: [
      {
        name: "review",
        description: "Two reviewers in parallel",
        agents: [
          {
            prompt:
              "Review the material for correctness and gaps. List issues by severity.",
            role: "explore",
            capability_mode: "read-only",
            label: "reviewer-a",
            description: "Correctness review",
          },
          {
            prompt:
              "Review the material for clarity and audience fit. Suggest concrete edits.",
            role: "explore",
            capability_mode: "read-only",
            label: "reviewer-b",
            description: "Clarity review",
          },
        ],
      },
      {
        name: "synthesize",
        description: "Merge review feedback",
        agents: [
          {
            prompt:
              "Synthesize both reviews into a prioritized action list and a short recommendation.",
            role: "general-purpose",
            capability_mode: "read-write",
            description: "Synthesizer",
          },
        ],
      },
    ],
  },
  single_task: {
    name: "single-agent-task",
    description: "One agent completes a focused task.",
    when_to_use: "Simple multi-step work that does not need a multi-stage pipeline.",
    stages: [
      {
        name: "run",
        description: "Execute the task",
        agents: [
          {
            prompt:
              "Complete the task described in the parent brief. Prefer vault paths and tools over guessing.",
            role: "general-purpose",
            capability_mode: "read-write",
            description: "Worker",
          },
        ],
      },
    ],
  },
};

// ---------------------------------------------------------------------------
// Name helpers (host needs kebab-case ids; users never see that jargon)
// ---------------------------------------------------------------------------

const WORKFLOW_NAME_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const WORKFLOW_NAME_MAX = 64;

const STOP_WORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "to",
  "for",
  "of",
  "in",
  "on",
  "at",
  "by",
  "with",
  "from",
  "into",
  "this",
  "that",
  "these",
  "those",
  "it",
  "its",
  "is",
  "are",
  "be",
  "as",
  "then",
  "next",
  "after",
  "before",
  "finally",
  "please",
  "should",
  "will",
  "can",
  "do",
  "does",
  "my",
  "our",
  "your",
  "me",
  "we",
  "you",
  "i",
  "workflow",
  "called",
  "named",
  "title",
  "name",
]);

const STAGE_VERB_ALIASES: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /\b(research|researches|researching|investigate|investigat\w*)\b/i, name: "research" },
  { pattern: /\b(gather|collect|find|explore|look up)\b/i, name: "research" },
  { pattern: /\b(write|writes|writing|draft|drafts|drafting|compose)\b/i, name: "write" },
  { pattern: /\b(report|reports|reporting|summarize|summarise|summary)\b/i, name: "report" },
  { pattern: /\b(review|reviews|reviewing|critique)\b/i, name: "review" },
  { pattern: /\b(synthesize|synthesise|merge|combine|consolidate)\b/i, name: "synthesize" },
  { pattern: /\b(analyze|analyse|analysis)\b/i, name: "analyze" },
  { pattern: /\b(plan|planning)\b/i, name: "plan" },
  { pattern: /\b(implement|build|create|develop|code)\b/i, name: "implement" },
  { pattern: /\b(test|validate|verify|check)\b/i, name: "test" },
  { pattern: /\b(deploy|publish|ship)\b/i, name: "deploy" },
  { pattern: /\b(edit|revise|polish|refine)\b/i, name: "edit" },
  { pattern: /\b(run|execute|perform|complete)\b/i, name: "run" },
];

/**
 * Normalize free text toward a valid kebab-case workflow name (internal id).
 * Returns null when still invalid.
 */
export function normalizeWorkflowWizardName(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const lower = raw.trim().toLowerCase();
  const collapsed = lower
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-+/g, "-")
    .slice(0, WORKFLOW_NAME_MAX);
  if (!collapsed || !WORKFLOW_NAME_PATTERN.test(collapsed)) return null;
  return collapsed;
}

/** True when name is already valid kebab-case. */
export function isValidWorkflowWizardName(name: string): boolean {
  return (
    typeof name === "string" &&
    name.length >= 1 &&
    name.length <= WORKFLOW_NAME_MAX &&
    WORKFLOW_NAME_PATTERN.test(name)
  );
}

function wordCount(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}

function looksLikeIrJson(value: string): boolean {
  return (
    (value.startsWith("{") && value.includes('"steps"')) ||
    (value.startsWith("{") && value.includes('"meta"')) ||
    value.includes('"spawn_agent"') ||
    /^\s*\{\s*"action"\s*:/i.test(value)
  );
}

// ---------------------------------------------------------------------------
// Natural-language parse (stages + optional name)
// ---------------------------------------------------------------------------

export type WorkflowNlParseOk = {
  ok: true;
  name?: string;
  description: string;
  stages: WorkflowAuthoredStage[];
  /** True when stages came from multi-phase language (not a single default stage). */
  multiPhase: boolean;
};

export type WorkflowNlParseFail = {
  ok: false;
  reason: "empty" | "ambiguous" | "looks_like_ir";
  message: string;
  name?: string;
  description?: string;
};

export type WorkflowNlParseResult = WorkflowNlParseOk | WorkflowNlParseFail;

function stripTitlePrefix(line: string): string {
  return line
    .replace(/^(?:title|name|workflow)\s*[:\\-–—]\s*/i, "")
    .replace(/^["'“”]|["'“”]$/g, "")
    .trim();
}
