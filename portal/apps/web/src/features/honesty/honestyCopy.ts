/**
 * Operator honesty copy for non-host-backed Portal panes.
 *
 * Operators misread fixture Settings "Disconnected" and empty Directory as
 * host failure. These helpers surface known modes from existing client data
 * (settings snapshot source, brain_rpc_enabled / vault_plane / chat_delivery
 * from GET /api/context).
 *
 * On the short stack (VaultPlane=cp_s3, ChatDelivery=harness) Directory is
 * control-plane projects and Vault is the agent's files.
 * Guest-world copy keeps chat separate from Directory, Vault, and Settings.
 *
 * Never put secrets, tokens, paths with credentials, or env values in strings.
 */

/**
 * Snapshot origin tags accepted by honesty copy.
 * Prefer backend-neutral values (`brain_rpc`, `backend`, `fixture`);
 * `hermes` remains a valid legacy discovery tag.
 */
export type SettingsSource =
  | "fixture"
  | "hermes"
  | "brain_rpc"
  | "backend"
  | "lanyard_agent"
  | (string & {});

export type HonestySurface = "settings" | "vault" | "directory";

/** Dual-run chat path (BFF `chat_delivery`). */
export type ChatDelivery = "relay" | "harness";

/** Vault UI plane (BFF `vault_plane`). */
export type VaultPlane = "fs" | "brain_rpc" | "cp_s3";

export type HonestyNotice = {
  /** Stable test id / key for the notice. */
  id: string;
  status: "info" | "warning";
  title: string;
  description: string;
};

export type ResolveHonestyInput = {
  surface: HonestySurface;
  /**
   * From GET /api/context `brain_rpc_enabled`.
   * `null` = not loaded yet / unknown — do not invent a host failure.
   */
  brainRpcEnabled: boolean | null;
  /**
   * From GET /api/context `chat_delivery`.
   * `null`/omit = unknown — keep guest-world relay copy.
   */
  chatDelivery?: ChatDelivery | null;
  /**
   * From GET /api/context `vault_plane`.
   * `cp_s3` means Directory/Vault are control-plane files and projects.
   * `null`/omit = unknown — keep chat separate from those panes.
   */
  vaultPlane?: VaultPlane | null;
  /** Settings snapshot `source` when surface is settings. */
  settingsSource?: SettingsSource | null;
  /** True when Directory projects list is empty (after load). */
  directoryEmpty?: boolean;
  /**
   * True when projects.list failed / is unreachable (not the same as a
   * successful empty list). Prefer over directoryEmpty for Directory honesty.
   */
  directoryUnavailable?: boolean;
  /** True when Vault tree has no roots (after load). */
  vaultEmpty?: boolean;
  /**
   * True when GET /api/vault/tree failed or reports `unavailable`.
   * Prefer over vaultEmpty — a 500 is not a successful empty tree.
   */
  vaultUnavailable?: boolean;
  /**
   * True when GET /api/vault/tree reports `truncated: true` (node budget hit).
   * Alone this is not a user-facing failure when folders can lazy-load
   * via GET /api/vault/entries (lp-ypx / lp-vnz.10).
   */
  vaultTruncated?: boolean;
  /**
   * When true (default if unset), the Vault UI can expand folders on demand
   * through the entries endpoint. Soft tree node-budget truncation then must
   * not show a yellow banner for normal company vaults (lp-vnz.10).
   * Set false only when there is no on-demand recovery path (hard partial).
   */
  vaultLazyEntriesAvailable?: boolean;
};

/** Guest-world default: chat is separate from Directory, Vault, and Settings. */
export const CHAT_VS_HOST_COPY =
  "Chat uses the relay path independently. Directory, Vault, and Settings are separate from chat.";

export function parseChatDelivery(value: unknown): ChatDelivery | null {
  return value === "relay" || value === "harness" ? value : null;
}

export function parseVaultPlane(value: unknown): VaultPlane | null {
  return value === "fs" || value === "brain_rpc" || value === "cp_s3"
    ? value
    : null;
}

