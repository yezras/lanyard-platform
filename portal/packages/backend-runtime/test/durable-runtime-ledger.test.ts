/**
 * lp-ye4.12 — Host durable ledger + signing.
 *
 * Proves:
 * - durable persist of events, idempotency, artifact heads, workspace heads
 * - ed25519 canonicalization + sign/verify + key rotation
 * - host rejects forged actor claims; re-signs observed commits
 * - restart + retry idempotency survives process reopen
 * - history/head capabilities advertised only when durable store is enabled
 */

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  BackendRuntimeError,
  DEFAULT_LEDGER_SIGNED_FIELDS,
  DurableRuntimeLedger,
  DurableRuntimeLedgerError,
  FakeBackendRuntimeService,
  bodyHashFromUtf8,
  canonicalizeJson,
  canonicalizeSignedOperationEvent,
  createEd25519HostLedgerSigner,
  createHostLedgerKeyRing,
  createNoneHostLedgerSigner,
  durableLedgerStateDir,
  exportHostLedgerKeyPairDer,
  generateHostLedgerKeyPair,
  importHostLedgerPrivateKey,
  importHostLedgerPublicKey,
  revisionFromUtf8,
  rotateHostLedgerActiveKey,
  type BackendRuntimeContext,
  type OperationActor,
} from "../src/index.js";

const HUMAN: OperationActor = {
  kind: "human",
  subject_id: "usr_test",
  portal_user_id: "usr_test",
  display_name: "Test Human",
};

const tmpDirs: string[] = [];

function tempStateDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "lp-ye4.12-ledger-"));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length > 0) {
    const d = tmpDirs.pop()!;
    try {
      rmSync(d, { recursive: true, force: true });
    } catch {
      // ignore
    }
  }
});

function makeSigner(keyId = "host-ledger-key-v1") {
  const pair = generateHostLedgerKeyPair({ keyId, active: true });
  const ring = createHostLedgerKeyRing([pair], keyId);
  const signer = createEd25519HostLedgerSigner({ ring });
  return { pair, ring, signer };
}

function humanCtx(
  overrides: Partial<BackendRuntimeContext> = {},
): BackendRuntimeContext {
  return {
    tenantId: "ten_test",
    instanceId: "inst_test",
    userId: "usr_test",
    sessionId: "sess_test",
    profile: { name: "contributor", pathPrefixes: ["/"] },
    roles: [],
    actor: HUMAN,
    ...overrides,
  };
}

