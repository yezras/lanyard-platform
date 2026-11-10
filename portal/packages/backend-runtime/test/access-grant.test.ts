import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  ACCESS_GRANT_RECORD_TYPE,
  ACCESS_GRANT_SCHEMA_VERSION,
  AccessGrantParseError,
  BackendRuntimeError,
  FakeBackendRuntimeService,
  actorFromGrant,
  actorFromHumanSession,
  actorFromSystem,
  assertNoClientAuthorityFields,
  backendContextFromValidatedGrant,
  createOfflineGrantTrustConfig,
  grantAllowsCapability,
  grantAllowsPath,
  parseAccessGrant,
  stampContextFromAccessGrant,
  validateAccessGrant,
  validateAccessGrantAtBoundary,
  writeVaultContent,
  type AccessGrant,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const EXAMPLES = join(
  HERE,
  "../../../../contracts/backend-runtime-v1/examples",
);

function loadExample(name: string): unknown {
  return JSON.parse(readFileSync(join(EXAMPLES, name), "utf8"));
}

function labGrant(overrides: Partial<AccessGrant> & Record<string, unknown> = {}): AccessGrant {
  const base: AccessGrant = {
    schema_version: ACCESS_GRANT_SCHEMA_VERSION,
    record_type: ACCESS_GRANT_RECORD_TYPE,
    grant_id: "grant_01LABTEST00000001",
    tenant_id: "tenant_demo",
    instance_id: "inst_1",
    session_id: "sess_1",
    subject: {
      kind: "delegated_agent",
      subject_id: "run:unknown-agent-42",
      portal_user_id: "user_alice",
      agent_id: "agent:unknown-external",
      run_id: "run-42",
      display_name: "Unknown agent run",
    },
    path_prefixes: ["/Projects/A", "/Projects/A/.lanyard/checkpoints"],
    capabilities: ["vault.read", "vault.stat", "vault.write", "history.list"],
    issued_at: "2026-07-12T00:00:00.000Z",
    not_before: "2026-07-12T00:00:00.000Z",
    expires_at: "2026-07-12T12:00:00.000Z",
    issuer: "lab",
    backend_profile: "contributor",
    signature: {
      alg: "none",
      key_id: "fixture-grant-key-v1",
      value: "unsigned",
      signed_at: "2026-07-12T00:00:00.010Z",
    },
  };
  return parseAccessGrant({ ...base, ...overrides, subject: { ...base.subject, ...(overrides.subject as object | undefined) }, signature: { ...base.signature, ...(overrides.signature as object | undefined) } });
}

const NOW_MID = () => new Date("2026-07-12T06:00:00.000Z");

describe("access-grant parse (lp-ye4.9)", () => {
  it("parses contract fixtures for human, agent, and delegated_agent", () => {
    for (const name of [
      "access-grant.human-session.json",
      "access-grant.agent.json",
      "access-grant.delegated-agent.json",
    ]) {
      const grant = parseAccessGrant(loadExample(name));
      expect(grant.schema_version).toBe(1);
      expect(grant.record_type).toBe("access_grant");
      expect(grant.grant_id.startsWith("grant_")).toBe(true);
      expect(grant.path_prefixes.length).toBeGreaterThan(0);
      expect(grant.capabilities.length).toBeGreaterThan(0);
      expect(grant.signature.key_id).toBeTruthy();
    }
  });

  it("distinguishes actor kinds on fixtures", () => {
    const human = parseAccessGrant(loadExample("access-grant.human-session.json"));
    const agent = parseAccessGrant(loadExample("access-grant.agent.json"));
    const delegated = parseAccessGrant(
      loadExample("access-grant.delegated-agent.json"),
    );
    expect(human.subject.kind).toBe("human");
    expect(agent.subject.kind).toBe("agent");
    expect(delegated.subject.kind).toBe("delegated_agent");
    expect(delegated.subject.run_id).toBe("run-42");
    expect(actorFromSystem().kind).toBe("system");
    expect(actorFromHumanSession({ userId: "u", sessionId: "s" }).kind).toBe(
      "human",
    );
  });

  it("rejects malformed grant_id and unknown bags", () => {
    expect(() =>
      parseAccessGrant({
        ...labGrant(),
        grant_id: "bad",
      }),
    ).toThrow(AccessGrantParseError);

    expect(() =>
      parseAccessGrant({
        ...labGrant(),
        extra: true,
      }),
    ).toThrow(/unknown property/);
  });
});

