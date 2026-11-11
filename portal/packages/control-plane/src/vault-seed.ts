/**
 * Optional client-core seed bootstrap into a tenant S3 vault prefix (lp-9o6).
 *
 * Runs **after** prefix ensure (`lp-jt5` / {@link ensureTenantVaultPrefix}).
 * Seed is **optional**: callers may provision an empty mountable vault with only
 * the platform prefix marker. When a seed pack is supplied, objects are written
 * under `tenants/{tenant_id}/vault/` only — never under another tenant, and never
 * by copying objects from another prefix (no cross-tenant copy).
 *
 * Idempotency matches `client-core/scripts/seed-vault.sh` plus fill-missing:
 *   - If vault-root `AGENTS.md` already exists → put missing pack objects only
 *   - If platform `bootstrap.json` seed marker exists (no AGENTS.md) → skip
 *   - Never deletes existing objects; re-seed only with explicit `force`
 *
 * Layout: docs/plans/0008-daytona-agent-sandboxes/s3-vault-prefix-layout.md
 *
 * No @aws-sdk dependency; inject {@link VaultObjectStore}.
 */

import type { RuntimeKind } from "./types.js";
import {
  assertValidTenantIdForVaultPrefix,
  buildS3VaultPrefix,
  ensureTenantVaultPrefix,
  VaultPrefixError,
  VaultPrefixRuntimeKindError,
  type EnsureTenantVaultPrefixResult,
  type VaultObjectStore,
} from "./vault-prefix.js";

/** Platform-only bootstrap / seed pin marker (never on guest mount). */
export const VAULT_SEED_BOOTSTRAP_MARKER_REL =
  "_platform/bootstrap.json" as const;

/** Schema version written into `_platform/bootstrap.json`. */
export const VAULT_SEED_BOOTSTRAP_VERSION = 1 as const;

/**
 * Live-vault gate object (vault-root relative). Presence means "do not re-seed"
 * unless `force` — same contract as seed-vault.sh + AGENTS.md.
 */
export const VAULT_SEED_GATE_REL = "AGENTS.md" as const;

/** Relative path for optional in-vault provenance (parity with seed-vault.sh). */
export const VAULT_SEED_PROVENANCE_REL = ".seed/provenance.json" as const;

export class VaultSeedError extends VaultPrefixError {
  constructor(code: string, message: string) {
    super(code, message);
    this.name = "VaultSeedError";
  }
}

/**
 * One vault-root-relative object to put under `s3_vault_prefix`.
 * Paths are relative to the mount root (e.g. `AGENTS.md`, `Knowledge/INDEX.md`).
 */
export type VaultSeedObject = {
  relativePath: string;
  body: string;
  contentType?: string;
};

export type BootstrapTenantVaultSeedInput = {
  /** Platform vault bucket name (no s3://). */
  bucket: string;
  tenantId: string;
  store: VaultObjectStore;
  /**
   * Optional seed pack. When omitted or empty, no content is written
   * (`skippedReason: "no_seed_pack"`) — empty vault remains usable after
   * prefix ensure.
   */
  seedObjects?: readonly VaultSeedObject[];
  /** Pin / label recorded in bootstrap marker (e.g. client-core version). */
  seedVersion?: string;
  /** Free-form source label (e.g. "client-core@v0.1.0", "inline-fixture"). */
  seedSource?: string;
  /**
   * When true, re-put seed objects even if AGENTS.md / bootstrap marker exist.
   * Still never deletes extra live objects. Intended for tests / ops repair.
   */
  force?: boolean;
  /** Clock for marker timestamps (ISO). Defaults to Date.now. */
  now?: () => Date;
};

export type BootstrapTenantVaultSeedSkippedReason =
  | "no_seed_pack"
  | "agents_md_present"
  | "bootstrap_marker_present";

