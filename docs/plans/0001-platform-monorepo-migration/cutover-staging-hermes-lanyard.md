# Cutover: stage Hermes-Lanyard backend pins — offline prep (`lp-k7g.12.5`)

Back to [phase 8](phase-8-cutover.md) · [staging runbook](../../runbooks/staging-hermes-lanyard-backend-pins.md) · [upgrade/rollback](../../runbooks/backend-upgrade-rollback.md).

## Goal

Prepare and document **staging** of a tenant backend with **generic** monorepo
pins selecting **Hermes-Lanyard** (`backend.kind: hermes_lanyard` /
`BACKEND_ARTIFACT_KIND=hermes_lanyard` / `backend_artifact_kind`).

This bead’s **live** acceptance (EC2 install, Portal E2E, live rollback capture)
requires cloud access and **human approval**. This document records what was
completed **offline** and what remains **pending**.

**Ready for review:** `partial` (offline prep complete; live EC2 not executed).

## Acceptance criteria status

| Criterion | Status | Evidence |
| --- | --- | --- |
| EC2 installs backend through generic pipeline | **Pending (live)** | Offline: pin fragment + `smoke-bootstrap-backend-install` + `smoke-bootstrap-inject` dual-write `BACKEND_*`; live apply **not run** (policy) |
| Portal settings, vault, projects, and chat work | **Pending (live)** | Offline: HL conformance fixture / Brain RPC examples; live Portal+host **not run** |
| Rollback pins are recorded | **Partial** | Capture **template** + checklist committed; **live host capture file not recorded** (no host) |

## Deliverables landed (this session)

| Deliverable | Path |
| --- | --- |
| Staging runbook (exact HL + `BACKEND_*` commands) | [`docs/runbooks/staging-hermes-lanyard-backend-pins.md`](../../runbooks/staging-hermes-lanyard-backend-pins.md) |
| schema_version 2 pin document (`hermes_lanyard`) | [`compatibility/pins.hermes-lanyard-staging.example.yaml`](../../../compatibility/pins.hermes-lanyard-staging.example.yaml) |
| Host `artifact-pins.env` fragment | [`deploy/examples/staging-hermes-lanyard/artifact-pins.env.fragment`](../../../deploy/examples/staging-hermes-lanyard/artifact-pins.env.fragment) |
| Tenant `backend_artifact_*` tfvars fragment | [`deploy/examples/staging-hermes-lanyard/tfvars.backend.fragment.hcl`](../../../deploy/examples/staging-hermes-lanyard/tfvars.backend.fragment.hcl) |
| Rollback pin capture template | [`deploy/examples/staging-hermes-lanyard/rollback-pin-capture.template.sh`](../../../deploy/examples/staging-hermes-lanyard/rollback-pin-capture.template.sh) |
| Example index | [`deploy/examples/staging-hermes-lanyard/README.md`](../../../deploy/examples/staging-hermes-lanyard/README.md) |
| Provenance schema + example (existing) | [`deploy/schemas/backend-install-provenance.schema.json`](../../../deploy/schemas/backend-install-provenance.schema.json), [`deploy/examples/backend-install-provenance.example.json`](../../../deploy/examples/backend-install-provenance.example.json) |

Pin coordinates: private product releases (`v0.1.0-g7h3` Hermes-Lanyard,
`v0.1.0-g7c2` client-core) translated to schema_version 2 from
[`deploy/compatibility/pins.real-releases.yaml`](../../../deploy/compatibility/pins.real-releases.yaml)
per [`compatibility/translation-v1-to-v2.md`](../../../compatibility/translation-v1-to-v2.md).
No tokens committed.

## Offline dry-run evidence

Commands re-run from monorepo root on branch
`beads/lp-k7g.12.5-stage-hermes-lanyard-pins` (no network required except where
noted):

```bash
python3 scripts/validate-compatibility-pins.py \
  compatibility/pins.hermes-lanyard-staging.example.yaml

python3 scripts/validate-compatibility-pins.py

bash deploy/scripts/smoke-bootstrap-backend-install.sh
bash deploy/scripts/smoke-bootstrap-inject.sh
bash deploy/scripts/smoke-backend-systemd-unit.sh

# Provenance example has required fields + kind=hermes_lanyard
python3 -c "
import json
from pathlib import Path
schema=json.loads(Path('deploy/schemas/backend-install-provenance.schema.json').read_text())
ex=json.loads(Path('deploy/examples/backend-install-provenance.example.json').read_text())
assert all(k in ex for k in schema['required'])
assert ex['kind']=='hermes_lanyard'
print('provenance schema+example OK')
"

bash scripts/validate.sh
```

