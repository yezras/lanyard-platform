# Phase 6 — Tool-only snapshot

Back: [overview](./overview.md). Beads: `lp-oop.21`–`.23`.

## Goal

A guest image with git/python/jq/mount-s3 and no `lanyard-agent/` tree. Not the live MockLab pin.

## Changes

- Dockerfile target or build-arg that skips `AGENT_TARBALL` / `install-agent-runtime.sh` agent extract.
- Offline smoke: image has no `/opt/company-brain-backend/current/lanyard-agent`.
- Pin artifact under `artifacts/` for lab. Do not write `DAYTONA_DEFAULT_SNAPSHOT` or MockLab `agent_snapshot_id`.

## Data structures

Same snapshot pin YAML shape as existing agent-gateway pins, new name.

## Verification

`docker build` smoke when Docker is available. Script fails if the agent tree exists.
