/**
 * Chat sandbox stamp helpers (lp-rt5.5 / phase 3).
 *
 * Agent project `primary_path` is stored on the chat thread as
 * `project_vault_path` at create time. On each user message the BFF stamps
 * that absolute path onto the relay inbound event so the host can enforce
 * cwd + path ACL (Portal does not sandbox FS itself).
 *
 * Wire fields the host may read:
 * - `event.source.chat_topic` — SessionSource dual channel (historical)
 * - `event.metadata.working_directory` — explicit cwd stamp
 * - `event.metadata.project_vault_path` — same value (alias for vault tools)
 */

/**
 * Normalize thread-bound project path into a non-empty absolute cwd stamp.
 * Returns null when the thread is not scoped to an agent project.
 */
export function resolveChatWorkingDirectory(
  projectVaultPath: string | null | undefined,
): string | null {
  if (typeof projectVaultPath !== "string") {
    return null;
  }
  const trimmed = projectVaultPath.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Build inbound metadata that pins host sandbox cwd for a scoped thread.
 * Omitted entirely when the thread has no project working directory.
 */
export function chatWorkingDirectoryMetadata(
  workingDirectory: string | null,
): { working_directory: string; project_vault_path: string } | undefined {
  if (!workingDirectory) {
    return undefined;
  }
  return {
    working_directory: workingDirectory,
    project_vault_path: workingDirectory,
  };
}
