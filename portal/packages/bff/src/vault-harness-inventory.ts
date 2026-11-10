/**
 * Project the live vault document (skills/ + workflows/) onto the harness
 * settings snapshot (lp-oop.38.18).
 *
 * Tools inventory is the same CP/S3 tree Vault UI lists. Harness
 * BACKEND_HOME may be unset on Fargate; empty harness arrays are not the
 * product document. Models stay harness/LiteLLM. Fail-soft: vault errors
 * leave the harness snapshot unchanged.
 */

import type { UserRbac } from "./control-plane-client.js";
import type { VaultEntry } from "./vault/types.js";
import type { VaultService } from "./vault/service.js";

const SKILL_MD = "SKILL.md";
const SKILLS_ROOT = "/skills";
const WORKFLOW_ROOTS = ["/workflows", "/.lanyard/workflows"] as const;

export type VaultHarnessSkill = {
  id: string;
  name: string;
  enabled: boolean;
  path: string;
  source: "harness";
};

export type VaultHarnessWorkflow = {
  id: string;
  name: string;
  path: string;
  enabled: boolean;
};

export type VaultHarnessInventory = {
  skills: VaultHarnessSkill[];
  workflows: VaultHarnessWorkflow[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asRows(value: unknown): Record<string, unknown>[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord);
}

function rowId(row: Record<string, unknown>): string {
  if (typeof row.id === "string" && row.id.trim()) return row.id.trim();
  if (typeof row.name === "string" && row.name.trim()) return row.name.trim();
  return "";
}

function vaultRel(path: string): string {
  return path.replace(/^\/+/, "");
}

function isReadme(name: string): boolean {
  return /^readme\.md$/i.test(name);
}

function workflowIdFromName(name: string): string | null {
  if (!name || name.startsWith(".") || isReadme(name)) return null;
  if (/\.(ya?ml|json|md)$/i.test(name)) {
    return name.replace(/\.(ya?ml|json|md)$/i, "");
  }
  if (!name.includes(".")) return name;
  return null;
}

async function listSafe(
  vault: VaultService,
  rbac: UserRbac,
  path: string,
): Promise<VaultEntry[]> {
  try {
    const listing = await vault.listEntries(rbac, path);
    return listing.entries;
  } catch {
    return [];
  }
}

export async function collectVaultHarnessInventory(
  vault: VaultService,
  rbac: UserRbac,
): Promise<VaultHarnessInventory> {
  const skills: VaultHarnessSkill[] = [];
  const skillDirs = await listSafe(vault, rbac, SKILLS_ROOT);
  for (const entry of skillDirs) {
    if (entry.kind !== "directory") continue;
    if (entry.name.startsWith(".")) continue;
    const kids = await listSafe(vault, rbac, entry.path);
    const hasSkillMd = kids.some(
      (kid) => kid.kind === "file" && kid.name === SKILL_MD,
    );
    if (!hasSkillMd) continue;
    skills.push({
      id: entry.name,
      name: entry.name,
      enabled: true,
      path: vaultRel(entry.path),
      source: "harness",
    });
  }
  skills.sort((a, b) => a.id.localeCompare(b.id));

  const workflows: VaultHarnessWorkflow[] = [];
  const seen = new Set<string>();
  for (const root of WORKFLOW_ROOTS) {
    const entries = await listSafe(vault, rbac, root);
    for (const entry of entries) {
      if (entry.kind !== "file") continue;
      const id = workflowIdFromName(entry.name);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      workflows.push({
        id,
        name: id,
        path: vaultRel(entry.path),
        enabled: true,
      });
    }
  }
  workflows.sort((a, b) => a.id.localeCompare(b.id));

  return { skills, workflows };
}

/**
 * Union by id. Harness rows win on collision (enabled flags from config).
 * Vault rows fill ids the harness snapshot omitted.
 */
export function overlayVaultInventoryOnSnapshot(
  snapshot: Record<string, unknown>,
  inventory: VaultHarnessInventory,
): Record<string, unknown> {
  return {
    ...snapshot,
    skills: mergeRows(asRows(snapshot.skills), inventory.skills),
    workflows: mergeRows(asRows(snapshot.workflows), inventory.workflows),
  };
}

function mergeRows(
  primary: Record<string, unknown>[],
  fill: Array<Record<string, unknown>>,
): Record<string, unknown>[] {
  const byId = new Map<string, Record<string, unknown>>();
  for (const row of fill) {
    const id = rowId(row);
    if (!id) continue;
    byId.set(id.toLowerCase(), row);
  }
  for (const row of primary) {
    const id = rowId(row);
    if (!id) continue;
    byId.set(id.toLowerCase(), row);
  }
  return [...byId.values()].sort((a, b) => rowId(a).localeCompare(rowId(b)));
}

export async function projectVaultInventoryOntoSnapshot(
  snapshot: Record<string, unknown>,
  vault: VaultService,
  rbac: UserRbac | null | undefined,
): Promise<Record<string, unknown>> {
  if (!rbac) return snapshot;
  try {
    const inventory = await collectVaultHarnessInventory(vault, rbac);
    return overlayVaultInventoryOnSnapshot(snapshot, inventory);
  } catch {
    return snapshot;
  }
}
