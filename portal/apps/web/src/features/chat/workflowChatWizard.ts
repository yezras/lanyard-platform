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
    .replace(/^(?:title|name|workflow)\s*[:\-–—]\s*/i, "")
    .replace(/^["'“”]|["'“”]$/g, "")
    .trim();
}

/**
 * Extract an optional short title from free-form prose.
 * Patterns: "Title: …", "called X", first short line + body, leading "Name — body".
 */
export function extractWorkflowNameFromProse(text: string): {
  name?: string;
  remainder: string;
} {
  const raw = text.trim();
  if (!raw) return { remainder: "" };

  // "Title: Research Report" or "Title: Research Report Research the topic…"
  // (newlines may be flattened by single-line inputs — take first 1–5 words only)
  const titleLabel = raw.match(
    /^(?:title|name|workflow)\s*[:\-–—]\s*(.+)$/im,
  );
  if (titleLabel?.[1]) {
    const after = titleLabel[1].trim();
    const words = after.split(/\s+/).filter(Boolean);
    // Prefer a short title: first 1–5 words that do not start a phase verb sentence
    let take = Math.min(5, words.length);
    for (let i = 1; i < Math.min(5, words.length); i++) {
      const slice = words.slice(0, i + 1).join(" ");
      // Stop before a new sentence-ish phase verb if we already have ≥1 word
      if (
        i >= 1 &&
        STAGE_VERB_ALIASES.some(({ pattern }) => pattern.test(words[i]!)) &&
        !STAGE_VERB_ALIASES.some(({ pattern }) =>
          pattern.test(words.slice(0, i).join(" ")),
        )
      ) {
        take = i;
        break;
      }
    }
    // If the whole after is short, use it all
    if (words.length <= 5 && !looksLikeMultiPhaseProse(after)) {
      take = words.length;
    }
    const candidate = words.slice(0, take).join(" ");
    const name = normalizeWorkflowWizardName(candidate);
    if (name && name !== "title" && name !== "name" && name !== "workflow") {
      const restFromLine = words.slice(take).join(" ").trim();
      const remainder = raw
        .replace(titleLabel[0], restFromLine)
        .replace(/^\s*\n+/, "")
        .replace(/\s+/g, " ")
        .trim();
      return { name, remainder: remainder || after };
    }
  }

  const called = raw.match(
    /\b(?:call(?:ed)?|name(?:d)?)\s+(?:it|this|the workflow)?\s*[:\s]+["']?([A-Za-z][\w\s-]{1,40})["']?/i,
  );
  if (called?.[1] && wordCount(called[1]) <= 5) {
    const name = normalizeWorkflowWizardName(called[1]);
    if (name) {
      const remainder = raw.replace(called[0], " ").replace(/\s+/g, " ").trim();
      return { name, remainder: remainder || raw };
    }
  }

  const quoted = raw.match(/^["'“]([^"'”]{2,40})["'”]\s*[:\-–—,]?\s*([\s\S]+)$/);
  if (quoted?.[1] && quoted[2] && wordCount(quoted[1]) <= 5) {
    const name = normalizeWorkflowWizardName(quoted[1]);
    if (name) return { name, remainder: quoted[2].trim() };
  }

  const lines = raw
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length >= 2 && wordCount(lines[0]!) <= 5 && lines[0]!.length <= 48) {
    const maybe = normalizeWorkflowWizardName(stripTitlePrefix(lines[0]!));
    if (
      maybe &&
      maybe !== "title" &&
      maybe !== "name" &&
      maybe !== "workflow"
    ) {
      return { name: maybe, remainder: lines.slice(1).join("\n") };
    }
  }

  // "Daily Brief: research news then summarize"
  // Never treat the labels Title/Name/Workflow as the workflow id.
  const colonHead = raw.match(/^([A-Za-z][\w\s-]{1,40})\s*:\s+([\s\S]{8,})$/);
  if (colonHead?.[1] && colonHead[2] && wordCount(colonHead[1]) <= 5) {
    const label = colonHead[1].trim().toLowerCase();
    if (label === "title" || label === "name" || label === "workflow") {
      // Fall through — handled above; if we got here, parse body for a short title
      const body = colonHead[2].trim();
      const bodyWords = body.split(/\s+/).filter(Boolean);
      const short = bodyWords.slice(0, 3).join(" ");
      const name = normalizeWorkflowWizardName(short);
      if (name && bodyWords.length > 3) {
        return {
          name,
          remainder: bodyWords.slice(3).join(" ").trim() || body,
        };
      }
    } else {
      const name = normalizeWorkflowWizardName(colonHead[1]);
      // Avoid treating "research: gather facts" stage DSL as a title when short.
      if (name && wordCount(colonHead[2]) >= 3) {
        return { name, remainder: colonHead[2].trim() };
      }
    }
  }

  return { remainder: raw };
}

function stageNameFromProse(text: string, index: number): string {
  for (const { pattern, name } of STAGE_VERB_ALIASES) {
    if (pattern.test(text)) return name;
  }
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 3);
  const fromWords = normalizeWorkflowWizardName(words.join(" "));
  if (fromWords) return fromWords;
  return `stage-${index + 1}`;
}

