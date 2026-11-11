# Phase 2: Publish hermes-lanyard runtime artifact

**Bead:** `cbd-ukg.5`  
**Depends on:** `cbd-ukg.4` (GO pack — portal-integration + G2a jti missing from pin)  
**Status:** **done** (2026-07-19) — GH private release published; S3 mirror blocked for this operator identity

## Goal

Immutable hermes-lanyard tarball that includes portal-adapted code, with version + URL + SHA-256 recorded for mocklab re-pin (phase 3).

## Work executed

1. **Cut ref:** throwaway pack branch from `origin/main` @ `4596ecd58` (includes G2a jti `7ff6bf22b`), cherry-pick portal-integration:
   - `1506032c8` — cwd pin, `portal_metadata`, relay `edit_message`
   - `d956fac28` — tool spinner complete emit (+ minor `scripts/release.py` author-map conflict resolved)
   - Result pack commit / tag: `1f80ccf6f` / **`v0.1.0-g7h3`**
   - **Not** cut from main alone; **not** portal-integration tip alone.
2. **Pack** (hermes-lanyard worktree):  
   `./scripts/pack-lanyard-runtime.sh --version v0.1.0-g7h3`  
   Full frontend (web dashboard + TUI); no `--skip-frontend`.
3. **Publish:**
   - **S3:** attempted staging product-artifact bucket → **AccessDenied** for caller `litigationagent-terraform` (wrong account / no bucket policy). Did **not** invent a live s3:// URL.
   - **GitHub Release** (same dual-path as g7h2): `LanyardBrain/hermes-lanyard` tag `v0.1.0-g7h3` + assets.
4. **Pins recorded** in `compatibility/pins.real-releases.yaml` and mocklab `terraform.tfvars.example` comments. Live `terraform.tfvars` not edited (phase 3).

## Coordinates (acceptance)

| Field | Value |
|-------|--------|
| Version | `v0.1.0-g7h3` (immutable) |
| URL | `https://github.com/LanyardBrain/hermes-lanyard/releases/download/v0.1.0-g7h3/hermes-v0.1.0-g7h3.tar.gz` |
| SHA-256 | `a372580396e170436c22e44a61fbcdf8d2c7cf4f5d328694bb5afdf279904db9` |
| Pack git_sha (`.seed/build.env`) | `1f80ccf6f743f9daed57b9c082e0eb9a16e8ae71` |
| Local pack path (operator machine) | hermes-lanyard `dist/lanyard/hermes-v0.1.0-g7h3.tar.gz` (worktree under `/tmp/…/hermes-pack-wt`) |
| Proposed S3 key (when platform publish available) | `hermes/v0.1.0-g7h3/hermes-v0.1.0-g7h3.tar.gz` |

## Verification

- [x] `sha256sum -c` on local pack
- [x] Layout: top-level `hermes-v0.1.0-g7h3/` + `bin/hermes` + relocatable `.venv`
- [x] Tarball contains `gateway/relay/portal_metadata.py`, G2a `generate_jti` / `make_upgrade_token`, adapter `edit_message`
- [x] GH release assets present
- [ ] S3 object under hermes/ prefix — **blocked** (AccessDenied); GH URL is the bootstrap coordinate
- Do not claim production G7 ready from publish alone

## Acceptance

- [x] Version label immutable (`v0.1.0-g7h3`, not main/HEAD/latest)
- [x] URL + SHA-256 recorded for mocklab pin (`compatibility/pins.real-releases.yaml`)
- [x] Not skip (phase 1 said GO)

## Appendix: mocklab pin targets (phase 3 input; no secrets)

```hcl
hermes_artifact_url     = "https://github.com/LanyardBrain/hermes-lanyard/releases/download/v0.1.0-g7h3/hermes-v0.1.0-g7h3.tar.gz"
hermes_artifact_version = "v0.1.0-g7h3"
hermes_artifact_sha256  = "a372580396e170436c22e44a61fbcdf8d2c7cf4f5d328694bb5afdf279904db9"
```

Prefer `s3://$BUCKET/hermes/v0.1.0-g7h3/hermes-v0.1.0-g7h3.tar.gz` once an operator with platform-account credentials mirrors the same SHA-256.

## Residual

- S3 mirror of this object into product-artifact staging bucket (platform account).
- Phase 3: re-pin mocklab host / bootstrap (do not do in this bead).
- Portal-integration branch remains unmerged on product `main`; this release is a **pack cut tag** only.
