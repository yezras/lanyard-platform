import { projectToVaultRelativePath } from "@lanyard/shared";

/**
 * Join project vault root with a relative citation path (POSIX-style).
 * Absolute paths under `projectVaultPath` are returned as-is (normalized),
 * then projected to vault-root-relative form when the absolute result embeds
 * a known vault tree under a host prefix (lp-vnz.3).
 *
 * Callers must pass the raw path (or a true URL handled by
 * {@link resolveVaultCitationClickPath}) — do not run {@link vaultPathFromHref}
 * first, or multi-segment relatives like `src/foo.ts` become `/src/foo.ts`
 * and skip the project join.
 */
export function resolveVaultCitationPath(
  path: string,
  projectVaultPath?: string | null,
): string {
  const trimmed = path.trim();
  if (!trimmed) {
    return trimmed;
  }

  // file:// URLs → filesystem path
  if (/^file:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const filePath = decodeURIComponent(url.pathname);
      return resolveVaultCitationPath(filePath, projectVaultPath);
    } catch {
      // fall through
    }
  }

  const projectRoot = projectVaultPath?.trim().replace(/\/+$/, "") || "";

  let joined: string;

  // Already absolute filesystem / vault path.
  if (trimmed.startsWith("/")) {
    if (
      projectRoot &&
      (trimmed === projectRoot || trimmed.startsWith(`${projectRoot}/`))
    ) {
      joined = trimmed;
    } else if (projectRoot) {
      // Fixture/contract paths: /Projects/… under multi-root → remap into project.
      // e.g. /Projects/A/README.md + project /home/u/Core → /home/u/Core/README.md
      // (strip leading /Projects/<segment>/ when present)
      const projectsMatch = trimmed.match(
        /^\/Projects\/[^/]+\/(.+)$/i,
      );
      if (projectsMatch?.[1]) {
        joined = `${projectRoot}/${projectsMatch[1]}`.replace(/\/{2,}/g, "/");
      } else {
        // Vault-root-relative absolute (`/qa-open-test.docx`, `/README.md`) or
        // multi-segment vault paths. Do **not** re-scope under the active project —
        // that mapped vault-root office files into /Clients/… and broke OnlyOffice
        // open (lp-95v.3). Bare relatives still join project below.
        joined = trimmed;
      }
    } else {
      joined = trimmed;
    }
  } else if (projectRoot) {
    // Relative / bare filename: prepend project folder so vault tree can locate it.
    const relative = trimmed.replace(/^\.?\//, "");
    joined = `${projectRoot}/${relative}`.replace(/\/{2,}/g, "/");
  } else {
    // No project context — normalize to leading slash when it looks path-like.
    const fromHref = vaultPathFromHref(trimmed);
    joined = fromHref ?? `/${trimmed.replace(/^\.?\//, "")}`;
  }

  // Host absolute (agent cwd / soft-open) → vault-root-relative for vault.read.
  // No-op for multi-root paths that lack known vault top-level structure.
  return projectToVaultRelativePath(joined, {
    projectVaultPath: projectRoot || null,
  });
}

/**
 * Resolve a citation / markdown link click into a vault API path.
 * True http(s) URLs are reduced via {@link vaultPathFromHref} first; all other
 * inputs go through {@link resolveVaultCitationPath} so relatives join the
 * project root instead of being force-prefixed with `/`.
 */
export function resolveVaultCitationClickPath(
  pathOrHref: string,
  projectVaultPath?: string | null,
): string {
  const trimmed = pathOrHref.trim();
  if (!trimmed) {
    return trimmed;
  }
  if (/^https?:\/\//i.test(trimmed)) {
    const fromHref = vaultPathFromHref(trimmed);
    if (!fromHref) {
      return "";
    }
    return resolveVaultCitationPath(fromHref, projectVaultPath);
  }
  return resolveVaultCitationPath(trimmed, projectVaultPath);
}

/** Display label for a citation: project folder + relative path when possible. */
export function citationDisplayTitle(
  path: string,
  projectVaultPath?: string | null,
  fallbackTitle?: string,
): string {
  const resolved = resolveVaultCitationPath(path, projectVaultPath);
  const projectRoot = projectVaultPath?.trim().replace(/\/+$/, "") || "";
  if (projectRoot && (resolved === projectRoot || resolved.startsWith(`${projectRoot}/`))) {
    const projectName = projectRoot.split("/").filter(Boolean).pop() ?? projectRoot;
    const relative =
      resolved === projectRoot
        ? ""
        : resolved.slice(projectRoot.length + 1);
    return relative ? `${projectName}/${relative}` : projectName;
  }
  // Absolute multi-segment paths: show parent folder + filename for vault tree match.
  const parts = resolved.split("/").filter(Boolean);
  if (parts.length >= 2) {
    return parts.slice(-2).join("/");
  }
  if (fallbackTitle?.trim()) {
    return fallbackTitle.trim();
  }
  return parts[parts.length - 1] ?? resolved;
}

/**
 * Normalize a citation/link href into a vault API path (leading `/`, no origin).
 * Handles absolute vault paths, `./relative`, bare `Projects/…`, and same-origin
 * URLs that Markdown/Citation may resolve from `/path` hrefs.
 */
export function vaultPathFromHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed || /^mailto:/i.test(trimmed)) {
    return null;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      // Only treat same-origin absolute URLs as vault paths (SPA resolved `/file`).
      if (
        typeof window !== "undefined" &&
        url.origin === window.location.origin &&
        url.pathname.length > 1
      ) {
        return decodeURIComponent(url.pathname);
      }
    } catch {
      return null;
    }
    return null;
  }

  if (/^file:\/\//i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      return decodeURIComponent(url.pathname) || null;
    } catch {
      return null;
    }
  }

  if (trimmed.startsWith("./")) {
    const rest = trimmed.slice(2).replace(/^\/+/, "");
    return rest ? `/${rest}` : null;
  }
  if (trimmed.startsWith("/")) {
    return trimmed.length > 1 ? trimmed : null;
  }
  // Bare project-style paths (e.g. Projects/A/README.md) from Hermes tool targets.
  if (/^[\w.-]+(?:\/[\w./-]+)+$/.test(trimmed)) {
    return `/${trimmed}`;
  }
  return null;
}

/** True for vault paths (absolute, relative, or same-origin resolved). */
export function isVaultPathHref(href: string): boolean {
  return vaultPathFromHref(href) != null;
}