function isCpS3(input: { vaultPlane?: VaultPlane | null }): boolean {
  return input.vaultPlane === "cp_s3";
}

/**
 * Chat-vs-pane sentence. Guest-world default matches CHAT_VS_HOST_COPY.
 * On VaultPlane=cp_s3 the UI must not claim chat is Relay (unless it is).
 */
export function chatVsHostCopy(
  input: {
    chatDelivery?: ChatDelivery | null;
    vaultPlane?: VaultPlane | null;
  } = {},
): string {
  const chatBit =
    input.chatDelivery === "harness"
      ? "Chat uses the harness path independently."
      : "Chat uses the relay path independently.";

  if (isCpS3(input)) {
    return `${chatBit} Directory lists projects and Vault is the agent's files. They are separate from chat.`;
  }

  if (input.chatDelivery === "harness") {
    return `${chatBit} Directory, Vault, and Settings are separate from chat.`;
  }

  return CHAT_VS_HOST_COPY;
}

export function directoryEmptyHintCopy(input: {
  vaultPlane?: VaultPlane | null;
  chatDelivery?: ChatDelivery | null;
}): string {
  if (isCpS3(input)) {
    return "Empty Directory is not a chat failure. Create a project or check the control-plane project list.";
  }
  return "Empty Directory is not a chat failure. Create a project. Chat still uses the relay.";
}

export function directoryUnavailableHintCopy(input: {
  vaultPlane?: VaultPlane | null;
  chatDelivery?: ChatDelivery | null;
}): string {
  if (isCpS3(input) || input.chatDelivery === "harness") {
    const chat =
      input.chatDelivery === "harness"
        ? "Chat still works over the harness path."
        : "Chat still works on a separate path.";
    return `Project list is unavailable. ${chat}`;
  }
  return "Project list is unavailable. Chat still works over the relay.";
}

export function vaultEmptyStateCopy(input: {
  brainRpcEnabled: boolean | null;
  vaultPlane?: VaultPlane | null;
  chatDelivery?: ChatDelivery | null;
}): string | null {
  if (isCpS3(input) || input.brainRpcEnabled === false) {
    return "No files";
  }
  return null;
}

export function resolveHonestyNotice(
  input: ResolveHonestyInput,
): HonestyNotice | null {
  switch (input.surface) {
    case "settings":
      return resolveSettingsHonesty(input);
    case "vault":
      return resolveVaultHonesty(input);
    case "directory":
      return resolveDirectoryHonesty(input);
    default:
      return null;
  }
}

/** Host-backed snapshot tags — must not trigger fixture honesty (lp-p2a). */
function isHostSettingsSource(
  source: SettingsSource | null | undefined,
): boolean {
  if (source == null || source === "" || source === "fixture") {
    return false;
  }
  if (
    source === "brain_rpc" ||
    source === "backend" ||
    source === "lanyard_agent" ||
    source === "hermes"
  ) {
    return true;
  }
  // Unknown non-fixture tags (e.g. future hosts) are treated as host-backed.
  return true;
}

function resolveSettingsHonesty(
  input: ResolveHonestyInput,
): HonestyNotice | null {
  // Only exact fixture source is fixture honesty — never for host RPC tags.
  if (input.settingsSource === "fixture") {
    return {
      id: "settings-fixture",
      status: "warning",
      title: "Fixture settings snapshot (not host-backed)",
      description:
        "Snapshot source is fixture — sample data, not the agent's live settings. Model status “Disconnected” here is fixture catalog state, not an outage. " +
        chatVsHostCopy(input),
    };
  }

  if (input.brainRpcEnabled === false) {
    // Host tags still mean discovery ran; only warn about flag off.
    return {
      id: "settings-brain-rpc-off",
      status: "info",
      title: "Settings are not the agent's live settings",
      description:
        "This page is not loading the agent's settings. " +
        chatVsHostCopy(input),
    };
  }

  if (isHostSettingsSource(input.settingsSource)) {
    return null;
  }

  return null;
}

