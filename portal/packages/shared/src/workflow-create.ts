/**
 * workflow.create host tool schema (lp-k5c4.21).
 *
 * Host tool wrapping workflow creation as owner identity.
 * Model-visible fields are { name, prompt, stages? }.
 */

const NAME_MAX = 128;
const PROMPT_MAX = 4096;

export const WORKFLOW_CREATE_TOOL_NAME = "workflow.create" as const;

export const WORKFLOW_CREATE_PARAMETERS = {
  type: "object",
  additionalProperties: false,
  required: ["name", "prompt"],
  properties: {
    name: {
      type: "string",
      minLength: 1,
      maxLength: NAME_MAX,
      description: "Workflow name.",
    },
    prompt: {
      type: "string",
      minLength: 1,
      maxLength: PROMPT_MAX,
      description: "Workflow prompt / instructions.",
    },
    stages: {
      type: "array",
      items: { type: "string" },
      description: "Optional stages.",
    },
  },
} as const;

export type WorkflowCreateInput = {
  name: string;
  prompt: string;
  stages?: string[];
};

export function parseWorkflowCreateInput(raw: unknown): WorkflowCreateInput {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw))
    throw new Error("invalid input");
  const rec = raw as Record<string, unknown>;
  const allowed = new Set(["name", "prompt", "stages"]);
  for (const k of Object.keys(rec)) if (!allowed.has(k)) throw new Error(`invalid ${k}`);
  const name = (() => {
    if (typeof rec.name !== "string") throw new Error("invalid name");
    const t = rec.name.trim();
    if (t.length < 1 || t.length > NAME_MAX) throw new Error("invalid name");
    return t;
  })();
  const prompt = (() => {
    if (typeof rec.prompt !== "string") throw new Error("invalid prompt");
    const t = rec.prompt.trim();
    if (t.length < 1 || t.length > PROMPT_MAX) throw new Error("invalid prompt");
    return t;
  })();
  let stages: string[] | undefined;
  if ("stages" in rec && rec.stages !== undefined) {
    if (!Array.isArray(rec.stages)) throw new Error("invalid stages");
    stages = rec.stages.map((s) => {
      if (typeof s !== "string") throw new Error("invalid stages");
      const t = s.trim();
      if (t.length === 0) throw new Error("invalid stages");
      return t;
    });
  }
  return { name, prompt, stages };
}
