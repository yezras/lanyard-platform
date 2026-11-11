# OPERATOR HOLD — platform-staging localhost-only (cost)

**Status:** **ACTIVE** (filed 2026-07-26; still active as of 2026-08-04 residual `lp-kng.3`)  
**Audience:** operators and coding agents working in `lanyard-platform`  
**Mirror:** [`.grok/OPERATOR-HOLD-LOCALHOST-ONLY.md`](../../../.grok/OPERATOR-HOLD-LOCALHOST-ONLY.md)

---

## Policy

AWS **platform-staging** fixed network/compute is in **TEARDOWN** for cost. Target residual cloud spend is roughly **$5–20/mo**. Product and agent test traffic must run on **localhost** (or managed external services that do not re-enable this stack), **not** by re-applying the full staging network.

### Forbidden without an explicit human lift of this hold

- `terraform apply` that **re-enables** VPC / NAT / interface endpoints / ALBs / ECS / RDS / CloudFront / staging document server for platform-staging
- `aws ecs update-service … --desired-count 1` on `lanyard-platform-staging-*` services
- Recreating the historical staging Relay ELB solely to “green” a dual-run check without written approval

### Allowed

- Offline / localhost portal compose, unit tests, package smokes
- Managed Daytona API usage (external SaaS) under thrifty budgets
- Reading Terraform, runbooks, and diagnosis notes
- Documenting lab-only Relay paths that do **not** restore full platform-staging
- Human-approved **minimal** lab spend that is **not** a full stack re-enable (must be explicit)

---

## Relay DNS implication

Public name **`relay.withlanyard.com`** still has a CNAME to a **torn-down** staging ELB name (`lanyard-platform-staging-relay-a-87559758.us-east-1.elb.amazonaws.com`) with **no A/AAAA**. Real WSS from Daytona fails at DNS before TCP.

**Do not** fix this by silently applying platform-staging. See residual runbook:

→ [`docs/plans/0008-daytona-agent-sandboxes/residual-kng.3-relay-dns.md`](../../../docs/plans/0008-daytona-agent-sandboxes/residual-kng.3-relay-dns.md)

---

## How to lift

1. Human owner writes approval (bead note / ops channel) describing scope (Relay-only vs full stack) and cost acceptance.  
2. Follow deploy SoT under **`lanyard-platform/deploy/`** only (never edit legacy company-brain-deploy for new platform work).  
3. Update this file status to **LIFTED** with date + scope, or delete/replace with a time-bounded exception note.  
4. Re-run DNS health + thrifty Daytona WSS re-prove from the residual doc.

Until then, agents treat live staging network restore as **blocked** and prefer lab-only or localhost paths.

## Restart direction

The active restart is localhost, then Cloudflare, with Daytona kept as the agent computer. See [plan 0020](../../../docs/plans/0020-cloudflare-platform-revamp/overview.md) (`lp-bhcg`). That plan does not lift this hold and does not authorize a platform-staging apply.
