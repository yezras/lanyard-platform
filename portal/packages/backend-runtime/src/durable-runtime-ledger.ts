/**
 * Crash-safe durable signed-operation ledger (lp-ye4.12 / phase 7).
 *
 * Host products that advertise history/currentness capabilities persist:
 * - append-only ledger events
 * - idempotency records
 * - materialized artifact heads
 * - materialized workspace heads
 *
 * under **backend-owned** state (`$BACKEND_HOME/ledger/` by convention).
 *
 * Design:
 * - `events.jsonl` is the authoritative recovery log (one JSON event per line).
 * - Heads + idempotency index are atomically rewritten after each durable append.
 * - On open, events are replayed into an in-memory {@link FakeRuntimeLedger}
 *   so heads/idempotency always match the log (self-heal if snapshot lags).
 * - Host signs observed commits after ACL/CAS via {@link HostLedgerSigner}
 *   (production: ed25519).
 */

import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { dirname, join } from "node:path";

import {
  FakeRuntimeLedger,
  FakeRuntimeLedgerError,
  type FakeRuntimeLedgerOptions,
  type LedgerCommitInput,
  type LedgerCommitResult,
  type LedgerRejectInput,
} from "./fake-runtime-ledger.js";
import type { HostLedgerSigner } from "./ledger-signing.js";
import {
  parseSignedOperationEventOnly,
  type ArtifactHead,
  type OperationId,
  type SignedOperationEvent,
  type WorkspaceHead,
} from "./signed-operation.js";

// ---------------------------------------------------------------------------
// Layout (relative to stateDir, typically $BACKEND_HOME/ledger)
// ---------------------------------------------------------------------------

/** Normative relative layout under BACKEND_HOME for durable ledger state. */
export const DURABLE_LEDGER_DIR_NAME = "ledger" as const;

export const DURABLE_LEDGER_FILES = {
  events: "events.jsonl",
  artifactHeads: "artifact_heads.json",
  workspaceHeads: "workspace_heads.json",
  idempotency: "idempotency.json",
  meta: "meta.json",
} as const;

export type DurableRuntimeLedgerOptions = FakeRuntimeLedgerOptions & {
  /**
   * Absolute path to the durable ledger directory
   * (e.g. `$BACKEND_HOME/ledger`).
   */
  stateDir: string;
  /**
   * Required for production durable hosts. Signs commit/reject events.
   * Prefer {@link createEd25519HostLedgerSigner}.
   */
  signer: HostLedgerSigner;
  /**
   * When true (default), refuse to open if stateDir cannot be created/written.
   */
  requireWritable?: boolean;
};

export type DurableLedgerMeta = {
  schema_version: 1;
  tenant_id: string;
  instance_id: string;
  workspace_id: string;
  active_key_id: string;
  event_count: number;
  updated_at: string;
};

export class DurableRuntimeLedgerError extends Error {
  readonly code:
    | "not_writable"
    | "corrupt_state"
    | "signature_invalid"
    | "invalid_argument";

  constructor(code: DurableRuntimeLedgerError["code"], message: string) {
    super(message);
    this.name = "DurableRuntimeLedgerError";
    this.code = code;
  }
}

type IdempotencyIndexFile = {
  schema_version: 1;
  records: Array<{
    key: string;
    fingerprint: string;
    operation_id: OperationId;
    artifact_heads?: ArtifactHead[];
    workspace_heads?: WorkspaceHead[];
  }>;
};

type HeadsFile<T> = {
  schema_version: 1;
  heads: T[];
};

/**
 * Durable host ledger: crash-safe append + head materialization + signing.
 */
export class DurableRuntimeLedger {
  readonly stateDir: string;
  readonly enabled = true as const;
  private readonly inner: FakeRuntimeLedger;
  private readonly signer: HostLedgerSigner;
  private readonly eventsPath: string;
  private readonly artifactHeadsPath: string;
  private readonly workspaceHeadsPath: string;
  private readonly idempotencyPath: string;
  private readonly metaPath: string;

