# Runbook: stage Hermes-Lanyard with generic BACKEND_* pins

**Bead:** `lp-k7g.12.5` · **Epic:** `lp-k7g.12` (phase 8 cutover)

Operator procedure to **stage a customer-host backend** using the monorepo
**generic** pin path (`backend.*` / `BACKEND_ARTIFACT_*` / `backend_artifact_*`)
with **`kind: hermes_lanyard`**.

This is the cutover path that replaces Hermes-only `hermes_artifact_*` pins for
new applies while remaining dual-write compatible during the migration window.

| Surface | Canonical path / name |
| --- | --- |
| Pin document (schema_version 2) | [`compatibility/pins.hermes-lanyard-staging.example.yaml`](../../compatibility/pins.hermes-lanyard-staging.example.yaml) |
| Pin fragments (env + tfvars) | [`deploy/examples/staging-hermes-lanyard/`](../../deploy/examples/staging-hermes-lanyard/) |
| Terraform inputs | `backend_artifact_*` / `backend_contract_*` ([tfvars example](../../deploy/templates/tenant/terraform.tfvars.backend_artifact.example)) |
| Host pin env | `/etc/company-brain/artifact-pins.env` |
| Install root | `/opt/company-brain-backend` |
| Active install | `/opt/company-brain-backend/current` → `versions/<version>` |
| Provenance | `…/versions/<version>/.seed/provenance.json` |
| Runtime home | `/var/lib/company-brain-backend` (`BACKEND_HOME`; Hermes alias `HERMES_HOME=$BACKEND_HOME`) |
| Vault root | `/opt/company-brain` (`VAULT_ROOT`; client-core — **not** swapped with backend) |
| systemd unit | `company-brain-backend.service` (legacy alias: `hermes-gateway.service`) |
| Bootstrap | [`deploy/scripts/bootstrap-backend-install.sh`](../../deploy/scripts/bootstrap-backend-install.sh) (+ product `bootstrap-host.sh` inject) |
| Offline cutover evidence | [`docs/plans/0001-platform-monorepo-migration/cutover-staging-hermes-lanyard.md`](../plans/0001-platform-monorepo-migration/cutover-staging-hermes-lanyard.md) |
| Generic upgrade/rollback | [`docs/runbooks/backend-upgrade-rollback.md`](backend-upgrade-rollback.md) |

---

## Status honesty (read first)

| Claim | Status for this bead session |
| --- | --- |
| Offline pin shape + published HL coordinates | **Done** (example pin file + fragments) |
| Offline bootstrap / provenance / inject smokes | **Done** (see cutover evidence) |
| Rollback pin capture **template** | **Done** (script + checklist) |
| Live EC2 installs backend through generic pipeline | **Pending** — needs staging account + human apply approval |
| Portal settings, vault, projects, chat on staging | **Pending** — requires live host + Portal staging |
| Rollback pins **recorded from a live host** | **Pending** — template ready; capture only after host exists |

**Do not run `terraform apply`, EC2 mutation, or production/staging cloud deploys
without explicit human approval.** This runbook documents the approved sequence;
it is not authorization to execute it.

---

## Preconditions

1. Monorepo checkout with deploy import (`lp-k7g.12.3`) and CI/release wiring
   (`lp-k7g.12.4`) available.
2. Hermes-Lanyard artifact published at an immutable URL + SHA-256
   (default coordinates in the staging pin example: `v0.1.0-g7h3`).
3. client-core pin available and **left separate** from `backend.*`.
4. Staging AWS account / role, SSM or SSH to the tenant host, and (for private
   GitHub artifact URLs) `GITHUB_TOKEN` or `GH_TOKEN` injected via env/SSM —
   **never** written into pin YAML, tfvars committed to git, or this repo.
