# Phase 4: Bootstrap and systemd env flag

Back-link: [overview.md](./overview.md)  
**Bead:** `cbd-o9s.10`  
**Depends on:** phase 3

## Goal

Wire Omnibox into tenant host provision behind `enable_omnibox` without changing gateway ExecStart to a different product.

## Changes

- Modify `scripts/bootstrap-host.sh` to call ensure-omnibox when enabled.
- Add `enable_omnibox` to `modules/company-brain-ec2/variables.tf` (default false).
- Systemd drop-in or unit env: `OMNIBOX_ENABLED`, `OMNIBOX_CONFIG_DIR`, `OMNIBOX_WRAPPER`.
- Update `templates/tenant/terraform.tfvars.example`.

## Data structures

- Terraform bool → user_data/bootstrap env → gateway Environment.

## Verification

**Static:** `terraform fmt` / validate on module if in CI; offline smoke still green.  
**Runtime:** Lab bootstrap with flag true installs files; gateway unit still `User=hermes` and same ExecStart binary family.

## Acceptance

- [ ] Default flag false.
- [ ] Gateway process not replaced by Omnigent.
- [ ] Flag true path calls ensure-omnibox after hardening/profiles.
