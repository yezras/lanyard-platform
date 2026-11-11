# Client data-handling and egress policy (template)

**Status:** Per-client policy template (cbd-zzx.13)  
**How to use:** Copy this file to a **private** operator location (ticket attachment, customer security folder, or `deployments/<slug>/docs/` that is **not** committed with live secrets). Fill every section marked `REPLACE`. Do not commit customer vault content, live account IDs beyond the agreed AWS boundary, or secrets.

**Catalog:** `references/approved-data-processors.md`  
**Onboarding new destinations:** `references/runbooks/data-processor-onboarding.md`  
**Technical mapping:** `references/runbooks/controlled-egress.md` § Policy → technical controls  
**Tenant vars:** `approved_processor_ids`, `data_handling_policy_ref`, `processor_egress_domains`, `require_data_handling_policy`

---

## 1. Client identity

| Field | Value |
|-------|--------|
| Tenant slug | `REPLACE_TENANT_SLUG` |
| Legal entity / DPA counterparty | `REPLACE` |
| Hosting track | `lanyard_hosted` \| `customer_account` |
| Isolation mode | `account` \| `vpc_interim` \| `customer_account` |
| AWS account ID (boundary) | `REPLACE_12_DIGIT` (private only) |
| Region | `REPLACE` |
| Policy owner (client) | `REPLACE name/email` |
| Policy owner (Lanyard ops) | `REPLACE` |
| Effective date | `YYYY-MM-DD` |
| Review date | `YYYY-MM-DD` (≤ 12 months) |
| Change ticket | `REPLACE` |

---

## 2. Selected processors

List **only** catalog IDs from `references/approved-data-processors.md`. These must match tenant Terraform:

```hcl
approved_processor_ids = [
  # examples — replace with client-approved set
  "lanyard-portal-relay",
  "aws-s3-artifacts",
  "aws-ssm",
  "aws-logs-kms-sts",
  "dns-resolver",
  "ntp-time",
  # "model-anthropic",
  # "email-google",
]
```

| Catalog ID | Approved? (Y/N) | Allowed data categories | Retention / zero-retention requirement | Notes |
|------------|-----------------|-------------------------|----------------------------------------|-------|
| `lanyard-portal-relay` | Y | `relay_session`, … | Product G2 incomplete — document residual risk | WSS FQDN: `REPLACE` |
| `aws-s3-artifacts` | Y | `artifacts` | N/A (product artifacts) | Bucket prefix hermes/, client-core/ |
| `aws-ssm` | Y | `auth_logs`, `credentials` (relay secret only) | Session log TTL: `REPLACE` | |
| `aws-logs-kms-sts` | Y | `telemetry`, `auth_logs` | Log TTL: `REPLACE` days | Partition: `/company-brain/<slug>` |
| `dns-resolver` / `ntp-time` | Y | `dns_ntp` | N/A | |
| `model-…` | | `prompt_context` / `vault_content`? | Zero-retention: Y/N; no-training: Y/N | Contract ref: `REPLACE` |
| `email-…` / `crm-…` | | `email_crm` | SaaS retention per vendor DPA | Packs: `REPLACE` |
| `os-package-mirrors` | N preferred | `package_metadata` | Prefer golden AMI | |

**Packs / email (must ⊆ approved processors):**

```hcl
email_provider = "google" # or "m365" — only if matching email-* processor approved
enable_packs   = []       # e.g. ["gws"] only when email-google (or equivalent) approved
```

---

## 3. Allowed egress destinations

### 3.1 Port-level (security group) — deploy module

| Setting | Required production value | Client override |
|---------|---------------------------|-----------------|
| `network_mode` | `production` | |
| `egress_mode` | `controlled` (or null → controlled) | Never `open` |
| `egress_https_cidrs` | Prefer tightened or proxy CIDRs; default `0.0.0.0/0` is port-only | `REPLACE` |
| `egress_https_prefix_list_ids` | Optional managed lists | `REPLACE` |
| VPC endpoints | S3 gateway + SSM + logs/kms/sts when private | `REPLACE true/false` |

### 3.2 Domain / FQDN allowlist (Network Firewall or egress proxy)

**Mandatory** when client forbids arbitrary HTTPS. Document owner and change process.