describe("ledger-signing (lp-ye4.12)", () => {
  it("canonical JSON is deterministic and key-order independent", () => {
    const a = canonicalizeJson({ b: 1, a: { z: true, m: [2, 1] } });
    const b = canonicalizeJson({ a: { m: [2, 1], z: true }, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"a":{"m":[2,1],"z":true},"b":1}');
  });

  it("ed25519 sign/verify round-trips; tamper fails", () => {
    const { signer } = makeSigner();
    const ledger = DurableRuntimeLedger.open({
      stateDir: tempStateDir(),
      tenantId: "ten_test",
      instanceId: "inst_test",
      signer,
    });
    const r = ledger.commit({
      kind: "file_create",
      actor: HUMAN,
      path: "/Projects/a.md",
      revision: revisionFromUtf8("v1"),
      bodyHash: bodyHashFromUtf8("v1"),
      vaultWriteMode: "create_new",
    });
    expect(r.event.signature.alg).toBe("ed25519");
    expect(r.event.signature.key_id).toBe("host-ledger-key-v1");
    expect(r.event.signature.signed_fields).toEqual([
      ...DEFAULT_LEDGER_SIGNED_FIELDS,
    ]);
    signer.verify(r.event);

    const tampered = {
      ...r.event,
      result: { ...r.event.result, message: "forged" },
    };
    expect(() => signer.verify(tampered)).toThrow(/signature/i);
  });

  it("key rotation: retired key still verifies; new commits use active key", () => {
    const v1 = generateHostLedgerKeyPair({ keyId: "k1", active: true });
    let ring = createHostLedgerKeyRing([v1], "k1");
    const stateDir = tempStateDir();

    const first = DurableRuntimeLedger.open({
      stateDir,
      tenantId: "ten_rot",
      instanceId: "inst_rot",
      signer: createEd25519HostLedgerSigner({ ring }),
    });
    const r1 = first.commit({
      kind: "file_create",
      actor: HUMAN,
      path: "/x.md",
      revision: revisionFromUtf8("one"),
      bodyHash: bodyHashFromUtf8("one"),
      idempotencyKey: "create-x",
    });
    expect(r1.event.signature.key_id).toBe("k1");

    const v2 = generateHostLedgerKeyPair({ keyId: "k2", active: true });
    ring = rotateHostLedgerActiveKey(ring, v2);
    // Verify-only public material for k1 still in ring via rotate (private kept).
    const signer2 = createEd25519HostLedgerSigner({ ring });

    // Re-open with rotated ring: must verify k1-signed history and sign with k2.
    const second = DurableRuntimeLedger.open({
      stateDir,
      tenantId: "ten_rot",
      instanceId: "inst_rot",
      signer: signer2,
    });
    expect(second.listEvents()).toHaveLength(1);
    const r2 = second.commit({
      kind: "file_replace",
      actor: HUMAN,
      path: "/x.md",
      revision: revisionFromUtf8("two"),
      bodyHash: bodyHashFromUtf8("two"),
      expectedRevision: r1.event.result.revision,
      idempotencyKey: "replace-x",
    });
    expect(r2.event.signature.key_id).toBe("k2");
    signer2.verify(r2.event);
    signer2.verify(second.listEvents()[0]!);
  });

  it("rejects alg:none durable open", () => {
    expect(() =>
      DurableRuntimeLedger.open({
        stateDir: tempStateDir(),
        signer: createNoneHostLedgerSigner(),
      }),
    ).toThrow(DurableRuntimeLedgerError);
  });
});

describe("DurableRuntimeLedger persistence (lp-ye4.12)", () => {
  it("persists events, heads, and idempotency under backend-owned stateDir", () => {
    const backendHome = tempStateDir();
    const stateDir = durableLedgerStateDir(backendHome);
    const { signer } = makeSigner();

    const ledger = DurableRuntimeLedger.open({
      stateDir,
      tenantId: "ten_persist",
      instanceId: "inst_persist",
      signer,
    });

    const rev = revisionFromUtf8("hello durable");
    const r = ledger.commit({
      kind: "file_create",
      actor: HUMAN,
      path: "/Projects/Legal/memo.md",
      revision: rev,
      bodyHash: bodyHashFromUtf8("hello durable"),
      vaultWriteMode: "create_new",
      idempotencyKey: "memo-v1",
    });

    expect(r.event.operation_id.startsWith("op_")).toBe(true);
    expect(ledger.getArtifactHead("/Projects/Legal/memo.md")?.operation_id).toBe(
      r.event.operation_id,
    );
    expect(ledger.getWorkspaceHead()?.tree_root_hash).toBeTruthy();
    expect(ledger.readMeta().event_count).toBe(1);

    // Files exist under BACKEND_HOME/ledger/
    expect(existsSync(join(stateDir, "events.jsonl"))).toBe(true);
    expect(existsSync(join(stateDir, "artifact_heads.json"))).toBe(true);
    expect(existsSync(join(stateDir, "workspace_heads.json"))).toBe(true);
    expect(existsSync(join(stateDir, "idempotency.json"))).toBe(true);
    expect(existsSync(join(stateDir, "meta.json"))).toBe(true);
  });

  it("restart + retry: idempotency survives process reopen", () => {
    const stateDir = tempStateDir();
    const { pair, signer } = makeSigner("host-k-restart");
    // Keep same key material across "process" by re-importing DER.
    const der = exportHostLedgerKeyPairDer(pair);

    const process1 = DurableRuntimeLedger.open({
      stateDir,
      tenantId: "ten_rst",
      instanceId: "inst_rst",
      signer,
    });

    const rev = revisionFromUtf8("body-v1");
    const first = process1.commit({
      kind: "file_create",
      actor: HUMAN,
      path: "/docs/a.md",
      revision: rev,
      bodyHash: bodyHashFromUtf8("body-v1"),
      idempotencyKey: "idem-a-v1",
      vaultWriteMode: "create_new",
    });
    const opId = first.event.operation_id;
    const tree1 = process1.getWorkspaceHead()?.tree_root_hash;

    // Simulate process exit — drop reference, reopen with re-imported key.
    const pair2 = importHostLedgerPrivateKey(
      "host-k-restart",
      der.privateKeyPkcs8Der!,
      { active: true },
    );
    const signer2 = createEd25519HostLedgerSigner({
      ring: createHostLedgerKeyRing([pair2], "host-k-restart"),
    });

    const process2 = DurableRuntimeLedger.open({
      stateDir,
      tenantId: "ten_rst",
      instanceId: "inst_rst",
      signer: signer2,
    });

    expect(process2.listEvents()).toHaveLength(1);
    expect(process2.listEvents()[0]!.operation_id).toBe(opId);
    expect(process2.getArtifactHead("/docs/a.md")?.revision.token).toBe(
      rev.token,
    );
    expect(process2.getWorkspaceHead()?.tree_root_hash).toBe(tree1);

    // Retry same idempotency key + fingerprint → same operation_id, no second append.
    const replay = process2.commit({
      kind: "file_create",
      actor: HUMAN,
      path: "/docs/a.md",
      revision: rev,
      bodyHash: bodyHashFromUtf8("body-v1"),
      idempotencyKey: "idem-a-v1",
      vaultWriteMode: "create_new",
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.event.operation_id).toBe(opId);
    expect(process2.listEvents()).toHaveLength(1);
    expect(process2.getWorkspaceHead()?.tree_root_hash).toBe(tree1);
  });

  it("crash window: events.jsonl ahead of idempotency snapshot self-heals", () => {
    // Simulate: durable append of events.jsonl succeeded, then process died
    // before atomic rewrite of idempotency.json (review blocker on .12).
    const stateDir = tempStateDir();
    const { pair, signer } = makeSigner("host-k-crash");
    const der = exportHostLedgerKeyPairDer(pair);

    const process1 = DurableRuntimeLedger.open({
      stateDir,
      tenantId: "ten_crash",
      instanceId: "inst_crash",
      signer,
    });

    const rev = revisionFromUtf8("crash-body");
    const first = process1.commit({
      kind: "file_create",
      actor: HUMAN,
      path: "/crash/window.md",
      revision: rev,
      bodyHash: bodyHashFromUtf8("crash-body"),
      idempotencyKey: "idem-crash-window",
      vaultWriteMode: "create_new",
      // Empty string must not diverge from default workspace on replay.
      workspaceId: "",
    });
    const opId = first.event.operation_id;

    // Truncate/lag the idempotency snapshot (events.jsonl still has the line).
    const idemPath = join(stateDir, "idempotency.json");
    expect(existsSync(idemPath)).toBe(true);
    writeFileSync(
      idemPath,
      `${JSON.stringify({ schema_version: 1, records: [] }, null, 2)}\n`,
      "utf8",
    );
    // Leave a stale fingerprint shape on disk if someone re-introduces dual-hash:
    // empty records force rebuild purely from events.jsonl on open.

    const pair2 = importHostLedgerPrivateKey(
      "host-k-crash",
      der.privateKeyPkcs8Der!,
      { active: true },
    );
    const process2 = DurableRuntimeLedger.open({
      stateDir,
      tenantId: "ten_crash",
      instanceId: "inst_crash",
      signer: createEd25519HostLedgerSigner({
        ring: createHostLedgerKeyRing([pair2], "host-k-crash"),
      }),
    });

    expect(process2.listEvents()).toHaveLength(1);
    expect(readFileSync(join(stateDir, "events.jsonl"), "utf8").trim()).toContain(
      opId,
    );

    const replay = process2.commit({
      kind: "file_create",
      actor: HUMAN,
      path: "/crash/window.md",
      revision: rev,
      bodyHash: bodyHashFromUtf8("crash-body"),
      idempotencyKey: "idem-crash-window",
      vaultWriteMode: "create_new",
      workspaceId: "",
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.event.operation_id).toBe(opId);
    expect(process2.listEvents()).toHaveLength(1);
  });

  it("crash window: lagging idempotency.json with stale fingerprint does not conflict", () => {
    const stateDir = tempStateDir();
    const { pair, signer } = makeSigner("host-k-stale-fp");
    const der = exportHostLedgerKeyPairDer(pair);
    const reopenSigner = () =>
      createEd25519HostLedgerSigner({
        ring: createHostLedgerKeyRing(
          [
            importHostLedgerPrivateKey(
              "host-k-stale-fp",
              der.privateKeyPkcs8Der!,
              { active: true },
            ),
          ],
          "host-k-stale-fp",
        ),
      });

    const processA = DurableRuntimeLedger.open({
      stateDir,
      tenantId: "ten_stale",
      instanceId: "inst_stale",
      signer,
    });
    const base = processA.commit({
      kind: "file_create",
      actor: HUMAN,
      path: "/stale/fp.md",
      revision: revisionFromUtf8("base-rev"),
      bodyHash: bodyHashFromUtf8("base-rev"),
      idempotencyKey: "idem-create-base",
      vaultWriteMode: "create_new",
    });
    const rev = revisionFromUtf8("stale-fp-body");
    const replace = processA.commit({
      kind: "file_replace",
      actor: HUMAN,
      path: "/stale/fp.md",
      revision: rev,
      bodyHash: bodyHashFromUtf8("stale-fp-body"),
      expectedRevision: base.event.result.revision,
      idempotencyKey: "idem-stale-fp",
      vaultWriteMode: "replace_if_match",
    });
    expect(replace.idempotentReplay).toBe(false);

    // Poison idempotency.json with pre-alignment dual-hash fingerprint.
    const idemPath = join(stateDir, "idempotency.json");
    const doc = JSON.parse(readFileSync(idemPath, "utf8")) as {
      schema_version: 1;
      records: Array<{
        key: string;
        fingerprint: string;
        operation_id: string;
      }>;
    };
    for (const rec of doc.records) {
      if (rec.key === "idem-stale-fp") {
        rec.fingerprint = "deadbeef".repeat(8);
      }
    }
    writeFileSync(idemPath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");

    const processB = DurableRuntimeLedger.open({
      stateDir,
      tenantId: "ten_stale",
      instanceId: "inst_stale",
      signer: reopenSigner(),
    });

    const replay = processB.commit({
      kind: "file_replace",
      actor: HUMAN,
      path: "/stale/fp.md",
      revision: rev,
      bodyHash: bodyHashFromUtf8("stale-fp-body"),
      expectedRevision: base.event.result.revision,
      idempotencyKey: "idem-stale-fp",
      vaultWriteMode: "replace_if_match",
    });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.event.operation_id).toBe(replace.event.operation_id);
    expect(processB.listEvents()).toHaveLength(2);
  });

  it("rejects forged client signature on append (host re-signs)", () => {
    const { signer } = makeSigner("host-only");
    const ledger = DurableRuntimeLedger.open({
      stateDir: tempStateDir(),
      tenantId: "ten_sig",
      instanceId: "inst_sig",
      signer,
    });

    const forged = {
      schema_version: 1 as const,
      record_type: "signed_operation" as const,
      operation_id: "op_client_forged_00000001",
      tenant_id: "ten_sig",
      instance_id: "inst_sig",
      occurred_at: new Date().toISOString(),
      kind: "file_create" as const,
      actor: HUMAN,
      target: { scope: "file" as const, path: "/forged.md", workspace_id: "default" },
      parents: [] as string[],
      result: {
        status: "committed" as const,
        reason: "ok" as const,
        revision: revisionFromUtf8("forged-bytes"),
      },
      signature: {
        alg: "ed25519" as const,
        key_id: "attacker-key",
        value: "AAAA",
        signed_at: new Date().toISOString(),
      },
      advances_artifact_head: true,
      advances_workspace_head: true,
    };

    const r = ledger.appendEvent(forged);
    expect(r.event.signature.key_id).toBe("host-only");
    expect(r.event.signature.alg).toBe("ed25519");
    expect(r.event.signature.value).not.toBe("AAAA");
    signer.verify(r.event);
  });
});

describe("FakeBackendRuntimeService durable host (lp-ye4.12)", () => {
  it("advertises history/heads only when durable store is enabled", async () => {
    const { signer } = makeSigner("cap-key");

    const offlineOnly = new FakeBackendRuntimeService({
      supportLedgerReads: false,
    });
    const offlineCaps = await offlineOnly.capabilities(humanCtx());
    expect(offlineCaps.features.history_read).toBe(false);
    expect(offlineCaps.features.heads_read).toBe(false);
    expect(offlineOnly.durableLedgerEnabled).toBe(false);

    // In-memory harness still allowed for unit tests (explicit supportLedgerReads).
    const memHarness = new FakeBackendRuntimeService({
      supportLedgerReads: true,
    });
    const memCaps = await memHarness.capabilities(humanCtx());
    expect(memCaps.features.history_read).toBe(true);

    const durable = new FakeBackendRuntimeService({
      supportWriteVault: true,
      durableLedger: {
        stateDir: tempStateDir(),
        tenantId: "ten_cap",
        instanceId: "inst_cap",
        signer,
      },
    });
    expect(durable.durableLedgerEnabled).toBe(true);
    expect(durable.supportLedgerReads).toBe(true);
    const dCaps = await durable.capabilities(humanCtx());
    expect(dCaps.features.history_read).toBe(true);
    expect(dCaps.features.heads_read).toBe(true);
    expect(dCaps.brain_rpc_methods).toEqual(
      expect.arrayContaining([
        "history.list",
        "heads.artifact",
        "heads.workspace",
      ]),
    );
  });

  it("vault.write signs after CAS and survives restart with same commit.operation_id", async () => {
    const stateDir = tempStateDir();
    const { pair, signer } = makeSigner("vault-host-k");
    const der = exportHostLedgerKeyPairDer(pair);

    const host1 = new FakeBackendRuntimeService({
      supportWriteVault: true,
      durableLedger: {
        stateDir,
        tenantId: "ten_v",
        instanceId: "inst_v",
        signer,
      },
    });

    const write1 = await host1.writeVault(humanCtx(), {
      path: "/Projects/note.md",
      mode: "create_new",
      content: "durable body",
      encoding: "utf-8",
      sizeBytes: Buffer.byteLength("durable body", "utf8"),
      idempotencyKey: "note-create-1",
    });
    expect(write1.commit?.operation_id).toBeTruthy();
    expect(write1.commit?.kind).toBe("file_create");
    const opId = write1.commit!.operation_id;
    const events1 = host1.listLedgerEvents();
    expect(events1).toHaveLength(1);
    expect(events1[0]!.signature.alg).toBe("ed25519");
    signer.verify(events1[0]!);

    // Process restart
    const pair2 = importHostLedgerPrivateKey("vault-host-k", der.privateKeyPkcs8Der!, {
      active: true,
    });
    const host2 = new FakeBackendRuntimeService({
      supportWriteVault: true,
      durableLedger: {
        stateDir,
        tenantId: "ten_v",
        instanceId: "inst_v",
        signer: createEd25519HostLedgerSigner({
          ring: createHostLedgerKeyRing([pair2], "vault-host-k"),
        }),
      },
    });
    expect(host2.durableLedgerEnabled).toBe(true);
    expect(host2.listLedgerEvents()).toHaveLength(1);
    expect(host2.listLedgerEvents()[0]!.operation_id).toBe(opId);

    // Idempotent retry after restart
    const write2 = await host2.writeVault(humanCtx(), {
      path: "/Projects/note.md",
      mode: "create_new",
      content: "durable body",
      encoding: "utf-8",
      sizeBytes: Buffer.byteLength("durable body", "utf8"),
      idempotencyKey: "note-create-1",
    });
    // File-store idempotency also applies; commit id must match if returned.
    if (write2.commit) {
      expect(write2.commit.operation_id).toBe(opId);
    }
    expect(host2.listLedgerEvents()).toHaveLength(1);
  });

  it("rejects forged delegated_agent without grant_id on durable host", async () => {
    const { signer } = makeSigner("forged-gate");
    const host = new FakeBackendRuntimeService({
      supportWriteVault: true,
      durableLedger: {
        stateDir: tempStateDir(),
        tenantId: "ten_f",
        instanceId: "inst_f",
        signer,
      },
    });

    await expect(
      host.writeVault(
        humanCtx({
          actor: {
            kind: "delegated_agent",
            subject_id: "run_evil",
            // grant_id intentionally omitted — forged claim
          },
        }),
        {
          path: "/evil.md",
          mode: "create_new",
          content: "x",
          encoding: "utf-8",
          sizeBytes: 1,
          idempotencyKey: "evil-1",
        },
      ),
    ).rejects.toBeInstanceOf(BackendRuntimeError);

    expect(() =>
      host.commitLedgerMutation({
        kind: "file_create",
        actor: {
          kind: "delegated_agent",
          subject_id: "run_evil",
        },
        path: "/evil2.md",
        revision: revisionFromUtf8("x"),
      }),
    ).toThrow(BackendRuntimeError);
  });

  it("canonical bytes are stable for fixture-shaped envelopes", () => {
    const { signer } = makeSigner();
    const event = {
      schema_version: 1 as const,
      record_type: "signed_operation" as const,
      operation_id: "op_canon_1",
      tenant_id: "ten",
      instance_id: "inst",
      occurred_at: "2026-08-01T00:00:00.000Z",
      kind: "file_create" as const,
      actor: HUMAN,
      target: { scope: "file" as const, path: "/a.md" },
      parents: [] as string[],
      result: { status: "committed" as const, reason: "ok" as const },
      signature: {
        alg: "none" as const,
        key_id: "x",
        value: "unsigned",
        signed_at: "2026-08-01T00:00:00.000Z",
      },
    };
    const bytes1 = canonicalizeSignedOperationEvent(event);
    const signed = { ...event, signature: signer.sign(event) };
    // Canonical payload ignores signature field content.
    const bytes2 = canonicalizeSignedOperationEvent(signed);
    expect(bytes1.equals(bytes2)).toBe(true);
  });
});

describe("key ring trust", () => {
  it("untrusted key_id fails verify", () => {
    const k1 = generateHostLedgerKeyPair({ keyId: "trusted", active: true });
    const k2 = generateHostLedgerKeyPair({ keyId: "other", active: true });
    const signer1 = createEd25519HostLedgerSigner({
      ring: createHostLedgerKeyRing([k1], "trusted"),
    });
    const signer2 = createEd25519HostLedgerSigner({
      ring: createHostLedgerKeyRing([k2], "other"),
    });

    const ledger = DurableRuntimeLedger.open({
      stateDir: tempStateDir(),
      tenantId: "ten_t",
      instanceId: "inst_t",
      signer: signer1,
    });
    const r = ledger.commit({
      kind: "file_create",
      actor: HUMAN,
      path: "/t.md",
      revision: revisionFromUtf8("t"),
      bodyHash: bodyHashFromUtf8("t"),
    });

    expect(() => signer2.verify(r.event)).toThrow(/not trusted|untrusted/i);

    // Public-only import of trusted key still verifies.
    const pubOnly = importHostLedgerPublicKey(
      "trusted",
      k1.publicKey.export({ type: "spki", format: "der" }) as Buffer,
    );
    const verifyRing = createEd25519HostLedgerSigner({
      ring: createHostLedgerKeyRing(
        [{ ...pubOnly, active: false }, k2],
        "other",
      ),
    });
    // verify uses key_id from signature (trusted), not active signer key
    verifyRing.verify(r.event);
  });
});