export type BootstrapTenantVaultSeedResult = {
  bucket: string;
  tenantId: string;
  /** Normative CP field value. */
  s3_vault_prefix: string;
  /** Full key of platform bootstrap marker (even when seed skipped). */
  bootstrapMarkerKey: string;
  /** Full key of vault-root AGENTS.md gate object. */
  agentsMdKey: string;
  /** True when this call wrote seed objects. */
  seeded: boolean;
  /** Why seed was not applied (when `seeded` is false). */
  skippedReason?: BootstrapTenantVaultSeedSkippedReason;
  /** Number of putObject calls for seed content (excludes bootstrap marker). */
  objectsWritten: number;
  /** True when this call wrote/updated `_platform/bootstrap.json`. */
  bootstrapMarkerWritten: boolean;
};

function assertBucketName(bucket: string): string {
  const b = bucket?.trim() ?? "";
  if (!b) {
    throw new VaultSeedError("INVALID_BUCKET", "bucket is required");
  }
  if (b.startsWith("s3://") || b.includes("/")) {
    throw new VaultSeedError(
      "INVALID_BUCKET",
      "bucket must be a bare bucket name (no s3:// or key prefix)",
    );
  }
  return b;
}

/**
 * Platform bootstrap marker key:
 * `tenants/{tenant_id}/_platform/bootstrap.json`
 */
export function buildVaultSeedBootstrapMarkerKey(tenantId: string): string {
  const id = assertValidTenantIdForVaultPrefix(tenantId);
  return `tenants/${id}/${VAULT_SEED_BOOTSTRAP_MARKER_REL}`;
}

/**
 * Vault-root gate key: `tenants/{tenant_id}/vault/AGENTS.md`
 */
export function buildVaultSeedAgentsMdKey(tenantId: string): string {
  return `${buildS3VaultPrefix(tenantId)}${VAULT_SEED_GATE_REL}`;
}

/**
 * Validate a vault-root-relative seed path and return the full S3 object key
 * under the tenant's vault prefix.
 *
 * Rejects absolute paths, `..`, empty segments, backslashes, and any path that
 * would escape `tenants/{tenant_id}/vault/`.
 */
export function buildVaultSeedObjectKey(
  tenantId: string,
  relativePath: string,
): string {
  const prefix = buildS3VaultPrefix(tenantId);
  const raw = relativePath?.trim() ?? "";
  if (!raw) {
    throw new VaultSeedError("INVALID_SEED_PATH", "relativePath is required");
  }
  if (raw.startsWith("/") || raw.startsWith("\\")) {
    throw new VaultSeedError(
      "INVALID_SEED_PATH",
      `relativePath must be vault-root-relative (no leading slash): ${raw}`,
    );
  }
  if (raw.includes("\\") || raw.includes("\0")) {
    throw new VaultSeedError(
      "INVALID_SEED_PATH",
      `relativePath must not contain backslash or NUL: ${raw}`,
    );
  }
  // Normalize and reject traversal / empty segments.
  const parts = raw.split("/");
  for (const part of parts) {
    if (!part || part === "." || part === "..") {
      throw new VaultSeedError(
        "INVALID_SEED_PATH",
        `relativePath must not contain empty, '.', or '..' segments: ${raw}`,
      );
    }
  }
  if (raw.startsWith("tenants/") || raw.includes("://")) {
    throw new VaultSeedError(
      "INVALID_SEED_PATH",
      `relativePath must not be an absolute S3 key or URI: ${raw}`,
    );
  }
  const key = `${prefix}${parts.join("/")}`;
  // Defense in depth: key must stay under this tenant's vault prefix.
  if (!key.startsWith(prefix) || key.includes("..")) {
    throw new VaultSeedError(
      "INVALID_SEED_PATH",
      `resolved key escapes vault prefix: ${raw}`,
    );
  }
  return key;
}

function guessContentType(relativePath: string): string {
  const lower = relativePath.toLowerCase();
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) {
    return "application/yaml";
  }
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  return "application/octet-stream";
}

