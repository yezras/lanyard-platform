# Hermes profile matrix (customer brain)

Portal maps each business user to a **Hermes profile** and vault path prefixes in the Lanyard control plane. Customer operators must provision matching profiles on the Hermes gateway host.

Default roles for Company Brain tenants: **admin** and **contributor**.

## Enforce path (host — not docs-only)

**`hermes_profile_hints` in Terraform is documentation only.** It does **not** create profiles, gate capabilities, or prevent role elevation.

Host enforcement is owned by company-brain-deploy bootstrap:

| Control | Location |
|---------|----------|
| Profile seeds (capability matrix) | `scripts/hermes-profiles/{admin,contributor}.json` |
| Ensure / verify script | `scripts/ensure-hermes-profiles.sh` |
| Bootstrap install step | `scripts/bootstrap-host.sh` → `ensure_hermes_profiles` after Hermes install |
| Offline smoke | `scripts/smoke-hermes-profiles.sh` |

After Hermes artifact install, bootstrap writes:

```text
$HERMES_HOME/profiles/admin.json
$HERMES_HOME/profiles/contributor.json
# best-effort mirror:
/etc/company-brain/hermes-profiles/
```

Contributor seeds **must not** include admin-only capabilities. Verification is fail-closed:

- `profile_manage`, `system_ops`, `shell_exec`, `gateway_config`, `beads_admin`, `vault_full` → **admin only**
- Contributor: `vault_read`, `vault_write`, `chat` (path prefixes bound by portal role / operator)

Set `REQUIRE_HERMES_PROFILES=1` (or `ensure-hermes-profiles.sh --require`) to hard-fail when seeds cannot be written.

```bash
# Operator re-run / repair
sudo REQUIRE_HERMES_PROFILES=1 bash /path/to/ensure-hermes-profiles.sh \
  --hermes-home /home/ec2-user/.hermes
```

Relay module (`modules/customer-gateway-relay`) still accepts `hermes_profile_hints` for SOW alignment only — see that module README.

## Control plane

1. Create roles per tenant: `POST /tenants/:tenantId/roles`
   - `name` — portal role label
   - `hermes_profile` — must match a Hermes gateway profile name on the customer server (`admin` / `contributor` for MVP)
   - `path_prefixes` — vault-root-relative paths (e.g. `/Projects/Legal`)
2. Assign roles: `PUT /tenants/:tenantId/users/:userId/roles` with `{ "role_ids": ["..."] }`
3. BFF loads RBAC on each authenticated request and:
   - Sets `SessionSource.profile` on relay chat inject
   - Enforces vault ACL on `/api/vault/*` before browse/read proxies

Portal BFF RBAC and host profile seeds are complementary: portal cannot elevate a session beyond the host profile matrix, and host seeds cannot invent portal role membership.

## Customer gateway (EC2)

For each `hermes_profile` value used in the portal:

- Profiles **admin** and **contributor** are created/enforced by bootstrap (see Enforce path above).
- Align vault-writer / MCP path allowlists with the same prefixes as the portal role.
- Optional OS-level separation: dedicated Unix user per profile (deployment-specific).

### MVP matrix

| Portal role | `hermes_profile` | Typical access | Host capabilities (seed) |
|-------------|------------------|----------------|--------------------------|
| Admin | `admin` | Full vault + ops | `vault_full`, ops (`profile_manage`, `system_ops`, `shell_exec`, `gateway_config`, `beads_admin`), chat |
| Contributor | `contributor` | Authoring within allowed prefixes | `vault_read`, `vault_write`, `chat` only |

### Omnibox Mode A (optional OS cage for tool children)

When `OMNIBOX_ENABLED=1` (Terraform `enable_omnibox`, default **false**), host-impacting tools should run under `run-under-omnibox` with the session profile. This is **complementary** to profile seeds and tool allowlists — it does not replace them.

| `hermes_profile` | Omnibox policy | FS grant shape | Notes |
|------------------|----------------|----------------|-------|
| `admin` | `scripts/omnibox/admin.yaml` → `/etc/company-brain/omnibox/admin.yaml` | Full vault RW (+ optional path_prefixes) + admin workspace | `shell_exec` allowed by tool allowlist; cage denies `.env` / secret stores |
| `contributor` | `scripts/omnibox/contributor.yaml` → `/etc/company-brain/omnibox/contributor.yaml` | Vault only via path_prefixes; contributor workspace | `shell_exec` still **denied** by tool allowlist; Omnibox stricter if any host tool runs |

Break-glass: `OMNIBOX_ENABLED=0` in `/etc/company-brain/omnibox.env` + gateway restart. Residual **shared-kernel** risk (bubblewrap ≠ microVM): see `references/runbooks/omnibox-mode-a.md` and `references/threat-model-private-by-default.md`.

Additional profiles (e.g. intake, kb, vault-writer) may be added for multi-pipeline SOWs; document them in the tenant tfvars `hermes_profile_hints` when used, and extend seed templates + ensure script before treating them as enforced.

## Smoke check

### Offline (deploy repo)

```bash
bash scripts/smoke-hermes-profiles.sh
bash scripts/smoke-omnibox.sh   # profile → Omnibox policy mapping + never_grant
```

Asserts: seeds present, contributor lacks admin-only caps, elevation inject fails verification.

### Live (after provision)

1. Provision two roles with disjoint `path_prefixes`.
2. Assign one role each to two portal users.
3. Call vault access-check as each user — denied paths must return **403**.
4. Send chat as each user — gateway inbound `source.profile` must match the role's `hermes_profile`.
5. Confirm host files exist: `~/.hermes/profiles/admin.json` and `contributor.json`.

## Related

- Relay wiring: `modules/customer-gateway-relay/` (hints ≠ enforcement)
- Bootstrap: `scripts/bootstrap-host.sh`, `scripts/ensure-hermes-profiles.sh`
- Runtime hardening + tool allowlists: `scripts/ensure-runtime-hardening.sh`, `scripts/tool-allowlists/`, `references/runbooks/host-runtime-hardening.md`
- Omnibox Mode A (enable / verify / break-glass): `references/runbooks/omnibox-mode-a.md`, `scripts/omnibox/`, `scripts/ensure-omnibox.sh`
- Hermes pre-exec hook contract (phase 5): `references/omnibox-mode-a-hermes-hook.md` (planned path)
- Provision flow: `references/provision-runbook.md`
