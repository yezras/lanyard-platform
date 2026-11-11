# Runbook: Tailscale optional secondary operator access

**Status:** Production-hardening guidance (optional feature)  
**Beads:** cbd-zzx.4  
**Related modules:** `modules/company-brain-ec2/`

---

## Doctrine (access preference order)

| Preference | Production default |
|------------|--------------------|
| **Primary access** | AWS Systems Manager **Session Manager** (no inbound port 22) |
| **Secondary mesh** | **Optional Tailscale** (this runbook) — convenience / dual-path |
| **SSH** | **Off** (`operator_ssh_cidrs = []`) — MFA time-boxed break-glass only |
| **Public IP** | Never for production (`network_mode = "production"`) |

Tailscale is **never** required for a production-private Company Brain host. SSM + controlled egress + private subnet stand alone. When Tailscale is enabled, **public SSH stays closed**; do not re-open port 22 “because Tailscale exists.”

Portal chat never requires inbound access to the Hermes host (egress-only WSS).

---

## What the module does (`enable_tailscale = true`)

1. Writes **non-secret** config to `/etc/company-brain/tailscale.env` (source, parameter name / secret ARN, tags, hostname).
2. Installs `/usr/local/sbin/company-brain-tailscale-enroll` (from `modules/company-brain-ec2/scripts/tailscale-enroll.sh`).
3. Attaches instance-role IAM to **GetParameter** or **GetSecretValue** on that reference only.
4. Installs `tailscaled` accept-dns drop-in (`accept-dns=false`) so MagicDNS does not break model/API egress.
5. Optionally auto-enrolls on first boot (`tailscale_auto_enroll = true`, default) by fetching the auth key at **runtime** via the instance role.

**Never** place a Tailscale auth key in:

- `terraform.tfvars` / module variables as a secret value  
- EC2 user_data plaintext  
- git, plans committed to git, or MOTD  

Store a **one-time or short-lived** auth key in SSM SecureString or Secrets Manager (same pattern as relay secrets).

---

## 1. Create the auth key outside Terraform

### Recommended key properties (admin console / API)

| Setting | Production recommendation |
|---------|---------------------------|
| Reusable | **No** (one-time) when possible; rotate after use |
| Ephemeral | Usually **No** for always-on Hermes (device should persist) |
| Tags | Pre-authorize only `tag:tenant=<project_name>` and `tag:role=company-brain` |
| Expiry | Short (hours/days), not years |
| Device approval | **On** for production tailnets **or** enable **Tailnet Lock** |

### SSM SecureString (default)

```bash
# Documentation shape only — run in the target account; never commit the key value.
aws ssm put-parameter \
  --name /company-brain/acme-brain/tailscale-auth-key \
  --type SecureString \
  --value 'tskey-auth-…' \
  --overwrite
```

### Secrets Manager

```bash
aws secretsmanager create-secret \
  --name company-brain/acme-brain/tailscale-auth-key \
  --secret-string 'tskey-auth-…'
# or JSON: {"authkey":"tskey-auth-…"}
```

After successful enrollment, **disable/delete** one-time keys (or rotate the parameter) so a compromised disk image cannot re-enroll another node with the same material.

---

## 2. Terraform (module / tenant)

```hcl
enable_tailscale                    = true
tailscale_auth_secret_source        = "ssm" # or "secretsmanager"
tailscale_auth_secret_ssm_parameter = "/company-brain/acme-brain/tailscale-auth-key"
# tailscale_auth_secret_secretsmanager_arn = "arn:aws:secretsmanager:…"

# Optional overrides (defaults shown):
# tailscale_tags            = []  # → tag:tenant=<project_name>, tag:role=company-brain
# tailscale_hostname        = null  # → <project_name>-hermes
# tailscale_auto_enroll     = true
# tailscale_ssh             = false  # prefer SSM shell
# tailscale_allow_direct_udp = false # DERP over TCP/443; see §4

# Keep primary + SSH doctrine:
enable_ssm_access  = true
operator_ssh_cidrs = []
# ssh_key_name     = null
```

Standalone module path: `modules/company-brain-ec2/terraform.tfvars.example`.  
Tenant template: set the same variables on `module.company_brain` (see `templates/tenant/`).

### Manual re-enroll (SSM session)

```bash
aws ssm start-session --target <instance-id> --region <region>
sudo /usr/local/sbin/company-brain-tailscale-enroll
# or after copying setup helpers:
# sudo ENABLE_TAILSCALE=1 ./setup.sh
```

```bash
terraform output -json tailscale_config
terraform output -raw tailscale_enroll_command
```

---

## 3. Tailnet ACL: default-deny, no cross-tenant

Production tailnets **must** enforce isolation. Example ACL shape (operators adapt to their Tailscale policy file; placeholders only):