function makeStage(
  name: string,
  description: string,
  prompt?: string,
): WorkflowAuthoredStage {
  const desc = description.trim() || name;
  return {
    name,
    description: desc,
    agents: [
      {
        prompt:
          prompt?.trim() ||
          `Work on this step: ${desc}. Use the parent brief for context.`,
        capability_mode: "read-only",
        description: desc.length > 48 ? `${desc.slice(0, 45)}…` : desc,
      },
    ],
  };
}

function dedupeStageNames(stages: WorkflowAuthoredStage[]): WorkflowAuthoredStage[] {
  const seen = new Map<string, number>();
  return stages.map((s) => {
    const base = s.name;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    if (n === 1) return s;
    const suffix = normalizeWorkflowWizardName(`${base}-${n}`) ?? `${base}-${n}`;
    return { ...s, name: suffix };
  });
}

/** Detect multi-phase intent markers (then / next / numbered / bullets). */
export function looksLikeMultiPhaseProse(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/(?:^|\n)\s*(?:\d+[.)]\s+|[-*•]\s+)\S/m.test(t)) return true;
  if (/\s[|;]\s/.test(t)) return true;
  if (/\bthen\b/i.test(t)) return true;
  if (/\b(?:after that|afterwards|next,|finally,|following that)\b/i.test(t)) {
    return true;
  }
  // Two+ sentences with different phase verbs
  const sentences = t
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  if (sentences.length >= 2) {
    const verbs = new Set<string>();
    for (const s of sentences) {
      for (const { pattern, name } of STAGE_VERB_ALIASES) {
        if (pattern.test(s)) verbs.add(name);
      }
    }
    if (verbs.size >= 2) return true;
  }
  return false;
}

/**
 * Split multi-phase natural language into stage segments.
 * Returns null when multi-phase is indicated but cannot be split safely
 * (caller should clarify — never kebab-case the whole paragraph).
 */
function splitMultiPhaseSegments(text: string): string[] | null {
  const raw = text.trim();
  if (!raw) return null;

  // Numbered or bulleted lines
  const lines = raw
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);
  const bulletOrNumber = lines.filter((l) =>
    /^(?:\d+[.)]\s+|[-*•]\s+)/.test(l),
  );
  if (bulletOrNumber.length >= 2) {
    return bulletOrNumber.map((l) =>
      l.replace(/^(?:\d+[.)]\s+|[-*•]\s+)/, "").trim(),
    );
  }

  // Pipe / semicolon short lists (legacy compact form)
  if (/\s[|;]\s/.test(raw) && !raw.includes("\n")) {
    const parts = raw
      .split(/\s*[|;]\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length >= 2) return parts;
  }

  // Sentence-boundary transitions: "…. Then …" / "…. Next, …" / "…. Finally, …"
  const transitionSplit = raw
    .split(
      /(?<=[.!?])\s+(?=(?:Then|Next|After that|Afterwards|Finally|Following that)\b)/i,
    )
    .map((s) => s.trim())
    .filter(Boolean);
  if (transitionSplit.length >= 2) {
    return transitionSplit.map((s) =>
      s.replace(
        /^(?:Then|Next|After that|Afterwards|Finally|Following that)[,:]?\s+/i,
        "",
      ),
    );
  }

  // Mid-sentence "… then …" with phase verbs on both sides
  const thenMatch = raw.match(
    /^([\s\S]+?)\bthen\b\s+([\s\S]+)$/i,
  );
  if (thenMatch?.[1] && thenMatch[2]) {
    const left = thenMatch[1].trim().replace(/[,;]\s*$/, "");
    const right = thenMatch[2].trim();
    if (wordCount(left) >= 2 && wordCount(right) >= 2) {
      return [left, right];
    }
  }

  // Two+ sentences with ≥2 distinct phase verbs
  const sentences = raw
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 3);
  if (sentences.length >= 2) {
    const tagged = sentences.map((s) => {
      let verb: string | null = null;
      for (const { pattern, name } of STAGE_VERB_ALIASES) {
        if (pattern.test(s)) {
          verb = name;
          break;
        }
      }
      return { s, verb };
    });
    const verbs = new Set(
      tagged.map((t) => t.verb).filter((v): v is string => Boolean(v)),
    );
    if (verbs.size >= 2) {
      // Group consecutive sentences sharing the same verb; merge untagged into neighbors
      const groups: string[] = [];
      let buf = "";
      let lastVerb: string | null = null;
      for (const t of tagged) {
        if (t.verb && lastVerb && t.verb !== lastVerb && buf) {
          groups.push(buf.trim());
          buf = t.s;
          lastVerb = t.verb;
        } else {
          buf = buf ? `${buf} ${t.s}` : t.s;
          if (t.verb) lastVerb = t.verb;
        }
      }
      if (buf.trim()) groups.push(buf.trim());
      if (groups.length >= 2) return groups;
    }
  }

  if (looksLikeMultiPhaseProse(raw)) {
    // Multi-phase language present but we could not split safely.
    return null;
  }
  return [raw];
}