| Check | Result |
| --- | --- |
| Staging HL pin YAML validates (schema_version 2, `kind=hermes_lanyard`) | **PASS** (run at cutover) |
| Default pins.example.yaml + negative policy suite | **PASS** |
| `smoke-bootstrap-backend-install` (verify → extract → `versions/` → `current` → provenance) | **PASS** |
| `smoke-bootstrap-inject` (user_data dual-write `BACKEND_*` + temporary `HERMES_*`) | **PASS** |
| `smoke-backend-systemd-unit` (`BACKEND_KIND`, `BACKEND_HOME`, ExecStart contract) | **PASS** |
| Provenance schema required keys on example (`kind=hermes_lanyard`) | **PASS** |
| `bash scripts/validate.sh` full offline gate | **PASS** (recorded at commit time) |

### Pin fragment summary (generic path)

| Layer | Key / field | Staging value |
| --- | --- | --- |
| YAML | `backend.kind` | `hermes_lanyard` |
| YAML | `backend.version` | `v0.1.0-g7h3` |
| env | `BACKEND_ARTIFACT_KIND` | `hermes_lanyard` |
| env | `BACKEND_ARTIFACT_VERSION` | `v0.1.0-g7h3` |
| tfvars | `backend_artifact_kind` | `hermes_lanyard` |
| dual-write | `HERMES_ARTIFACT_*` | same URL/version/sha as `BACKEND_*` (temporary) |
| install | `BACKEND_INSTALL_PATH` | `/opt/company-brain-backend` |
| contract | runtime_layout / relay / brain_rpc | `1` / `1` / `1` |

### Rollback capture template fields

The template script emits (for operators to store off-host):

- Full `artifact-pins.env` (`BACKEND_*` / dual-write `HERMES_*` / `CLIENT_CORE_*`)
- `backend.env` (`BACKEND_KIND`)
- `current` symlink + resolved path
- Active `provenance.json` (or legacy `/opt/hermes-lanyard/.seed/provenance.env`)
- Installed `versions/` listing
- systemd active state for `company-brain-backend` / `hermes-gateway`
- Operator checklist table (kind, version, url, sha256, contract, pin revision)

**Live capture:** not executed — no staging host in this session.

## Live staging blockers

| Blocker | Detail |
| --- | --- |
| **Human apply approval** | Orchestrator forbids `terraform apply` / EC2 changes without approval |
| **AWS staging credentials** | No operator SSO/role into platform-staging or tenant staging in this session |
| **Artifact download credentials** | Private GitHub pins need `GITHUB_TOKEN`/`GH_TOKEN` via SSM (or S3 instance role after mirror) |
| **Connected Portal staging** | Settings/vault/projects/chat need platform-staging Portal + relay-connected host |
| **ECR Portal image pins** | Pin example still uses placeholder ECR repositories for service images (local digests from product build) |
| **Secrets / readiness** | Staging secrets checklist + readiness matrix G* still operator-owned |

See runbook § “Live staging blockers” for unblock actions.

## Commands for the live session (after approval)

```bash
# Offline re-check
python3 scripts/validate-compatibility-pins.py \
  compatibility/pins.hermes-lanyard-staging.example.yaml
bash deploy/scripts/smoke-bootstrap-backend-install.sh

# On approved staging host — capture first
sudo bash deploy/examples/staging-hermes-lanyard/rollback-pin-capture.template.sh \
  | tee "rollback-pins-$(hostname)-$(date -u +%Y%m%dT%H%M%SZ).txt"

# Then plan/apply + bootstrap per:
#   docs/runbooks/staging-hermes-lanyard-backend-pins.md §§1–3
```

## Related Beads

| Bead | Topic |
| --- | --- |
| `lp-k7g.12.4` | CI/release pin emission (prerequisite) — **closed** |
| `lp-k7g.12.5` | This work — offline prep **partial** |
| `lp-k7g.12.6` | Stage Lanyard Agent pins (after product conformance) |
| `lp-k7g.7.3`–`7.7` | Generic `backend_artifact_*`, bootstrap, systemd, upgrade runbook |
| `lp-k7g.11.4` | Hermes-Lanyard offline conformance job |
