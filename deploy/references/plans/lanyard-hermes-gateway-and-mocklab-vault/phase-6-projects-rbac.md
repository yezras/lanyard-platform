# Phase 6: Hermes projects + CP path prefixes

**Bead:** `cbd-ukg.9`  
**Depends on:** `cbd-ukg.8`  
**Status:** implemented (Hermes projects registered on mocklab; CP path story documented for MVP admin)

## Goal

Portal Directory and RBAC match the seeded tree.

## Work

1. On host as Hermes runtime user (or documented operator path):
   ```bash
   # Preferred (idempotent; run as root on host after phase-5 vault seed):
   sudo bash scripts/seed-demo-hermes-projects.sh

   # Or raw CLI (exact flags for hermes-lanyard on host):
   sudo -u hermes env HOME=/home/hermes HERMES_HOME=/home/hermes/.hermes \
     /opt/hermes-lanyard/bin/hermes project create Legal \
     /opt/company-brain/Projects/Legal --slug legal \
     --description "Demo Legal project (synthetic)"
   sudo -u hermes env HOME=/home/hermes HERMES_HOME=/home/hermes/.hermes \
     /opt/hermes-lanyard/bin/hermes project create Operations \
     /opt/company-brain/Projects/Operations --slug operations \
     --description "Demo Operations project (synthetic)"
   ```
   State lives at **`$HERMES_HOME/projects.db`** (`/home/hermes/.hermes/projects.db` for the gateway unit). Always create as user **`hermes`** so the DB is not root-owned.

2. Control plane (mocklab tenant) — see **RBAC story** below.

3. Smoke:
   - CLI: `hermes project list` shows `legal` + `operations` (acceptance for this bead)
   - Directory lists Legal / Operations when Portal reads brain projects (may need brain RPC / session)
   - Chat with project bound sets cwd / chat_topic toward project path (optional; not required for phase-6 close)
   - Optional: contributor cannot read Legal (if contributor role + path_prefixes seeded)

## Acceptance

- [x] projects.db has demo projects
- [x] At least one portal project-bound chat turn **or documented CLI list proof**
- [x] RBAC path story documented for mocklab (even if only admin for MVP)

## Mocklab RBAC story (MVP)

### Layers (do not conflate)

| Layer | What it controls | Mocklab state |
|-------|------------------|---------------|
| **Filesystem** | Paths under `/opt/company-brain` | Phase 5 seed: Legal, Operations, Knowledge, Acme_Demo; `root:hermes` group RW |
| **Hermes profiles (host)** | Capability matrix (`admin` / `contributor` seeds under `$HERMES_HOME/profiles/`) | Present via bootstrap / `ensure-hermes-profiles.sh` |
| **Hermes projects.db** | Named Directory entries + primary folders for chat/cwd | **This phase:** `legal` → `…/Projects/Legal`, `operations` → `…/Projects/Operations` |
| **Control-plane roles** | Portal memberships: `hermes_profile` + `path_prefixes` stamped by BFF onto session subject | **MVP:** admin full-vault story (below); no CP mutation from this bead |

Doctrine: browser never elevates `hermes_profile` / `path_prefixes`. BFF stamps from CP; Hermes enforces host profile + path ACL. See `references/hermes-profile-rbac.md`, `references/brain-rpc-contract.md` L3/L5.

### MVP for demo (admin)

For mocklab demo login as **admin**:

| Field | Recommended value | Notes |
|-------|-------------------|-------|
| Portal role name | `admin` (or existing admin role) | Match tenant seed |
| `hermes_profile` | `admin` | Host seed must exist (`profiles/admin.json`) |
| `path_prefixes` | `/` **or leave empty / full-vault equivalent already configured** | Admin sees entire vault including Legal + Operations + Knowledge + Acme_Demo |

**Do not invent tokens** in git. If admin already has full vault access from tenant seed, **no CP change is required** for Directory + chat once projects.db is populated.

### Optional contributor slice (not applied this bead)

To demo ACL later (operator-only; requires live CP credentials):

| Role | `hermes_profile` | `path_prefixes` (vault-root-relative) |
|------|------------------|----------------------------------------|
| `contributor` | `contributor` | `/Projects/Operations`, optionally `/Knowledge` |
| (admin unchanged) | `admin` | `/` |

Operator steps (control plane; no secrets in this repo):

