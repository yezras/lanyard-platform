# Runbook: Controlled egress for Company Brain Hermes hosts

**Status:** Production network posture  
**Beads:** cbd-zzx.3  
**Related modules:** `modules/company-brain-ec2/`

---

## Problem addressed

Unrestricted security-group egress (`protocol = "-1"` to `0.0.0.0/0`) allows any outbound protocol and simplifies data exfiltration. Production must not ship that default.

---

## Default postures

| `network_mode` | Default `egress_mode` | Behavior |
|----------------|----------------------|----------|
| **production** | **controlled** | Port-restricted: TCP/443, DNS 53 tcp/udp, NTP 123/udp (+ optional extra rules). **Never** all-protocol open. |
| **lab** | **open** | All protocols to `0.0.0.0/0` for quick non-prod bring-up (explicit, documented). |

Production **rejects** `egress_mode = "open"` at plan time.

---

## Production controlled rules

Module variables (defaults shown):

```hcl
egress_mode                  = null # → controlled when network_mode=production
egress_https_cidrs           = ["0.0.0.0/0"] # TCP/443 destinations (SaaS practicality)
egress_https_prefix_list_ids = []
egress_dns_cidrs             = ["0.0.0.0/0"]
egress_ntp_cidrs             = ["0.0.0.0/0"]
extra_egress_rules           = []
```

### What remains open vs closed

| Allowed by default (controlled) | Not allowed |
|---------------------------------|-------------|
| HTTPS / WSS (TCP 443) to configured CIDRs/prefix lists | Arbitrary TCP/UDP ports (e.g. 25, 445, 3306) |
| DNS (53) and NTP (123) to configured CIDRs | `protocol = "-1"` to the world |
| Traffic via VPC endpoints (S3/SSM/Logs/KMS/STS) on the AWS network | Unrestricted all-protocol exfil |

**Important:** TCP/443 to `0.0.0.0/0` still permits HTTPS to arbitrary hosts. That is intentional pragmatism for multi-vendor model/relay endpoints whose IPs change. It is **not** a full domain allowlist. For host-level / domain allowlisting, use Network Firewall or an egress proxy (below).

### Tighten HTTPS destinations

When destinations are known (customer proxy, fixed relay prefixes, managed prefix lists):

```hcl
egress_https_cidrs = [
  # Documentation placeholders only — replace with real prefixes in private tfvars
  "203.0.113.0/24",
]
# and/or:
egress_https_prefix_list_ids = ["pl-REPLACE_ME"]
```

Empty `egress_https_cidrs` **and** empty prefix lists omit the 443 rule (deny-by-default for HTTPS) — only use when VPC endpoints + proxy cover approved flows.

---

## VPC endpoints (prefer private AWS paths)

```hcl
# S3 artifact fetch without public S3 egress
create_s3_gateway_endpoint            = true
s3_gateway_endpoint_route_table_ids   = ["rtb-REPLACE_ME"] # private RT(s)

# SSM without NAT
create_ssm_vpc_endpoints              = true
ssm_vpc_endpoint_subnet_ids           = ["subnet-REPLACE_ME"]

# Common AWS APIs
create_aws_interface_endpoints        = true
# aws_interface_endpoint_subnet_ids falls back to SSM/subnet_id
```

