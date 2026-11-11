# Runbook: Onboard a new data processor (security review)

**Status:** Operator procedure (cbd-zzx.13)  
**Audience:** Deploy/ops + security  
**Related:** `references/approved-data-processors.md`, `references/templates/client-data-handling-policy.md`, `references/runbooks/controlled-egress.md`

---

## Rule (fail-closed)

**No new egress destination or SaaS integration that may receive `vault_content`, `prompt_context`, `email_crm`, or `credentials` may be enabled in production without a completed security review** and catalog update (or an explicit time-boxed risk acceptance signed by the client and Lanyard security).

Runtime “it works over 443” is **not** approval. Controlled SG egress still allows arbitrary HTTPS when `egress_https_cidrs = ["0.0.0.0/0"]`; domain allowlists and processor policy close that gap.

---

## When this runbook applies

| Trigger | Example |
|---------|---------|
| New model vendor or endpoint | Switching inference to a new API host |
| New pack / email / CRM integration | Enabling `crm`, `granola`, remote OCR |
| New artifact download origin | HTTPS CDN outside product-artifact S3 |
| New corporate proxy or tool port | Non-443 `extra_egress_rules` |
| Client requests destination not in catalog | Any FQDN outside approved list |

**Does not apply to:** ephemeral lab `network_mode=lab` experiments that never touch production vault data (still document if promoting to production).

---

## Review checklist (copy into ticket)

### A. Identity and purpose

```text
[ ] Processor legal name and product name
[ ] Catalog ID proposal (stable kebab-case, e.g. model-vendorx)
[ ] Purpose (one sentence) and data categories (from catalog table)
[ ] Client(s) requesting enablement; tenant_slug list
[ ] Whether traffic can include vault-derived content (Y/N)
```

### B. Data protection

```text
[ ] DPA / SCC / equivalent executed or client accepts residual risk in writing
[ ] Retention: zero-retention / no-training / default vendor retention (document which)
[ ] Training-on-customer-inputs: forbidden unless client explicitly accepts
[ ] Subprocessors and processing regions listed
[ ] Encryption in transit (TLS 1.2+) and at rest (vendor)
[ ] Credential handling: where API keys live (host secret path / SSM — never git)
```

### C. Technical controls

```text
[ ] Exact FQDNs / URL patterns for Network Firewall or egress proxy
[ ] Ports/protocols (prefer 443 only)
[ ] Private endpoint option evaluated (PrivateLink, VPC-SC, etc.)
[ ] SG impact: controlled egress sufficient vs extra_egress_rules needed
[ ] VPC endpoint impact: none vs new AWS service endpoint
[ ] IAM impact: new instance-role permissions? (default deny)
[ ] Pack / email_provider / Hermes config changes documented
[ ] Logging: will vendor or host logs contain vault content? mitigation?
```

### D. Catalog and tenant wiring

```text
[ ] PR updates references/approved-data-processors.md (purpose, categories, controls)
[ ] Per-client policy updated for each affected tenant (private copy of template)
[ ] Tenant tfvars: approved_processor_ids includes new ID
[ ] processor_egress_domains updated (documentation for firewall team)
[ ] enable_packs / email_provider only if pack-backed
[ ] Firewall/proxy change merged and verified before production cutover
[ ] Rollback: remove ID + domains + rotate credentials
```

### E. Dual control and sign-off

```text
[ ] Security reviewer: _______________ date ________
[ ] Deploy/ops implementer: _______________ date ________
[ ] Client approver (if customer_account or vault leaves boundary): _______________
[ ] Production change ticket linked
```

---

## Implementation sequence

1. **Open ticket** with sections A–E above; do not enable packs yet.
2. **Security review** completes B + C; residual risks written.
3. **Catalog PR** in company-brain-deploy (this repo) — no live secrets.
4. **Network change** — firewall/proxy domains (account-owned); verify deny of unlisted hosts if policy requires.
5. **Tenant private policy** — fill/update client-data-handling-policy template.
6. **Terraform** — set `approved_processor_ids`, optional `processor_egress_domains`, packs; `terraform plan` review.
7. **Smoke** — approved flow works; sample unapproved FQDN fails when L7 allowlist is in force.
8. **Close ticket** with evidence links (private).

---

## Emergency exception

Time-boxed production exception (≤ 14 days) requires:

- Written client + Lanyard security acceptance of residual risk  
- Explicit expiry date  
- Tracking issue to complete full onboarding or remove access  

Lab mode is not a substitute for a production exception.

---

## Cross-links

- Catalog: `references/approved-data-processors.md`  
- Policy template: `references/templates/client-data-handling-policy.md`  
- Egress: `references/runbooks/controlled-egress.md`  
- Production security honesty: `references/runbooks/production-security-gate.md`  
- Alert response: `references/runbooks/security-alert-triage.md`  
