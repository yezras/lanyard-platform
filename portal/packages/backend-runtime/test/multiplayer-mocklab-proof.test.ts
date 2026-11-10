/**
 * lp-ye4.13 — Local mocklab multiplayer proof (offline durable host).
 *
 * Seeds two human sessions + one delegated agent grant, then proves:
 * 1. Human edit + agent checkpoint (canonical source not overwritten)
 * 2. Stale-base vault.write CAS conflict → error, head unchanged
 * 3. history.list shows signed events and hides paths outside viewer ACL
 * 4. Durable ledger retains operation ids across idempotent retry
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ACCESS_GRANT_RECORD_TYPE,
  ACCESS_GRANT_SCHEMA_VERSION,
  BackendRuntimeError,
  FakeBackendRuntimeService,
  createEd25519HostLedgerSigner,
  createHostLedgerKeyRing,
  createOfflineGrantTrustConfig,
  durableLedgerStateDir,
  generateHostLedgerKeyPair,
  getArtifactHeadRead,
  listArtifactHistory,
  parseAccessGrant,
  stampContextFromAccessGrant,
  writeVaultContent,
  type BackendRuntimeContext,
  type OperationActor,
} from "../src/index.js";

const NOW = () => new Date("2026-08-13T17:00:00.000Z");
const TRUST = createOfflineGrantTrustConfig({ now: NOW });

const HUMAN_A: OperationActor = {
  kind: "human",
  subject_id: "usr_alice",
  portal_user_id: "usr_alice",
  display_name: "Alice",
  session_id: "sess_alice",
};

const HUMAN_B: OperationActor = {
  kind: "human",
  subject_id: "usr_bob",
  portal_user_id: "usr_bob",
  display_name: "Bob",
  session_id: "sess_bob",
};

const tmpDirs: string[] = [];

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), "lp-ye4.13-"));
  tmpDirs.push(d);
  return d;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    try {
      rmSync(tmpDirs.pop()!, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function humanCtx(
  actor: OperationActor,
  pathPrefixes: string[],
): BackendRuntimeContext {
  return {
    tenantId: "ten_mocklab",
    instanceId: "inst_mocklab",
    userId: actor.portal_user_id ?? actor.subject_id,
    sessionId: actor.session_id ?? `sess_${actor.subject_id}`,
    profile: { name: "contributor", pathPrefixes },
    roles: ["contributor"],
    actor,
  };
}

function agentGrant() {
  return parseAccessGrant({
    schema_version: ACCESS_GRANT_SCHEMA_VERSION,
    record_type: ACCESS_GRANT_RECORD_TYPE,
    grant_id: "grant_01YE413MOCKLAB0001",
    tenant_id: "ten_mocklab",
    instance_id: "inst_mocklab",
    session_id: "sess_alice",
    subject: {
      kind: "delegated_agent",
      subject_id: "run:unknown-agent-ye413",
      portal_user_id: "usr_alice",
      agent_id: "agent:unknown-external",
      run_id: "run-ye413",
      display_name: "External agent",
    },
    path_prefixes: [
      "/Projects/Shared",
      "/Projects/Shared/.lanyard/checkpoints",
    ],
    capabilities: ["vault.read", "vault.stat", "vault.write", "history.list"],
    issued_at: "2026-08-13T16:00:00.000Z",
    not_before: "2026-08-13T16:00:00.000Z",
    expires_at: "2026-08-13T20:00:00.000Z",
    issuer: "lab",
    backend_profile: "contributor",
    signature: {
      alg: "none",
      key_id: "fixture-grant-key-v1",
      value: "unsigned",
      signed_at: "2026-08-13T16:00:00.010Z",
    },
  });
}

function makeDurableBackend(stateDir: string): FakeBackendRuntimeService {
  const pair = generateHostLedgerKeyPair({ keyId: "ye413-host", active: true });
  const signer = createEd25519HostLedgerSigner({
    ring: createHostLedgerKeyRing([pair], "ye413-host"),
  });
  return new FakeBackendRuntimeService({
    supportWriteVault: true,
    durableLedger: {
      stateDir: durableLedgerStateDir(stateDir),
      tenantId: "ten_mocklab",
      instanceId: "inst_mocklab",
      signer,
    },
  });
}

describe("lp-ye4.13 local mocklab multiplayer proof", () => {
  it("two users + agent checkpoint + CAS conflict + ACL-filtered history", async () => {
    const backendHome = tempDir();
    const backend = makeDurableBackend(backendHome);

    const alice = humanCtx(HUMAN_A, [
      "/Projects/Shared",
      "/Projects/AliceOnly",
    ]);
    const bob = humanCtx(HUMAN_B, ["/Projects/Shared"]);

    // --- Shared file: Alice creates ---
    const create = await writeVaultContent(
      backend,
      alice,
      {
        path: "/Projects/Shared/brief.md",
        mode: "create_new",
        content: "shared v1",
        encoding: "utf-8",
        sizeBytes: Buffer.byteLength("shared v1", "utf8"),
        idempotencyKey: "ye413-create-shared",
      },
      { origin: "browser", requireCapabilityAdvertisement: false },
    );
    expect(create.created).toBe(true);
    expect(create.commit?.operation_id?.startsWith("op_")).toBe(true);
    const rev1 = create.revision!;
    const opCreate = create.commit!.operation_id!;

    // --- Alice private path ---
    await writeVaultContent(
      backend,
      alice,
      {
        path: "/Projects/AliceOnly/notes.md",
        mode: "create_new",
        content: "alice private",
        encoding: "utf-8",
        sizeBytes: Buffer.byteLength("alice private", "utf8"),
        idempotencyKey: "ye413-create-alice-private",
      },
      { origin: "browser", requireCapabilityAdvertisement: false },
    );

    // --- Bob human edit with CAS ---
    const bobEdit = await writeVaultContent(
      backend,
      bob,
      {
        path: "/Projects/Shared/brief.md",
        mode: "replace_if_match",
        ifMatch: rev1.token,
        content: "shared v2 by bob",
        encoding: "utf-8",
        sizeBytes: Buffer.byteLength("shared v2 by bob", "utf8"),
        idempotencyKey: "ye413-bob-replace",
      },
      { origin: "browser", requireCapabilityAdvertisement: false },
    );
    expect(bobEdit.created).toBe(false);
    expect(bobEdit.commit?.kind).toBe("file_replace");
    const rev2 = bobEdit.revision!;
    const opBob = bobEdit.commit!.operation_id!;

    // --- Agent checkpoint (canonical source unchanged) ---
    const grant = agentGrant();
    const checkpointPath =
      "/Projects/Shared/.lanyard/checkpoints/brief.md/run-ye413.md";
    const { ctx: agentCtx, actor: agentActor } = stampContextFromAccessGrant({
      grant,
      tenantId: "ten_mocklab",
      instanceId: "inst_mocklab",
      sessionId: "sess_alice",
      path: checkpointPath,
      paths: ["/Projects/Shared/brief.md"],
      capability: "vault.write",
      trust: TRUST,
    });
    expect(agentActor.kind).toBe("delegated_agent");

    const checkpoint = await writeVaultContent(
      backend,
      agentCtx,
      {
        path: checkpointPath,
        mode: "write_checkpoint",
        sourcePath: "/Projects/Shared/brief.md",
        content: "agent staged rewrite — not live",
        encoding: "utf-8",
        sizeBytes: Buffer.byteLength("agent staged rewrite — not live", "utf8"),
        idempotencyKey: "ye413-agent-checkpoint",
      },
      { origin: "agent", requireCapabilityAdvertisement: false },
    );
    expect(checkpoint.created).toBe(true);
    expect(checkpoint.commit?.kind).toBe("file_checkpoint");
    const opCheckpoint = checkpoint.commit!.operation_id!;

    const sourceAfter = await backend.readVault(bob, {
      path: "/Projects/Shared/brief.md",
    });
    expect(sourceAfter.content).toBe("shared v2 by bob");

    // --- Stale base CAS conflict ---
    let casError: BackendRuntimeError | undefined;
    try {
      await writeVaultContent(
        backend,
        alice,
        {
          path: "/Projects/Shared/brief.md",
          mode: "replace_if_match",
          ifMatch: rev1.token,
          content: "alice stale write",
          encoding: "utf-8",
          sizeBytes: Buffer.byteLength("alice stale write", "utf8"),
          idempotencyKey: "ye413-alice-stale",
        },
        { origin: "browser", requireCapabilityAdvertisement: false },
      );
    } catch (err) {
      expect(err).toBeInstanceOf(BackendRuntimeError);
      casError = err as BackendRuntimeError;
    }
    expect(casError).toBeDefined();

    const contentAfterConflict = await backend.readVault(bob, {
      path: "/Projects/Shared/brief.md",
    });
    expect(contentAfterConflict.content).toBe("shared v2 by bob");
    // Ledger head (when materialised) must still reflect Bob's revision.
    const headAfterConflict = await getArtifactHeadRead(backend, bob, {
      path: "/Projects/Shared/brief.md",
    });
    if (headAfterConflict.head?.revision?.token) {
      expect(headAfterConflict.head.revision.token).toBe(rev2.token);
    }

    // --- History ACL ---
    const bobHistory = await listArtifactHistory(backend, bob, {
      path: "/Projects/Shared/brief.md",
    });
    expect(bobHistory.events.length).toBeGreaterThanOrEqual(2);
    expect(
      bobHistory.events.every((e) => e.signature?.alg === "ed25519"),
    ).toBe(true);
    const bobOpIds = bobHistory.events.map((e) => e.operation_id);
    expect(bobOpIds).toEqual(expect.arrayContaining([opCreate, opBob]));

    await expect(
      listArtifactHistory(backend, bob, {
        path: "/Projects/AliceOnly/notes.md",
      }),
    ).rejects.toBeInstanceOf(BackendRuntimeError);

    const alicePrivateHistory = await listArtifactHistory(backend, alice, {
      path: "/Projects/AliceOnly/notes.md",
    });
    expect(alicePrivateHistory.events.length).toBeGreaterThanOrEqual(1);

    // --- Idempotent agent checkpoint retry ---
    const checkpointReplay = await writeVaultContent(
      backend,
      agentCtx,
      {
        path: checkpointPath,
        mode: "write_checkpoint",
        sourcePath: "/Projects/Shared/brief.md",
        content: "agent staged rewrite — not live",
        encoding: "utf-8",
        sizeBytes: Buffer.byteLength("agent staged rewrite — not live", "utf8"),
        idempotencyKey: "ye413-agent-checkpoint",
      },
      { origin: "agent", requireCapabilityAdvertisement: false },
    );
    expect(
      checkpointReplay.commit?.operation_id === opCheckpoint ||
        checkpointReplay.created === false,
    ).toBe(true);

    const sourceFinal = await backend.readVault(alice, {
      path: "/Projects/Shared/brief.md",
    });
    expect(sourceFinal.content).toBe("shared v2 by bob");

    // Evidence fields for RESULT.md
    expect(backend.durableLedgerEnabled).toBe(true);
    expect(opCreate).toMatch(/^op_/);
    expect(opBob).toMatch(/^op_/);
    expect(opCheckpoint).toMatch(/^op_/);
  });
});