describe("access-grant validation (lp-ye4.9)", () => {
  const trust = createOfflineGrantTrustConfig({ now: NOW_MID });

  it("allows checkpoint write under grant path + capability", () => {
    const grant = labGrant();
    const result = validateAccessGrant(
      grant,
      {
        tenantId: "tenant_demo",
        instanceId: "inst_1",
        sessionId: "sess_1",
        path: "/Projects/A/.lanyard/checkpoints/proposal.docx/run-42.docx",
        paths: ["/Projects/A/proposal.docx"],
        capability: "vault.write",
      },
      trust,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("expected ok");
    expect(result.actor.kind).toBe("delegated_agent");
    expect(result.actor.grant_id).toBe(grant.grant_id);
    expect(result.actor.run_id).toBe("run-42");
    expect(result.actor.agent_id).toBe("agent:unknown-external");
    // Safe provenance only — no signature/token fields on actor.
    expect(result.actor).not.toHaveProperty("signature");
    expect(JSON.stringify(result.actor)).not.toMatch(/unsigned|token|secret/i);
  });

  it("rejects expired grant", () => {
    const grant = labGrant({
      expires_at: "2026-07-12T01:00:00.000Z",
    });
    const result = validateAccessGrant(
      grant,
      {
        tenantId: "tenant_demo",
        sessionId: "sess_1",
        path: "/Projects/A/README.md",
        capability: "vault.write",
      },
      trust,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected deny");
    expect(result.reason).toBe("expired");
  });

  it("rejects wrong tenant", () => {
    const grant = labGrant();
    const result = validateAccessGrant(
      grant,
      {
        tenantId: "tenant_other",
        sessionId: "sess_1",
        path: "/Projects/A/README.md",
        capability: "vault.write",
      },
      trust,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected deny");
    expect(result.reason).toBe("wrong_tenant");
  });

  it("rejects path outside grant prefixes", () => {
    const grant = labGrant();
    const result = validateAccessGrant(
      grant,
      {
        tenantId: "tenant_demo",
        sessionId: "sess_1",
        path: "/Projects/B/secret.md",
        capability: "vault.write",
      },
      trust,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected deny");
    expect(result.reason).toBe("path_denied");
  });

  it("rejects untrusted signing key id", () => {
    const grant = labGrant({
      signature: {
        alg: "none",
        key_id: "evil-key",
        value: "unsigned",
        signed_at: "2026-07-12T00:00:00.010Z",
      },
    });
    const result = validateAccessGrant(
      grant,
      {
        tenantId: "tenant_demo",
        sessionId: "sess_1",
        capability: "vault.write",
      },
      trust,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected deny");
    expect(result.reason).toBe("untrusted_key");
  });

  it("rejects alg none when allowUnsigned is false", () => {
    const grant = labGrant();
    const result = validateAccessGrant(
      grant,
      {
        tenantId: "tenant_demo",
        sessionId: "sess_1",
        capability: "vault.write",
      },
      { trustedKeyIds: ["fixture-grant-key-v1"], allowUnsigned: false, now: NOW_MID },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected deny");
    expect(result.reason).toBe("unsigned_not_allowed");
  });

  it("rejects session-bound grant when request sessionId is omitted (fail closed)", () => {
    const grant = labGrant(); // binds session_id: sess_1
    expect(grant.session_id).toBe("sess_1");
    const result = validateAccessGrant(
      grant,
      {
        tenantId: "tenant_demo",
        // sessionId intentionally omitted
        path: "/Projects/A/README.md",
        capability: "vault.write",
      },
      trust,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected deny");
    expect(result.reason).toBe("wrong_session");
    expect(result.message).toMatch(/omitted/i);
  });

  it("rejects session-bound grant when request sessionId mismatches", () => {
    const grant = labGrant();
    const result = validateAccessGrant(
      grant,
      {
        tenantId: "tenant_demo",
        sessionId: "sess_other",
        path: "/Projects/A/README.md",
        capability: "vault.write",
      },
      trust,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected deny");
    expect(result.reason).toBe("wrong_session");
  });

  it("allows unbound grant without request sessionId", () => {
    // Grant with no session_id may be used without a request session.
    const unboundGrant = parseAccessGrant({
      schema_version: ACCESS_GRANT_SCHEMA_VERSION,
      record_type: ACCESS_GRANT_RECORD_TYPE,
      grant_id: "grant_01UNBOUND00000001",
      tenant_id: "tenant_demo",
      subject: {
        kind: "agent",
        subject_id: "agent:svc",
      },
      path_prefixes: ["/Projects/A"],
      capabilities: ["vault.write"],
      issued_at: "2026-07-12T00:00:00.000Z",
      expires_at: "2026-07-12T12:00:00.000Z",
      signature: {
        alg: "none",
        key_id: "fixture-grant-key-v1",
        value: "unsigned",
        signed_at: "2026-07-12T00:00:00.010Z",
      },
    });
    expect(unboundGrant.session_id).toBeUndefined();
    const result = validateAccessGrant(
      unboundGrant,
      {
        tenantId: "tenant_demo",
        path: "/Projects/A/README.md",
        capability: "vault.write",
      },
      trust,
    );
    expect(result.ok).toBe(true);
  });

  it("grantAllowsCapability supports trailing .* wildcards", () => {
    expect(grantAllowsCapability(["vault.*"], "vault.write")).toBe(true);
    expect(grantAllowsCapability(["vault.write"], "vault.read")).toBe(false);
    expect(grantAllowsCapability(["*"], "history.list")).toBe(true);
  });

  it("grantAllowsPath mirrors vault ACL semantics", () => {
    expect(grantAllowsPath(["/Projects/A"], "/Projects/A/x.md")).toBe(true);
    expect(grantAllowsPath(["/Projects/A"], "/Projects/B/x.md")).toBe(false);
    expect(grantAllowsPath([], "/Projects/A/x.md")).toBe(false);
    expect(grantAllowsPath(["/"], "/anywhere")).toBe(true);
  });
});

describe("access-grant BFF boundary (lp-ye4.9)", () => {
  const trust = createOfflineGrantTrustConfig({ now: NOW_MID });

  it("never trusts client-supplied ACL / actor / grant claims on write bodies", () => {
    expect(() =>
      assertNoClientAuthorityFields({
        path: "/Projects/A/x.md",
        pathPrefixes: ["/"],
      }),
    ).toThrow(BackendRuntimeError);

    expect(() =>
      assertNoClientAuthorityFields({
        path: "/Projects/A/x.md",
        actor: { kind: "agent", subject_id: "evil" },
      }),
    ).toThrow(/must not include actor/);

    expect(() =>
      assertNoClientAuthorityFields({
        path: "/Projects/A/x.md",
        grant_id: "grant_forged",
      }),
    ).toThrow(/must not include grant_id/);
  });

  it("stampContextFromAccessGrant sets pathPrefixes only from grant", () => {
    const grant = labGrant();
    const { ctx, actor } = stampContextFromAccessGrant({
      grant,
      tenantId: "tenant_demo",
      instanceId: "inst_1",
      sessionId: "sess_1",
      path: "/Projects/A/README.md",
      capability: "vault.write",
      trust,
    });
    expect(ctx.profile.pathPrefixes).toEqual(grant.path_prefixes);
    expect(ctx.grantId).toBe(grant.grant_id);
    expect(ctx.actor?.kind).toBe("delegated_agent");
    expect(actor.grant_id).toBe(grant.grant_id);
    // Client cannot have widened ACL via ctx — only grant prefixes.
    expect(ctx.profile.pathPrefixes).not.toContain("/");
  });

  it("validateAccessGrantAtBoundary maps expired → unauthenticated", () => {
    const grant = labGrant({ expires_at: "2026-07-12T01:00:00.000Z" });
    try {
      validateAccessGrantAtBoundary(
        grant,
        {
          tenantId: "tenant_demo",
          sessionId: "sess_1",
          path: "/Projects/A/x",
          capability: "vault.write",
        },
        trust,
      );
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BackendRuntimeError);
      expect(err).toMatchObject({ code: "unauthenticated" });
    }
  });

  it("validateAccessGrantAtBoundary maps wrong tenant → forbidden", () => {
    try {
      validateAccessGrantAtBoundary(
        labGrant(),
        {
          tenantId: "other",
          sessionId: "sess_1",
          path: "/Projects/A/x",
          capability: "vault.write",
        },
        trust,
      );
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toMatchObject({ code: "forbidden" });
    }
  });

  it("validateAccessGrantAtBoundary maps path denial → forbidden", () => {
    try {
      validateAccessGrantAtBoundary(
        labGrant(),
        {
          tenantId: "tenant_demo",
          sessionId: "sess_1",
          path: "/Projects/B/secret.md",
          capability: "vault.write",
        },
        trust,
      );
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toMatchObject({ code: "forbidden" });
    }
  });

  it("validateAccessGrantAtBoundary maps omitted session on bound grant → unauthenticated", () => {
    try {
      validateAccessGrantAtBoundary(
        labGrant(),
        {
          tenantId: "tenant_demo",
          // sessionId omitted — fail closed for session-bound grant
          path: "/Projects/A/x",
          capability: "vault.write",
        },
        trust,
      );
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(BackendRuntimeError);
      expect(err).toMatchObject({
        code: "unauthenticated",
        details: { reason: "wrong_session" },
      });
    }
  });
});

describe("grant-backed vault.write checkpoint + ledger actor (lp-ye4.9)", () => {
  const trust = createOfflineGrantTrustConfig({ now: NOW_MID });

  it("allowed checkpoint write stamps delegated_agent + grant_id on ledger", async () => {
    const service = new FakeBackendRuntimeService({
      files: [
        {
          path: "/Projects/A/proposal.docx",
          content: "canonical",
          mime_type:
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        },
      ],
      supportWriteVault: true,
      supportLedgerReads: true,
    });

    const grant = labGrant();
    const checkpointPath =
      "/Projects/A/.lanyard/checkpoints/proposal.docx/run-42.docx";
    const { ctx, actor } = stampContextFromAccessGrant({
      grant,
      tenantId: "tenant_demo",
      instanceId: "inst_1",
      sessionId: "sess_1",
      path: checkpointPath,
      paths: ["/Projects/A/proposal.docx"],
      capability: "vault.write",
      trust,
    });

    expect(actor.kind).toBe("delegated_agent");
    expect(ctx.grantId).toBe(grant.grant_id);

    const result = await writeVaultContent(
      service,
      ctx,
      {
        path: checkpointPath,
        mode: "write_checkpoint",
        sourcePath: "/Projects/A/proposal.docx",
        content: "agent staged rewrite",
        encoding: "utf-8",
        sizeBytes: Buffer.byteLength("agent staged rewrite", "utf8"),
        idempotencyKey: "grant-checkpoint-1",
      },
      { origin: "agent", requireCapabilityAdvertisement: false },
    );

    expect(result.created).toBe(true);
    expect(result.commit?.kind).toBe("file_checkpoint");
    expect(result.commit?.operation_id?.startsWith("op_")).toBe(true);

    // Canonical source unchanged.
    const source = await service.readVault(ctx, {
      path: "/Projects/A/proposal.docx",
    });
    expect(source.content).toBe("canonical");

    // Ledger event carries safe actor provenance from the grant.
    const history = service.listLedgerEvents();
    expect(history.length).toBeGreaterThanOrEqual(1);
    const event = history[history.length - 1]!;
    expect(event.actor.kind).toBe("delegated_agent");
    expect(event.actor.grant_id).toBe(grant.grant_id);
    expect(event.actor.run_id).toBe("run-42");
    expect(event.actor.agent_id).toBe("agent:unknown-external");
    expect(event.actor.subject_id).toBe("run:unknown-agent-42");
    expect(event.kind).toBe("file_checkpoint");
    // No secrets / raw tokens on the stored actor.
    expect(JSON.stringify(event.actor)).not.toMatch(
      /signature|unsigned|Bearer|token_[A-Za-z0-9]/i,
    );
  });

  it("expired grant never reaches vault write (boundary fails closed)", async () => {
    const service = new FakeBackendRuntimeService({
      files: [
        {
          path: "/Projects/A/proposal.docx",
          content: "canonical",
          mime_type: "text/plain",
        },
      ],
      supportWriteVault: true,
    });
    const grant = labGrant({ expires_at: "2026-07-12T01:00:00.000Z" });

    try {
      stampContextFromAccessGrant({
        grant,
        tenantId: "tenant_demo",
        instanceId: "inst_1",
        sessionId: "sess_1",
        path: "/Projects/A/.lanyard/checkpoints/x.docx",
        paths: ["/Projects/A/proposal.docx"],
        capability: "vault.write",
        trust,
      });
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toMatchObject({ code: "unauthenticated" });
    }

    // Empty pathPrefixes on ctx → BFF path ACL denies (never trust open ACL).
    const emptyGrant = labGrant({ path_prefixes: [] });
    await expect(
      writeVaultContent(
        service,
        backendContextFromValidatedGrant({
          grant: emptyGrant,
          actor: actorFromGrant(emptyGrant),
          pathPrefixes: [],
          capabilities: ["vault.write"],
          instanceId: "inst_1",
        }),
        {
          path: "/Projects/A/.lanyard/checkpoints/x.docx",
          mode: "write_checkpoint",
          sourcePath: "/Projects/A/proposal.docx",
          content: "nope",
          encoding: "utf-8",
          sizeBytes: 4,
          idempotencyKey: "should-fail",
        },
        { origin: "agent", requireCapabilityAdvertisement: false },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("session-bound grant without request sessionId never stamps context", () => {
    try {
      stampContextFromAccessGrant({
        grant: labGrant(),
        tenantId: "tenant_demo",
        instanceId: "inst_1",
        // sessionId omitted — must fail closed
        path: "/Projects/A/proposal.docx",
        capability: "vault.write",
        trust,
      });
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toMatchObject({
        code: "unauthenticated",
        details: { reason: "wrong_session" },
      });
    }
  });

  it("wrong tenant grant cannot authorize checkpoint write", () => {
    try {
      stampContextFromAccessGrant({
        grant: labGrant({ tenant_id: "tenant_other" }),
        tenantId: "tenant_demo",
        instanceId: "inst_1",
        sessionId: "sess_1",
        path: "/Projects/A/proposal.docx",
        capability: "vault.write",
        trust,
      });
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toMatchObject({ code: "forbidden" });
    }
  });

  it("path denial grant cannot authorize write outside prefixes", () => {
    try {
      stampContextFromAccessGrant({
        grant: labGrant(),
        tenantId: "tenant_demo",
        instanceId: "inst_1",
        sessionId: "sess_1",
        path: "/Projects/B/secret.md",
        capability: "vault.write",
        trust,
      });
      expect.fail("expected throw");
    } catch (err) {
      expect(err).toMatchObject({ code: "forbidden" });
    }
  });
});