  private constructor(
    stateDir: string,
    inner: FakeRuntimeLedger,
    signer: HostLedgerSigner,
  ) {
    this.stateDir = stateDir;
    this.inner = inner;
    this.signer = signer;
    this.eventsPath = join(stateDir, DURABLE_LEDGER_FILES.events);
    this.artifactHeadsPath = join(stateDir, DURABLE_LEDGER_FILES.artifactHeads);
    this.workspaceHeadsPath = join(
      stateDir,
      DURABLE_LEDGER_FILES.workspaceHeads,
    );
    this.idempotencyPath = join(stateDir, DURABLE_LEDGER_FILES.idempotency);
    this.metaPath = join(stateDir, DURABLE_LEDGER_FILES.meta);
  }

  get tenantId(): string {
    return this.inner.tenantId;
  }

  get instanceId(): string {
    return this.inner.instanceId;
  }

  get defaultWorkspaceId(): string {
    return this.inner.defaultWorkspaceId;
  }

  get hostSigner(): HostLedgerSigner {
    return this.signer;
  }

  /** Underlying in-memory harness (tests / advanced host wiring). */
  get memory(): FakeRuntimeLedger {
    return this.inner;
  }

  /**
   * Open or create a durable ledger at `stateDir`.
   * Replays `events.jsonl` so restart recovers idempotency + heads.
   */
  static open(options: DurableRuntimeLedgerOptions): DurableRuntimeLedger {
    if (!options.stateDir || options.stateDir.trim() === "") {
      throw new DurableRuntimeLedgerError(
        "invalid_argument",
        "stateDir is required for durable ledger",
      );
    }
    if (!options.signer) {
      throw new DurableRuntimeLedgerError(
        "invalid_argument",
        "signer is required for durable ledger (production uses ed25519)",
      );
    }
    if (options.signer.alg === "none") {
      throw new DurableRuntimeLedgerError(
        "invalid_argument",
        "durable ledger rejects alg:none signer — use ed25519 host signing",
      );
    }

    const stateDir = options.stateDir;
    try {
      mkdirSync(stateDir, { recursive: true, mode: 0o700 });
    } catch (err) {
      throw new DurableRuntimeLedgerError(
        "not_writable",
        `cannot create durable ledger dir ${stateDir}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    // Prefer explicit options; else recover tenant/instance from prior meta.
    let tenantId = options.tenantId;
    let instanceId = options.instanceId;
    let workspaceId = options.workspaceId;
    const metaPath = join(stateDir, DURABLE_LEDGER_FILES.meta);
    if (existsSync(metaPath)) {
      try {
        const meta = JSON.parse(readFileSync(metaPath, "utf8")) as Partial<DurableLedgerMeta>;
        tenantId = tenantId ?? meta.tenant_id;
        instanceId = instanceId ?? meta.instance_id;
        workspaceId = workspaceId ?? meta.workspace_id;
      } catch {
        // meta is advisory; events.jsonl remains SoT
      }
    }

    const inner = new FakeRuntimeLedger({
      tenantId,
      instanceId,
      workspaceId,
      signatureKeyId: options.signatureKeyId ?? options.signer.keyId,
      signer: options.signer,
    });

    const store = new DurableRuntimeLedger(stateDir, inner, options.signer);
    store.replayFromDisk();
    store.restoreIdempotencyFromDisk();
    store.persistSnapshots(); // ensure heads/idempotency files exist after open
    return store;
  }

  // -------------------------------------------------------------------------
  // Public ledger API (mirrors FakeRuntimeLedger mutation surface)
  // -------------------------------------------------------------------------

  listEvents(): SignedOperationEvent[] {
    return this.inner.listEvents();
  }

  getEvent(operationId: OperationId): SignedOperationEvent | undefined {
    return this.inner.getEvent(operationId);
  }

  getArtifactHead(path: string): ArtifactHead | undefined {
    return this.inner.getArtifactHead(path);
  }

  listArtifactHeads(): ArtifactHead[] {
    return this.inner.listArtifactHeads();
  }

  getWorkspaceHead(workspaceId?: string): WorkspaceHead | undefined {
    return this.inner.getWorkspaceHead(workspaceId);
  }

  listWorkspaceHeads(): WorkspaceHead[] {
    return this.inner.listWorkspaceHeads();
  }

  seedArtifactHead(
    input: Parameters<FakeRuntimeLedger["seedArtifactHead"]>[0],
  ): ArtifactHead {
    const head = this.inner.seedArtifactHead(input);
    this.persistSnapshots();
    return head;
  }

  commit(input: LedgerCommitInput): LedgerCommitResult {
    const beforeCount = this.inner.listEvents().length;
    const result = this.inner.commit(input);
    if (!result.idempotentReplay) {
      this.appendEventLine(result.event);
      this.persistSnapshots();
    } else if (this.inner.listEvents().length !== beforeCount) {
      // Defensive: replay should not append.
      throw new DurableRuntimeLedgerError(
        "corrupt_state",
        "idempotent replay unexpectedly appended an event",
      );
    }
    // Verify host signature on non-replay commits.
    if (!result.idempotentReplay) {
      try {
        this.signer.verify(result.event);
      } catch (err) {
        throw new DurableRuntimeLedgerError(
          "signature_invalid",
          err instanceof Error ? err.message : String(err),
        );
      }
    }
    return result;
  }

  recordRejection(input: LedgerRejectInput): LedgerCommitResult {
    const result = this.inner.recordRejection(input);
    this.appendEventLine(result.event);
    this.persistSnapshots();
    try {
      this.signer.verify(result.event);
    } catch (err) {
      throw new DurableRuntimeLedgerError(
        "signature_invalid",
        err instanceof Error ? err.message : String(err),
      );
    }
    return result;
  }

  appendEvent(event: SignedOperationEvent): LedgerCommitResult {
    // Host re-signs: never trust client-forged signatures as authority.
    const observed: SignedOperationEvent = {
      ...event,
      signature: this.signer.sign(event, event.occurred_at),
    };
    const beforeCount = this.inner.listEvents().length;
    const result = this.inner.appendEvent(observed);
    if (!result.idempotentReplay && this.inner.listEvents().length > beforeCount) {
      this.appendEventLine(result.event);
      this.persistSnapshots();
    }
    return result;
  }

  /** Current meta snapshot (also on disk as meta.json). */
  readMeta(): DurableLedgerMeta {
    return {
      schema_version: 1,
      tenant_id: this.inner.tenantId,
      instance_id: this.inner.instanceId,
      workspace_id: this.inner.defaultWorkspaceId,
      active_key_id: this.signer.keyId,
      event_count: this.inner.listEvents().length,
      updated_at: new Date().toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  /**
   * Overlay durable idempotency fingerprints + head snapshots after event
   * replay so mutationFingerprint retries match pre-restart commits.
   */
  private restoreIdempotencyFromDisk(): void {
    if (!existsSync(this.idempotencyPath)) return;
    let raw: string;
    try {
      raw = readFileSync(this.idempotencyPath, "utf8");
    } catch {
      return;
    }
    let doc: IdempotencyIndexFile;
    try {
      doc = JSON.parse(raw) as IdempotencyIndexFile;
    } catch {
      throw new DurableRuntimeLedgerError(
        "corrupt_state",
        "idempotency.json is not valid JSON",
      );
    }
    if (!doc || !Array.isArray(doc.records)) return;
    this.inner.restoreIdempotencyRecords(
      doc.records.map((r) => ({
        key: r.key,
        fingerprint: r.fingerprint,
        operationId: r.operation_id,
        artifactHeads: r.artifact_heads,
        workspaceHeads: r.workspace_heads,
      })),
    );
  }

  private replayFromDisk(): void {
    if (!existsSync(this.eventsPath)) {
      return;
    }
    let raw: string;
    try {
      raw = readFileSync(this.eventsPath, "utf8");
    } catch (err) {
      throw new DurableRuntimeLedgerError(
        "corrupt_state",
        `cannot read events log: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    const lines = raw.split("\n").filter((l) => l.trim().length > 0);
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      let parsed: unknown;
      try {
        parsed = JSON.parse(line);
      } catch {
        throw new DurableRuntimeLedgerError(
          "corrupt_state",
          `invalid JSON on events.jsonl line ${i + 1}`,
        );
      }
      let event: SignedOperationEvent;
      try {
        event = parseSignedOperationEventOnly(parsed);
      } catch (err) {
        throw new DurableRuntimeLedgerError(
          "corrupt_state",
          `invalid signed_operation on events.jsonl line ${i + 1}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      // Verify host signature on durable history (fail closed).
      try {
        this.signer.verify(event);
      } catch (err) {
        throw new DurableRuntimeLedgerError(
          "signature_invalid",
          `events.jsonl line ${i + 1}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
      try {
        // Replay without re-signing (signature already verified).
        // Temporarily use inner append without going through host re-sign path.
        this.inner.appendEvent(event);
      } catch (err) {
        if (err instanceof FakeRuntimeLedgerError && err.code === "duplicate_operation_id") {
          throw new DurableRuntimeLedgerError(
            "corrupt_state",
            `duplicate operation_id in events log: ${event.operation_id}`,
          );
        }
        throw new DurableRuntimeLedgerError(
          "corrupt_state",
          `replay failed at line ${i + 1}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  private appendEventLine(event: SignedOperationEvent): void {
    const line = `${JSON.stringify(event)}\n`;
    let fd: number | undefined;
    try {
      fd = openSync(this.eventsPath, "a", 0o600);
      writeSync(fd, line, undefined, "utf8");
      fsyncSync(fd);
    } catch (err) {
      throw new DurableRuntimeLedgerError(
        "not_writable",
        `failed to append ledger event: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    } finally {
      if (fd !== undefined) {
        try {
          closeSync(fd);
        } catch {
          // ignore close errors after write
        }
      }
    }
  }

  private persistSnapshots(): void {
    const artifactDoc: HeadsFile<ArtifactHead> = {
      schema_version: 1,
      heads: this.inner.listArtifactHeads(),
    };
    const workspaceDoc: HeadsFile<WorkspaceHead> = {
      schema_version: 1,
      heads: this.inner.listWorkspaceHeads(),
    };
    const idempotencyDoc: IdempotencyIndexFile = {
      schema_version: 1,
      records: this.inner.exportIdempotencyIndex().map((r) => ({
        key: r.key,
        fingerprint: r.fingerprint,
        operation_id: r.operationId,
        artifact_heads: r.artifactHeads,
        workspace_heads: r.workspaceHeads,
      })),
    };
    const meta = this.readMeta();

    atomicWriteJson(this.artifactHeadsPath, artifactDoc);
    atomicWriteJson(this.workspaceHeadsPath, workspaceDoc);
    atomicWriteJson(this.idempotencyPath, idempotencyDoc);
    atomicWriteJson(this.metaPath, meta);
  }
}

/**
 * Resolve the normative durable ledger directory under BACKEND_HOME.
 */
export function durableLedgerStateDir(backendHome: string): string {
  return join(backendHome, DURABLE_LEDGER_DIR_NAME);
}

/**
 * Atomic write: temp file in same directory → fsync → rename.
 */
function atomicWriteJson(path: string, value: unknown): void {
  const dir = dirname(path);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${path}.${process.pid}.${Date.now()}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;
  try {
    writeFileSync(tmp, body, { encoding: "utf8", mode: 0o600 });
    const fd = openSync(tmp, "r+");
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (err) {
    try {
      if (existsSync(tmp)) {
        // best-effort cleanup
        writeFileSync(tmp, "", { flag: "w" });
      }
    } catch {
      // ignore
    }
    throw new DurableRuntimeLedgerError(
      "not_writable",
      `atomic write failed for ${path}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}