```text
1. Authenticate to control plane with an operator credential (never commit).
2. GET /tenants/{tenantId}/roles  — confirm admin + optional contributor.
3. Ensure admin role: hermes_profile=admin, path_prefixes=["/"] (or existing full vault).
4. Optional: create/update contributor:
     hermes_profile=contributor
     path_prefixes=["/Projects/Operations","/Knowledge"]
5. Assign roles to portal users (PUT …/users/{userId}/roles).
6. Verify vault browse: contributor 403 on /Projects/Legal; OK on /Projects/Operations.
```

Host profiles alone do **not** set path prefixes — CP memberships do. Omnibox Mode A (if enabled) further cages tool children by profile + path_prefixes.

### Why CP was not mutated in-repo

- No control-plane API tokens, service tokens, or live membership IDs belong in company-brain-deploy.
- Phase 6 acceptance is satisfied by **projects.db + documented RBAC story + CLI list proof**.
- Live CP membership edit is operator-owned when a safe credential path exists outside git.

## Operator lever

| Piece | Path |
|-------|------|
| Register projects | `scripts/seed-demo-hermes-projects.sh` |
| Vault tree (prereq) | `scripts/seed-demo-vault.sh` + `artifacts/demo-vault/` |
| Mocklab notes | `deployments/mocklab/INDEX.md` |

```bash
# On host after phase-5 seed (SSM as root):
sudo bash scripts/seed-demo-hermes-projects.sh
# Verify:
sudo bash scripts/seed-demo-hermes-projects.sh --list-only
# or:
sudo -u hermes env HOME=/home/hermes HERMES_HOME=/home/hermes/.hermes \
  /opt/hermes-lanyard/bin/hermes project list
```

Idempotency: script uses `hermes project show <slug>` and **skips** create when slug exists (avoids hermes auto-suffixing `legal-2`).

---

## Execution appendix (`cbd-ukg.9`)

| Field | Value |
|-------|-------|
| Date (UTC) | 2026-07-19 |
| Instance | `i-08655012ee8702842` (mocklab-brain-hermes) |
| Account | via `AWS_PROFILE=lanyard-main` |
| Hermes CLI | `/opt/hermes-lanyard/bin/hermes` (`hermes project create|list|show`) |
| Runtime | `User=hermes`, `HERMES_HOME=/home/hermes/.hermes` (hermes-gateway unit) |
| DB | `/home/hermes/.hermes/projects.db` owner `hermes:hermes` |
| Create Legal | SSM Success `f5cd0ca2-64d5-4687-a656-228222f980c5` — slug `legal` id `p_43e01f54` → `/opt/company-brain/Projects/Legal` |
| Create Operations | same command — slug `operations` id `p_4a4d4ae5` → `/opt/company-brain/Projects/Operations` |
| Seed script re-run | SSM Success `61877875-b8be-4b33-918c-e2ddbfa63ace` — both slugs **skip (exists)** twice; list-only OK |
| List proof | see below |
| CP memberships | **not modified** — admin full-vault MVP documented; contributor optional steps only |
| Portal project-bound chat | **not run** this bead (optional; CLI list is acceptance) |

### CLI list proof

```text
  legal                    Legal  [1 folder(s)]
  operations               Operations  [1 folder(s)]
```

```text
legal  [p_43e01f54]
  name:    Legal
  about:   Demo Legal project (synthetic)
  primary: /opt/company-brain/Projects/Legal
  folders:
    * /opt/company-brain/Projects/Legal

operations  [p_4a4d4ae5]
  name:    Operations
  about:   Demo Operations project (synthetic)
  primary: /opt/company-brain/Projects/Operations
  folders:
    * /opt/company-brain/Projects/Operations
```

SQLite (host):

```text
p_43e01f54|legal|Legal|…|/opt/company-brain/Projects/Legal
p_4a4d4ae5|operations|Operations|…|/opt/company-brain/Projects/Operations
```

### Notes

- Do **not** run `hermes project` as root without `runuser -u hermes` — discovery as root created a root-owned `projects.db` which was chowned back to `hermes`.
- Duplicate `create` with the same intended slug can auto-allocate `legal-2` if the slug is taken; always check `project show` / use the seed script.
- Phase 5 filesystem tree remains the source of folder content; projects.db only indexes names for Directory / chat binding.
