/**
 * Fake Brain RPC invoker for offline Portal contract tests (lp-k7g.8.8).
 *
 * Implements the required `backend-runtime-v1` Brain RPC method set
 * (`REQUIRED_BRAIN_RPC_METHODS`) plus optional expansions when the underlying
 * {@link FakeBackendRuntimeService} advertises them. Wire shapes match
 * `HermesBackendRuntimeService` / production BFF invoke params so tests prove
 * Portal behavior against the contract instead of Hermes internals.
 *
 * Usage:
 *
 * ```ts
 * const invoke = createFakeBrainRpcInvoker({ files: [...], projects: [...] });
 * const backend = createProductionHermesBackendRuntimeService({
 *   invokeBrainRpc: invoke,
 * });
 * // BFF handlers → Brain RPC methods → fake host (no live Hermes)
 * ```
 */

import { REQUIRED_BRAIN_RPC_METHODS } from "./capability-defaults.js";
import { BackendRuntimeError } from "./errors.js";
import {
  FakeBackendRuntimeService,
  type FakeBackendRuntimeOptions,
} from "./fake-backend.js";
import type { BrainRpcInvoker } from "./hermes-adapter.js";
import { parseProjectsCreateInput } from "./projects-bff.js";
import { parseSettingsPatchInput } from "./settings-bff.js";
import { parseAgentVaultWriteBody } from "./vault-bff.js";
import type {
  BackendRuntimeContext,
  ListProjectsParams,
  SettingsSnapshotParams,
  VaultListParams,
  VaultReadParams,
} from "./types.js";

/** Expansion methods the fake invoker can serve when the backend supports them. */
export const FAKE_BRAIN_RPC_EXPANSION_METHODS = [
  "brain.capabilities",
  "settings.patch",
  "projects.create",
  "projects.delete",
  "vault.write",
  "history.list",
  "heads.artifact",
  "heads.workspace",
] as const;

export type FakeBrainRpcOptions = FakeBackendRuntimeOptions & {
  /**
   * Extra method names to accept (return empty object) for tests that need
   * custom advertisements without full handlers.
   */
  extraMethods?: string[];
  /**
   * Instance id returned by `brain.ping` when not taken from ctx.instanceId.
   */
  instanceId?: string;
};

export type FakeBrainRpcInvoker = BrainRpcInvoker & {
  /** Underlying in-memory host for seeding and direct assertions. */
  readonly backend: FakeBackendRuntimeService;
  /** Methods this invoker currently implements (required + expansions). */
  supportedMethods(): string[];
};

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    if (typeof item === "string") out.push(item);
  }
  return out;
}

/**
 * Create a {@link BrainRpcInvoker} backed by an in-memory fake host.
 *
 * Covers all seven required Brain RPC methods for `contract.brain_rpc: 1`:
 * `brain.ping`, `brain.health`, `vault.list`, `vault.stat`, `vault.read`,
 * `settings.snapshot`, `projects.list`.
 */