```json
{
  "tagOwners": {
    "tag:tenant-acme-brain": ["group:lanyard-ops"],
    "tag:role-company-brain": ["group:lanyard-ops"],
    "tag:operator": ["group:lanyard-ops"]
  },
  "acls": [
    {
      "action": "accept",
      "src": ["group:lanyard-ops", "tag:operator"],
      "dst": ["tag:tenant-acme-brain:22", "tag:tenant-acme-brain:443"]
    }
  ],
  "ssh": [
    {
      "action": "check",
      "src": ["group:lanyard-ops"],
      "dst": ["tag:tenant-acme-brain"],
      "users": ["ec2-user", "autogroup:nonroot"]
    }
  ]
}
```

### Required policy properties

```text
[ ] Default deny — no "src: *, dst: *" production grants
[ ] No tenant-to-tenant: devices tagged tag:tenant=A must not reach tag:tenant=B
[ ] Operators reach a single tenant tag (or explicit host) only
[ ] Prefer tag-based grants over IP-based; avoid autogroup:member → all tags
[ ] Separate tags per project_name / tenant_slug
[ ] Device authorization: require admin approval for new nodes OR enable Tailnet Lock
[ ] Log / audit Tailscale admin actions under change control
```

Module default advertise tags:

- `tag:tenant=<project_name>` (e.g. `tag:tenant=acme-brain`)
- `tag:role=company-brain`

Tailscale requires tags to exist in ACL `tagOwners` before a node can advertise them. Create matching tag owners before enrollment.

---

## 4. Controlled egress tradeoffs (UDP 41641 vs DERP 443)

| Path | Ports | Module behavior | Notes |
|------|-------|-----------------|-------|
| **DERP relay** | TCP **443** (and DNS) | Works with default **controlled** HTTPS egress | Slightly higher latency; fewest SG holes |
| **Direct WireGuard** | UDP **41641** | Only if `tailscale_allow_direct_udp = true` | Better latency; wider UDP allow; still no inbound required for client→node mesh in many setups |
| **Coordination / install** | TCP **443** to Tailscale control + package endpoints | Needs controlled HTTPS (or golden AMI with package prebaked) | Install script hits `pkgs.tailscale.com` / `tailscale.com` |

**Production recommendation:** keep `tailscale_allow_direct_udp = false` unless operators need direct peer performance and accept UDP/41641 egress in the SG. Prefer Network Firewall / proxy allowlists for Tailscale control-plane hostnames when policy requires FQDN restriction.

See also `references/runbooks/controlled-egress.md` § Tailscale.

---

## 5. Device approval and Tailnet Lock

Production must use **at least one** of:

1. **Device approval** — new nodes stay unauthorized until an admin approves them in the admin console (or API).  
2. **Tailnet Lock** — cryptographic continuity so unauthorized coordination-plane changes cannot silently add trusted nodes.

Document which control the tailnet uses in the tenant change ticket. Do not treat a long-lived reusable auth key without approval as production-safe.

---

## 6. Relationship to SSM and SSH

```text
                    ┌────────────────────────┐
 Operator           │  Preference order       │
                    ├────────────────────────┤
                    │ 1. SSM Session Manager  │  ← primary break-glass
                    │ 2. Tailscale (optional) │  ← secondary mesh
                    │ 3. SSH /32 (exception)  │  ← MFA time-boxed only
                    └────────────────────────┘
```

- Enabling Tailscale **does not** open security-group SSH.  
- Disabling Tailscale **does not** break production access if SSM endpoints/NAT remain healthy.  
- If both SSM and Tailscale fail, follow `references/runbooks/ssm-break-glass.md` § temporary SSH.

---

## 7. Validation checklist

```text
[ ] enable_tailscale defaults false — hosts without Tailscale still plan/apply
[ ] Auth key only in SSM/SM; terraform state has parameter name / ARN only
[ ] Instance role GetParameter/GetSecretValue scoped to that reference
[ ] Advertised tags match ACL tagOwners; no cross-tenant ACL grants
[ ] Device approval or Tailnet Lock enabled on the production tailnet
[ ] operator_ssh_cidrs remains []
[ ] enable_ssm_access true (or equivalent external role)
[ ] accept-dns=false (drop-in present; model/API egress still works)
[ ] Controlled egress: DERP via 443, or explicit UDP 41641 if approved
```

Offline:

```bash
bash -n modules/company-brain-ec2/setup.sh
bash -n modules/company-brain-ec2/scripts/tailscale-enroll.sh
(cd modules/company-brain-ec2 && terraform init -backend=false -input=false && terraform validate)
```

---

## Cross-links

- `references/runbooks/ssm-break-glass.md` — primary access + SSH exception  
- `references/runbooks/controlled-egress.md` — port-restricted egress + Tailscale ports  
- `references/runbooks/relay-secret-lifecycle.md` — same SSM/SM secret discipline  
- `modules/company-brain-ec2/references/deployment.md` — host deploy  
- `modules/company-brain-ec2/scripts/tailscale-enroll.sh` — on-host enroll implementation  