/**
 * Optional idempotent seed of client-core (or fixture) objects into the
 * tenant vault prefix. Does **not** create the prefix marker (`lp-jt5`);
 * call {@link ensureTenantVaultPrefix} first (or use
 * {@link bootstrapVaultForDaytonaProvision}).
 *
 * Cross-tenant safety: writes only under `tenants/{tenantId}/vault/` derived
 * from the input `tenantId`. Seed bytes come from the caller-supplied
 * `seedObjects` array — this helper never lists or copies another tenant's
 * prefix.
 */
export async function bootstrapTenantVaultSeed(
  input: BootstrapTenantVaultSeedInput,
): Promise<BootstrapTenantVaultSeedResult> {
  const bucket = assertBucketName(input.bucket);
  const tenantId = assertValidTenantIdForVaultPrefix(input.tenantId);
  const s3_vault_prefix = buildS3VaultPrefix(tenantId);
  const bootstrapMarkerKey = buildVaultSeedBootstrapMarkerKey(tenantId);
  const agentsMdKey = buildVaultSeedAgentsMdKey(tenantId);
  const force = input.force === true;
  const seedObjects = input.seedObjects ?? [];

  const base = {
    bucket,
    tenantId,
    s3_vault_prefix,
    bootstrapMarkerKey,
    agentsMdKey,
    objectsWritten: 0,
    bootstrapMarkerWritten: false,
  } as const;

  if (seedObjects.length === 0) {
    return {
      ...base,
      seeded: false,
      skippedReason: "no_seed_pack",
    };
  }

  // Validate all paths before any put (fail closed; no partial cross-writes).
  const resolved: Array<{
    key: string;
    body: string;
    contentType: string;
    relativePath: string;
  }> = [];
  let hasAgentsMd = false;
  for (const obj of seedObjects) {
    const key = buildVaultSeedObjectKey(tenantId, obj.relativePath);
    if (obj.relativePath.replace(/^\/+/, "") === VAULT_SEED_GATE_REL) {
      hasAgentsMd = true;
    }
    resolved.push({
      key,
      body: obj.body,
      contentType: obj.contentType ?? guessContentType(obj.relativePath),
      relativePath: obj.relativePath,
    });
  }
  if (!hasAgentsMd) {
    throw new VaultSeedError(
      "SEED_PACK_MISSING_AGENTS_MD",
      "seed pack must include vault-root AGENTS.md (seed-vault.sh contract)",
    );
  }

  if (!force) {
    const agentsExists = await input.store.headObject({
      bucket,
      key: agentsMdKey,
    });
    const markerExists = await input.store.headObject({
      bucket,
      key: bootstrapMarkerKey,
    });
    if (agentsExists) {
      // Live vaults already have AGENTS.md. Fill missing kitchen-sink
      // objects (config.yaml, workflows) without wiping operator edits.
      let objectsWritten = 0;
      for (const obj of resolved) {
        const exists = await input.store.headObject({
          bucket,
          key: obj.key,
        });
        if (exists) continue;
        await input.store.putObject({
          bucket,
          key: obj.key,
          body: obj.body,
          contentType: obj.contentType,
        });
        objectsWritten += 1;
      }
      if (objectsWritten === 0) {
        return {
          ...base,
          seeded: false,
          skippedReason: "agents_md_present",
        };
      }
      return {
        ...base,
        seeded: true,
        objectsWritten,
        bootstrapMarkerWritten: false,
      };
    }
    if (markerExists) {
      return {
        ...base,
        skippedReason: "bootstrap_marker_present",
        seeded: false,
      };
    }
  }

  let objectsWritten = 0;
  for (const obj of resolved) {
    await input.store.putObject({
      bucket,
      key: obj.key,
      body: obj.body,
      contentType: obj.contentType,
    });
    objectsWritten += 1;
  }

  const now = input.now ?? (() => new Date());
  const installedAt = now().toISOString();
  const seedVersion = input.seedVersion?.trim() || "unknown";
  const seedSource = input.seedSource?.trim() || "inline-seed-pack";

  // In-vault provenance (guest-visible; matches seed-vault.sh .seed/)
  const provenanceKey = buildVaultSeedObjectKey(
    tenantId,
    VAULT_SEED_PROVENANCE_REL,
  );
  const provenanceBody = JSON.stringify({
    version: VAULT_SEED_BOOTSTRAP_VERSION,
    client_core_version: seedVersion,
    source: seedSource,
    installed_at: installedAt,
    s3_vault_prefix,
    tenant_id: tenantId,
    object_count: objectsWritten,
  });
  await input.store.putObject({
    bucket,
    key: provenanceKey,
    body: provenanceBody,
    contentType: "application/json",
  });
  objectsWritten += 1;

  // Platform-only bootstrap pin (not mounted)
  const bootstrapBody = JSON.stringify({
    version: VAULT_SEED_BOOTSTRAP_VERSION,
    s3_vault_prefix,
    tenant_id: tenantId,
    seed_version: seedVersion,
    seed_source: seedSource,
    seeded_at: installedAt,
    object_count: objectsWritten,
    gate: VAULT_SEED_GATE_REL,
  });
  await input.store.putObject({
    bucket,
    key: bootstrapMarkerKey,
    body: bootstrapBody,
    contentType: "application/json",
  });

  return {
    ...base,
    seeded: true,
    objectsWritten,
    bootstrapMarkerWritten: true,
  };
}

