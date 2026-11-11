# Approved data processors (Company Brain data plane)

**Status:** Deploy-owned catalog + policy contract (cbd-zzx.13)  
**Audience:** Operators onboarding tenants; security review for new destinations  
**Related:** `references/templates/client-data-handling-policy.md`, `references/runbooks/controlled-egress.md`, `references/runbooks/data-processor-onboarding.md`

---

## Purpose

Company Brain Hermes hosts send traffic to a small set of **data processors** (third parties and Lanyard platform surfaces). Without a written catalog:

- Controlled egress (ports/CIDRs) is necessary but not sufficient for compliance.
- Model / email / CRM / pack integrations can land customer content in destinations the client never approved.
- Operators cannot map **policy → Terraform** (`egress_*`, VPC endpoints, firewall domains, pack enablement).

This document is the **canonical allowlist of processor categories** for the client data plane. It is not a live customer inventory and must not contain real account IDs, secrets, or vault content.

**Doctrine:** Fail closed for production onboarding when a client requires a filled policy (`require_data_handling_policy` + `production_intent`). Runtime Network Firewall / proxy domain allowlists remain the L7 control; SG controlled egress is the port-level floor.

---

## Data categories (what may leave the host)

| Category ID | Description | Typical sensitivity |
|-------------|-------------|---------------------|
| `vault_content` | Employee vault markdown, files under `/opt/company-brain`, chat context that includes vault excerpts | **High** — customer IP / PII as defined by client |
| `prompt_context` | Model prompts/completions that may embed vault excerpts or tool results | **High** when vault-derived |
| `relay_session` | Portal relay WSS frames (control + tool RPC; may carry vault-derived payloads) | **High** |
| `credentials` | API keys, OAuth tokens, relay secrets, AWS credentials (must not log) | **Critical** — never to model providers as training data |
| `telemetry` | Host metrics, status checks, non-content operational logs | Low–medium |
| `auth_logs` | SSH/SSM session metadata, sudo, backend process logs (no vault dump by default) | Medium |
| `artifacts` | Backend artifact + client-core release tarballs (product code, not customer vault; Hermes-Lanyard is the current reference backend kind) | Low (product IP) |
| `package_metadata` | OS package indexes / updates (prefer golden AMI to avoid) | Low |
| `email_crm` | Mail, calendar, CRM objects accessed via packs (gws, m365, crm, …) | **High** — customer SaaS data |
| `dns_ntp` | Resolver and time sync only | None (metadata) |

Operators record which categories a tenant authorizes per processor in the **per-client policy** template.

---

## Processor catalog

IDs are stable strings for tenant `approved_processor_ids` and policy forms. Hostnames below are **documentation shapes** — fill real FQDNs in private tenant policy / firewall rules, never invent live customer endpoints in git.

### Platform / Lanyard

| ID | Processor | Purpose | Data categories (typical) | Zero-retention / private path | Technical controls |
|----|-----------|---------|---------------------------|-------------------------------|--------------------|
| `lanyard-portal-relay` | Lanyard Portal gateway relay | Egress-only WSS from Hermes to control plane / operator UX | `relay_session`, optionally `vault_content` in tool RPC | Product G2 lifecycle incomplete; treat secrets as break-glass. Prefer dedicated Tier 3 hostname when required. No inbound portal ports on host. | `relay_wss_url` (wss/https only); SG TCP/443; optional firewall domain for relay FQDN |
| `lanyard-control-plane` | Portal control plane (via BFF/relay, not direct public CP) | Instance provision, session orchestration | `relay_session`, instance metadata — **not** bulk vault sync in deploy contract | G1 private boundary **blocked** product-side; deploy does not expose CP on public ALB | No brain-host listener; path-first Portal URL only |
| `aws-s3-artifacts` | Product artifact S3 (backend + client-core prefixes) | Bootstrap download of pinned backend artifacts + client-core | `artifacts` only | Object Lock + versioning on platform bucket; instance role scoped to `backends/*` / dual-write `hermes/*`, `client-core/*` | `s3://` pins; `create_s3_gateway_endpoint`; `artifact_s3_*` IAM |
| `aws-ssm` | AWS Systems Manager | Session Manager operator access; optional parameter read for relay secret | `auth_logs`, `credentials` (GetParameter of relay secret only) | Session logs optional CW group; no vault in SSM by default | `create_ssm_vpc_endpoints`; `enable_ssm_*`; secret Get* IAM scoped |
| `aws-logs-kms-sts` | CloudWatch Logs, KMS, STS | Host log shipping, decrypt CMK volumes, instance creds | `telemetry`, `auth_logs`; KMS ciphertext only | Prefer interface endpoints; tenant log partition prefix | `create_aws_interface_endpoints`; `log_group_prefix`; dedicated CMK |
| `aws-ec2-metadata` | Instance metadata (IMDSv2) | Role credentials, identity | `credentials` (temporary) | IMDSv2 hop limit; no customer processor | Module defaults |