| Destination FQDN / pattern | Catalog processor ID | Port | Direction | Justification |
|----------------------------|----------------------|------|-----------|---------------|
| `REPLACE.relay.example` | `lanyard-portal-relay` | 443 | egress | Portal WSS |
| `REPLACE.api.model.example` | `model-…` | 443 | egress | Inference |
| `REPLACE.googleapis.com` (if used) | `email-google` | 443 | egress | Workspace APIs |
| … | | | | |

Tenant documentation vars (non-secret):

```hcl
processor_egress_domains = [
  "relay.example.com",
  "api.model.example",
]
data_handling_policy_ref = "ticket-or-path-REPLACE" # private policy location
```

### 3.3 Private endpoints / zero-retention

| Requirement | Required? (Y/N) | Evidence |
|-------------|-----------------|----------|
| Model provider zero-retention / no-training tier | | Contract / admin console screenshot ref (private) |
| Azure OpenAI / Vertex private endpoint (if selected) | | Private Link ID (private docs) |
| S3 artifact fetch via gateway endpoint (no public S3) | | `create_s3_gateway_endpoint = true` |
| SSM via PrivateLink (no NAT for admin) | | `create_ssm_vpc_endpoints = true` |
| No inbound portal ports on brain host | Y | Module doctrine / SG ingress |

---

## 4. Retention

| Data store | What is stored | TTL / retention | Access | Notes |
|------------|----------------|-----------------|--------|-------|
| Customer vault on EBS | Vault content | Customer-owned lifecycle; DLM snapshots daily | Tenant admins / break-glass | Encrypted; prefer CMK |
| DLM EBS snapshots | Volume backups | `REPLACE` days / count | Ops + client | BPA block-all-sharing |
| CloudWatch host logs | auth/sudo/backend process logs (no vault dump default) | `REPLACE` days | Ops break-glass | `log_group_prefix`; see `references/security-observability.md` |
| VPC Flow Logs | 5-tuples / metadata | `REPLACE` days | Ops | Optional module |
| Portal relay / control-plane logs | Product-owned; may include session metadata | Product policy (G2b **blocked** until defined) | Product + ops | Do not claim production-ready logging while G2b blocked |
| Model provider | Prompts/completions | Per zero-retention contract | Vendor | Forbid training-on-inputs unless client accepts |
| Email/CRM SaaS | Objects in vendor systems | Vendor + client retention schedule | Client IdP | |

---

## 5. DLP and content controls

| Control | Enabled? | Owner | Notes |
|---------|----------|-------|-------|
| No vault content to unapproved model IDs | Y | Ops + Hermes config | |
| Contributor profile path prefixes (no full-vault exfil tools) | Y | `hermes-profile-rbac.md` | |
| Packs disabled unless in policy | Y | `enable_packs` | |
| Outbound email/CRM write requires client approval | | Client | |
| Secrets never in model prompts (keys, relay secret) | Y | Ops | |
| Shared multi-tenant debug buckets for vault dumps | **Forbidden** | | |
| Redaction / classification tooling | Optional | Client | |

---

## 6. Subprocessors and international transfers

| Processor | Processing region(s) | Transfer mechanism (if cross-border) | DPA / SCC ref (private) |
|-----------|----------------------|--------------------------------------|-------------------------|
| `REPLACE` | | | |

---

## 7. Incident and offboarding

| Event | Action |
|-------|--------|
| Suspected exfil to non-approved destination | Follow `security-alert-triage.md`; disable pack/model; tighten firewall |
| Processor offboard | Remove from `approved_processor_ids` + firewall domains; rotate credentials; ticket |
| Tenant offboard | Revoke relay secret (G2 product path when ready); snapshot retention per contract; wipe EBS per runbook |

---

## 8. Sign-off

```text
[ ] Catalog IDs reviewed against approved-data-processors.md
[ ] Terraform approved_processor_ids + packs/email match this policy
[ ] Egress SG controlled; domain allowlist implemented or risk accepted in writing
[ ] Zero-retention / private endpoint requirements evidenced
[ ] Retention + DLP sections complete
[ ] Client security sign-off: _______________ date ________
[ ] Lanyard ops sign-off:     _______________ date ________
```

**Honesty:** Completing this template does **not** clear Portal G1/G2 production security gates. Data-plane processor policy is necessary but not sufficient for production Portal/relay security sign-off (`references/readiness-matrix.md`).