export type BootstrapVaultForDaytonaProvisionInput = {
  tenantId: string;
  /** Must be `daytona`; ec2 path has no S3 vault seed. */
  runtimeKind: RuntimeKind;
  bucket: string;
  store: VaultObjectStore;
  /** Optional; when omitted, only prefix ensure runs (empty vault). */
  seedObjects?: readonly VaultSeedObject[];
  seedVersion?: string;
  seedSource?: string;
  force?: boolean;
  now?: () => Date;
};

export type BootstrapVaultForDaytonaProvisionResult = {
  prefix: EnsureTenantVaultPrefixResult;
  seed: BootstrapTenantVaultSeedResult;
};

/**
 * Provision-path entry (lp-9o6 + lp-jt5):
 * 1. Idempotent empty-prefix marker (`ensureTenantVaultPrefix`)
 * 2. Optional client-core seed when `seedObjects` provided
 *
 * Empty vault (no seed pack) is intentional and agent-usable once mounted.
 * Safe to re-run: both steps are idempotent.
 */
export async function bootstrapVaultForDaytonaProvision(
  input: BootstrapVaultForDaytonaProvisionInput,
): Promise<BootstrapVaultForDaytonaProvisionResult> {
  if (input.runtimeKind !== "daytona") {
    throw new VaultPrefixRuntimeKindError(String(input.runtimeKind));
  }

  const prefix = await ensureTenantVaultPrefix({
    bucket: input.bucket,
    tenantId: input.tenantId,
    store: input.store,
    now: input.now,
  });

  const seed = await bootstrapTenantVaultSeed({
    bucket: input.bucket,
    tenantId: input.tenantId,
    store: input.store,
    seedObjects: input.seedObjects,
    seedVersion: input.seedVersion,
    seedSource: input.seedSource,
    force: input.force,
    now: input.now,
  });

  return { prefix, seed };
}

/**
 * Minimal client-core-shaped seed pack for unit tests / empty-lab bootstrap.
 * Not a full client-core release — only the gate + a few scaffold files so an
 * agent sees a usable vault tree. Production provision should pass a real
 * pack built from `client-core` (see seed-vault.sh).
 */