### Model providers

Model traffic often carries **`prompt_context`** that embeds vault excerpts. Production clients should prefer **zero-retention / no-training** contract tiers and document the legal basis in the per-client policy.

| ID | Processor | Purpose | Data categories | Zero-retention / private endpoint | Technical controls |
|----|-----------|---------|-----------------|-----------------------------------|--------------------|
| `model-openai` | OpenAI API (or Azure OpenAI private) | LLM inference | `prompt_context`, may include `vault_content` | Prefer enterprise zero-retention + no-training; Azure OpenAI private endpoints when client requires | HTTPS 443; firewall domain allowlist; optional private link (customer-owned) |
| `model-anthropic` | Anthropic API | LLM inference | same | Prefer commercial zero-data-retention tier where offered | HTTPS 443 + domain allowlist |
| `model-google` | Google AI / Vertex AI | LLM inference | same | Prefer Vertex private Google access / VPC-SC when required | HTTPS 443; private Google access optional |
| `model-xai` | xAI API | LLM inference | same | Document retention tier in client policy | HTTPS 443 + domain allowlist |
| `model-other` | Other approved model vendor (named in client policy) | LLM inference | same | **Must** complete processor onboarding runbook before production | Explicit domains in private policy; never “any HTTPS” as sole approval |

Do **not** enable a model ID in `approved_processor_ids` unless the client policy names the legal entity, retention tier, and allowed data categories.

### Email / collaboration / CRM (packs)

| ID | Processor | Purpose | Data categories | Packs / vars | Technical controls |
|----|-----------|---------|-----------------|--------------|--------------------|
| `email-google` | Google Workspace APIs | Mail, calendar, drive as enabled | `email_crm`, may seed `prompt_context` | `email_provider = "google"`; pack `gws` | OAuth tokens on host secrets path; HTTPS domains in firewall |
| `email-m365` | Microsoft 365 / Graph | Mail, calendar, files as enabled | `email_crm`, may seed `prompt_context` | `email_provider = "m365"` | same |
| `crm-hubspot` | HubSpot (or client CRM) | CRM read/write via pack | `email_crm` | pack `crm` (when used) | Domain allowlist; least-privilege OAuth |
| `collab-whatsapp` | WhatsApp / WACLI bridge (if enabled) | Messaging integration | `email_crm` / chat | pack `wacli` | Domain allowlist; DLP on outbound content |
| `collab-granola` | Granola (meeting notes) | Notes ingest | may include PII | pack `granola` | Domain allowlist |
| `tool-excel-author` | Excel authoring tooling destinations | Spreadsheet generation APIs if any | low–medium | pack `excel-author` | Document if any egress beyond local |
| `tool-focr` | OCR / document extract services | Document text extraction | may include `vault_content` | pack `focr` | Prefer local models; remote OCR needs onboarding |
| `tool-self-improve` | Self-improve pack destinations | Optional learning/telemetry | policy-dependent | pack `self-improve` | **Default deny** for production unless policy allows |

### OS / package / update path

| ID | Processor | Purpose | Data categories | Notes | Technical controls |
|----|-----------|---------|-----------------|-------|--------------------|
| `os-package-mirrors` | Distro package mirrors | `dnf`/security updates | `package_metadata` | Prefer **golden AMI** so runtime package egress is rare | `use_golden_ami = true`; pin `ami_id`; see golden-ami runbook |
| `dns-resolver` | VPC DNS / approved resolvers | Name resolution | `dns_ntp` | Required | `egress_dns_cidrs` or VPC resolver |
| `ntp-time` | Approved NTP | Clock sync | `dns_ntp` | Required | `egress_ntp_cidrs` or internal NTP |

### Explicitly out of catalog (default deny)

