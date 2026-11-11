# staging-document-server

**Topology:** `staging-platform-shared-ds`  
**Bead:** `lp-5q6.34`  
**ADR:** [0006 Document Server topology](../../../docs/adr/0006-document-server-topology-and-data-residency.md)  
**Detail:** [portal-document-server-topology.md](../../../docs/architecture/portal-document-server-topology.md)  
**License track:** free Community image only ([decision-license-path](../../../docs/plans/0004-portal-onlyoffice-integration/decision-license-path.md))

Platform-operated **staging** ONLYOFFICE Document Server in the staging account/VPC: one shared instance for staging tenants / dogfood. Status: **infra_ready**, not auto-applied from git, not production residency (`prod-per-tenant-ds`).

## What this module provides

| Surface | Behavior |
|---------|----------|
| Browser → DS | Public ALB edge; health on `/healthcheck`; optional ALB HTTPS + ACM (`lp-zuh.12.2`) **or** CloudFront HTTPS→HTTP ALB (`lp-zuh.12.9` Option B) |
| DS → BFF | Tasks in private subnets with egress so Document Server can **HTTPS GET/POST** BFF Office download + callback URLs |
| JWT | Secrets Manager only (`JWT_SECRET` into DS; same ARN → BFF `BFF_OFFICE_JWT_SECRET`) |
| License | Free track: no license file required. Optional SM shell for future paid material — never git |
| Image | Digest-pinned Community `onlyoffice/documentserver` (never tag-only / `:latest` alone) |

## Compose (platform-staging)

Root toggle (default **off** so offline validate stays cheap):

```hcl
enable_staging_document_server = true
# document_server_image_digest = "sha256:…"  # private pin — never commit live digests
# acknowledge_staging_shared_residual = true
```

When enabled, `environments/platform-staging` wires:

- DS ALB DNS → browser Docs URL / web feature flag `onlyoffice_document_server_url`
- JWT SM ARN → BFF `secrets.BFF_OFFICE_JWT_SECRET`
- BFF plain env: `BFF_OFFICE_PUBLIC_BASE_URL`, `BFF_OFFICE_DOCUMENT_SERVER_HOSTS` (CF domain and/or public hostname + ALB DNS)

## Operator procedure

→ **[references/runbooks/staging-document-server.md](../../references/runbooks/staging-document-server.md)**

## Offline smoke

```bash
bash deploy/scripts/smoke-staging-document-server.sh
bash deploy/scripts/smoke-platform-staging-compose.sh
```

## Rollback (Office off, previews stay)

1. Set web flag `onlyoffice_editor=false` (or omit `VITE_ONLYOFFICE_EDITOR`) — chat document **previews** continue.
2. Set BFF `BFF_OFFICE_VAULT_EDIT=false` (default fail-closed).
3. Scale DS: `document_server_desired_count = 0` **or** `enable_staging_document_server = false`.
4. Do **not** remove vault preview routes or chat pane.

## Honesty

| Claim | Truth |
|-------|--------|
| Staging topology named + TF module | Yes |
| JWT/license material from secret store not git | Yes (JWT SM; license optional shell) |
| Offline validate / smoke | Yes |
| Live staging apply from examples | **No** — operator-owned |
| Production Document Server | **Blocked** (license re-open + security + `prod-per-tenant-ds`) |
| Staging shared residual | Accepted for **staging data only** |
