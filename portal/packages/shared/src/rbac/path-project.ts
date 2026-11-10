/**
 * Project host-absolute agent paths to vault-root-relative API paths.
 *
 * Bead: lp-vnz.3
 *
 * Chat soft-open / citations often carry host disk paths
 * (`/home/…/Lanyard/Clients/…/Note.docx`, `/opt/company-brain/…`) while
 * Brain RPC + VAULT_ROOT vault.read expect vault-root-relative paths
 * (`/Clients/…/Note.docx`, `/AGENTS.md`).
 *
 * Rules (fail open — keep input when projection is ambiguous):
 * 1. Explicit `vaultRoot` strip when path is under that root.
 * 2. Infer vault root from `projectVaultPath` when it embeds a known
 *    vault top-level segment (e.g. `…/Lanyard/Clients` → `…/Lanyard`).
 * 3. Else strip through the first known vault top-level segment in the path.
 * 4. Non-host paths (`/Clients/…`, `/Projects/…`) and host paths that do
 *    not embed vault structure (multi-root Hermes project folders) are
 *    returned unchanged so multi-root absolute identity still works.
 */

/** Client-core / demo-vault top-level directory names under VAULT_ROOT. */
export const KNOWN_VAULT_TOP_LEVEL = [
  "Clients",
  "Projects",
  "Knowledge",
  "Business",
  "Archive",
  "Education",
  "Relationships",
  "skills",
  "staging",
  "agents",
  "memory",
  "dev",
  "workflows",
  "cron",
  "mempalace",
] as const;

/**
 * Daytona / short-stack guest mount. Citations and toolbox paths use this
 * absolute prefix; vault APIs are vault-root-relative (lp-oop.38.22).
 */
export const DEFAULT_GUEST_VAULT_ROOT = "/mnt/vault";

const VAULT_TOP_LEVEL_SET = new Set<string>(
  KNOWN_VAULT_TOP_LEVEL.map((s) => s.toLowerCase()),
);

/** Unix/Windows host roots that are never vault-root-relative API paths. */
const HOST_ROOT_PREFIXES = [
  "/home/",
  "/Users/",
  "/opt/",
  "/var/",
  "/tmp/",
  "/usr/",
  "/etc/",
  "/root/",
  "/private/",
  "/mnt/",
] as const;

export type ProjectToVaultRelativeOptions = {
  /**
   * Active chat project primary_path / project_vault_path. When it embeds a
   * known vault top-level (e.g. `…/Lanyard/Clients`), the host prefix before
   * that segment is treated as VAULT_ROOT for projection.
   */
  projectVaultPath?: string | null;
  /**
   * Explicit VAULT_ROOT (BFF env). When set, host paths under this root are
   * always stripped — including vault-root files like `/AGENTS.md`.
   */
  vaultRoot?: string | null;
};

function trimTrailingSlashes(path: string): string {
  if (path.length <= 1) return path;
  return path.replace(/\/+$/, "") || "/";
}

/**
 * True when `path` looks like a host filesystem absolute path rather than a
 * vault-root-relative API path (`/Clients/…`, `/Projects/…`).
 */
export function looksLikeHostFilesystemPath(path: string): boolean {
  const trimmed = path.trim();
  if (!trimmed.startsWith("/")) return false;
  const lower = trimmed.toLowerCase();
  for (const root of HOST_ROOT_PREFIXES) {
    if (lower === root.slice(0, -1) || lower.startsWith(root.toLowerCase())) {
      return true;
    }
  }
  // Windows drive / UNC disguised as POSIX
  if (/^\/[a-z]:/i.test(trimmed) || lower.startsWith("/\\")) {
    return true;
  }
  return false;
}

function isVaultTopLevelSegment(segment: string): boolean {
  return VAULT_TOP_LEVEL_SET.has(segment.toLowerCase());
}

/**
 * Index of the first known vault top-level segment, or -1.
 */
export function indexOfVaultTopLevelSegment(
  path: string,
): number {
  const segments = path.split("/").filter((s) => s.length > 0);
  for (let i = 0; i < segments.length; i += 1) {
    if (isVaultTopLevelSegment(segments[i]!)) {
      return i;
    }
  }
  return -1;
}

