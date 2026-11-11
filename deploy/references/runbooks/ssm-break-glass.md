# Runbook: SSM Session Manager access and SSH break-glass

**Status:** Production operator procedure  
**Beads:** cbd-zzx.2  
**Related modules:** `modules/company-brain-ec2/`

---

## Doctrine

| Preference | Production default |
|------------|--------------------|
| **Primary access** | AWS Systems Manager **Session Manager** (no inbound port 22) |
| **SSH** | **Off** (`operator_ssh_cidrs = []`, no key pair required) |
| **Public IP** | Never for production (`network_mode = "production"`) |
| **SSH to 0.0.0.0/0** | Forbidden (module validation) |

Portal chat never requires inbound access to the Hermes host (egress-only WSS).

---

## 1. Normal operator access (SSM)

### Prerequisites

1. Instance role has `enable_ssm_access = true` (attaches `AmazonSSMManagedInstanceCore`).
2. Instance can reach SSM control plane:
   - NAT (or other HTTPS egress), **or**
   - VPC interface endpoints: `create_ssm_vpc_endpoints = true` for `ssm`, `ssmmessages`, `ec2messages`.
3. Operator IAM allows `ssm:StartSession` (and related session APIs) on the instance ARN.
4. SSM agent is present (Amazon Linux 2023 AMIs include it; golden AMIs must retain it).

### Connect

```bash
# From terraform output (tenant or module):
terraform output -raw ssm_start_session_command
# Equivalent:
aws ssm start-session --target <instance-id> --region <region>
```

Then run bootstrap on the host:

```bash
sudo /usr/local/sbin/company-brain-bootstrap
```

---

## 2. PrivateLink (no NAT) for Session Manager

When the host is in a private subnet without outbound internet for SSM:

```hcl
create_ssm_vpc_endpoints    = true
ssm_vpc_endpoint_subnet_ids = ["subnet-…"] # or rely on subnet_id
# Ensure VPC DNS hostnames + DNS resolution are enabled (Private DNS on endpoints).
```

Module creates interface endpoints with a dedicated security group allowing HTTPS from the Hermes SG.

---

## 3. Session logging (CloudWatch / S3)

Module can create a CloudWatch log group:

```hcl
enable_ssm_session_log_group         = true
ssm_session_logs_cloudwatch_log_group = "/company-brain/<project>/ssm-sessions" # optional override
# ssm_session_logs_s3_bucket_name    = "example-ssm-session-logs"               # preference only
```

**Operators must also configure** account Session Manager preferences (document `SSM-SessionManagerRunShell` or Console → Systems Manager → Session Manager → Preferences):

- CloudWatch logging → log group name from `terraform output ssm_session_log_group_name`
- Optional S3 logging → existing bucket + prefix; bucket policy must allow the Session Manager logging role
- Prefer encryption with a customer-managed KMS key where policy requires it

Terraform does not overwrite org-wide Session Manager preferences by default (multi-tenant blast radius). Use the module log group + this runbook.

---

## 4. Temporary SSH break-glass (MFA-controlled)

SSH remains available as **exceptional** break-glass when SSM is unavailable (agent failure, endpoint outage, etc.).

### Production process (checklist)

```text
[ ] Incident / change ticket opened with justification and time box
[ ] Approver is not the same person as the implementer (dual control where possible)
[ ] Operator authentication uses MFA (IdP / AWS console / SSO)
[ ] Temporary operator_ssh_cidrs is a single /32 (or smallest feasible) — never 0.0.0.0/0
[ ] ssh_key_name set to an existing key pair; private key handled outside git
[ ] terraform apply for the change window only
[ ] Work completed; operator_ssh_cidrs returned to [] and key_name cleared if unused
[ ] terraform apply to remove port 22 ingress
[ ] Ticket closed with session notes (prefer SSM session logs when available)
```

### Example temporary tfvars (placeholders only)

```hcl
operator_ssh_cidrs = ["203.0.113.10/32"] # operator public IP; RFC 5737 in docs only
ssh_key_name       = "acme-brain-hermes-breakglass"
```

### Security notes

- Module rejects `0.0.0.0/0` in `operator_ssh_cidrs`.
- Non-empty CIDRs without `ssh_key_name` fail plan (no silent half-open SSH).
- Optional **Tailscale** is a **secondary** mesh path only (`enable_tailscale`; auth key from SSM/SM). It does **not** replace SSM as primary break-glass and must not justify re-opening public SSH. See `references/runbooks/tailscale-operator-access.md`.

---

## 5. Validation

```bash
# Offline: production SG has no mandatory SSH; SSM IAM present
grep -n 'create_ssh_ingress\|AmazonSSMManagedInstanceCore\|create_ssm_vpc_endpoints' \
  modules/company-brain-ec2/main.tf

bash scripts/smoke-controlled-egress.sh   # includes access posture checks
```

---

## Cross-links

- `references/runbooks/controlled-egress.md` — production egress without open all-protocol rules  
- `references/runbooks/tailscale-operator-access.md` — optional Tailscale secondary access + ACL  
- `references/runbooks/golden-ami-supply-chain.md` — AMI pins and package path  
- `modules/company-brain-ec2/references/deployment.md` — full host deploy  
- `references/provision-runbook.md` — control plane → Terraform → bootstrap  
