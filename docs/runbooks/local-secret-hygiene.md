# Local secret hygiene, retention, and artifact permissions

**Bead:** `lp-p37.13` · **Audience:** agents and humans doing local Portal / mocklab work

## Why

A 2026-07 security audit found that several **ignored/untracked** local env and session artifacts under `lanyard-platform` were mode `664` (group-readable), including:

| Artifact | Typical path | Risk |
|----------|--------------|------|
| Demo / relay seed env | `portal/.data/demo-env.sh` | Contains `RELAY_DEV_SECRETS`, service tokens |
| Last relay secret | `portal/.data/last-relay-secret.txt` | Gateway instance secret |
| Hermes portal relay env | `portal/.data/hermes-portal-relay.env` | Relay connect secrets |
| Durable chat SQLite | `portal/.data/chat.db` (+ `-wal`/`-shm`) | Full chat message bodies when `CHAT_STORE_PATH` set |
| Playwright auth state | `artifacts/ui/.auth/mocklab-agent.json` | Session cookies / storage |
| Mocklab agent env | `.env.mocklab-agent-dev` (repo root) | Staging/mocklab credentials |

These must stay **gitignored**, **owner-only** (`0600` files / `0700` dirs), and easy to clean up.

## Required permissions

| Path pattern | Mode |
|--------------|------|
| `portal/.data/` (or `$PORTAL_DATA_DIR`) | `0700` |
| `demo-env.sh`, `last-relay-secret.txt`, `hermes-portal-relay.env`, `*.env` under `.data` | `0600` |
| `chat.db`, `chat.db-wal`, `chat.db-shm` | `0600` |
| `artifacts/ui/.auth/` | `0700` |
| Files under `artifacts/ui/.auth/` (e.g. `mocklab-agent.json`) | `0600` |
| `.env.mocklab-agent-dev`, other `.env.mocklab*` | `0600` |
| `~/.lanyard-agent/meta.env` (Muse Spark / Meta Model API; lp-k5c4.17) | `0600` |

`meta.env` is **outside git**. Copy placeholders from
[`deploy/dev/localhost-muse-spark/meta.env.example`](../../deploy/dev/localhost-muse-spark/meta.env.example).
Never commit the real file. `LITELLM_BASE_URL` is `https://api.meta.ai` (no `/v1`).

### One-shot fix / check

From `portal/`:

```bash
# Tighten modes on known local secret paths
bash scripts/secure-local-secrets.sh

# Report only (CI / pre-handoff); non-zero if any file is too open
bash scripts/secure-local-secrets.sh --check

# Inventory present artifacts + modes
bash scripts/secure-local-secrets.sh --scan
```

Manual equivalent:

```bash
chmod 700 portal/.data artifacts/ui/.auth 2>/dev/null || true
chmod 600 \
  portal/.data/demo-env.sh \
  portal/.data/last-relay-secret.txt \
  portal/.data/hermes-portal-relay.env \
  portal/.data/chat.db \
  portal/.data/chat.db-wal \
  portal/.data/chat.db-shm \
  artifacts/ui/.auth/* \
  .env.mocklab-agent-dev \
  2>/dev/null || true
```

### Generators that set modes by default

| Generator | Behavior |
|-----------|----------|
| `portal/scripts/seed-demo-tenant.sh` | `mkdir` `.data` → `0700`; writes `demo-env.sh` + `last-relay-secret.txt` with umask `077` + `chmod 600` |
| BFF `ChatThreadStore` (`CHAT_STORE_PATH`) | Parent dir `0700`; DB + WAL/SHM `0600` (umask `0077` during open) |
| UI QA scripts saving Playwright `storage_state` | Call `secure_secret_path()` from `portal/packages/web/ui-testing/secure_paths.py` after save |

## Gitignore (must remain)

Already covered (do **not** weaken):

| Pattern | Where |
|---------|--------|
| `.env`, `.env.*` (with `!.env.example`) | monorepo root `.gitignore` |
| `.data/` | `portal/.gitignore` |
| `*.db` | monorepo root + portal `.gitignore` |
| `artifacts/ui/.auth/` | monorepo root `.gitignore` (lp-p37.13) |