Approved artifact path: `s3://` pins + gateway endpoint + scoped instance role (hermes/*, client-core/*).

---

## Approved production flows (checklist)

```text
[ ] Artifact download: s3:// via gateway endpoint and/or HTTPS 443 to artifact CDN
[ ] Portal relay: outbound WSS (typically 443) to relay_wss_url
[ ] Model providers: HTTPS 443 to approved endpoints (CIDR/prefix list or firewall domain list)
[ ] DNS + time sync: 53 / 123 or VPC resolver + internal NTP
[ ] SSM: endpoints or NAT so Session Manager works
[ ] Optional Tailscale: DERP/control over TCP 443; UDP 41641 only if explicitly enabled
[ ] No production use of egress_mode=open
[ ] Per-client processor policy filled (references/templates/client-data-handling-policy.md)
[ ] approved_processor_ids ⊆ references/approved-data-processors.md catalog
[ ] Firewall/proxy domains match processor_egress_domains / client policy (not “any HTTPS”)
```

**Processor catalog and data categories:** `references/approved-data-processors.md`  
**Per-client policy template:** `references/templates/client-data-handling-policy.md`  
**New processor security review:** `references/runbooks/data-processor-onboarding.md`

---

## Policy → technical controls (mapping)

Per-client **data-handling policy** selects catalog processor IDs and destinations. Map them onto deploy controls as follows:

| Policy element | Technical control | Where set |
|----------------|-------------------|-----------|
| Production posture | `network_mode=production`, `egress_mode=controlled` (or null) | tenant tfvars → `modules/company-brain-ec2` |
| Port floor (deny non-443/DNS/NTP) | Controlled SG rules | EC2 module (default production) |
| Named HTTPS destinations | Network Firewall / egress proxy FQDN allowlist | Account/network team; document in `processor_egress_domains` + private policy |
| Stable SaaS/proxy CIDRs | `egress_https_cidrs`, `egress_https_prefix_list_ids` | tenant → EC2 module |
| Corporate proxy non-443 | `extra_egress_rules` | tenant → EC2 module (rare) |
| Artifact S3 (no public S3) | `create_s3_gateway_endpoint` + route tables + scoped `artifact_s3_*` IAM | tenant → EC2 module |
| SSM / Logs / KMS / STS private | `create_ssm_vpc_endpoints`, `create_aws_interface_endpoints` | tenant → EC2 module |
| Portal relay only | `relay_wss_url` (wss/https); processor `lanyard-portal-relay` | tenant + customer-gateway-relay |
| Model / email / CRM approval | `approved_processor_ids` + packs/email vars ⊆ policy | tenant template (docs + optional fail-closed) |
| Fail-closed policy present | `production_intent` + `require_data_handling_policy` | tenant check blocks |
| Golden AMI (reduce package egress) | `ami_id`, `use_golden_ami` | tenant → EC2 module |
| New destination | Security review runbook before production | `data-processor-onboarding.md` |

**Important:** `approved_processor_ids` and `processor_egress_domains` are **operator contracts** for checklists and firewall handoff. They do **not** by themselves rewrite SG rules. Domain deny-by-default requires Network Firewall or a proxy on the egress path.

Suggested tenant wiring (documentation placeholders only):

```hcl
approved_processor_ids = [
  "lanyard-portal-relay",
  "aws-s3-artifacts",
  "aws-ssm",
  "aws-logs-kms-sts",
  "dns-resolver",
  "ntp-time",
  "model-anthropic",
]
processor_egress_domains = [
  "relay.example.com",       # from private policy — not live customer data in git
  "api.model.example",
]
data_handling_policy_ref     = "ticket-or-private-path-REPLACE"
require_data_handling_policy = true # with production_intent
```

---

## Tailscale (optional secondary access)

Tailscale is **optional** (`enable_tailscale = false` by default). Operator doctrine: **SSM primary**, Tailscale secondary, public SSH closed. Full ACL/enrollment procedure: `references/runbooks/tailscale-operator-access.md`.

| Mode | Egress needed | Module flag |
|------|---------------|-------------|
| **DERP / control plane** (default) | TCP **443** (+ DNS) already covered by controlled HTTPS | no extra SG rule |
| **Direct WireGuard** | UDP **41641** to peers | `tailscale_allow_direct_udp = true` adds controlled UDP/41641 egress |
| **Package install** | TCP 443 to Tailscale package/control endpoints | same HTTPS path; or prebake on golden AMI |

**Tradeoffs:** DERP-only minimizes protocol surface (fits locked-down controlled egress). Direct UDP improves latency but widens outbound UDP. Prefer DERP unless operators document a need for direct paths. Do **not** switch `egress_mode` to `open` just to “make Tailscale work.”

---

## Advanced: Network Firewall / egress proxy

When policy requires **blocking arbitrary HTTPS hosts** while allowing named destinations:

1. Deploy **AWS Network Firewall** (or corporate forward proxy) on the egress path of the private subnet.
2. Domain / FQDN allowlist **must** match the client policy and tenant `processor_egress_domains`. Category examples (operators fill real names in private runbooks):
   - Lanyard portal relay hostname(s) — catalog `lanyard-portal-relay`
   - Model provider API hostnames — catalog `model-*`
   - Email/CRM API hostnames — catalog `email-*` / `crm-*` / pack tools
   - Package/update mirrors **only if** golden AMI path is not used — `os-package-mirrors`
   - Artifact HTTPS endpoints if not using S3 gateway — prefer `aws-s3-artifacts` + gateway
3. Keep the Hermes SG on **controlled** mode (port restriction) as defense-in-depth; firewall enforces L7/FQDN policy.
4. Document the allowlist owner and change process (ticket + dual control for production). **New FQDNs require** `references/runbooks/data-processor-onboarding.md`.

This module does **not** invent Network Firewall resources per tenant by default (account-level design). Wire firewall subnet routing outside or extend carefully with customer-owned modules.

---

## Lab mode

```hcl
network_mode        = "lab"
# egress_mode defaults to open
associate_public_ip = true # optional convenience
```

Do **not** copy lab egress into production tenants.

---

## Offline automated checks

```bash
bash scripts/smoke-controlled-egress.sh
```

The smoke script asserts:

1. Production path cannot use unrestricted all-protocol egress (`egress_mode=open` forbidden with `network_mode=production`).
2. Open egress exists only behind `egress_mode == "open"` dynamic block.
3. Controlled mode uses port-specific rules (443/53/123), not `protocol = "-1"`.
4. Optional fixture: when HTTPS CIDRs omit `0.0.0.0/0`, world-open HTTPS is not forced.

Full live E2E (“curl random host fails; relay succeeds”) requires an AWS account with firewall/prefix policy; capture results in the tenant change ticket.

---

## Cross-links

- `references/approved-data-processors.md` (processor catalog + data categories)  
- `references/templates/client-data-handling-policy.md` (per-client policy template)  
- `references/runbooks/data-processor-onboarding.md` (security review for new destinations)  
- `references/runbooks/ssm-break-glass.md`  
- `references/runbooks/tailscale-operator-access.md` (optional secondary mesh + ACL)  
- `references/runbooks/golden-ami-supply-chain.md` (reduces package-mirror egress)  
- `modules/company-brain-ec2/references/deployment.md`  

