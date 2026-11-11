# Spike report: `lp-ctu` — Go / no-go for managed Daytona pilot

**Bead:** `lp-ctu`  
**Epic:** Phase 0 `lp-6tq` (parent under `lp-kng`)  
**Date:** 2026-08-04  
**Status:** Complete — decision synthesis from Phase 0 spikes (no live Daytona spend for this bead).

**Sources (all closed with notes):**

| Bead | Notes |
|------|--------|
| `lp-v2p` | [spike-v2p-org-access.md](./spike-v2p-org-access.md) — org, SM path, Tier 1, egress |
| `lp-z1u` | [spike-z1u-linux-vm-sandbox.md](./spike-z1u-linux-vm-sandbox.md) — VM gate + AC1 waiver; container exec |
| `lp-3en` | [spike-3en-s3-vault-mount.md](./spike-3en-s3-vault-mount.md) — Mountpoint S3 as `VAULT_ROOT` |
| `lp-kx4` | [spike-kx4-vault-io-patterns.md](./spike-kx4-vault-io-patterns.md) — list / many-small / sequential I/O |
| `lp-bnd` | [spike-bnd-wake-latencies.md](./spike-bnd-wake-latencies.md) — create / start-stopped / archive restore |
| `lp-4dk` | [spike-4dk-wss-relay.md](./spike-4dk-wss-relay.md) — mock WSS hold; real Relay DNS residual |
| `lp-4l5` | [spike-4l5-gateway-secret-inject.md](./spike-4l5-gateway-secret-inject.md) — create-time env inject |

Offline piping DoD already met: [offline-piping-exit-evidence.md](./offline-piping-exit-evidence.md) (`lp-kng.2`).  
Plan overview: [overview.md](./overview.md). Issue map: [issue-map.md](./issue-map.md).

---

## 1. Executive recommendation

### **CONDITIONAL GO** for managed Daytona pilot (Phases 1+)

Proceed into Phase 1 contracts / Phase 2 image / Phase 3 vault apply / Phase 4 orchestrator on **managed Daytona**, with **container isolation accepted for pilot**, subject to the conditions in §8.

| Pillar | Verdict | One-line |
|--------|---------|----------|
| Org / API / Tier 1 | **GO** | SM key path works; create/list/stop/delete proven thriftily |
| Isolation (container) | **GO (pilot)** | Human product decision 2026-08-04: container **acceptable** for pilot; linux-vm **not** a pilot gate |
| S3 vault Mountpoint | **GO** | Lab prefix R/W as `VAULT_ROOT`; durable after stop |
| Vault many-small I/O | **Conditional** | Sparse I/O OK; many-small without cache **NO-GO** for agent loops |
| Gateway secret inject | **GO** | Create-time `env` + mock WSS auth; bake-into-image rejected |
| WSS guest mechanics | **GO (mock)** | ≥5 min hold + reconnect in sandbox |
| Real Relay WSS e2e | **Residual** | Staging Relay DNS NXDOMAIN (operator hold) — restore before dual-run proof |
| Wake latencies | **GO** | Warm = start-from-stopped; cold = create; archive only extended idle |

**Why not pure GO:** real product WSS to `relay.withlanyard.com` is not end-to-end proven; vault chatty I/O needs product discipline or a guest cache; orchestrator must redact Daytona create responses that echo secrets. None of these force a **NO-GO** on managed Daytona as the pilot host — offline piping, create/exec, S3 mount, inject, and latency paths already support moving forward.

**Why not NO-GO on isolation:** original plan locked “Linux VM from day one,” but **linux-vm runners are unavailable** on this org’s region `us` today. Product explicitly accepted **container isolation for the managed Daytona pilot** (2026-08-04). Do **not** recommend no-go solely because linux-vm is unavailable. linux-vm remains optional hardening / future option (P3/P4), not a pilot gate.

---

## 2. Isolation decision (normative for pilot)

| Item | Decision |
|------|----------|
| **Date** | 2026-08-04 |
| **Source** | Human product decision after Phase 0 spikes (`lp-z1u` AC1 waiver context) |
| **Pilot isolation** | **Container is ACCEPTABLE** for managed Daytona pilot |
| **linux-vm** | Optional hardening / re-prove later if product wants stronger isolation — **not** a pilot gate |
| **Phase 0 AC1** | Already waived for remaining Phase 0 spikes; this report **closes** the product isolation question for pilot |

