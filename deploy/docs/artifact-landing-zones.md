# Artifact landing zones and publisher trust

Canonical design (backend prefix strategy, OIDC publishers, dual-write migration):

**[docs/architecture/deploy-artifact-landing-zones.md](../../docs/architecture/deploy-artifact-landing-zones.md)**

## Stubs in this tree

| File | Purpose |
| --- | --- |
| [`../modules/product-artifact-infra/README.md`](../modules/product-artifact-infra/README.md) | Merge notes for company-brain-deploy product-artifact-infra |
| [`../modules/product-artifact-infra/artifact_prefixes.tf.example`](../modules/product-artifact-infra/artifact_prefixes.tf.example) | Target `artifact_prefixes` + kind-slug map |
| [`../modules/product-artifact-infra/publisher_repos.tf.example`](../modules/product-artifact-infra/publisher_repos.tf.example) | Target OIDC `publisher_repos` (Hermes-Lanyard dual-write + Lanyard Agent) |
| [`../modules/product-artifact-infra/outputs_landing_zones.tf.example`](../modules/product-artifact-infra/outputs_landing_zones.tf.example) | URL template outputs (backends + unchanged client-core/portal-web) |
| [`../modules/product-artifact-infra/terraform.tfvars.landing_zones.example`](../modules/product-artifact-infra/terraform.tfvars.landing_zones.example) | Placeholder-safe module inputs |
| [`../scripts/smoke-artifact-landing-zones.sh`](../scripts/smoke-artifact-landing-zones.sh) | Offline contract checks |

## Prefix summary

```text
s3://$BUCKET/backends/hermes-lanyard/<version>/linux-x86_64/…   # default product arch
s3://$BUCKET/backends/lanyard-agent/<version>/linux-x86_64/…
s3://$BUCKET/client-core/<version>/…     # UNCHANGED (arch-neutral seed)
s3://$BUCKET/portal-web/<version>/…      # UNCHANGED
s3://$BUCKET/hermes/<version>/linux-x86_64/…   # product publish (arch-labeled)
s3://$BUCKET/hermes/<version>/hermes-….*       # DEPRECATED unlabeled
```

Pin field: `backend.arch` / Terraform `backend_artifact_arch` default **`linux-x86_64`**.
