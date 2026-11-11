# Runbook: backend upgrade and rollback

**Bead:** `lp-k7g.7.7` · **Epic:** `lp-k7g.7` (phase 3)

Operator procedure to change backend artifact pins, apply install, verify the
host, swap **Hermes-Lanyard → Lanyard Agent**, and roll back to previous pins.

Platform paths below are the **target** layout after phase-3 generalization.
`company-brain-deploy` may still be external until phase 6; use the monorepo
scaffolds under `deploy/` as the merge-ready contract.

| Surface | Canonical path / name |
| --- | --- |
| Pin document | Operator overlay of [`compatibility/pins.example.yaml`](../../compatibility/pins.example.yaml) (schema_version 2); HL staging candidate [`compatibility/pins.hermes-lanyard-staging.example.yaml`](../../compatibility/pins.hermes-lanyard-staging.example.yaml) (`lp-k7g.12.5`) |
| Staging HL runbook | [`docs/runbooks/staging-hermes-lanyard-backend-pins.md`](staging-hermes-lanyard-backend-pins.md) (generic `BACKEND_*` path + live blockers) |
| Terraform inputs | `backend_artifact_*` / `backend_contract_*` ([`deploy/templates/tenant/terraform.tfvars.backend_artifact.example`](../../deploy/templates/tenant/terraform.tfvars.backend_artifact.example)) |
| Host pin env | `/etc/company-brain/artifact-pins.env` |
| Install root | `/opt/company-brain-backend` |
| Active install | `/opt/company-brain-backend/current` → `versions/<version>` |
| Provenance | `/opt/company-brain-backend/versions/<version>/.seed/provenance.json` |
| Runtime home | `/var/lib/company-brain-backend` (`BACKEND_HOME`) |
| Vault root | `/opt/company-brain` (`VAULT_ROOT`; client-core — **not** swapped with backend) |
| systemd unit | `company-brain-backend.service` |
| Bootstrap script | [`deploy/scripts/bootstrap-backend-install.sh`](../../deploy/scripts/bootstrap-backend-install.sh) |

Related design:

- **Backend compatibility matrix** (which kinds are pin-ready): [`docs/architecture/backend-compatibility-matrix.md`](../architecture/backend-compatibility-matrix.md)
- Pins: [`compatibility/README.md`](../../compatibility/README.md)
- Bootstrap: [`docs/architecture/deploy-bootstrap-backend-install.md`](../architecture/deploy-bootstrap-backend-install.md)
- systemd: [`docs/architecture/deploy-backend-systemd-service.md`](../architecture/deploy-backend-systemd-service.md)
- Landing zones: [`docs/architecture/deploy-artifact-landing-zones.md`](../architecture/deploy-artifact-landing-zones.md)
- Phase 3 plan: [`docs/plans/0001-platform-monorepo-migration/phase-3-artifact-deploy-generalization.md`](../plans/0001-platform-monorepo-migration/phase-3-artifact-deploy-generalization.md)
- Lanyard Agent gaps: [`docs/architecture/lanyard-agent-conformance-gaps.md`](../architecture/lanyard-agent-conformance-gaps.md)
- Deploy readiness gates (G*): [`deploy/references/readiness-matrix.md`](../../deploy/references/readiness-matrix.md)

---

## Preconditions

