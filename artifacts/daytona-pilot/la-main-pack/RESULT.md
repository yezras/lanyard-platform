# LA main pack + agent-gateway bake (2026-08-13)

## Pack

| Field | Value |
|-------|--------|
| LA main | `508b0b736ad5c56e4f3846622c46b53aca22f723` |
| version | `0.0.0-main.508b0b736ad5` |
| sha256 | `eeb709ecee725f343764771363dc0e5f2f42142eff0555e4d330f40c42f8a578` |
| command | `./scripts/release-artifact.sh --version 0.0.0-main.508b0b736ad5` |

## Image bake (local, linux/amd64)

| Field | Value |
|-------|--------|
| tag | `lanyard/agent-gateway:la-main-508b0b736ad5` |
| image id | `sha256:09a5167144d5ffb0f26f43ca6983a67fc350cc5d79612df401d8f891abdefd48` |
| layout | LA source+dist-v1 → `bin/company-brain-backend` wrapper |
| version probe | `company-brain-backend (lanyard-agent) 0.0.0-main.508b0b736ad5` |

```bash
docker build --platform linux/amd64 \
  --build-arg AGENT_TARBALL=lanyard-agent-0.0.0-main.508b0b736ad5.tar.gz \
  -t lanyard/agent-gateway:la-main-508b0b736ad5 \
  -f deploy/daytona/agent-gateway/Dockerfile \
  deploy/daytona/agent-gateway
```

## Platform bake landed (lp-kng.9)

- `deploy/daytona/agent-gateway/Dockerfile`: Node 22 + corepack/pnpm prebake
- `deploy/daytona/agent-gateway/install-agent-runtime.sh`: LA source+dist-v1 wrap → `bin/company-brain-backend`
- `deploy/daytona/agent-gateway/repack-notes.md`: pack → bake operator notes
- `deploy/daytona/agent-gateway/pins/staging-pilot.pins.yaml`: `product_backend: lanyard_agent` + tarball coordinates
- Smoke: `bash deploy/daytona/agent-gateway/smoke-entrypoint.sh` (includes LA wrap fixture)

## De-Hermes mocklab AWS packs (lp-kng.10, merged)

- `deploy/deployments/mocklab/terraform.tfvars` (private): `hermes_artifact_*=UNCONFIGURED`; S3 prefixes → `backends/lanyard-agent/*`
- `terraform.tfvars.example` + `INDEX.md`: product path = LA + Daytona
- `deploy/compatibility/pins.real-releases.yaml`: Hermes marked legacy residual; LA pin pointer

## Not done here (live cutover — follow-up)

- ECR publish of this image (registry digest) — `lp-zuh.2`
- Daytona snapshot register + MockLab pin replace
- Redeploy Portal BFF/CP/Relay/web images from monorepo main to AWS
- `lp-kng.6.7` vault live proof

Product agent path for MockLab Daytona is **Lanyard Agent only** (not Hermes).