function resolveVaultHonesty(input: ResolveHonestyInput): HonestyNotice | null {
  const cpS3 = isCpS3(input);

  if (input.vaultUnavailable) {
    return {
      id: "vault-unavailable",
      status: "warning",
      title: "Vault tree unavailable",
      description:
        "The agent's files could not be loaded. Do not treat this as an empty file list.",
    };
  }

  // Short stack: Vault is CP S3 even when brain_rpc_enabled is false.
  // Do not tell operators the tree is local/fixture or that they need Brain RPC.
  if (!cpS3 && input.brainRpcEnabled === false) {
    return {
      id: "vault-brain-rpc-off",
      status: "info",
      title: "Agent files",
      description: "The vault is the agent's files.",
    };
  }

  // Soft max_nodes truncation of the initial /api/vault/tree snapshot is
  // expected for large vaults. After lp-ypx, folder children load on expand via
  // /api/vault/entries, so the yellow banner must not appear for normal
  // company vaults (lp-vnz.10). Only warn when the caller reports no lazy
  // recovery path (true hard partial tree).
  const lazyEntriesOk = input.vaultLazyEntriesAvailable !== false;
  const planeKnown = cpS3 || input.brainRpcEnabled === true;
  if (planeKnown && input.vaultTruncated && !lazyEntriesOk) {
    return {
      id: "vault-tree-truncated",
      status: "warning",
      title: "Vault tree is truncated",
      description:
        "The initial vault tree hit a size limit, so the first snapshot may be partial. Top-level folders should still appear when the server returned them. Without on-demand folder loading, deeper children may be missing. This is not a connection problem.",
    };
  }

  // Empty tree: CP S3 empty is not a fixture, and not chat-over-relay.
  if ((cpS3 || input.brainRpcEnabled === true) && input.vaultEmpty) {
    return {
      id: "vault-empty-host",
      status: "info",
      title: "No files listed",
      description: "The vault is the agent's files. None are listed for this session.",
    };
  }

  return null;
}

function resolveDirectoryHonesty(
  input: ResolveHonestyInput,
): HonestyNotice | null {
  const cpS3 = isCpS3(input);

  // List call failed — never masquerade as a successful empty project list.
  if (input.directoryUnavailable) {
    return {
      id: "directory-unavailable",
      status: "warning",
      title: "Directory projects unavailable",
      description:
        "The project list could not be loaded. This empty Directory is not a live project list — do not treat it as zero projects. " +
        chatVsHostCopy(input),
    };
  }

  // Short stack: Directory is CP projects even when brain_rpc_enabled is false.
  if (!cpS3 && input.brainRpcEnabled === false) {
    return {
      id: "directory-brain-rpc-off",
      status: "info",
      title: "Projects are not loaded from the agent",
      description:
        "Empty or local projects are not a chat failure. " +
        (input.directoryEmpty
          ? "No projects in the current list. "
          : "Projects shown are from this session. ") +
        chatVsHostCopy(input),
    };
  }

  if ((cpS3 || input.brainRpcEnabled === true) && input.directoryEmpty) {
    return {
      id: "directory-empty-host",
      status: "info",
      title: "No projects in Directory",
      description: cpS3
        ? "Project list is empty after load. This is control-plane Directory, not chat connectivity. Create an agent project or check the control-plane project list."
        : "Project list is empty after load. This is Directory discovery, not chat connectivity. Create an agent project.",
    };
  }

  return null;
}

/**
 * Model connectivity label/tooltip when Settings source is fixture so operators
 * do not treat fixture "Disconnected" as a live host outage.
 */
export function modelConnectivityHonesty(opts: {
  connected: boolean;
  settingsSource?: SettingsSource | null;
}): { label: string; tooltip: string } {
  if (opts.connected) {
    return {
      label: "Connected",
      tooltip:
        opts.settingsSource === "fixture"
          ? "Fixture marks this model connected (not a live host probe)."
          : "Connected",
    };
  }

  if (opts.settingsSource === "fixture") {
    return {
      label: "Fixture: offline",
      tooltip:
        "Fixture snapshot: model not marked connected. This is not a live host gateway or host failure.",
    };
  }

  return {
    label: "Disconnected",
    tooltip: "Disconnected",
  };
}