/**
 * Parse free-text stage list (NL multi-phase, pipe, colon, or multi-line).
 *
 * Formats accepted:
 * - Multi-sentence NL: "Research the topic. Then write a report."
 * - "research | write" (names only → one default agent each)
 * - "research: gather facts; write: draft report" (name: prompt)
 * - multi-line "name: prompt" or numbered steps
 *
 * Returns null when empty or when multi-phase prose cannot be split
 * (do not silently kebab-case a whole paragraph into one stage).
 */
export function parseStagesFreeText(
  text: string,
): WorkflowAuthoredStage[] | null {
  const raw = text.trim();
  if (!raw) return null;

  // Compact colon / pipe DSL when every segment is short or name:prompt
  const lines = raw
    .split(/\n+/)
    .map((l) => l.trim())
    .filter(Boolean);

  const compactSegments =
    lines.length > 1 &&
    lines.every(
      (l) =>
        /^(?:\d+[.)]\s+|[-*•]\s+)?[a-zA-Z][\w\s-]{0,40}(?:\s*:\s*.+)?$/.test(
          l,
        ) && wordCount(l.split(":")[0] ?? l) <= 6,
    )
      ? lines.map((l) => l.replace(/^(?:\d+[.)]\s+|[-*•]\s+)/, "").trim())
      : !raw.includes("\n") && /\s[|;]\s/.test(raw)
        ? raw
            .split(/\s*[|;]\s*/)
            .map((s) => s.trim())
            .filter(Boolean)
        : null;

  if (compactSegments && compactSegments.length >= 1) {
    const allShort = compactSegments.every((seg) => {
      const colon = seg.indexOf(":");
      const namePart = colon > 0 ? seg.slice(0, colon).trim() : seg;
      return wordCount(namePart) <= 5 && namePart.length <= 40;
    });
    if (allShort) {
      const stages: WorkflowAuthoredStage[] = [];
      for (const seg of compactSegments) {
        const colon = seg.indexOf(":");
        let namePart: string;
        let promptPart: string | undefined;
        if (colon > 0) {
          namePart = seg.slice(0, colon).trim();
          promptPart = seg.slice(colon + 1).trim() || undefined;
        } else {
          namePart = seg;
        }
        // Long name part without colon → not compact DSL; fall through to NL.
        if (wordCount(namePart) > 5) {
          break;
        }
        const name = normalizeWorkflowWizardName(namePart);
        if (!name) return null;
        stages.push(makeStage(name, namePart, promptPart));
      }
      if (stages.length === compactSegments.length && stages.length > 0) {
        return dedupeStageNames(stages);
      }
    }
  }

  // Natural-language multi-phase / single-phase
  const segments = splitMultiPhaseSegments(raw);
  if (segments === null) {
    // Multi-phase indicated but unsafe to invent a single kebab stage.
    return null;
  }

  if (segments.length === 1) {
    const only = segments[0]!;
    // Never use a long paragraph as the stage id.
    if (wordCount(only) > 8 || only.length > 64) {
      const name = stageNameFromProse(only, 0);
      return [makeStage(name, only, only)];
    }
    // Short single token/phrase → treat as stage name
    if (!looksLikeMultiPhaseProse(only) && wordCount(only) <= 5) {
      const colon = only.indexOf(":");
      if (colon > 0) {
        const namePart = only.slice(0, colon).trim();
        const promptPart = only.slice(colon + 1).trim();
        const name = normalizeWorkflowWizardName(namePart);
        if (!name) return null;
        return [makeStage(name, namePart, promptPart || undefined)];
      }
      const name = normalizeWorkflowWizardName(only) ?? stageNameFromProse(only, 0);
      return [makeStage(name, only)];
    }
    const name = stageNameFromProse(only, 0);
    return [makeStage(name, only, only)];
  }

  // ≥2 segments from multi-phase split
  const stages = segments.map((seg, i) => {
    const colon = seg.indexOf(":");
    if (colon > 0 && wordCount(seg.slice(0, colon)) <= 5) {
      const namePart = seg.slice(0, colon).trim();
      const promptPart = seg.slice(colon + 1).trim();
      const name =
        normalizeWorkflowWizardName(namePart) ?? stageNameFromProse(seg, i);
      return makeStage(name, namePart, promptPart || seg);
    }
    const name = stageNameFromProse(seg, i);
    return makeStage(name, seg, seg);
  });
  return dedupeStageNames(stages);
}

