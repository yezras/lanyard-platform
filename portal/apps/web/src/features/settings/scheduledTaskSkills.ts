/**
 * Scheduled task skill attachment from vault / Brain RPC skills inventory
 * (lp-jzl.9.2).
 *
 * Source of truth is the same inventory as Settings:
 * `settings.snapshot` with `include=skills` (vault + host skills_roots).
 * There is no separate skill registry for scheduled tasks.
 *
 * Pure TypeScript — shared by Settings create form (lp-jzl.5) and the chat
 * wizard skills step. Job rows store skill **ids**; at run time the agent
 * loads packs from vault / skills_roots via those ids (and optional paths
 * from inventory).
 */

import type { McqChoice } from "../../api/types.js";

/** Minimal skill row from settings.snapshot.skills. */
export type InventorySkill = {
  id: string;
  name?: string;
  enabled?: boolean;
  path?: string;
  source?: string;
};

/** UI / form option for attaching a skill to a scheduled task. */
export type SkillAttachmentOption = {
  id: string;
  name: string;
  path?: string;
  /** Whether the skill is currently enabled in inventory. */
  enabled: boolean;
};

export type ResolveJobSkillsResult =
  | {
      ok: true;
      /** Skill ids safe to store on the job (order preserved, de-duped). */
      skillIds: string[];
      /** Resolved inventory rows for the accepted ids (paths available). */
      resolved: SkillAttachmentOption[];
    }
  | {
      ok: false;
      error: string;
      unknown: string[];
    };

const SKILL_ID_MAX = 200;
const SKILLS_MAX = 50;

/**
 * Normalize a raw skill id for comparison / storage.
 * Empty or whitespace-only → null.
 */
export function normalizeSkillId(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const id = raw.trim();
  if (!id || id.length > SKILL_ID_MAX) return null;
  return id;
}

/**
 * Skills that may be attached on create/update.
 * Defaults to **enabled** inventory rows only (disabled skills stay out of
 * the picker). Pass `includeDisabled: true` for edit/debug surfaces.
 */
export function listAttachableSkills(
  inventory: InventorySkill[] | null | undefined,
  options: { includeDisabled?: boolean } = {},
): SkillAttachmentOption[] {
  if (!Array.isArray(inventory) || inventory.length === 0) return [];
  const out: SkillAttachmentOption[] = [];
  const seen = new Set<string>();
  for (const row of inventory) {
    const id = normalizeSkillId(row?.id);
    if (!id || seen.has(id)) continue;
    const enabled = row.enabled !== false;
    if (!options.includeDisabled && !enabled) continue;
    seen.add(id);
    const name =
      typeof row.name === "string" && row.name.trim()
        ? row.name.trim()
        : id;
    out.push({
      id,
      name,
      ...(typeof row.path === "string" && row.path.trim()
        ? { path: row.path.trim() }
        : {}),
      enabled,
    });
  }
  return out;
}

/**
 * Map snapshot skills → form multi-select options (enabled only by default).
 * Settings New scheduled task form uses this for the skill picker.
 */
export function skillAttachmentOptionsFromSnapshot(
  skills: InventorySkill[] | null | undefined,
  options: { includeDisabled?: boolean } = {},
): SkillAttachmentOption[] {
  return listAttachableSkills(skills, options);
}

/**
 * Partition selected skill ids into those present in inventory vs unknown.
 * Does not require skills to be enabled — useful for validating a stored job
 * against a later snapshot.
 */
export function partitionSkillIdsAgainstInventory(
  selectedIds: string[] | null | undefined,
  inventory: InventorySkill[] | null | undefined,
): { accepted: string[]; unknown: string[] } {
  const accepted: string[] = [];
  const unknown: string[] = [];
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
    return { accepted, unknown };
  }
  const byId = new Map<string, InventorySkill>();
  for (const row of inventory ?? []) {
    const id = normalizeSkillId(row?.id);
    if (id) byId.set(id, row);
  }
  const seen = new Set<string>();
  for (const raw of selectedIds) {
    const id = normalizeSkillId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (byId.has(id)) accepted.push(id);
    else unknown.push(id);
  }
  return { accepted, unknown };
}

/**
 * Resolve skill ids for job storage against snapshot inventory.
 *
 * - Empty / omitted selection → ok with empty skillIds (optional attach).
 * - Unknown ids fail closed when `requireKnown` is true (default).
 * - When inventory is empty and ids are requested, fail closed (cannot
 *   prove ids come from snapshot inventory).
 * - Cap: at most {@link SKILLS_MAX} ids.
 */
export function resolveJobSkillIds(
  selectedIds: string[] | null | undefined,
  inventory: InventorySkill[] | null | undefined,
  options: { requireKnown?: boolean } = {},
): ResolveJobSkillsResult {
  const requireKnown = options.requireKnown !== false;
  if (!Array.isArray(selectedIds) || selectedIds.length === 0) {
    return { ok: true, skillIds: [], resolved: [] };
  }

  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of selectedIds) {
    const id = normalizeSkillId(raw);
    if (!id) {
      return {
        ok: false,
        error: "Skill id must be a non-empty string",
        unknown: [String(raw ?? "")],
      };
    }
    if (seen.has(id)) continue;
    seen.add(id);
    normalized.push(id);
  }

  if (normalized.length > SKILLS_MAX) {
    return {
      ok: false,
      error: `At most ${SKILLS_MAX} skills may be attached to a scheduled task`,
      unknown: [],
    };
  }

  const attachable = listAttachableSkills(inventory, { includeDisabled: true });
  const byId = new Map(attachable.map((s) => [s.id, s]));
  const resolved: SkillAttachmentOption[] = [];
  const unknown: string[] = [];
  for (const id of normalized) {
    const row = byId.get(id);
    if (row) resolved.push(row);
    else unknown.push(id);
  }

  if (unknown.length > 0 && requireKnown) {
    return {
      ok: false,
      error:
        unknown.length === 1
          ? `Unknown skill id (not in settings.snapshot skills inventory): ${unknown[0]}`
          : `Unknown skill ids (not in settings.snapshot skills inventory): ${unknown.join(", ")}`,
      unknown,
    };
  }

  // Prefer only ids that resolved when requireKnown; otherwise keep all.
  const skillIds = requireKnown
    ? resolved.map((r) => r.id)
    : normalized;

  return { ok: true, skillIds, resolved };
}

