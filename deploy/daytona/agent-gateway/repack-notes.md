# Bake Lanyard Agent (main) into agent-gateway image

**Product:** Lanyard Agent (not Hermes).  
**Pack:** from `lanyard-agent` repo `origin/main` via `scripts/release-artifact.sh`.  
**Image:** `deploy/daytona/agent-gateway/` — install accepts LA product layout and wraps `bin/company-brain-backend gateway`.

## 1. Pack LA from main

```bash
cd /path/to/lanyard-agent
git checkout main && git pull origin main
SHA="$(git rev-parse --short=12 HEAD)"
./scripts/release-artifact.sh --version "0.0.0-main.${SHA}"
# → dist/release/lanyard-agent-0.0.0-main.${SHA}.tar.gz
# → dist/release/lanyard-agent-0.0.0-main.${SHA}.tar.gz.sha256
```

## 2. Stage for image bake (never commit the tarball)

```bash
cd /path/to/lanyard-platform
cp /path/to/lanyard-agent/dist/release/lanyard-agent-*.tar.gz \
   deploy/daytona/agent-gateway/agent-release/
```

`agent-release/*` is gitignored except `.gitignore` / `.gitkeep`.

## 3. Build linux/amd64 image with real agent

```bash
AGENT_TARBALL=lanyard-agent-0.0.0-main.<sha>.tar.gz \
  IMAGE_TAG=lanyard/agent-gateway:la-main-<sha>-wf-enosys-zuh1010 \
  bash deploy/daytona/agent-gateway/build-local.sh --run-smoke
```

## 4. Snapshot + pin (live MockLab)

Follow [agent-snapshot-bump-runbook.md](../../../docs/plans/0008-daytona-agent-sandboxes/agent-snapshot-bump-runbook.md):
ECR push → Daytona snapshot (prefer **tag** imageName; `@sha256` digest form can fail registry inspect) → `DAYTONA_DEFAULT_SNAPSHOT` / instance pin.

## Current pack (this session)

| Field | Value |
|-------|--------|
| LA git | `8835654f4ecd200b12ef7a7744e804beee38be3d` |
| Version | `0.0.0-main.8835654f4ecd` |
| SHA-256 | `c3a1bc740e04e94c0bedfd157b5e582348c8924528a21a063ca2a77ee57f8865` |
| Artifact | `deploy/daytona/agent-gateway/agent-release/lanyard-agent-0.0.0-main.8835654f4ecd.tar.gz` |
| Built at | 2026-08-26T02:03:27Z |
| Bead | `lp-na7d` mailbox-era real agent (not fake-gateway) |
| LA PRs | #277 #279 #278 #276 #280 #281 #275 (`lac-r9w.*`) |
| Prior pin | `lanyard-agent-gateway-v2026.08.25` / `52bf79ab` (pre-mailbox 09a4df) |