export function minimalClientCoreSeedFixture(): VaultSeedObject[] {
  return [
    {
      relativePath: "AGENTS.md",
      body: [
        "# AGENTS.md — Company Brain seed (client-core scaffold)",
        "",
        "Minimal fixture for offline vault bootstrap tests (lp-9o6).",
        "Replace with a full client-core pack in production provision.",
        "",
      ].join("\n"),
    },
    {
      relativePath: "INDEX.md",
      body: "# Vault index\n\nScaffold.\n",
    },
    {
      relativePath: "index.yaml",
      body: "version: 1\nname: company-brain-seed\n",
    },
    {
      relativePath: "Knowledge/INDEX.md",
      body: "# Knowledge\n",
    },
    {
      relativePath: "Clients/INDEX.md",
      body: "# Clients\n",
    },
    {
      relativePath: "Projects/INDEX.md",
      body: "# Projects\n",
    },
    {
      relativePath: "memory/INDEX.md",
      body: "# Memory\n",
    },
  ];
}

/**
 * MockLab kitchen-sink vault seed pack (lp-zuh.9.5 / lp-oop.38.18).
 *
 * Mirrors the essential surfaces of `deploy/artifacts/mocklab-vault-seed/`:
 * AGENTS.md gate, harness `config.yaml` kitchen-sink flags, default Workspace
 * project path, discoverable skills, and a chat-readable welcome file. Full
 * tree is applied live via `deploy/scripts/seed-mocklab-s3-vault.sh`.
 *
 * `primary_path` target for Directory / projects.create:
 * `/mnt/vault/Projects/Workspace`.
 *
 * Harness BACKEND_HOME is this same document (config.yaml + skills/ +
 * workflows/), not a fat guest snapshot.
 */
export const MOCKLAB_KITCHEN_SINK_CONFIG_YAML = [
  "# MockLab kitchen-sink for harness BACKEND_HOME (lp-oop.38.18).",
  "# Same document the vault seed pack and CP/S3 serve. Guest stays tool-only",
  "# (no lanyard-agent tree). Fat-guest entrypoint seed is not restored.",
  "#",
  "# Snapshot (GET /internal/settings/snapshot) reads this file plus skills/",
  "# and workflows/ under BACKEND_HOME. Empty home → Tools page honestly empty.",
  "#",
  "# Secrets stay in env / SM. Do not commit keys.",
  "tenant_id: mocklab",
  "vault_root: /mnt/vault",
  "# Skill packages next to this file when BACKEND_HOME is the vault projection.",
  "skills_roots:",
  "  - skills",
  "skills:",
  "  disabled: []",
  'default_model: "poolside/laguna-s-2.1"',
  "litellm:",
  "  base_url: https://inference.poolside.ai",
  "  master_key_env: POOLSIDE_API_KEY",
  "tools:",
  "  catalog_search:",
  "    enabled: true",
  "subagents:",
  "  enabled: true",
  "  max_concurrent: 0",
  "  max_depth: 1",
  "  default_isolation: none",
  "mempalace:",
  "  enabled: true",
  "  path: mempalace",
  "  wing: mocklab",
  "  write_policy:",
  "    mode: disabled",
  "cron:",
  "  enabled: true",
  "  state_dir: .",
  "workflow:",
  "  enabled: true",
  "  agent_budget: 128",
  "  max_active_runs: 16",
  "  state_dir: .",
  "  definition_roots:",
  "    - workflows",
  "",
].join("\n");