/**
 * Build create/update wire `skills` array from a form/wizard selection.
 * Returns `undefined` when empty so callers omit the field; throws on
 * invalid/unknown ids (fail closed against inventory).
 */
export function skillIdsForJobWrite(
  selectedIds: string[] | null | undefined,
  inventory: InventorySkill[] | null | undefined,
): string[] | undefined {
  const result = resolveJobSkillIds(selectedIds, inventory, {
    requireKnown: true,
  });
  if (!result.ok) {
    throw new Error(result.error);
  }
  return result.skillIds.length > 0 ? [...result.skillIds] : undefined;
}

// ---------------------------------------------------------------------------
// Chat wizard MCQ helpers (lp-jzl.9.2 / D4 step 5)
// ---------------------------------------------------------------------------

/** Choice id for "attach no skills". */
export const SKILL_MCQ_NONE = "none" as const;
/** Choice id for "done selecting skills" (multi-select chain). */
export const SKILL_MCQ_DONE = "done" as const;

/**
 * MCQ choices for the optional skills step.
 * Single-select MCQ: user may pick one skill, none, or Done (when already
 * collecting a multi-select set via repeated prompts).
 *
 * @param inventory Snapshot skills
 * @param alreadySelected Skill ids already chosen in this wizard session
 */
export function buildSkillMcqChoices(
  inventory: InventorySkill[] | null | undefined,
  alreadySelected: string[] | null | undefined = [],
): McqChoice[] {
  const selected = new Set(
    (alreadySelected ?? [])
      .map((id) => normalizeSkillId(id))
      .filter((id): id is string => Boolean(id)),
  );
  const remaining = listAttachableSkills(inventory).filter(
    (s) => !selected.has(s.id),
  );

  const choices: McqChoice[] = [];

  if (selected.size === 0) {
    choices.push({ id: SKILL_MCQ_NONE, label: "No skills" });
  } else {
    choices.push({
      id: SKILL_MCQ_DONE,
      label: `Done selecting skills (${selected.size} selected)`,
    });
  }

  for (const skill of remaining) {
    const pathHint =
      skill.path && skill.path !== skill.id ? ` — ${skill.path}` : "";
    choices.push({
      id: skill.id,
      label: `${skill.name}${pathHint}`,
    });
  }

  // If all remaining attached already and none selected somehow, still allow none.
  if (choices.length === 0) {
    choices.push({ id: SKILL_MCQ_NONE, label: "No skills" });
  }

  return choices;
}

/**
 * Apply a skills-step MCQ choice_id against inventory + current selection.
 * Returns next selection + whether the step is complete.
 */
export function applySkillMcqChoice(
  choiceId: string,
  inventory: InventorySkill[] | null | undefined,
  alreadySelected: string[] | null | undefined = [],
):
  | { ok: true; skills: string[]; complete: boolean }
  | { ok: false; error: string } {
  const id = (choiceId ?? "").trim();
  if (!id) {
    return { ok: false, error: "choice_id is required" };
  }

  const current = (alreadySelected ?? [])
    .map((s) => normalizeSkillId(s))
    .filter((s): s is string => Boolean(s));

  if (id === SKILL_MCQ_NONE) {
    return { ok: true, skills: [], complete: true };
  }
  if (id === SKILL_MCQ_DONE) {
    return { ok: true, skills: current, complete: true };
  }

  const attachable = listAttachableSkills(inventory);
  const known = attachable.find((s) => s.id === id);
  if (!known) {
    return {
      ok: false,
      error: `Unknown skill id (not in snapshot inventory): ${id}`,
    };
  }
  if (current.includes(id)) {
    // Already selected — treat as complete if no remaining, else re-prompt.
    const remaining = attachable.filter((s) => !current.includes(s.id));
    return {
      ok: true,
      skills: current,
      complete: remaining.length === 0,
    };
  }
  if (current.length >= SKILLS_MAX) {
    return {
      ok: false,
      error: `At most ${SKILLS_MAX} skills may be attached`,
    };
  }
  const next = [...current, id];
  const remaining = attachable.filter((s) => !next.includes(s.id));
  // Auto-complete when no skills left to add.
  return {
    ok: true,
    skills: next,
    complete: remaining.length === 0,
  };
}

/**
 * True when the wizard should show the skills step (inventory has attachable
 * skills). Empty inventory → skip (optional attach).
 */
export function shouldPromptForSkills(
  inventory: InventorySkill[] | null | undefined,
): boolean {
  return listAttachableSkills(inventory).length > 0;
}

/**
 * Summarize attached skills for confirm card / review text.
 */
export function summarizeAttachedSkills(
  skillIds: string[] | null | undefined,
  inventory: InventorySkill[] | null | undefined,
): string {
  if (!skillIds?.length) return "None";
  const byId = new Map(
    listAttachableSkills(inventory, { includeDisabled: true }).map((s) => [
      s.id,
      s,
    ]),
  );
  return skillIds
    .map((id) => {
      const row = byId.get(id);
      return row?.name ?? id;
    })
    .join(", ");
}
