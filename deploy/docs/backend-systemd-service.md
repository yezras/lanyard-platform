# Generic backend systemd service

**Bead:** `lp-k7g.7.5` · **Status:** platform scaffold coexists with imported product under `deploy/` (`lp-k7g.10.1`+).

## Design

Full design (entrypoint, env files, Hermes aliases, `ReadWritePaths`, migration
from `hermes-gateway.service`):

[`docs/architecture/deploy-backend-systemd-service.md`](../../docs/architecture/deploy-backend-systemd-service.md)

## Scaffold in this tree

| Path | Role |
| --- | --- |
| [`../modules/company-brain-ec2/systemd/company-brain-backend.service`](../modules/company-brain-ec2/systemd/company-brain-backend.service) | Generic unit: `ExecStart=…/bin/company-brain-backend gateway` |
| [`../modules/company-brain-ec2/systemd/company-brain-backend.service.d/sandbox.conf`](../modules/company-brain-ec2/systemd/company-brain-backend.service.d/sandbox.conf) | Sandbox drop-in / override point |
| [`../modules/company-brain-ec2/systemd/company-brain-backend.service.d/omnibox.conf`](../modules/company-brain-ec2/systemd/company-brain-backend.service.d/omnibox.conf) | Omnibox Mode A env only (no `ExecStart` change) |
| [`../scripts/smoke-backend-systemd-unit.sh`](../scripts/smoke-backend-systemd-unit.sh) | Offline unit content checks |

## Defaults (greenfield)

```text
ExecStart=/opt/company-brain-backend/current/bin/company-brain-backend gateway
BACKEND_HOME=/var/lib/company-brain-backend
EnvironmentFile=-/var/lib/company-brain-backend/.env
EnvironmentFile=-/etc/company-brain/backend.env
HERMES_HOME=/var/lib/company-brain-backend   # compatibility alias only
```

## Merge note (phase 6 — lp-k7g.10.4)

`ensure-runtime-hardening.sh` and `setup.sh` install/enable
`company-brain-backend` by default (user `company-brain`, own
`BACKEND_HOME` + `/opt/company-brain-backend`, secrets 0600). Imported
`hermes-gateway.service` remains optional via
`ensure-runtime-hardening.sh --install-legacy-unit`. Keep `User=hermes` only
via migration drop-in until state is re-homed.