**Evidence that VM is gated (not blocking pilot):** `POST /snapshots` with `sandboxClass: linux-vm` → `No runners are configured in region 'us' for sandbox class 'linux-vm'`; general VM snapshots return not available in `us`/`eu`. Container + custom agent-like snapshot + process exec proven (`sandbox_id` `29a6b661-…` on `lp-z1u`).

**Plan note:** Overview locked decision #2 still says “Isolation = Linux VM from day one.” For **pilot**, treat that as **aspirational / post-pilot hardening**. Pilot dual-run may ship on **container** class with documented residual.

---

## 3. Secrets path

| Topic | Finding |
|-------|---------|
| **Platform Daytona key** | AWS Secrets Manager secret **name** `lanyard/staging/portal/daytona` (account `123456789012`, `us-east-1`). JSON keys: `DAYTONA_API_KEY`, `DAYTONA_ORG_ID`, `DAYTONA_REGION`. Audience: **Control Plane only** — never inject into guest |
| **Org** | `5b45bf51-5792-4f75-a54a-ffa6c4752d6e` · Tier **1** · region preference **US** |
| **Guest Relay secret** | Create-time sandbox `env` map (`GATEWAY_RELAY_SECRET`, `GATEWAY_RELAY_URL`, instance ids) — primary product path ([spike-4l5](./spike-4l5-gateway-secret-inject.md)) |
| **Alternate** | File drop mode `0600` proven; prefer env for gateway parity with EC2 |
| **Rejected** | Bake secret into snapshot; put secret in labels; put secret in S3 vault; inject `DAYTONA_API_KEY` into guest; log raw secrets |
| **Rotation** | Recreate / re-wake with new env on next `ensure_online` — no durable post-create env PATCH on this API |
| **API risk** | Create **response body echoes full `env` including secrets** — orchestrator **must redact** before logging (follow-up bead) |

No secret values in this report. Fingerprints/lengths only appear in source spikes where needed.

---

## 4. S3 vault

| Topic | Finding |
|-------|---------|
| **Mechanism** | Daytona has **no** first-class “attach my S3 bucket” API. Product path = **Mountpoint for Amazon S3** (`mount-s3`) in guest + short-lived STS in create `env` ([spike-3en](./spike-3en-s3-vault-mount.md)) |
| **Lab vault** | `s3://lanyard-mocklab-vault-123456789012/tenants/mocklab/vault/` |
| **Durability** | Write from sandbox visible via external `aws s3` **after** sandbox stop |
| **Tier 1 egress** | `domainAllowList` must include S3 endpoints (+ package mirrors if install-on-boot). Prefer **pre-bake `mount-s3`** in Phase 2 snapshot so install egress is off the wake path |
| **Guest perms** | Default root mount + `--allow-other`: `daytona` user can read but not write unless `--uid/--gid` or entrypoint runs as correct user |
| **Daytona Volumes** | Daytona-hosted FUSE volumes are **not** Lanyard vault durability |

### Vault I/O (from `lp-kx4`)

| Pattern | Approx cost | Pilot tolerance |
|---------|-------------|-----------------|
| List vault root / small dirs | ~20–65 ms | **OK** |
| Single small read | ~50–200 ms (p50 ~75) | **OK** if sparse |
| 100 small reads series | **~8.5 s** | **No** for interactive turns without cache |
| Single small write | ~0.21–0.38 s | **OK** if sparse |
| 100 small writes | **~27 s** | **No** without redesign |
| 1 MiB sequential write | ~0.3–0.4 s | **OK** |
| Append / in-place open-for-write | **fails** on Mountpoint | **Must redesign** (write-temp + replace) |

**Vault sub-recommendation:** **Conditional GO** for pilot vault path under **sparse I/O** (list, occasional reads, infrequent durable writes). **NO-GO without guest cache or I/O redesign** if agent assumes local-disk many-small-file loops. Prefer fewer/larger objects; document no POSIX append.

---

## 5. WSS / Relay