/**
 * Parse a free-form workflow description into name / description / stages.
 * Multi-sentence research→write prose yields ≥2 stages; ambiguous multi-phase
 * returns ok:false with a clarify message (never one giant kebab stage).
 */
export function parseWorkflowNaturalLanguage(
  text: string,
): WorkflowNlParseResult {
  const raw = typeof text === "string" ? text.trim() : "";
  if (!raw) {
    return {
      ok: false,
      reason: "empty",
      message: "Please describe what the workflow should do.",
    };
  }
  if (looksLikeIrJson(raw)) {
    return {
      ok: false,
      reason: "looks_like_ir",
      message:
        "Please describe the workflow in plain language — no technical paste needed.",
    };
  }

  const { name, remainder } = extractWorkflowNameFromProse(raw);
  const description = (remainder || raw).trim();
  if (!description) {
    return {
      ok: false,
      reason: "empty",
      message: "Please describe what the workflow should do.",
      name,
    };
  }

  const multiHint = looksLikeMultiPhaseProse(description);
  const stages = parseStagesFreeText(description);

  if (multiHint && (!stages || stages.length < 2)) {
    return {
      ok: false,
      reason: "ambiguous",
      message:
        "I couldn't tell the steps apart. Try separate sentences, for example: Research the topic thoroughly. Then write a summary report.",
      name,
      description,
    };
  }

  if (!stages || stages.length === 0) {
    return {
      ok: false,
      reason: "ambiguous",
      message:
        "I couldn't find clear steps. Describe what should happen in one or more plain sentences.",
      name,
      description,
    };
  }

  return {
    ok: true,
    ...(name ? { name } : {}),
    description,
    stages,
    multiPhase: stages.length >= 2,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function newSessionId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID().replace(/-/g, "").slice(0, 12);
  }
  return `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function mcq(
  step: WorkflowWizardStep,
  sessionId: string,
  content: string,
  choices: readonly McqChoice[],
): WorkflowWizardMcqPrompt {
  return {
    portal_event: "mcq",
    mcq_id: buildWorkflowWizardMcqId(step, sessionId),
    content,
    choices: choices.map((c) => ({ ...c })),
    step,
  };
}

function withMcq(
  session: WorkflowWizardSession,
  prompt: WorkflowWizardMcqPrompt,
  statusMessage: string,
): WorkflowWizardSession {
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
  session: WorkflowWizardSession,
  step: WorkflowWizardStep,
  statusMessage: string,
): WorkflowWizardSession {
  return {
    ...session,
    step,
    activeMcq: null,
    statusMessage,
    readyToCreate: false,
    error: null,
  };
}

/** Plain-language summary for confirm MCQ (no technical jargon). */
function summarizeDraft(draft: WorkflowWizardDraft): string {
  const name = draft.name?.trim() || "(unnamed)";
  // Prefer humanized name in display
  const displayName = name
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  const description = draft.description?.trim() || "(no description)";
  const descShort =
    description.length > 160 ? `${description.slice(0, 157)}…` : description;
  const stages = draft.stages ?? [];
  const stageLines =
    stages.length === 0
      ? "  (none yet)"
      : stages
          .map((s, i) => {
            const label =
              s.description?.trim() ||
              s.name
                .split("-")
                .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
                .join(" ");
            const short =
              label.length > 80 ? `${label.slice(0, 77)}…` : label;
            return `  ${i + 1}. ${short}`;
          })
          .join("\n");
  return `**${displayName}**\n${descShort}\n\nSteps:\n${stageLines}`;
}

function stagesFromPreset(id: string): WorkflowAuthoredStage[] | null {
  switch (id) {
    case "one_stage":
      return [
        {
          name: "run",
          description: "Primary work",
          agents: [
            {
              prompt:
                "Complete the task from the parent brief using available tools.",
              role: "general-purpose",
              capability_mode: "read-write",
              description: "Worker",
            },
          ],
        },
      ];
    case "two_stage":
      return PURPOSE_TEMPLATES.research_report!.stages.map((s) => ({
        ...s,
        agents: s.agents?.map((a) => ({ ...a })),
      }));
    default:
      return null;
  }
}

const DESCRIBE_PROMPT =
  "Describe what this workflow should do in plain language. You can include a short title (for example: Daily brief — research overnight news, then write a summary).";

const NAME_PROMPT =
  "What should we call this workflow? A short name is fine (for example: Daily brief).";

const STAGES_CUSTOM_PROMPT =
  "Describe the steps in plain language. Separate phases with sentences — for example: Research the topic thoroughly. Then write a summary report.";

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export type CreateWorkflowWizardOptions = {
  sessionId?: string;
  /**
   * `guided` — Workflow wizard menu (intent + templates).
   * `blank` — New workflow menu (NL describe first).
   */
  mode?: WorkflowWizardMode;
  /** Skip optional intent confirm (start at describe). */
  skipIntent?: boolean;
  seed?: Partial<WorkflowWizardDraft>;
};

/**
 * Start a new workflow create wizard session and emit the first MCQ/text step.
 */
export function createWorkflowWizardSession(
  options: CreateWorkflowWizardOptions = {},
): {
  session: WorkflowWizardSession;
  firstMcq: WorkflowWizardMcqPrompt | null;
} {
  const sessionId = options.sessionId?.trim() || newSessionId();
  const mode = options.mode ?? "guided";
  const skipIntent = options.skipIntent ?? mode === "blank";

  let session: WorkflowWizardSession = {
    sessionId,
    step: "intent",
    mode,
    draft: { ...(options.seed ?? {}) },
    activeMcq: null,
    statusMessage: "Starting workflow setup…",
    readyToCreate: false,
    createBody: null,
    createdName: null,
    error: null,
  };

  if (skipIntent || mode === "blank") {
    // Blank / New workflow: natural-language description first.
    session = waitingText(session, "describe", DESCRIBE_PROMPT);
    return { session, firstMcq: null };
  }

  const prompt = mcq(
    "intent",
    sessionId,
    "Create a multi-step **workflow**? (a reusable definition — not a one-shot chat)",
    WORKFLOW_INTENT_CHOICES,
  );
  session = withMcq(session, prompt, "Confirm you want a workflow");
  return { session, firstMcq: prompt };
}

/**
 * Build create body from a complete draft. Throws if incomplete/invalid.
 * Never requires raw IR/JSON from the user.
 */
export function buildWorkflowCreateBody(
  draft: WorkflowWizardDraft,
  options: { action?: "create" | "save"; launchAfter?: boolean } = {},
): WorkflowCreateBody {
  const nameRaw = draft.name?.trim();
  if (!nameRaw) {
    throw new Error("Workflow name is required");
  }
  const name = isValidWorkflowWizardName(nameRaw)
    ? nameRaw
    : normalizeWorkflowWizardName(nameRaw);
  if (!name) {
    throw new Error(
      "Could not form a valid workflow name from that title — try a short phrase.",
    );
  }
  const description = draft.description?.trim();
  if (!description) {
    throw new Error("Workflow description is required");
  }
  const stages = draft.stages;
  if (!stages?.length) {
    throw new Error("At least one step is required");
  }

  const body: WorkflowCreateBody = {
    action: options.action ?? "create",
    name,
    description,
    stages: stages.map((s) => ({
      name: s.name,
      ...(s.description ? { description: s.description } : {}),
      ...(s.agents?.length
        ? {
            agents: s.agents.map((a) => ({
              prompt: a.prompt,
              ...(a.description ? { description: a.description } : {}),
              ...(a.role ? { role: a.role } : {}),
              ...(a.capability_mode
                ? { capability_mode: a.capability_mode }
                : {}),
              ...(a.isolation ? { isolation: a.isolation } : {}),
              ...(a.label ? { label: a.label } : {}),
            })),
          }
        : {}),
    })),
  };
  if (draft.when_to_use?.trim()) {
    body.when_to_use = draft.when_to_use.trim();
  }
  const launch =
    options.launchAfter !== undefined
      ? options.launchAfter
      : Boolean(draft.launchAfter);
  if (launch) {
    body.launchAfter = true;
  }
  return body;
}

/**
 * Agent-facing instruction for host workflow create/save.
 * Sent to the model — keep structured, avoid user-facing jargon like "IR JSON"
 * or `Call workflow({…})` so transcripts stay readable if this text is shown.
 */
export function formatWorkflowCreateAgentRequest(
  body: WorkflowCreateBody,
): string {
  const stageBlocks = body.stages
    .map((s, i) => {
      const agents = s.agents ?? [];
      const agentLines =
        agents.length === 0
          ? "    (phase only — no agents)"
          : agents
              .map(
                (a, j) =>
                  `    ${j + 1}. ${a.description ?? a.label ?? "agent"}: ${a.prompt}${
                    a.role ? ` [role=${a.role}]` : ""
                  }${
                    a.capability_mode
                      ? ` [capability=${a.capability_mode}]`
                      : ""
                  }`,
              )
              .join("\n");
      return `  ${i + 1}. ${s.name}${s.description ? ` — ${s.description}` : ""}\n${agentLines}`;
    })
    .join("\n");

  const launchLine = body.launchAfter
    ? "\nAfter a successful create, launch the workflow by name."
    : "";

  return [
    `Please create and save this workflow using action=${body.action}.`,
    `Use these structured fields only (map them internally — do not ask me to paste technical definitions):`,
    ``,
    `- **name:** ${body.name}`,
    `- **description:** ${body.description}`,
    body.when_to_use ? `- **when_to_use:** ${body.when_to_use}` : null,
    `- **stages:**`,
    stageBlocks,
    launchLine,
    ``,
    `Confirm the saved name and path when done.`,
  ]
    .filter((line) => line !== null)
    .join("\n");
}

/**
 * User-visible create progress line (never mentions IR/JSON/tool syntax).
 */
export function formatWorkflowCreateUserProgress(
  body: WorkflowCreateBody,
): string {
  const display = body.name
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
  return body.launchAfter
    ? `Creating **${display}** and launching it…`
    : `Creating **${display}**…`;
}

function advanceAfterName(
  session: WorkflowWizardSession,
): WorkflowWizardApplyResult {
  if (session.mode === "guided" && !session.draft.description) {
    const prompt = mcq(
      "purpose_template",
      session.sessionId,
      "What is this workflow for?",
      PURPOSE_TEMPLATE_CHOICES,
    );
    const next = withMcq(
      session,
      prompt,
      "Choose a purpose template or describe it yourself",
    );
    return { ok: true, session: next, nextMcq: prompt, shouldCreate: false };
  }
  if (!session.draft.description) {
    const next = waitingText(session, "describe", DESCRIBE_PROMPT);
    return { ok: true, session: next, nextMcq: null, shouldCreate: false };
  }
  return advanceAfterPurpose(session);
}

function advanceAfterPurpose(
  session: WorkflowWizardSession,
): WorkflowWizardApplyResult {
  if (session.draft.stages?.length) {
    return advanceToConfirm(session);
  }
  const prompt = mcq(
    "stages",
    session.sessionId,
    "How should this workflow be structured?",
    STAGES_PRESET_CHOICES,
  );
  const next = withMcq(session, prompt, "Choose a step layout");
  return { ok: true, session: next, nextMcq: prompt, shouldCreate: false };
}

function advanceToConfirm(
  session: WorkflowWizardSession,
): WorkflowWizardApplyResult {
  const summary = summarizeDraft(session.draft);
  const prompt = mcq(
    "confirm",
    session.sessionId,
    `Does this look right?\n\n${summary}`,
    WORKFLOW_CONFIRM_CHOICES,
  );
  const next = withMcq(session, prompt, "Confirm create");
  return { ok: true, session: next, nextMcq: prompt, shouldCreate: false };
}

/**
 * After NL describe: fill draft, ask for name if needed, else stages/confirm.
 */
function advanceFromDescribe(
  session: WorkflowWizardSession,
  parsed: WorkflowNlParseOk,
  raw: string,
): WorkflowWizardApplyResult {
  const draft: WorkflowWizardDraft = {
    ...session.draft,
    rawDescription: raw,
    description: parsed.description,
    ...(parsed.name || session.draft.name
      ? { name: parsed.name ?? session.draft.name }
      : {}),
    ...(parsed.stages.length
      ? { stages: parsed.stages }
      : {}),
  };
  const nextSession = { ...session, draft };

  if (!draft.name) {
    const waiting = waitingText(nextSession, "name", NAME_PROMPT);
    return { ok: true, session: waiting, nextMcq: null, shouldCreate: false };
  }
  if (!draft.stages?.length) {
    return advanceAfterPurpose(nextSession);
  }
  return advanceToConfirm(nextSession);
}

/**
 * Apply an MCQ selection to the workflow wizard.
 */
export function applyWorkflowWizardMcqSelection(
  session: WorkflowWizardSession,
  selection: WorkflowMcqSelectionInput,
): WorkflowWizardApplyResult {
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

  const parsed = parseWorkflowWizardMcqId(selection.mcq_id);
  if (!parsed || parsed.sessionId !== session.sessionId) {
    return {
      ok: false,
      session,
      error: "mcq_id does not match this workflow wizard session",
    };
  }

  if (parsed.step !== session.step && session.activeMcq) {
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
        const next: WorkflowWizardSession = {
          ...session,
          step: "cancelled",
          activeMcq: null,
          statusMessage: "Cancelled — no workflow created.",
          readyToCreate: false,
          createBody: null,
          error: null,
        };
        return { ok: true, session: next, nextMcq: null, shouldCreate: false };
      }
      if (choiceId === "yes") {
        // Guided primary path: free-form description (templates available via MCQ later if needed).
        // Offer purpose templates as a light shortcut after a short name is optional —
        // NL describe first for multi-phase prose.
        const next = waitingText(session, "describe", DESCRIBE_PROMPT);
        return { ok: true, session: next, nextMcq: null, shouldCreate: false };
      }
      return { ok: false, session, error: `Unknown intent choice: ${choiceId}` };
    }

    case "purpose_template": {
      if (choiceId === "custom") {
        const next = waitingText(session, "describe", DESCRIBE_PROMPT);
        return { ok: true, session: next, nextMcq: null, shouldCreate: false };
      }
      const tmpl = PURPOSE_TEMPLATES[choiceId];
      if (!tmpl) {
        return {
          ok: false,
          session,
          error: `Unknown purpose template: ${choiceId}`,
        };
      }
      const draft: WorkflowWizardDraft = {
        ...session.draft,
        name: session.draft.name ?? tmpl.name,
        description: session.draft.description ?? tmpl.description,
        when_to_use: session.draft.when_to_use ?? tmpl.when_to_use,
        purposeTemplateId: choiceId,
        stages:
          session.draft.stages ??
          tmpl.stages.map((s) => ({
            ...s,
            agents: s.agents?.map((a) => ({ ...a })),
          })),
      };
      return advanceAfterPurpose({ ...session, draft });
    }

    case "stages": {
      if (choiceId === "custom") {
        const next = waitingText(
          session,
          "stages_custom",
          STAGES_CUSTOM_PROMPT,
        );
        return { ok: true, session: next, nextMcq: null, shouldCreate: false };
      }
      const stages = stagesFromPreset(choiceId);
      if (!stages) {
        return {
          ok: false,
          session,
          error: `Unknown stages choice: ${choiceId}`,
        };
      }
      return advanceToConfirm({
        ...session,
        draft: { ...session.draft, stages },
      });
    }

    case "confirm": {
      if (choiceId === "cancel") {
        const next: WorkflowWizardSession = {
          ...session,
          step: "cancelled",
          activeMcq: null,
          statusMessage: "Cancelled — no workflow created.",
          readyToCreate: false,
          createBody: null,
          error: null,
        };
        return { ok: true, session: next, nextMcq: null, shouldCreate: false };
      }
      if (choiceId === "edit") {
        const next = waitingText(
          {
            ...session,
            draft: {
              ...session.draft,
              stages: undefined,
              purposeTemplateId: undefined,
            },
          },
          "describe",
          DESCRIBE_PROMPT,
        );
        return {
          ok: true,
          session: next,
          nextMcq: null,
          shouldCreate: false,
        };
      }
      if (choiceId === "create" || choiceId === "create_launch") {
        try {
          const launchAfter = choiceId === "create_launch";
          const createBody = buildWorkflowCreateBody(
            { ...session.draft, launchAfter },
            { action: "create", launchAfter },
          );
          const next: WorkflowWizardSession = {
            ...session,
            step: "creating",
            activeMcq: null,
            statusMessage: launchAfter
              ? "Creating and launching workflow…"
              : "Creating workflow…",
            readyToCreate: true,
            createBody,
            draft: { ...session.draft, launchAfter },
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
 * Apply free-text user reply for describe / name / purpose / custom stages.
 */
export function applyWorkflowWizardTextInput(
  session: WorkflowWizardSession,
  text: string,
): WorkflowWizardApplyResult {
  const value = text.trim();
  if (!value) {
    return { ok: false, session, error: "Empty reply" };
  }

  switch (session.step) {
    case "describe":
    case "purpose_text": {
      // purpose_text kept for backwards-compat sessions; same NL path as describe.
      if (looksLikeIrJson(value)) {
        return {
          ok: false,
          session,
          error:
            "Please describe the workflow in plain language — no technical paste needed.",
        };
      }
      const parsed = parseWorkflowNaturalLanguage(value);
      if (!parsed.ok) {
        // Stay on describe with clarify (do not advance with bad stages).
        const clarify = waitingText(
          {
            ...session,
            draft: {
              ...session.draft,
              rawDescription: value,
              ...(parsed.description
                ? { description: parsed.description }
                : {}),
              ...(parsed.name ? { name: parsed.name } : {}),
            },
          },
          "describe",
          parsed.message,
        );
        return {
          ok: false,
          session: { ...clarify, error: parsed.message },
          error: parsed.message,
        };
      }
      return advanceFromDescribe(session, parsed, value);
    }

    case "name": {
      if (looksLikeIrJson(value)) {
        return {
          ok: false,
          session,
          error: "Please enter a short name — no technical paste needed.",
        };
      }
      // If the user pastes multi-sentence prose here, treat as full describe.
      if (looksLikeMultiPhaseProse(value) || wordCount(value) > 8) {
        const parsed = parseWorkflowNaturalLanguage(value);
        if (parsed.ok) {
          return advanceFromDescribe(session, parsed, value);
        }
        return {
          ok: false,
          session,
          error:
            parsed.message ||
            "That looks like a full description. Try a short name, or describe the steps in separate sentences.",
        };
      }
      const name = normalizeWorkflowWizardName(value);
      if (!name) {
        return {
          ok: false,
          session,
          error:
            "Could not use that as a name. Try a short phrase (for example: Daily brief).",
        };
      }
      return advanceAfterName({
        ...session,
        draft: { ...session.draft, name },
      });
    }

    case "stages_custom": {
      if (looksLikeIrJson(value)) {
        return {
          ok: false,
          session,
          error:
            "Please describe the steps in plain language — no technical paste needed.",
        };
      }
      const stages = parseStagesFreeText(value);
      if (!stages || (looksLikeMultiPhaseProse(value) && stages.length < 2)) {
        return {
          ok: false,
          session,
          error:
            "I couldn't tell the steps apart. Try: Research the topic thoroughly. Then write a summary report.",
        };
      }
      return advanceToConfirm({
        ...session,
        draft: { ...session.draft, stages },
      });
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
export function markWorkflowWizardCreateSucceeded(
  session: WorkflowWizardSession,
  createdName?: string | null,
): WorkflowWizardSession {
  const name =
    createdName?.trim() ||
    session.createBody?.name ||
    session.draft.name ||
    "workflow";
  return {
    ...session,
    step: "done",
    activeMcq: null,
    readyToCreate: false,
    createdName: name,
    statusMessage: session.createBody?.launchAfter
      ? `Workflow created and launch requested: ${name}`
      : `Workflow created: ${name}`,
    error: null,
  };
}

/**
 * Mark wizard failed after create error. Restores confirm MCQ for retry.
 */
export function markWorkflowWizardCreateFailed(
  session: WorkflowWizardSession,
  error: string,
): WorkflowWizardSession {
  const summary = summarizeDraft(session.draft);
  const prompt = mcq(
    "confirm",
    session.sessionId,
    `Create failed (${error}). Review and try again:\n\n${summary}`,
    WORKFLOW_CONFIRM_CHOICES,
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

/**
 * Steps that collect free text instead of MCQ.
 */
export function workflowWizardStepNeedsFreeText(
  step: string,
  activeMcq?: { mcq_id?: string } | null,
): step is "describe" | "name" | "purpose_text" | "stages_custom" {
  if (
    step === "describe" ||
    step === "name" ||
    step === "purpose_text" ||
    step === "stages_custom"
  ) {
    // Free-text only when no active MCQ is waiting.
    return activeMcq == null;
  }
  return false;
}