| Destination class | Why denied by default |
|-------------------|------------------------|
| Arbitrary public HTTPS hosts | Exfiltration path; only approved FQDNs via firewall/proxy |
| Unauthenticated pastebins / personal cloud | No DPA / retention control |
| Consumer AI free tiers with training-on-inputs | Conflicts with vault confidentiality |
| Inbound portal / control-plane listeners on brain host | Violates egress-only relay doctrine |
| Public S3 / anonymous upload endpoints | Artifact path is pin + role scoped only |
| SMTP (25) / SMB / DB ports to internet | Controlled egress omits non-443 protocols |

---

## Mapping: catalog ID → technical controls (summary)

| Control surface | How processors feed it |
|-----------------|------------------------|
| **SG controlled egress** | All production hosts: `egress_mode=controlled` (or null→controlled). Port floor only — not a domain allowlist. |
| **`egress_https_cidrs` / prefix lists** | Optional CIDR tighten when destinations have stable prefixes (proxy, fixed SaaS ranges). |
| **`extra_egress_rules`** | Rare non-443 corporate proxy ports only when policy allows. |
| **VPC endpoints** | `aws-s3-artifacts`, `aws-ssm`, `aws-logs-kms-sts` → `create_s3_gateway_endpoint`, `create_ssm_vpc_endpoints`, `create_aws_interface_endpoints`. |
| **Network Firewall / egress proxy domains** | Every model, portal relay, email/CRM FQDN listed in client policy § Allowed destinations. |
| **Tenant `approved_processor_ids`** | Subset of catalog IDs selected for that client (documentation + optional fail-closed checklist). |
| **`email_provider` / `enable_packs`** | Must be subset of processors approved for email/CRM/tool IDs; do not enable packs without policy. |
| **Artifact pins + S3 IAM** | Only `aws-s3-artifacts` (or HTTPS artifact CDN if separately onboarded). |
| **`relay_wss_url`** | Only `lanyard-portal-relay` (shared or Tier 3 hostname from provision). |
| **Omnibox Mode A egress allowlist** | Runtime L7 fragment for agent tool children under `run-under-omnibox` (not SG rewrite). See below. |

Detailed variable mapping: `references/runbooks/controlled-egress.md` § Policy → technical controls.

### Omnibox Mode A consumer (egress render)

**Script:** `scripts/omnibox/render-egress-allowlist.sh`  
**Static host shapes:** `scripts/omnibox/processor-hosts.static.list` (public docs only; no customer FQDNs, no keys)  
**Host output (generated, not git):** `/etc/company-brain/omnibox/runtime/egress.yaml`

Operators (or ensure/bootstrap later phases) render allowlisted **hostnames** from:

1. Catalog IDs in `approved_processor_ids` / `APPROVED_PROCESSOR_IDS` resolved against the static list where a public API host is known.
2. Tenant model / relay hosts from private tfvars or env (`OMNIBOX_MODEL_HOSTS`, `OMNIBOX_RELAY_HOST`, or hostname-only extract from `RELAY_WSS_URL` — **never** tokens or query strings).

The runtime file always re-lists **block** entries for IMDS (`169.254.169.254`), link-local, RFC1918, and loopback. Private/metadata addresses are rejected if supplied as allow hosts. API keys stay out of the allowlist and out of git. Wrapper merge of this fragment is phase 2+; this catalog note only identifies the consumer.

---

## Production checklist (processors)

```text
[ ] Per-client policy filled from references/templates/client-data-handling-policy.md (private copy)
[ ] approved_processor_ids in tenant tfvars matches policy § Selected processors
[ ] enable_packs / email_provider ⊆ approved email/CRM/tool processors
[ ] Model IDs list retention tier (zero-retention / no-training) where vault-derived prompts are allowed
[ ] Firewall/proxy domain allowlist matches policy destinations (not only 0.0.0.0/0:443)
[ ] S3 artifact path via gateway endpoint + scoped IAM when using s3:// pins
[ ] No processor outside this catalog without completed onboarding runbook
[ ] require_data_handling_policy=true for production_intent tenants that process vault_content off-box
```

---

## Change control

1. **New processor** → `references/runbooks/data-processor-onboarding.md` (security review required).
2. **Catalog edit** in this file (category, purpose, control mapping) — deploy PR; no live customer data.
3. **Per-tenant enablement** — private policy + tfvars `approved_processor_ids`; dual control for production.

**Beads:** cbd-zzx.13  
**Does not claim:** Product G1/G2 production security ready; full L7 enforcement in the EC2 module alone (firewall/proxy is account- or network-team-owned).