/**
 * Infer host VAULT_ROOT from a project primary_path that embeds a vault
 * top-level folder. Example:
 *   `/home/u/Lanyard/Clients/Active/Acme` → `/home/u/Lanyard`
 * Returns null when the project path does not embed a known top-level
 * (multi-root Hermes folders stay unprojected).
 */
export function inferVaultRootFromProjectPath(
  projectVaultPath: string | null | undefined,
): string | null {
  if (!projectVaultPath?.trim()) return null;
  const trimmed = trimTrailingSlashes(projectVaultPath.trim());
  if (!trimmed.startsWith("/")) return null;
  if (!looksLikeHostFilesystemPath(trimmed)) return null;

  const segments = trimmed.split("/").filter((s) => s.length > 0);
  const topIdx = indexOfVaultTopLevelSegment(trimmed);
  if (topIdx <= 0) {
    // No top-level in project path — do not treat arbitrary host project
    // folders as VAULT_ROOT (preserves multi-root absolute identity).
    return null;
  }
  // Host prefix before the vault top-level segment.
  return `/${segments.slice(0, topIdx).join("/")}`;
}

function stripRootPrefix(absolutePath: string, root: string): string | null {
  const path = trimTrailingSlashes(absolutePath);
  const base = trimTrailingSlashes(root);
  if (!base || base === "/") return null;
  if (path === base) return "/";
  if (path.startsWith(`${base}/`)) {
    const rest = path.slice(base.length);
    return rest.startsWith("/") ? rest : `/${rest}`;
  }
  return null;
}

/**
 * Project a path that may be host-absolute into a vault-root-relative path.
 *
 * Idempotent for already-relative vault paths. Returns the input (trimmed
 * leading-slash normalized lightly) when projection does not apply.
 */
export function projectToVaultRelativePath(
  rawPath: string,
  options: ProjectToVaultRelativeOptions = {},
): string {
  const trimmed = rawPath.trim();
  if (!trimmed) return trimmed;

  // Already vault-relative (not host-looking) — keep.
  if (trimmed.startsWith("/") && !looksLikeHostFilesystemPath(trimmed)) {
    return trimmed.length > 1 && trimmed.endsWith("/")
      ? trimmed.slice(0, -1)
      : trimmed;
  }

  if (!trimmed.startsWith("/")) {
    return trimmed;
  }

  // 1. Explicit VAULT_ROOT
  const explicitRoot = options.vaultRoot?.trim()
    ? trimTrailingSlashes(options.vaultRoot.trim())
    : "";
  if (explicitRoot && explicitRoot !== "/") {
    const stripped = stripRootPrefix(trimmed, explicitRoot);
    if (stripped != null) {
      return stripped === "/" ? "/" : stripped.replace(/\/+$/, "") || "/";
    }
  }

  // 1b. Short-stack guest mount (even when BFF VAULT_ROOT env is unset).
  const guestStripped = stripRootPrefix(trimmed, DEFAULT_GUEST_VAULT_ROOT);
  if (guestStripped != null) {
    return guestStripped === "/"
      ? "/"
      : guestStripped.replace(/\/+$/, "") || "/";
  }

  // 2. Infer root from project primary_path (Clients / Projects / …)
  const inferred = inferVaultRootFromProjectPath(options.projectVaultPath);
  if (inferred) {
    const stripped = stripRootPrefix(trimmed, inferred);
    if (stripped != null) {
      return stripped === "/" ? "/" : stripped.replace(/\/+$/, "") || "/";
    }
  }

  // 3. Strip through first known vault top-level in the path itself
  const topIdx = indexOfVaultTopLevelSegment(trimmed);
  if (topIdx >= 0) {
    const segments = trimmed.split("/").filter((s) => s.length > 0);
    return `/${segments.slice(topIdx).join("/")}`;
  }

  // 4. Ambiguous host path (multi-root project folder) — keep absolute.
  return trimmed.length > 1 && trimmed.endsWith("/")
    ? trimmed.slice(0, -1)
    : trimmed;
}