export function mockLabVaultSeedPack(): VaultSeedObject[] {
  return [
    {
      relativePath: "AGENTS.md",
      body: [
        "# AGENTS.md — MockLab vault seed",
        "",
        "<!-- mocklab-vault-seed:lp-zuh.9.5 -->",
        "",
        "Durable vault root for MockLab Daytona (`VAULT_ROOT=/mnt/vault`).",
        "Default project: `Projects/Workspace/` → primary_path `/mnt/vault/Projects/Workspace`.",
        "Skills: `skills/` (`skills_roots: [/mnt/vault/skills]`).",
        "Harness config: `config.yaml` (kitchen-sink flags, lp-oop.38.18).",
        "",
      ].join("\n"),
    },
    {
      relativePath: "config.yaml",
      body: MOCKLAB_KITCHEN_SINK_CONFIG_YAML,
      contentType: "application/yaml",
    },
    {
      relativePath: "INDEX.md",
      body: [
        "# MockLab vault index",
        "",
        "<!-- mocklab-vault-seed:lp-zuh.9.5 -->",
        "",
        "Default Directory path: `/mnt/vault/Projects/Workspace`.",
        "Harness kitchen-sink: `config.yaml` (`lp-oop.38.18`).",
        "",
      ].join("\n"),
    },
    {
      relativePath: "index.yaml",
      body: [
        "version: 1",
        "name: mocklab-vault-seed",
        "product: mocklab",
        "seed_gate: AGENTS.md",
        "kitchen_sink: lp-oop.38.18",
        "default_project:",
        "  name: Workspace",
        "  slug: workspace",
        "  primary_path: /mnt/vault/Projects/Workspace",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Projects/INDEX.md",
      body: "# Projects\n\n<!-- mocklab-vault-seed:lp-zuh.9.5 -->\n\n| Project | Path |\n|---------|------|\n| Workspace | `Workspace/` |\n",
    },
    {
      relativePath: "Projects/Workspace/AGENTS.md",
      body: [
        "# Workspace — MockLab default project",
        "",
        "<!-- mocklab-vault-seed:lp-zuh.9.5 -->",
        "",
        "Host primary_path: `/mnt/vault/Projects/Workspace`.",
        "",
      ].join("\n"),
    },
    {
      relativePath: "Projects/Workspace/welcome.md",
      body: [
        "# Welcome to MockLab Workspace",
        "",
        "<!-- mocklab-vault-seed:lp-zuh.9.5 -->",
        "",
        "This file is the **seeded read target** for vault / chat QA (`lp-zuh.9.5`).",
        "",
        "Path: `/mnt/vault/Projects/Workspace/welcome.md`",
        "",
      ].join("\n"),
    },
    {
      relativePath: "skills/mocklab-research/SKILL.md",
      body: [
        "---",
        "name: mocklab-research",
        "description: >",
        "  MockLab kitchen-sink research helper for seed/inventory smoke.",
        "version: 1.0.0",
        "platforms: [linux]",
        "---",
        "",
        "# MockLab research",
        "",
        "Use when verifying `skills_roots: [/mnt/vault/skills]` after vault seed.",
        "Start from `Projects/Workspace/welcome.md` for seed health checks.",
        "",
      ].join("\n"),
    },
    {
      relativePath: "skills/README.md",
      body: "# skills/\n\n<!-- mocklab-vault-seed:lp-zuh.9.5 -->\n\nPackages with `SKILL.md` for agent skills_roots.\n",
    },
    {
      relativePath: "workflows/README.md",
      body: "# workflows/\n\n<!-- mocklab-vault-seed:lp-zuh.9.5 -->\n\n`workflow.definition_roots` → `/mnt/vault/workflows`.\n",
    },
    {
      relativePath: "workflows/research-lite.yaml",
      body: [
        "name: MockLab research lite",
        "description: Kitchen-sink vault workflow definition for harness settings snapshot.",
        "",
      ].join("\n"),
      contentType: "application/yaml",
    },
    {
      relativePath: "Knowledge/INDEX.md",
      body: "# Knowledge\n\n<!-- mocklab-vault-seed:lp-zuh.9.5 -->\n",
    },
    {
      relativePath: ".seed/default-projects.json",
      body: JSON.stringify(
        {
          schema_version: 1,
          bead: "lp-zuh.10.7",
          note:
            "Product default for MockLab Directory / projects.list. Applied to $BACKEND_HOME/projects.db by agent-gateway ensure_default_projects.",
          projects: [
            {
              name: "Workspace",
              slug: "workspace",
              primary_path: "/mnt/vault/Projects/Workspace",
              folders: [
                {
                  path: "/mnt/vault/Projects/Workspace",
                  label: null,
                  is_primary: true,
                },
              ],
            },
          ],
        },
        null,
        2,
      ) + "\n",
      contentType: "application/json",
    },
  ];
}
