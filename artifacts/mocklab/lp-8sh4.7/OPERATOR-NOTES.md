# lp-8sh4.7 — MockLab BFF/CP/relay/web roll + connector entitle

Secret-free operator note. No task-def env dumps.

## Release

- Trigger: `gh workflow run release.yml --ref main -f version=portal-v2026.08.26 -f skip_upload=false -f components=all`
- Run: https://github.com/LanyardBrain/lanyard-platform/actions/runs/32921346986 at `62218130`
- portal-web: S3 publish **ok** (OIDC)
- portal-images: **failed** `tsc` in BFF (`sandboxNeed` missing on speculative harness kick)
- Images then built+pushed locally to ECR `lanyard-platform-staging/portal/{bff,relay,control-plane}` tag `portal-v2026.08.26` (immutable; tag was unused)

## Live pins (MockLab/UAT only)

| Surface | Task def | Image |
| --- | --- | --- |
| BFF | `lanyard-platform-staging-bff:48` | `…/portal/bff@sha256:173149efacbd253da92140bbe3f019af1d8c301562de7cdd8eb1ef44211fb63d` |
| Control plane | `lanyard-platform-staging-cp:37` | `…/portal/control-plane@sha256:8290cf82276f3e237e14f9126aa48ef830119e856705ab4ad6ab5c61c3002532` |
| Relay | `lanyard-platform-staging-relay:21` | `…/portal/relay@sha256:9330cd7c9b3d1f21df1dfa56dc843583a5a37924ce79731b7136816377207eb2` |
| Web | origin VERSION `portal-v2026.08.26` | tarball sha256 `46a96980ad38d8c2a6843617a3cf495e53d52ab7d1406f41fc46f989c5622557` live js `/assets/index-B9mLAxco.js` CF `ICKQMIF3PEX003CVO83D4OPT5T` |

Clusters: BFF `lanyard-platform-staging-portal`; CP `lanyard-platform-staging-portal-cp`; relay `lanyard-platform-staging-portal-relay`.

`aws ecs wait services-stable` returned 0. Running tasks HEALTHY. Image URIs are `@sha256:…` (not tag-only). Off pre-mailbox `:47` / `:20` / `:36`.

## Entitle (tenant `319d3808-e533-44db-bfdf-7b6ef8caaae1`)

CP internal (service token from task env, not printed):

- PUT `/internal/tenants/:id/connector-entitlements/{google,hubspot,whatsapp,github}` `{enabled:true}` → 200
- MockLab has roles **admin** + **member** (no role named `user`). Grants on both for all four ids → 200

Proof: [entitle-proof.json](./entitle-proof.json)

Authenticated BFF `GET /mocklab/api/connectors` (Jack’s MockLab user): four SaaS rows, all `entitled=true`, `role_granted=true`, `status=not_connected`. GitHub included. SPA contains `gh auth login --hostname github.com`. See [connectors-bff.json](./connectors-bff.json). OAuth/QR not completed (out of this leaf).

## Jack click list (`https://app.withlanyard.com/mocklab`)

Connectors page should list Google, HubSpot, WhatsApp, GitHub. GitHub `not_connected` + `gh auth login` hint is OK. Do **not** finish Jack’s OAuth here.

Nine mailbox destination checks remain Jack’s (`lp-v62i.4.1` stays open). Daytona snapshot bake remains `lp-na7d` (do not rewrite `staging-pilot.pins.yaml`).

## Image bake extras (needed to ship post-#661)

- BFF speculative harness kick passes `sandboxNeed: "toolbox"` (lp-vqr0 T7 compile)
- CP `SLO_CI_CASES` typed as `Record<SloCiId, SloCiCase>` so `tsc` in the image build succeeds
- Dockerfiles set `pnpm config set ignore-scripts true` before filter-build + deploy (sibling package.json-only COPY was running `web-settings-schema` prepare)
