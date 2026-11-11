# portal-static-edge

| File | Purpose |
|------|---------|
| `versions.tf` | Terraform + AWS provider pins |
| `variables.tf` | Bucket, OAC/CloudFront, optional BFF origin, dual API path patterns (`api_path_pattern` + `bare_api_path_pattern`), pin metadata, honesty gates |
| `main.tf` | Private S3 origin, OAC, optional BFF custom origin, dual API ordered behaviors (`/*/api/*` + `/api/*`) + ops SPA `/admin*` + default SPA + `/assets/*` |
| `outputs.tf` | Bucket, distribution, dual BFF API routing status (`path_patterns`), pin summary, module_status |
| `README.md` | Operator contract, dual API patterns, SPA custom_error risk, staging verify curls |
| `terraform.tfvars.example` | Placeholder-only inputs (no live account IDs; BFF origin empty by default; dual path defaults documented) |

## Dual API routing (when `bff_origin_domain_name` set)

| Ordered behavior | Default pattern | Target |
|------------------|-----------------|--------|
| Path-first | `/*/api/*` (`api_path_pattern`) | BFF origin `portal-bff` |
| Bare apex | `/api/*` (`bare_api_path_pattern`) | Same BFF origin (`/api/admin/*` included) |
| Ops SPA | `/admin*` | S3 origin (same tarball; not BFF) |
| Static assets | `/assets/*` | S3 origin |
| Default | `*` | S3 origin (SPA) |

Both API behaviors: CachingDisabled, AllViewerExceptHostHeader, full methods including POST. See [README.md](./README.md).