| Topic | Finding |
|-------|---------|
| **Create allowlist** | `domainAllowList: "relay.withlanyard.com"` accepted on create API (Tier 1 org policy still may win — re-test when DNS live) |
| **Mock WSS in sandbox** | ≥5 min hold (310 s), reconnect after process restart and server blip — **proven** ([spike-4dk](./spike-4dk-wss-relay.md)) |
| **Secret on handshake** | Injected `GATEWAY_RELAY_SECRET` used for mock Bearer / header auth — **proven** ([spike-4l5](./spike-4l5-gateway-secret-inject.md)) |
| **Real Relay** | `relay.withlanyard.com` CNAME → staging ELB name with **no A/AAAA** (operator hold teardown). Failure is **before TCP** — not a pure WSS client failure |
| **Auth gap (live)** | Staging CP register not exercised under localhost-only hold; credential issuance is existing `lp-9my` |
| **Production allowlist** | Existing `lp-ccp` (Phase 8) |

**WSS residual for pilot exit / dual-run:** restore lab or staging Relay DNS (or dedicated lab Relay), then re-prove real WSS + Tier 1 egress + inject end-to-end. Mock path is sufficient to **not block** Phase 1–4 implementation.

---

## 6. Latencies (`ensure_online`)

All numbers: container class, region `us`, snapshot `daytonaio/sandbox:0.8.0`, n=5, seconds to `state=started` ([spike-bnd](./spike-bnd-wake-latencies.md)).

| Path | p50 | p95 | Notes |
|------|-----|-----|--------|
| **create-from-snapshot** | **0.74 s** | **~18.6 s** | Fast typical; cold tail ~23 s under load |
| **start-from-stopped** | **2.8 s** | **~5.0 s** | Prefer for idle grace |
| **restore-from-archive** | **3.6 s** | **~5.6 s** | Archive transition itself ~10–40 s before start |

### Default `ensure_online` policy (normative intent)

1. **Warm:** keep sandbox **stopped** through 30 min idle grace → `POST …/start` (start-from-stopped).  
2. **Cold:** no usable `sandbox_id` → create-from-snapshot from pin / `DAYTONA_DEFAULT_SNAPSHOT`.  
3. **Archive:** only after **extended** idle beyond grace (billing), not as the 30 min action.  
4. Do **not** optimize archive-restore as primary wake.  
5. Cold-tail create / warm pool: follow-on `lp-6bg` if product needs tighter create p95.

Latencies are **compatible with pilot** interactive wake expectations for warm path (~few seconds). Re-measure on product agent snapshot after Phase 2.

---

## 7. Risks (aggregated)

| Risk | Severity | Mitigation / residual |
|------|----------|------------------------|
| Staging Relay DNS dead (operator hold) | **High for e2e proof** | Restore lab/staging Relay or lab Relay; re-prove WSS (follow-up) |
| Tier 1 may block custom host after DNS returns | Medium | Re-test; org exception / tier; production `lp-ccp` |
| Create API echoes secrets in response | **High for security** | Orchestrator redaction mandatory (follow-up) |
| Many-small-file vault I/O | **High if agent chatty** | Sparse I/O + optional guest cache redesign (follow-up) |
| Mountpoint no append | Medium | Agent/gateway writers use atomic rewrite |
| Guest write uid/gid on mount | Medium | Entrypoint `--uid/--gid` (`lp-b7w` / Phase 2) |
| Runtime install of `mount-s3` needs egress | Medium | Pre-bake in Phase 2 snapshot (`lp-4xa`) |
| linux-vm unavailable in `us` | Low for **pilot** (container OK) | Optional later re-prove (P3/P4) |
| Create p95 cold tail | Medium | Prefer stop/start; warm pool `lp-6bg` if needed |
| $10 Daytona hard cap | Ops | Thrifty throwaways; delete immediately |
| Staging AWS localhost-only hold | Ops | Blocks re-enabling staging ECS/ALB stacks; managed Daytona API still usable |

---

## 8. Explicit recommendation for Phases 1+

### Verdict: **CONDITIONAL GO**

| Decision | Scope |
|----------|--------|
| **CONDITIONAL GO** | Managed Daytona pilot; Phases 1+ implementation may proceed |
| **Not NO-GO** | Container-only isolation is **accepted** for pilot (human decision) |
| **Not pure GO** | Conditions below must be tracked; real WSS e2e remains residual |

### Conditions (must track; do not invent secret blockers)

