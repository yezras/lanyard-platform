/**
 * Path containment helpers for filesystem vault providers.
 *
 * Lexical prefix checks alone are insufficient: a symlink under an allowed
 * root can resolve outside that root. Callers must validate the realpath of
 * targets (and roots) before list/stat/read operations.
 */

import { realpath } from "node:fs/promises";
import path from "node:path";

/**
 * Maximum bytes loaded into memory for a single normal vault content read.
 * Larger files are refused (no whole-file buffer) until a streaming strategy
 * exists. Override via provider options in tests or specialized callers.
 */
export const DEFAULT_VAULT_READ_MAX_BYTES = 10 * 1024 * 1024; // 10 MiB

/**
 * Lexical containment: `candidate` is under `root` after path.resolve.
 * Does not follow symlinks — use {@link resolveContainedRealpath} for I/O.
 */
export function isLexicallyUnderRoot(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root);
  const normalized = path.resolve(candidate);
  return (
    normalized === normalizedRoot ||
    normalized.startsWith(`${normalizedRoot}${path.sep}`)
  );
}

/**
 * Resolve a filesystem path with realpath, or null if missing/broken.
 */
export async function safeRealpath(fsPath: string): Promise<string | null> {
  try {
    return await realpath(fsPath);
  } catch {
    return null;
  }
}

/**
 * Resolve `candidate` to a realpath that is contained under the realpath of
 * `root`. Returns null when missing, broken, or outside the root.
 */
export async function resolveContainedRealpath(
  root: string,
  candidate: string,
): Promise<string | null> {
  const rootReal = (await safeRealpath(root)) ?? path.resolve(root);
  const targetReal = await safeRealpath(candidate);
  if (targetReal === null) {
    return null;
  }
  if (!isLexicallyUnderRoot(rootReal, targetReal)) {
    return null;
  }
  return targetReal;
}

/**
 * Among `roots`, return the longest-prefix root whose realpath contains
 * `candidate`'s realpath. Used by multi-root matching so symlink targets
 * cannot jump outside every configured project root.
 */
export async function findContainingRootRealpath<
  T extends { absolutePath: string },
>(
  roots: T[],
  candidate: string,
): Promise<{ root: T; realPath: string; rootRealPath: string } | null> {
  const targetReal = await safeRealpath(candidate);
  if (targetReal === null) {
    return null;
  }

  let best: {
    root: T;
    realPath: string;
    rootRealPath: string;
  } | null = null;

  for (const root of roots) {
    const rootReal =
      (await safeRealpath(root.absolutePath)) ?? path.resolve(root.absolutePath);
    if (!isLexicallyUnderRoot(rootReal, targetReal)) {
      continue;
    }
    if (!best || rootReal.length > best.rootRealPath.length) {
      best = { root, realPath: targetReal, rootRealPath: rootReal };
    }
  }

  return best;
}