export function createFakeBrainRpcInvoker(
  options: FakeBrainRpcOptions | FakeBackendRuntimeService = {},
): FakeBrainRpcInvoker {
  const backend =
    options instanceof FakeBackendRuntimeService
      ? options
      : new FakeBackendRuntimeService(options);

  const extraMethods =
    options instanceof FakeBackendRuntimeService
      ? []
      : (options.extraMethods ?? []);
  const fixedInstanceId =
    options instanceof FakeBackendRuntimeService
      ? undefined
      : options.instanceId;
  const writeVaultAdvertised =
    options instanceof FakeBackendRuntimeService
      ? options.supportWriteVault
      : options.supportWriteVault === true;
  const ledgerReadsAdvertised =
    options instanceof FakeBackendRuntimeService
      ? options.supportLedgerReads
      : options.supportLedgerReads === true;

  async function invoke(input: {
    method: string;
    params: Record<string, unknown>;
    ctx: BackendRuntimeContext;
  }): Promise<unknown> {
    const { method, params, ctx } = input;
    const p =
      typeof params === "object" && params !== null
        ? params
        : ({} as Record<string, unknown>);

    switch (method) {
      case "brain.ping":
        return handlePing(p, ctx, fixedInstanceId);

      case "brain.health":
        return backend.health(ctx);

      case "vault.list": {
        const listParams: VaultListParams = {
          path: asString(p.path) ?? "/",
          cursor:
            p.cursor === null || typeof p.cursor === "string"
              ? (p.cursor as string | null)
              : undefined,
          limit: asNumber(p.limit),
        };
        return backend.listVault(ctx, listParams);
      }

      case "vault.stat": {
        const path = asString(p.path);
        if (!path) {
          throw new BackendRuntimeError(
            "invalid_argument",
            "vault.stat requires path",
            { retryable: false, details: { method } },
          );
        }
        return backend.statVault(ctx, { path });
      }

      case "vault.read": {
        const path = asString(p.path);
        if (!path) {
          throw new BackendRuntimeError(
            "invalid_argument",
            "vault.read requires path",
            { retryable: false, details: { method } },
          );
        }
        const readParams: VaultReadParams = {
          path,
          maxBytes: asNumber(p.max_bytes) ?? asNumber(p.maxBytes),
        };
        return backend.readVault(ctx, readParams);
      }

      case "vault.write": {
        // Fail closed with method_not_found when the fake host does not
        // advertise write (supportWriteVault: false) — before body parse so
        // incomplete params still surface method_not_found (contract honesty).
        const caps = await backend.capabilities(ctx);
        const advertised =
          caps.features?.vault_write === true &&
          (caps.brain_rpc_methods ?? []).includes("vault.write");
        if (!advertised) {
          throw new BackendRuntimeError(
            "method_not_found",
            "vault.write is not implemented by this fake host",
            { retryable: false, details: { method } },
          );
        }
        // Wire snake_case → domain input. Agent parser accepts content_ref and
        // write_checkpoint (lp-ye4.10); browser/callback HTTP parsers reject
        // write_checkpoint at the BFF origin boundary.
        const inputParsed = parseAgentVaultWriteBody(p);
        return backend.writeVault(ctx, inputParsed);
      }

      case "settings.snapshot": {
        const include = asStringArray(p.include) as
          | SettingsSnapshotParams["include"]
          | undefined;
        return backend.settingsSnapshot(ctx, include ? { include } : undefined);
      }

      case "settings.patch": {
        // Wire snake_case body → domain input via BFF parser.
        const inputParsed = parseSettingsPatchInput(p);
        return backend.patchSettings(ctx, inputParsed);
      }

      case "projects.list": {
        const listParams: ListProjectsParams = {
          includeArchived:
            asBoolean(p.include_archived) ?? asBoolean(p.includeArchived),
        };
        return backend.listProjects(ctx, listParams);
      }

      case "projects.create": {
        const inputParsed = parseProjectsCreateInput(p);
        return backend.createProject(ctx, inputParsed);
      }

      case "projects.delete": {
        const id = typeof p.id === "string" ? p.id.trim() : "";
        if (!id) {
          throw new BackendRuntimeError(
            "invalid_argument",
            "projects.delete requires a non-empty id",
            { retryable: false, details: { method } },
          );
        }
        return backend.deleteProject(ctx, { id });
      }

      case "history.list": {
        const caps = await backend.capabilities(ctx);
        const advertised =
          caps.features?.history_read === true &&
          (caps.brain_rpc_methods ?? []).includes("history.list");
        if (!advertised) {
          throw new BackendRuntimeError(
            "method_not_found",
            "history.list is not implemented by this fake host",
            { retryable: false, details: { method } },
          );
        }
        const path = asString(p.path);
        if (!path) {
          throw new BackendRuntimeError(
            "invalid_argument",
            "history.list requires path",
            { retryable: false, details: { method } },
          );
        }
        return backend.listHistory(ctx, {
          path,
          limit: asNumber(p.limit),
          cursor:
            p.cursor === null || typeof p.cursor === "string"
              ? (p.cursor as string | null)
              : undefined,
          includeRejected:
            asBoolean(p.include_rejected) ?? asBoolean(p.includeRejected),
        });
      }

      case "heads.artifact": {
        const caps = await backend.capabilities(ctx);
        const advertised =
          caps.features?.heads_read === true &&
          (caps.brain_rpc_methods ?? []).includes("heads.artifact");
        if (!advertised) {
          throw new BackendRuntimeError(
            "method_not_found",
            "heads.artifact is not implemented by this fake host",
            { retryable: false, details: { method } },
          );
        }
        const path = asString(p.path);
        if (!path) {
          throw new BackendRuntimeError(
            "invalid_argument",
            "heads.artifact requires path",
            { retryable: false, details: { method } },
          );
        }
        return backend.readArtifactHead(ctx, { path });
      }

      case "heads.workspace": {
        const caps = await backend.capabilities(ctx);
        const advertised =
          caps.features?.heads_read === true &&
          (caps.brain_rpc_methods ?? []).includes("heads.workspace");
        if (!advertised) {
          throw new BackendRuntimeError(
            "method_not_found",
            "heads.workspace is not implemented by this fake host",
            { retryable: false, details: { method } },
          );
        }
        return backend.readWorkspaceHead(ctx, {
          workspaceId:
            asString(p.workspace_id) ?? asString(p.workspaceId),
        });
      }

      case "brain.capabilities":
        return backend.capabilities(ctx);

      default: {
        if (extraMethods.includes(method)) {
          return {};
        }
        throw new BackendRuntimeError(
          "method_not_found",
          `Fake Brain RPC does not implement method: ${method}`,
          { retryable: false, details: { method } },
        );
      }
    }
  }

  const invoker = Object.assign(invoke, {
    backend,
    supportedMethods(): string[] {
      const methods = new Set<string>([
        ...REQUIRED_BRAIN_RPC_METHODS,
        "brain.capabilities",
        "settings.patch",
        "projects.create",
        "projects.delete",
      ]);
      if (writeVaultAdvertised || extraMethods.includes("vault.write")) {
        methods.add("vault.write");
      }
      if (
        ledgerReadsAdvertised ||
        extraMethods.includes("history.list") ||
        extraMethods.includes("heads.artifact") ||
        extraMethods.includes("heads.workspace")
      ) {
        methods.add("history.list");
        methods.add("heads.artifact");
        methods.add("heads.workspace");
      }
      for (const m of extraMethods) methods.add(m);
      return [...methods].sort();
    },
  }) as FakeBrainRpcInvoker;

  return invoker;
}

function handlePing(
  params: Record<string, unknown>,
  ctx: BackendRuntimeContext,
  fixedInstanceId?: string,
): {
  pong: true;
  echo?: string;
  instance_id: string;
  contract_version: number;
} {
  const echo = asString(params.echo);
  return {
    pong: true,
    ...(echo !== undefined ? { echo } : {}),
    instance_id: fixedInstanceId ?? ctx.instanceId,
    contract_version: 1,
  };
}

/**
 * Assert every required Brain RPC method is present in a method list
 * (capability advertisement or invoker.supportedMethods()).
 */
export function assertRequiredBrainRpcMethods(
  methods: readonly string[],
): void {
  const set = new Set(methods);
  const missing = REQUIRED_BRAIN_RPC_METHODS.filter((m) => !set.has(m));
  if (missing.length > 0) {
    throw new Error(
      `Missing required Brain RPC methods: ${missing.join(", ")}`,
    );
  }
}