Never commit contents of `.env.mocklab-agent-dev`, `.data/`, or `artifacts/ui/.auth/`.

## Cleanup

```bash
# Wipe local portal secrets (keeps Postgres demo tenant; re-seed after)
rm -f portal/.data/demo-env.sh \
      portal/.data/last-relay-secret.txt \
      portal/.data/hermes-portal-relay.env \
      portal/.data/chat.db \
      portal/.data/chat.db-wal \
      portal/.data/chat.db-shm

# Wipe Playwright session cookies for mocklab
rm -rf artifacts/ui/.auth

# Optional: full local data dir
rm -rf portal/.data
```

Re-seed: start control-plane, then `portal/scripts/seed-demo-tenant.sh`.

## Chat store retention, TTL, encryption

| Concern | Default / policy |
|---------|------------------|
| **In-memory history** | Process lifetime only (BFF restart clears) |
| **Durable store** | Opt-in via `CHAT_STORE_PATH` (e.g. `.data/chat.db`) |
| **Per-thread cap** | `MAX_HISTORY_EVENTS = 2000` (oldest dropped) — not a time-based TTL |
| **Time-based TTL** | **Not implemented** for BFF chat DB; delete threads via product API or wipe the file |
| **Encryption at rest** | **Application-level encryption: no.** File is cleartext SQLite with owner-only mode. Rely on host/volume encryption for residual risk. |
| **Message bodies** | Stored when durable mode is on — treat `chat.db` as a secret artifact |
| **Interaction export (L5)** | Control-plane `interaction_export_enabled` defaults **false**; relay `shouldPersistInteraction` is fail-closed. When enabled, export jobs are **metadata-only** — **never** long-term message bodies at Lanyard |

Policy cross-links:

- [portal/docs/policies/log-retention-and-access.md](../../portal/docs/policies/log-retention-and-access.md) — L3/L4/L5 classes
- [portal/README.md](../../portal/README.md) — backend retention policy (#19)
- [portal/testing.md](../../portal/testing.md) — local `CHAT_STORE_PATH` note

## History export redaction

| Path | Bodies retained? | Notes |
|------|------------------|-------|
| `GET /api/chat/threads/:id/history` | Yes (owner session) | Product hydrate — not an ops export |
| Relay ring buffer | Process lifetime | Not a compliance archive |
| Control-plane interaction export | **No message bodies** | Metadata-only when ops-enabled |
| Application logs | No bodies by default | G2b.2 redaction |

Operational check: `portal/packages/relay/test/retention.test.ts` asserts export gate defaults false and only enables when ops sets `interaction_export_enabled`.

## Repeat secret scan (expected findings)

A broad secret scan of the **tracked** tree should only report:

1. **Documented placeholders** — e.g. `placeholder-control-plane-service-token`, `placeholder-relay-internal-token`, `dev-session-secret-change-me`, `local-dev-password` (local demo password in `testing.md` only).
2. **Test fixtures** — synthetic tokens in `*.test.ts` / contract examples under `contracts/backend-runtime-v1/examples/`.
3. **Local ignored files** — anything under `.data/`, `artifacts/ui/.auth/`, `.env.mocklab*` (must not be tracked).

If a scan hits a live token outside those classes, **rotate** and remove it from git history if it was committed.

Suggested inventory (no network):

```bash
bash portal/scripts/secure-local-secrets.sh --scan
git check-ignore -v portal/.data/demo-env.sh artifacts/ui/.auth/mocklab-agent.json .env.mocklab-agent-dev
git ls-files --error-unmatch portal/.data/demo-env.sh 2>&1 || true   # must fail
```

## Related

- [local-dev-monorepo.md](./local-dev-monorepo.md)
- [backend-runtime-secrets.md](./backend-runtime-secrets.md) (host materialize; production `0600`)
- Portal seed: `portal/scripts/seed-demo-tenant.sh`
