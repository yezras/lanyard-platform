# Runbook: Golden AMI and bootstrap supply chain

**Status:** Production supply-chain posture  
**Beads:** cbd-zzx.16  
**Related:** `modules/company-brain-ec2/user_data.sh.tftpl`, `scripts/bootstrap-host.sh`, `artifacts/README.md`

---

## Goals

1. **Pin** the host OS image in production (`ami_id`) — no silent “latest AL2023” drift.
2. **Reduce first-boot package sprawl** from the public internet (`use_golden_ami = true`).
3. Keep the **artifact bootstrap contract** (URL + version + SHA-256) for Hermes + client-core.
4. Define **patch**, **inventory/SBOM**, and **ownership** so security reviews are repeatable.

---

## Production path (required defaults)

| Control | Setting |
|---------|---------|
| Pinned AMI | `ami_id = "ami-…"` (module requires when `network_mode=production` unless `require_pinned_ami=false`) |
| Golden packages | `use_golden_ami = true` skips broad `dnf install` in user_data |
| Bootstrap | Still injects `bootstrap_script_b64` → `/usr/local/sbin/company-brain-bootstrap` |
| Artifact pins | Unchanged contract under `/etc/company-brain/artifact-pins.env` |

```hcl
network_mode     = "production"
ami_id           = "ami-REPLACE_ME" # golden/hardened AMI in the target account/region
use_golden_ami   = true
# require_pinned_ami = null  # defaults true in production
```

Lab may leave `ami_id = null` (latest Amazon Linux 2023 lookup) and `use_golden_ami = false` for convenience.

---

## What user_data does

| Mode | Packages | Always |
|------|----------|--------|
| `use_golden_ami = false` (lab default) | `dnf update` + git/golang/nodejs/npm/awscli/sqlite/… + dnf-automatic | timezone, pins, bootstrap inject, MOTD |
| `use_golden_ami = true` | **No** broad dnf installs; warns if `aws` CLI missing | timezone, pins, bootstrap inject, MOTD |

Bootstrap still downloads **pinned** Hermes + client-core artifacts and verifies SHA-256. That path is independent of OS package installs.

---

## Building a golden AMI (operator outline)

1. Start from a trusted baseline (Amazon Linux 2023 or hardened CIS-equivalent).
2. Prebake required packages (minimum useful set):
   - `awscli`, `unzip`, `tar`, `rsync`
   - runtime deps for Hermes/client-core as documented per release (often node/python — pin versions)
   - SSM agent (retain AL2023 default)
3. Apply OS patches; reboot; clear machine identity (cloud-init clean) before imaging.
4. Register AMI in the **target account/region**; record AMI ID + source commit/build job.
5. Optionally export package inventory (below) and store next to the AMI pin in the private deploy tree.
6. Set `ami_id` + `use_golden_ami = true` in tenant tfvars (private; not live secrets).

Do **not** bake customer vault content, relay secrets, or live tfvars into the AMI.

---

## Controlled repositories

If residual package installs are required at boot or patch time:

| Prefer | Avoid |
|--------|--------|
| Internal mirror / Satellite / CodeArtifact-style repo with TLS | Unauthenticated third-party repos |
| Account-allowed AL2023 repos via VPC endpoints / approved NAT | Ad-hoc `curl \| bash` installers |
| Version pins in golden AMI build | Floating `latest` node/npm from random mirrors under open egress |

With **controlled egress**, public dnf mirrors may be unreachable — golden AMI + AMI refresh is the primary patch path.

---

## Patch policy

| Layer | Cadence (recommended) | Owner |
|-------|----------------------|--------|
| **OS / AMI** | Rebuild or patch golden AMI on a fixed cadence (e.g. monthly) and on critical CVEs; roll `ami_id` via Terraform change with change ticket | Platform / security + tenant operator |
| **dnf-automatic** | Lab images may enable unattended security updates; **golden production** may disable auto-mutate in favor of AMI refresh for reproducibility | Same |
| **Hermes + client-core** | Immutable artifact pins (URL + version + SHA-256); upgrade via bootstrap / upgrade-rollback runbook | Product + tenant operator |
| **Host tools** | Only from controlled repos or next golden AMI | Platform |

Security ownership: production AMI ID changes require review against this runbook and `references/runbooks/upgrade-rollback.md` for runtime artifacts.

---

## Inventory / SBOM approach

### Host packages

On a golden AMI builder or a representative host:

```bash
# Amazon Linux / rpm inventory (example)
rpm -qa --qf '%{NAME}\t%{VERSION}-%{RELEASE}\t%{ARCH}\n' | sort > host-rpm-inventory.txt
# Optional: feed into org SBOM tooling (Syft, etc.) — store outputs outside customer vault git
```

Retain inventory **with the AMI pin** in the private operator tree (not customer vault markdown in Core).

### Product artifacts

| Artifact | Inventory signal |
|----------|------------------|
| Hermes tarball | Pin version + SHA-256 in tfvars / `compatibility/` |
| client-core tarball | Pin version + SHA-256; seed provenance under `/opt/company-brain/.seed/` after bootstrap |
| Portal images | Repository + **digest** pins (compatibility manifests) |

SHA-256 pins are the deploy-repo baseline. Signed provenance beyond SHA-256 is tracked separately (epic follow-on).

---

## Alignment with controlled egress

| Without golden AMI | With golden AMI |
|--------------------|-----------------|
| First boot needs HTTPS to package mirrors | First boot needs artifact + relay + model HTTPS (and/or S3/SSM endpoints) |
| Larger supply-chain surface at boot | Surface moved to AMI build pipeline (auditable) |

See `references/runbooks/controlled-egress.md`.

---

## Validation

```bash
bash -n modules/company-brain-ec2/user_data.sh.tftpl  # not always valid; prefer inject smoke
bash scripts/smoke-bootstrap-inject.sh
bash scripts/smoke-controlled-egress.sh

cd modules/company-brain-ec2 && terraform init -backend=false && terraform validate
cd templates/tenant && terraform init -backend=false && terraform validate
```

Confirm `use_golden_ami` branch exists in `user_data.sh.tftpl` and that production preconditions require `ami_id`.

---

## Cross-links

- `artifacts/README.md` — artifact pin contract  
- `references/runbooks/upgrade-rollback.md` — runtime upgrade  
- `references/runbooks/controlled-egress.md`  
- `compatibility/` — product pin manifests  