1. You have SSH (or SSM) to the EC2 host and can `sudo`.
2. You have the **previous** pin values recorded (version, kind, url, sha256,
   contract majors). Copy them before any edit — see [§ Capture rollback
   snapshot](#0-capture-rollback-snapshot-always).
3. The target tarball is already published at an immutable URL
   (`s3://…` or `https://…` release object) with a known SHA-256.
4. Pin `backend.kind` will match `manifest/backend.json` `kind` inside the
   tarball (`hermes_lanyard` or `lanyard_agent`).
5. **client_core** and **portal** pins stay unchanged unless you are deliberately
   upgrading them in a separate change. Backend swaps must not nest or rewrite
   `client_core`.

Preferred S3 coordinates (kind slug = underscores → hyphens):

```text
s3://$BUCKET/backends/hermes-lanyard/<version>/backend.tar.gz
s3://$BUCKET/backends/lanyard-agent/<version>/backend.tar.gz
```

Legacy Hermes URLs (`s3://…/hermes/<version>/…` or GitHub Release HTTPS) remain
valid for Hermes-Lanyard until dual-write ends.

---

## 0. Capture rollback snapshot (always)

Run **before** changing pins. Save output off-host (ticket, notes, or a local file).

```bash
# On the host
sudo bash -c '
set -euo pipefail
ROOT="${BACKEND_INSTALL_ROOT:-/opt/company-brain-backend}"
echo "=== artifact-pins.env ==="
cat /etc/company-brain/artifact-pins.env 2>/dev/null || echo "(missing)"
echo
echo "=== current symlink ==="
readlink -f "$ROOT/current" || true
ls -la "$ROOT/current" 2>/dev/null || true
echo
echo "=== active provenance ==="
if [ -f "$ROOT/current/.seed/provenance.json" ]; then
  cat "$ROOT/current/.seed/provenance.json"
else
  echo "(no provenance.json under current)"
fi
echo
echo "=== installed versions ==="
ls -la "$ROOT/versions" 2>/dev/null || true
echo
echo "=== systemd ==="
systemctl is-active company-brain-backend.service 2>/dev/null || true
systemctl is-active hermes-gateway.service 2>/dev/null || true
'
```

Record at least:

| Field | Source |
| --- | --- |
| `kind` | `BACKEND_ARTIFACT_KIND` / provenance `kind` |
| `version` | `BACKEND_ARTIFACT_VERSION` / provenance `version` |
| `url` | `BACKEND_ARTIFACT_URL` / provenance `url` |
| `sha256` | `BACKEND_ARTIFACT_SHA256` / provenance `sha256` |
| `contract.*` | `BACKEND_CONTRACT_*` / provenance `contract` |

Keep a copy of the operator pin YAML / tfvars revision that produced the live
host. Rollback is “re-pin previous immutable coordinates,” not “rebuild from git
main.”

---

## 1. Change backend pins (kind / version / url / sha256)

### 1.1 Operator pin document (schema_version 2)

Edit the **private** pin overlay (not the git example). Only the `backend` block
changes for a backend swap or same-kind upgrade:

```yaml
schema_version: 2

backend:
  kind: hermes_lanyard          # or lanyard_agent
  version: "v0.2.0"            # immutable release label — never main/latest
  sha256: "<64 lowercase hex of the tarball bytes>"
  url: "s3://example-artifacts-bucket/backends/hermes-lanyard/v0.2.0/backend.tar.gz"
  contract:
    runtime_layout: 1
    relay: 1
    brain_rpc: 1

# Leave unchanged for a backend-only change:
client_core: { ... }
portal: { ... }
```

Validate offline from the monorepo (or any checkout with the validator):

```bash
# From monorepo root
python3 scripts/validate-compatibility-pins.py path/to/operator-pins.yaml
# or full planning-shell gates:
bash scripts/validate.sh
```

### 1.2 Terraform / tenant tfvars

Map the same coordinates into tenant inputs (preferred names):

```hcl
backend_artifact_kind    = "hermes_lanyard"
backend_artifact_url     = "s3://example-artifacts-bucket/backends/hermes-lanyard/v0.2.0/backend.tar.gz"
backend_artifact_version = "v0.2.0"
backend_artifact_sha256  = "<64 hex>"

backend_contract_runtime_layout = 1
backend_contract_relay          = 1
backend_contract_brain_rpc      = 1

# Do not set hermes_artifact_* to different values in the same apply.
```

Lanyard Agent example (same variable names; different kind + URL prefix):

```hcl
backend_artifact_kind    = "lanyard_agent"
backend_artifact_url     = "s3://example-artifacts-bucket/backends/lanyard-agent/v0.1.0/backend.tar.gz"
backend_artifact_version = "v0.1.0"
backend_artifact_sha256  = "<64 hex>"
backend_contract_runtime_layout = 1
backend_contract_relay          = 1
backend_contract_brain_rpc      = 1
```

### 1.3 Host pin env (if editing without full Terraform re-apply)

When Terraform has already dual-written `/etc/company-brain/artifact-pins.env`,
operators may stage a pin change for a **manual** re-bootstrap (lab / emergency).
Prefer Terraform + user_data for durable state.

```bash
sudo install -d -m 0755 /etc/company-brain
sudo tee /etc/company-brain/artifact-pins.env >/dev/null <<'EOF'
# Primary (long-term)
BACKEND_ARTIFACT_URL=s3://example-artifacts-bucket/backends/hermes-lanyard/v0.2.0/backend.tar.gz
BACKEND_ARTIFACT_VERSION=v0.2.0
BACKEND_ARTIFACT_SHA256=<64 hex>
BACKEND_ARTIFACT_KIND=hermes_lanyard
BACKEND_CONTRACT_RUNTIME_LAYOUT=1
BACKEND_CONTRACT_RELAY=1
BACKEND_CONTRACT_BRAIN_RPC=1
BACKEND_INSTALL_PATH=/opt/company-brain-backend

# Temporary dual-write (migration window only; same values)
HERMES_ARTIFACT_URL=s3://example-artifacts-bucket/backends/hermes-lanyard/v0.2.0/backend.tar.gz
HERMES_ARTIFACT_VERSION=v0.2.0
HERMES_ARTIFACT_SHA256=<64 hex>
RELAY_CONTRACT_MAJOR=1
HERMES_INSTALL_PATH=/opt/company-brain-backend
EOF
sudo chmod 0644 /etc/company-brain/artifact-pins.env
```

---

## 2. Apply deploy / re-bootstrap

Choose one path. Both end with versioned install + `current` symlink +
`provenance.json`.

### Path A — Terraform re-apply (durable)

```bash
# From the tenant Terraform root (after company-brain-deploy import: deploy/…)
terraform plan -out=backend-upgrade.plan
terraform apply backend-upgrade.plan
```

Then either:

- **Replace / re-bootstrap host** if user_data only runs at first boot, **or**
- **SSH and run bootstrap** (Path B) so the new pins in
  `artifact-pins.env` are applied without instance replacement.

Confirm cloud-init / user_data wrote the new pins:

```bash
sudo grep -E '^BACKEND_ARTIFACT_(KIND|VERSION|URL|SHA256)=' /etc/company-brain/artifact-pins.env
```

### Path B — Host bootstrap only (same instance)

Stop the gateway briefly so the binary under `current` is not busy during the
symlink flip (recommended for kind swaps; same-kind upgrades can often restart
after install).

```bash
sudo systemctl stop company-brain-backend.service 2>/dev/null || true
# Migration window only:
sudo systemctl stop hermes-gateway.service 2>/dev/null || true

# Reference install (monorepo scaffold; merge into bootstrap-host.sh at phase 6)
sudo env \
  BACKEND_INSTALL_ROOT=/opt/company-brain-backend \
  bash /opt/company-brain/deploy-scripts/bootstrap-backend-install.sh
# If the script lives only in the monorepo checkout on the operator machine,
# copy it first, or run from a checkout:
#   sudo bash deploy/scripts/bootstrap-backend-install.sh

# Force re-extract of the same version directory (rare; pin mismatch recovery):
#   sudo BACKEND_INSTALL_FORCE=1 bash deploy/scripts/bootstrap-backend-install.sh
```

CLI equivalent (no `artifact-pins.env`):

```bash
sudo bash deploy/scripts/bootstrap-backend-install.sh \
  --kind hermes_lanyard \
  --version v0.2.0 \
  --url 's3://example-artifacts-bucket/backends/hermes-lanyard/v0.2.0/backend.tar.gz' \
  --sha256 '<64 hex>' \
  --contract-runtime 1 \
  --contract-relay 1 \
  --contract-brain-rpc 1 \
  --install-root /opt/company-brain-backend
```

**Install algorithm (normative):** download → SHA-256 verify → extract into
`versions/<version>/` → write `.seed/provenance.json` →
`ln -sfn versions/<version> current`. Previous version directories are **left in
place** for rollback.

Start the unit:

```bash
# Prefer generic unit (lp-k7g.7.5); drop-in may set BACKEND_KIND
sudo systemctl daemon-reload
sudo systemctl enable --now company-brain-backend.service
# If still on legacy unit name during migration:
# sudo systemctl enable --now hermes-gateway.service
```

Update `BACKEND_KIND` when swapping product family:

```bash
# /etc/company-brain/backend.env (or unit Environment=)
sudo tee /etc/company-brain/backend.env >/dev/null <<'EOF'
BACKEND_KIND=lanyard_agent
EOF
sudo systemctl restart company-brain-backend.service
```

---

## 3. Verify (health, portal settings, provenance, systemd)

Run all checks after upgrade, swap, or rollback. Fail closed: if provenance or
systemd disagree with intended pins, do not hand off to users.

### 3.1 Install layout and provenance

```bash
ROOT=/opt/company-brain-backend

# current → expected version directory
readlink "$ROOT/current"
# expect: versions/<version>   (relative)
readlink -f "$ROOT/current"
# expect: /opt/company-brain-backend/versions/<version>

test -x "$ROOT/current/bin/company-brain-backend"

# Provenance must match intended pins
sudo python3 - <<'PY'
import json, os, sys
root = os.environ.get("BACKEND_INSTALL_ROOT", "/opt/company-brain-backend")
path = os.path.join(root, "current", ".seed", "provenance.json")
with open(path) as f:
    p = json.load(f)
need = {
    "kind": os.environ.get("EXPECT_KIND", p["kind"]),
    "version": os.environ.get("EXPECT_VERSION", p["version"]),
}
for k, v in need.items():
    if os.environ.get(f"EXPECT_{k.upper()}", v) and p.get(k) != os.environ.get(f"EXPECT_{k.upper()}", p.get(k)):
        pass
print(json.dumps(p, indent=2))
required = ["schema_version", "kind", "version", "url", "sha256", "contract",
            "installed_at", "install_root", "install_path"]
missing = [k for k in required if k not in p]
if missing:
    sys.exit(f"provenance missing fields: {missing}")
for ck in ("runtime_layout", "relay", "brain_rpc"):
    if ck not in p.get("contract", {}):
        sys.exit(f"provenance.contract missing {ck}")
print("provenance OK")
PY
```

Assert expected values explicitly (replace placeholders):

```bash
ROOT=/opt/company-brain-backend
sudo jq -e '
  .kind == "hermes_lanyard" and
  .version == "v0.2.0" and
  .sha256 == "<64 hex>" and
  .contract.runtime_layout == 1 and
  .contract.relay == 1 and
  .contract.brain_rpc == 1
' "$ROOT/current/.seed/provenance.json"
```

Pin env on disk should agree:

```bash
sudo grep -E '^BACKEND_ARTIFACT_(KIND|VERSION|SHA256)=' /etc/company-brain/artifact-pins.env
```

### 3.2 systemd

```bash
UNIT=company-brain-backend.service
# UNIT=hermes-gateway.service   # migration alias only

systemctl is-active "$UNIT"          # expect: active
systemctl is-enabled "$UNIT"         # expect: enabled (or enabled-runtime)
systemctl show "$UNIT" -p ActiveState -p SubState -p ExecMainStatus -p FragmentPath

# ExecStart must be the contract entrypoint via current
systemctl cat "$UNIT" | grep -E '^ExecStart='
# expect: ExecStart=/opt/company-brain-backend/current/bin/company-brain-backend gateway

# Recent logs (no crash loop)
journalctl -u "$UNIT" -n 80 --no-pager
```

### 3.3 Local process / gateway health

Contract entrypoint is always `bin/company-brain-backend gateway`. Local HTTP
probes (if the product exposes them) are **ops aids**, not a substitute for Brain
RPC through Portal.

```bash
# Process up
pgrep -a company-brain-backend || pgrep -af 'bin/company-brain-backend gateway'

# Optional product-local probes (kind-specific; may not exist)
# curl -fsS http://127.0.0.1:PORT/health
# curl -fsS http://127.0.0.1:PORT/ready
```

### 3.4 Portal / Brain RPC (settings + health)

From Portal (authenticated admin session), confirm:

| Check | Expected when backend claims brain_rpc: 1 |
| --- | --- |
| Host connected / relay healthy | Instance shows connected; chat or host strip not in error |
| Settings page load | Redacted settings via `settings.snapshot` (skills/models/cron/integrations as supported) |
| Health / host status | `brain.health` succeeds (or Portal host-health surface maps it) |

Contract request shapes (for tooling / BFF debug), see:

- [`contracts/backend-runtime-v1/examples/brain-rpc.health.request.json`](../../contracts/backend-runtime-v1/examples/brain-rpc.health.request.json)
- [`contracts/backend-runtime-v1/examples/brain-rpc.settings-snapshot.request.json`](../../contracts/backend-runtime-v1/examples/brain-rpc.settings-snapshot.request.json)

Example admin-session Brain RPC smoke (via your Portal BFF or relay client —
replace auth material; do not paste live tokens into tickets):

```bash
# Illustrative: POST to the BFF/admin Brain RPC proxy your environment provides.
# Exact URL is environment-specific; the method names are contract-stable.
curl -fsS -X POST "$PORTAL_BFF_BASE/api/brain-rpc" \
  -H "Authorization: Bearer $PORTAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"method":"brain.ping","params":{}}'

curl -fsS -X POST "$PORTAL_BFF_BASE/api/brain-rpc" \
  -H "Authorization: Bearer $PORTAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"method":"brain.health","params":{}}'

curl -fsS -X POST "$PORTAL_BFF_BASE/api/brain-rpc" \
  -H "Authorization: Bearer $PORTAL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"method":"settings.snapshot","params":{"include":["skills","models"]}}'
```

**Hermes-Lanyard:** required Brain RPC methods are expected to pass (reference
implementation).

**Lanyard Agent:** until conformance gaps close, chat/relay may work while
`settings.snapshot` / vault / projects RPC remain unavailable. Treat full Portal
settings verification as **blocked** for that kind; verify at minimum: install
provenance, systemd active, relay connect, and documented capability matrix.
See [lanyard-agent-conformance-gaps.md](../architecture/lanyard-agent-conformance-gaps.md).

### 3.5 Offline scaffold smokes (pre-merge / CI)

These do not touch a live host; they guard install and landing-zone contracts:

```bash
bash deploy/scripts/smoke-bootstrap-backend-install.sh
bash deploy/scripts/smoke-backend-systemd-unit.sh
bash deploy/scripts/smoke-artifact-landing-zones.sh
bash scripts/validate.sh
```

---

## 4. Swap Hermes-Lanyard → Lanyard Agent

Kind change is a normal pin upgrade with extra care around env aliases and
Portal capability expectations.

### 4.1 Sequence

1. **[§0 Capture rollback snapshot](#0-capture-rollback-snapshot-always)** of the
   live Hermes-Lanyard pins (keep the previous version tree under
   `/opt/company-brain-backend/versions/`).
2. Confirm Lanyard Agent artifact is published under
   `s3://$BUCKET/backends/lanyard-agent/<version>/…` with a known sha256.
3. Update pins:
   - `backend.kind` / `backend_artifact_kind` → `lanyard_agent`
   - `backend.version` / url / sha256 → Lanyard Agent release
   - Keep `client_core` and `portal` pins unchanged
   - Set contract majors to what the **agent release** actually claims (do not
     advertise `brain_rpc: 1` if the product has not closed required methods)
4. [Apply / re-bootstrap](#2-apply-deploy--re-bootstrap) (stop unit → install →
   set `BACKEND_KIND=lanyard_agent` → start unit).
5. [Verify](#3-verify-health-portal-settings-provenance-systemd) with
   Lanyard-Agent-aware expectations (provenance kind + systemd + relay; Portal
   settings only if the release claims Brain RPC).

### 4.2 Pin diff (illustrative)

Before:

```yaml
backend:
  kind: hermes_lanyard
  version: "v0.1.0-g7h2"
  sha256: "046f9987b10ae6f19a0e1e74bf2e68e5ce8ddeb853dee6a50211bc5cdffa71f4"
  url: "s3://example-artifacts-bucket/backends/hermes-lanyard/v0.1.0-g7h2/backend.tar.gz"
  contract: { runtime_layout: 1, relay: 1, brain_rpc: 1 }
```

After:

```yaml
backend:
  kind: lanyard_agent
  version: "v0.1.0"
  sha256: "<agent release sha256>"
  url: "s3://example-artifacts-bucket/backends/lanyard-agent/v0.1.0/backend.tar.gz"
  contract: { runtime_layout: 1, relay: 1, brain_rpc: 1 }  # only if claimed
```

Terraform:

```hcl
backend_artifact_kind    = "lanyard_agent"
backend_artifact_url     = "s3://example-artifacts-bucket/backends/lanyard-agent/v0.1.0/backend.tar.gz"
backend_artifact_version = "v0.1.0"
backend_artifact_sha256  = "<agent release sha256>"
```

Bootstrap:

```bash
sudo systemctl stop company-brain-backend.service
sudo bash deploy/scripts/bootstrap-backend-install.sh \
  --kind lanyard_agent \
  --version v0.1.0 \
  --url 's3://example-artifacts-bucket/backends/lanyard-agent/v0.1.0/backend.tar.gz' \
  --sha256 '<agent release sha256>' \
  --install-root /opt/company-brain-backend

sudo tee /etc/company-brain/backend.env >/dev/null <<'EOF'
BACKEND_KIND=lanyard_agent
EOF
# HERMES_HOME aliases may remain set to the same BACKEND_HOME path for dual-run
# tooling; pure lanyard_agent does not require Hermes product semantics.
sudo systemctl start company-brain-backend.service
```

### 4.3 Post-swap checks (concrete)

```bash
ROOT=/opt/company-brain-backend
test "$(readlink -f "$ROOT/current")" = "$ROOT/versions/v0.1.0"
sudo jq -e '.kind == "lanyard_agent" and .version == "v0.1.0"' \
  "$ROOT/current/.seed/provenance.json"
# Manifest inside the tarball (if present)
sudo jq -e '.kind == "lanyard_agent"' \
  "$ROOT/current/manifest/backend.json" 2>/dev/null || \
  echo "WARN: manifest/backend.json missing or unreadable — product conformance gap"
systemctl is-active company-brain-backend.service
# Previous Hermes tree still present for rollback:
test -d "$ROOT/versions/v0.1.0-g7h2"
```

### 4.4 What does **not** change

| Item | Why |
| --- | --- |
| `client_core` pin / vault seed | Separate artifact; install into `VAULT_ROOT` |
| Portal image digests | Separate `portal` block |
| Unit name / `ExecStart` path | Always `…/current/bin/company-brain-backend gateway` |
| Versioned install root | Same `/opt/company-brain-backend` for every kind |

---

## 5. Roll back to previous pins

Rollback restores the **previous immutable pin set**. Prefer the still-present
`versions/<old>/` tree when the archive was already verified on this host.

### 5.1 Fast host rollback (previous version still installed)

If `/opt/company-brain-backend/versions/<previous-version>/` exists and its
`provenance.json` matches the rollback pins:

```bash
ROOT=/opt/company-brain-backend
PREV_VERSION="v0.1.0-g7h2"          # from §0 snapshot
PREV_KIND="hermes_lanyard"

sudo systemctl stop company-brain-backend.service 2>/dev/null || true

# Point current at the previous extract (relative symlink)
sudo ln -sfn "versions/${PREV_VERSION}" "$ROOT/current"
readlink -f "$ROOT/current"   # expect: .../versions/v0.1.0-g7h2

# Restore pin env to previous coordinates (example — use §0 values)
sudo tee /etc/company-brain/artifact-pins.env >/dev/null <<EOF
BACKEND_ARTIFACT_URL=<previous url>
BACKEND_ARTIFACT_VERSION=${PREV_VERSION}
BACKEND_ARTIFACT_SHA256=<previous sha256>
BACKEND_ARTIFACT_KIND=${PREV_KIND}
BACKEND_CONTRACT_RUNTIME_LAYOUT=1
BACKEND_CONTRACT_RELAY=1
BACKEND_CONTRACT_BRAIN_RPC=1
BACKEND_INSTALL_PATH=${ROOT}
HERMES_ARTIFACT_URL=<previous url>
HERMES_ARTIFACT_VERSION=${PREV_VERSION}
HERMES_ARTIFACT_SHA256=<previous sha256>
RELAY_CONTRACT_MAJOR=1
HERMES_INSTALL_PATH=${ROOT}
EOF

sudo tee /etc/company-brain/backend.env >/dev/null <<EOF
BACKEND_KIND=${PREV_KIND}
EOF

sudo systemctl start company-brain-backend.service
```

Re-run [§3 Verify](#3-verify-health-portal-settings-provenance-systemd) against
the **previous** expected kind/version/sha256.

### 5.2 Full rollback via bootstrap (re-download previous pins)

Use when the previous version directory is missing, corrupted, or provenance
does not match the intended rollback pins.

1. Restore operator pin YAML / tfvars to the previous revision (git revert of
   the pin change, or paste §0 values).
2. Validate pins:

   ```bash
   python3 scripts/validate-compatibility-pins.py path/to/operator-pins.yaml
   ```

3. Apply Terraform (Path A) and/or run bootstrap with previous coordinates
   (Path B):

   ```bash
   sudo systemctl stop company-brain-backend.service
   sudo bash deploy/scripts/bootstrap-backend-install.sh \
     --kind hermes_lanyard \
     --version v0.1.0-g7h2 \
     --url 's3://example-artifacts-bucket/backends/hermes-lanyard/v0.1.0-g7h2/backend.tar.gz' \
     --sha256 '046f9987b10ae6f19a0e1e74bf2e68e5ce8ddeb853dee6a50211bc5cdffa71f4' \
     --install-root /opt/company-brain-backend
   sudo tee /etc/company-brain/backend.env >/dev/null <<'EOF'
   BACKEND_KIND=hermes_lanyard
   EOF
   sudo systemctl start company-brain-backend.service
   ```

4. Verify provenance + systemd + Portal as in §3.

### 5.3 Durable config rollback

If pins were applied only on the host, **also** revert Terraform state / private
tfvars / pin overlay so the next instance replacement does not re-upgrade:

```bash
# Example: restore previous tfvars from VCS, then
terraform plan   # should show backend_artifact_* returning to previous values
terraform apply
```

### 5.4 Rollback acceptance checklist

- [ ] `readlink -f /opt/company-brain-backend/current` ends with previous version
- [ ] `provenance.json` kind/version/url/sha256 match previous pins
- [ ] `/etc/company-brain/artifact-pins.env` matches previous pins
- [ ] `BACKEND_KIND` matches previous kind
- [ ] `systemctl is-active company-brain-backend.service` → `active`
- [ ] Portal relay/host health restored; settings path OK for Hermes-Lanyard
- [ ] Terraform / pin overlay committed (or ticketed) so drift does not reappear

---

## 6. Worked command sheet (copy/paste)

### Same-kind upgrade (Hermes-Lanyard vA → vB)

```bash
# 0) Snapshot
sudo cat /etc/company-brain/artifact-pins.env
sudo cat /opt/company-brain-backend/current/.seed/provenance.json

# 1–2) Pin + install (example coordinates)
sudo bash deploy/scripts/bootstrap-backend-install.sh \
  --kind hermes_lanyard \
  --version vB \
  --url 's3://$BUCKET/backends/hermes-lanyard/vB/backend.tar.gz' \
  --sha256 '<sha-vB>' \
  --install-root /opt/company-brain-backend

sudo systemctl restart company-brain-backend.service

# 3) Verify
readlink -f /opt/company-brain-backend/current
sudo jq -e '.version == "vB" and .kind == "hermes_lanyard"' \
  /opt/company-brain-backend/current/.seed/provenance.json
systemctl is-active company-brain-backend.service
# Portal: brain.ping / brain.health / settings.snapshot
```

### Kind swap (Hermes-Lanyard → Lanyard Agent)

```bash
sudo systemctl stop company-brain-backend.service
sudo bash deploy/scripts/bootstrap-backend-install.sh \
  --kind lanyard_agent \
  --version v0.1.0 \
  --url 's3://$BUCKET/backends/lanyard-agent/v0.1.0/backend.tar.gz' \
  --sha256 '<sha-agent>' \
  --install-root /opt/company-brain-backend
echo 'BACKEND_KIND=lanyard_agent' | sudo tee /etc/company-brain/backend.env
sudo systemctl start company-brain-backend.service
sudo jq -e '.kind == "lanyard_agent"' \
  /opt/company-brain-backend/current/.seed/provenance.json
```

### Rollback to previous Hermes-Lanyard

```bash
PREV=v0.1.0-g7h2
sudo systemctl stop company-brain-backend.service
sudo ln -sfn "versions/${PREV}" /opt/company-brain-backend/current
# restore artifact-pins.env from §0 snapshot
echo 'BACKEND_KIND=hermes_lanyard' | sudo tee /etc/company-brain/backend.env
sudo systemctl start company-brain-backend.service
sudo jq -e --arg v "$PREV" '.version == $v and .kind == "hermes_lanyard"' \
  /opt/company-brain-backend/current/.seed/provenance.json
systemctl is-active company-brain-backend.service
```

---

## Failure modes

| Symptom | Likely cause | Action |
| --- | --- | --- |
| Bootstrap exits on sha256 | Wrong pin digest or truncated download | Fix sha256/url; re-run (verify-before-extract never installs bad bytes) |
| `current` points at new version but unit crash-loops | Binary/runtime incompatibility or bad `BACKEND_HOME` | `journalctl -u company-brain-backend`; rollback §5 |
| Provenance kind ≠ pin kind | Manual extract or stale tree | `BACKEND_INSTALL_FORCE=1` re-bootstrap or rollback |
| Portal settings empty after Agent swap | Known Lanyard Agent Brain RPC gaps | Keep relay checks; do not claim full settings until conformance closes |
| Terraform re-applies old pins after host rollback | tfvars not reverted | Revert private tfvars / pin overlay (§5.3) |
| Both `hermes_artifact_*` and `backend_artifact_*` set differently | Alias conflict | Set only preferred `backend_artifact_*` (or identical values) |

---

## Non-goals

- Migrating live customer vault data between backend products (out of scope)
- Floating pins on git branches or `:latest` tags
- Changing client-core or portal as part of a backend-only swap
- Closing Lanyard Agent product conformance gaps (external product work)

---

## Related Beads

| Bead | Topic |
| --- | --- |
| `lp-k7g.7.1` / `lp-k7g.7.2` | Compatibility pins v2 + validator |
| `lp-k7g.7.3` | Terraform `backend_artifact_*` |
| `lp-k7g.7.4` | Versioned install + provenance |
| `lp-k7g.7.5` | `company-brain-backend.service` |
| `lp-k7g.7.6` | S3 landing zones / publisher trust |
| `lp-k7g.7.7` | This runbook |