5. Operator has captured **previous** pins if the host already has a backend
   ([§0](#0-capture-rollback-snapshot)).

Preferred S3 object shape (when platform-account mirror exists; **arch-labeled**,
default product arch **`linux-x86_64`**):

```text
s3://$BUCKET/backends/hermes-lanyard/<version>/linux-x86_64/backend.tar.gz
s3://$BUCKET/hermes/<version>/linux-x86_64/hermes-<version>.tar.gz
```

Set `backend.arch` / `backend_artifact_arch` intentionally (maps to product
`hermes.target_arch`). Unlabeled `hermes/<version>/hermes-<version>.*` is
**deprecated** once labeled objects exist. Private GitHub HTTPS remains valid
during migration (still set arch; verify in-tarball `TARGET_ARCH`).

---

## Offline prep (always; no cloud)

Run from monorepo root **before** any staging apply:

```bash
# 1) Validate staging HL pin document (schema_version 2, kind=hermes_lanyard)
python3 scripts/validate-compatibility-pins.py \
  compatibility/pins.hermes-lanyard-staging.example.yaml

# 2) Generic pin example + full offline monorepo gate
python3 scripts/validate-compatibility-pins.py
bash scripts/validate.sh

# 3) Bootstrap install pipeline (versioned layout + provenance schema)
bash deploy/scripts/smoke-bootstrap-backend-install.sh

# 4) user_data dual-write BACKEND_* + temporary HERMES_* inject
bash deploy/scripts/smoke-bootstrap-inject.sh

# 5) Generic gateway unit contract
bash deploy/scripts/smoke-backend-systemd-unit.sh

# 6) Optional: Hermes-Lanyard offline conformance (fixture; no download)
python3 scripts/run-hermes-lanyard-conformance.py --mode offline
```

Copy fragments for private overlays (gitignored / operator-held):

```bash
# Pin YAML for operator vault / ticket
cp compatibility/pins.hermes-lanyard-staging.example.yaml \
  "$HOME/ops/lanyard/pins-hl-staging-$(date +%Y%m%d).yaml"

# tfvars backend block
cp deploy/examples/staging-hermes-lanyard/tfvars.backend.fragment.hcl \
  "$HOME/ops/lanyard/tfvars-hl-backend.fragment.hcl"

# Capture script for the host (copy with bootstrap tools)
cp deploy/examples/staging-hermes-lanyard/rollback-pin-capture.template.sh \
  "$HOME/ops/lanyard/rollback-pin-capture.sh"
chmod +x "$HOME/ops/lanyard/rollback-pin-capture.sh"
```

---

## 0. Capture rollback snapshot

**Always** before changing pins on a live host. Use the template script:

```bash
# On the EC2 host (after human approval to access staging)
sudo bash /path/to/rollback-pin-capture.template.sh \
  | tee "rollback-pins-$(hostname)-$(date -u +%Y%m%dT%H%M%SZ).txt"
# Store the tee output OFF-HOST (ticket attachment or operator notes)
```

Minimum fields to record:

| Field | Source |
| --- | --- |
| `kind` | `BACKEND_ARTIFACT_KIND` / provenance `kind` |
| `version` | `BACKEND_ARTIFACT_VERSION` / provenance `version` |
| `url` | `BACKEND_ARTIFACT_URL` / provenance `url` |
| `sha256` | `BACKEND_ARTIFACT_SHA256` / provenance `sha256` |
| `contract.*` | `BACKEND_CONTRACT_*` / provenance `contract` |
| pin YAML / tfvars revision | operator git or ticket |

Rollback is “re-pin previous immutable coordinates,” not “rebuild from `main`.”

---

## 1. Set Hermes-Lanyard pins (generic path only)

### 1.1 Pin document (schema_version 2)

Operator overlay (private):

```yaml
schema_version: 2

backend:
  kind: hermes_lanyard
  version: "v0.1.0-g7h3"
  arch: linux-x86_64
  sha256: "a372580396e170436c22e44a61fbcdf8d2c7cf4f5d328694bb5afdf279904db9"
  url: "https://github.com/LanyardBrain/hermes-lanyard/releases/download/v0.1.0-g7h3/hermes-v0.1.0-g7h3.tar.gz"
  # Preferred when arch-labeled S3 mirror exists:
  # url: "s3://$BUCKET/backends/hermes-lanyard/v0.1.0-g7h3/linux-x86_64/backend.tar.gz"
  # url: "s3://$BUCKET/hermes/v0.1.0-g7h3/linux-x86_64/hermes-v0.1.0-g7h3.tar.gz"
  contract:
    runtime_layout: 1
    relay: 1
    brain_rpc: 1

# Leave client_core + portal as separate blocks (see staging example YAML).
# client_core is arch-neutral (no linux-x86_64 path segment).
```

Validate:

```bash
python3 scripts/validate-compatibility-pins.py path/to/operator-pins.yaml
```

### 1.2 Tenant Terraform (preferred durable path)

```hcl
backend_artifact_kind    = "hermes_lanyard"
backend_artifact_url     = "https://github.com/LanyardBrain/hermes-lanyard/releases/download/v0.1.0-g7h3/hermes-v0.1.0-g7h3.tar.gz"
backend_artifact_version = "v0.1.0-g7h3"
backend_artifact_sha256  = "a372580396e170436c22e44a61fbcdf8d2c7cf4f5d328694bb5afdf279904db9"

backend_contract_runtime_layout = 1
backend_contract_relay          = 1
backend_contract_brain_rpc      = 1

client_core_artifact_url     = "https://github.com/LanyardBrain/client-core/releases/download/v0.1.0-g7c2/client-core-v0.1.0-g7c2.tar.gz"
client_core_artifact_version = "v0.1.0-g7c2"
client_core_artifact_sha256  = "ef21c313525afdca9902c40814293bbe924f428c219d93cf80398941c1f181e1"
```

Fragment file: [`deploy/examples/staging-hermes-lanyard/tfvars.backend.fragment.hcl`](../../deploy/examples/staging-hermes-lanyard/tfvars.backend.fragment.hcl).

**Do not** set `hermes_artifact_*` to different values in the same apply. New
tenants should set only `backend_artifact_*`.

### 1.3 Host env dual-write (what user_data must produce)

After apply / first boot, `/etc/company-brain/artifact-pins.env` must contain
**primary** `BACKEND_*` keys (and temporary `HERMES_*` dual-write with the
**same** values). Reference fragment:

[`deploy/examples/staging-hermes-lanyard/artifact-pins.env.fragment`](../../deploy/examples/staging-hermes-lanyard/artifact-pins.env.fragment)

```bash
# Expect on host:
sudo grep -E '^BACKEND_ARTIFACT_(KIND|VERSION|URL|SHA256)=' /etc/company-brain/artifact-pins.env
# BACKEND_ARTIFACT_KIND=hermes_lanyard
# BACKEND_ARTIFACT_VERSION=v0.1.0-g7h3
# ...
```

---

## 2. Apply / bootstrap (live staging — human approval required)

### Path A — Terraform (durable)

```bash
# From private tenant Terraform root (deploy/templates/tenant or deployments/<slug>)
# ONLY after explicit human approval for this staging account:
terraform plan -out=hl-staging-backend.plan
# Review plan: backend_artifact_* / user_data pin intent only as expected
terraform apply hl-staging-backend.plan
```

If user_data runs only at first boot, re-bootstrap on the host (Path B) so pins
in `artifact-pins.env` are applied without instance replacement.

### Path B — Host bootstrap (generic install)

```bash
# Private GH pins: token from SSM/Secrets Manager only
# export GITHUB_TOKEN=…   # never commit

sudo systemctl stop company-brain-backend.service 2>/dev/null || true
sudo systemctl stop hermes-gateway.service 2>/dev/null || true

# Preferred: full product bootstrap (client-core + backend + hardening)
sudo /usr/local/sbin/company-brain-bootstrap

# Or backend-only versioned install (monorepo scaffold / when product sources it):
sudo env BACKEND_INSTALL_ROOT=/opt/company-brain-backend \
  bash /opt/company-brain/deploy-scripts/bootstrap-backend-install.sh
# CLI equivalent:
# sudo bash deploy/scripts/bootstrap-backend-install.sh \
#   --kind hermes_lanyard \
#   --version v0.1.0-g7h3 \
#   --url 'https://github.com/LanyardBrain/hermes-lanyard/releases/download/v0.1.0-g7h3/hermes-v0.1.0-g7h3.tar.gz' \
#   --sha256 'a372580396e170436c22e44a61fbcdf8d2c7cf4f5d328694bb5afdf279904db9' \
#   --contract-runtime 1 --contract-relay 1 --contract-brain-rpc 1 \
#   --install-root /opt/company-brain-backend

sudo tee /etc/company-brain/backend.env >/dev/null <<'EOF'
BACKEND_KIND=hermes_lanyard
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now company-brain-backend.service
# Migration window only if still on legacy unit:
# sudo systemctl enable --now hermes-gateway.service
```

**Install algorithm (normative):** download → SHA-256 verify → extract into
`versions/<version>/` → write `.seed/provenance.json` →
`ln -sfn versions/<version> current`. Previous version directories remain for
rollback.

---

## 3. Verify (live host)

### 3.1 Provenance + layout

```bash
ROOT=/opt/company-brain-backend
readlink -f "$ROOT/current"
# expect: .../versions/v0.1.0-g7h3

sudo jq -e '
  .kind == "hermes_lanyard" and
  .version == "v0.1.0-g7h3" and
  .sha256 == "a372580396e170436c22e44a61fbcdf8d2c7cf4f5d328694bb5afdf279904db9" and
  .contract.runtime_layout == 1 and
  .contract.relay == 1 and
  .contract.brain_rpc == 1
' "$ROOT/current/.seed/provenance.json"

test -x "$ROOT/current/bin/company-brain-backend" \
  || test -x "$ROOT/current/bin/hermes"   # product entrypoint may alias
```

### 3.2 systemd

```bash
UNIT=company-brain-backend.service
systemctl is-active "$UNIT"
systemctl cat "$UNIT" | grep -E '^ExecStart='
# expect contract entrypoint via current:
#   ExecStart=/opt/company-brain-backend/current/bin/company-brain-backend gateway
journalctl -u "$UNIT" -n 80 --no-pager
```

### 3.3 Portal / Brain RPC (settings, vault, projects, chat)

From an authenticated Portal staging session against the connected host:

| Surface | Check | Expected for Hermes-Lanyard |
| --- | --- | --- |
| Relay / host | Host connected; not in error strip | yes |
| Settings | Settings page / `settings.snapshot` | redacted skills/models as supported |
| Vault | Vault browser / `vault.list` / `vault.read` | yes (with vault ACL) |
| Projects | Projects UI / `projects.list` | yes |
| Chat | Send message via relay | yes |

Contract request shapes (tooling):

- [`contracts/backend-runtime-v1/examples/brain-rpc.health.request.json`](../../contracts/backend-runtime-v1/examples/brain-rpc.health.request.json)
- [`contracts/backend-runtime-v1/examples/brain-rpc.settings-snapshot.request.json`](../../contracts/backend-runtime-v1/examples/brain-rpc.settings-snapshot.request.json)
- vault / projects examples under the same directory

Illustrative BFF proxy smoke (replace URL/auth; never paste live tokens into git):

```bash
curl -fsS -X POST "$PORTAL_BFF_BASE/api/brain-rpc" \
  -H "Authorization: Bearer $PORTAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"method":"brain.ping","params":{}}'

curl -fsS -X POST "$PORTAL_BFF_BASE/api/brain-rpc" \
  -H "Authorization: Bearer $PORTAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"method":"brain.health","params":{}}'
```

---

## 4. Record rollback pins (live acceptance for AC-3)

After a successful staging install (or immediately before a deliberate upgrade),
store the capture file from [§0](#0-capture-rollback-snapshot) in the change
ticket. At minimum paste the table:

```text
kind:     hermes_lanyard
version:  v0.1.0-g7h3
url:      <immutable URL actually installed>
sha256:   <64 hex>
contract: runtime_layout=1 relay=1 brain_rpc=1
client_core.version / sha256 / url: <from pin env>
capture_file: <off-host path or ticket attachment>
tfvars_or_pin_revision: <git sha or ticket>
```

Fast rollback when `versions/<prev>/` still exists:

```bash
PREV=v0.1.0-g7h3   # or previous version from capture
sudo systemctl stop company-brain-backend.service
sudo ln -sfn "versions/${PREV}" /opt/company-brain-backend/current
# restore artifact-pins.env from capture
echo 'BACKEND_KIND=hermes_lanyard' | sudo tee /etc/company-brain/backend.env
sudo systemctl start company-brain-backend.service
sudo jq -e --arg v "$PREV" '.version == $v and .kind == "hermes_lanyard"' \
  /opt/company-brain-backend/current/.seed/provenance.json
```

Full procedure: [`backend-upgrade-rollback.md`](backend-upgrade-rollback.md) §5.

---

## 5. Acceptance criteria map

| Acceptance criterion | Offline prep | Live staging |
| --- | --- | --- |
| EC2 installs backend through generic pipeline | Pin fragment + bootstrap/inject smokes + user_data dual-write | Pending human-approved apply + bootstrap |
| Portal settings, vault, projects, and chat work | Offline HL conformance fixture; contract examples | Pending live Portal + host |
| Rollback pins are recorded | Capture template + checklist | Pending live capture file from host |

---

## Live staging blockers

Documented for operators and the next session that has account access:

| Blocker | Why it blocks | Unblock |
| --- | --- | --- |
| **No terraform apply / EC2 mutation without human approval** | Orchestrator + security policy | Explicit human approval for the staging account and change window |
| **Staging AWS credentials / account role** | Plan/apply and instance access | Operator SSO / role into platform-staging or tenant staging account |
| **Artifact download auth** | Private GitHub release URLs 404 without token | Inject `GITHUB_TOKEN`/`GH_TOKEN` via SSM/Secrets Manager on the host; or mirror to S3 and use instance role |
| **Platform S3 mirror optional but preferred** | Instance role path avoids long-lived GH tokens | Publish under `backends/hermes-lanyard/<ver>/` via product-artifact-infra |
| **Portal staging edge / connected host** | Settings/vault/projects/chat E2E needs Portal + relay | Platform-staging compose + tenant host connected (see deploy readiness matrix) |
| **Portal ECR image digests** | Image repos in pin example may still be placeholders | Re-pin real ECR RepoDigests after image-release publish |
| **Secrets checklist** | Relay secrets, OIDC, etc. | [`deploy/references/runbooks/staging-secrets-checklist.md`](../../deploy/references/runbooks/staging-secrets-checklist.md) |

---

## Related

| Doc / path | Role |
| --- | --- |
| [`cutover-staging-hermes-lanyard.md`](../plans/0001-platform-monorepo-migration/cutover-staging-hermes-lanyard.md) | Offline evidence for this bead |
| [`backend-upgrade-rollback.md`](backend-upgrade-rollback.md) | Generic upgrade / kind swap / rollback |
| [`backend-compatibility-matrix.md`](../architecture/backend-compatibility-matrix.md) | Kind readiness (`hermes_lanyard` = production default) |
| [`deploy/references/runbooks/pin-update.md`](../../deploy/references/runbooks/pin-update.md) | Legacy deploy pin-update (v1 `hermes.*` still documented there) |
| [`compatibility/translation-v1-to-v2.md`](../../compatibility/translation-v1-to-v2.md) | v1 → v2 field map |
| `lp-k7g.12.6` | Next: stage Lanyard Agent pins (blocked until product conformance) |