1. **Isolation:** Pilot ships on **container** class. linux-vm is optional future hardening, not a gate.  
2. **Relay DNS:** Before dual-run / live WSS acceptance, **restore lab or staging Relay DNS** (or stand up a lab Relay) and re-prove real WSS + Tier 1 egress with inject. Existing mock proof unblocks design/impl.  
3. **Secret redaction:** Instance Orchestrator **must redact** Daytona create/GET bodies that echo `GATEWAY_RELAY_SECRET` and other secrets before any logging.  
4. **Vault I/O:** Pilot agents use **sparse vault patterns** (or ship a guest cache / packed objects). Do not assume Mountpoint is local SSD. Document no append.  
5. **Pre-bake:** Phase 2 snapshot includes agent gateway + `mount-s3` (no install-on-boot).  
6. **Secrets placement:** Platform keys only in SM → CP; guest secrets only via wake inject env; never in image/labels/vault.  
7. **`ensure_online`:** Warm = start-from-stopped; cold = create; archive only extended idle.  
8. **Tier 1 allowlist:** Orchestrator sets comma-separated `domainAllowList` including Relay + S3 (and any non-prebaked install hosts).  
9. **Offline piping:** Already complete — do not re-open offline leaves for live work.  
10. **Budget / thrift:** Respect org hard cap; ephemeral sandboxes for spikes.

### Phase readiness (summary)

| Phase | After this report |
|-------|-------------------|
| Phase 0 (`lp-6tq`) | Exit criteria met **with residuals filed** (this report + follow-up beads) |
| Phase 1 contracts | Unblocked (offline already done under `lp-e0j` / `lp-kng.2`) |
| Phase 2 image (`lp-4xa`) | Unblocked — bake agent + mount-s3; container class pin |
| Phase 3 vault (`lp-eto`) | Unblocked — apply Mountpoint + scoped IAM; heed I/O conditions |
| Phase 4 orchestrator (`lp-pec`) | Unblocked — SDK wrapper, redaction, ensure_online policy |
| Dual-run / live WSS proof | **Blocked on** Relay DNS restore + re-prove (not on Daytona create/S3/inject) |

---

## 9. Follow-up beads (opened from this report)

Residual work filed after search for duplicates (existing `lp-ccp` production allowlist and `lp-9my` credential issue remain the right homes for production allowlist and CP register; not recreated).

| Bead | Title | Parent |
|------|--------|--------|
| **`lp-kng.3`** | Ops: restore lab/staging Relay DNS (or lab Relay) for real WSS e2e | `lp-kng` — notes: [residual-kng.3-relay-dns.md](./residual-kng.3-relay-dns.md) |
| **`lp-pec.1`** | Orchestrator: redact Daytona create/GET responses that echo env secrets | `lp-pec` |
| **`lp-eto.1`** | Vault many-small-file I/O: guest cache or redesign for Mountpoint | `lp-eto` — decision: [vault-io-pilot-decision.md](./vault-io-pilot-decision.md) |
| **`lp-kng.4`** | Optional: re-prove linux-vm when runners available (not pilot gate) | `lp-kng` (P3) |

---

## 10. Acceptance mapping (`lp-ctu`)

| Criterion | Met? | Evidence |
|-----------|------|----------|
| Report path with secrets, S3, WSS, latencies, risks, explicit go/no-go | **Yes** | this file §§1–8 |
| Linked from plan overview | **Yes** | [overview.md](./overview.md) |
| Human-readable recommendation | **Yes** | **CONDITIONAL GO** §1, §8 |
| Blockers as follow-up beads | **Yes** | §9 + `bd create` |
| No secrets committed | **Yes** | SM **names** only; no API keys |

---

## 11. Evidence index (no secrets)

| Spike | Key proof |
|-------|-----------|
| `lp-v2p` | List/create/stop API 200; SM name path; Tier 1; `domainAllowList` field accepted |
| `lp-z1u` | Container custom snapshot + exec; linux-vm runners missing in `us` |
| `lp-3en` | `mount-s3` → `/mnt/vault`; S3 durable after stop |
| `lp-kx4` | List ~25 ms; 100 reads ~8.5 s; 100 writes ~27 s; no append |
| `lp-bnd` | create p50 ~0.7 s; start-stopped p50 ~2.8 s; archive restore p50 ~3.6 s |
| `lp-4dk` | Mock WSS ≥5 min + reconnect; real Relay DNS fail |
| `lp-4l5` | Create-time env inject; mock WSS auth; create response echoes env (redact!) |
| Offline | `lp-kng.2` DoD met |

**Bottom line:** Managed Daytona is **ready for pilot implementation** under **CONDITIONAL GO**, with container isolation accepted, offline piping done, and create/exec/S3/inject/latency proven. Close Phase 0 residuals via the follow-up beads; do not block Phases 1–4 on linux-vm runners or on mock-only WSS.
