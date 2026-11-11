# Testing summary (Mode A Omnibox)

Back-link: [overview.md](./overview.md)

## Offline (every PR)

```bash
bash scripts/smoke-omnibox.sh
bash scripts/smoke-host-runtime-hardening.sh
bash scripts/smoke-hermes-profiles.sh
```

## Lab (phases 0, 2)

- Secrets path denied inside wrapper.
- Blocked egress denied.
- Granted path writable.

## Staging (phase 9)

- Portal chat regression suite (admin + contributor).
- Isolation table in `references/runbooks/omnibox-mode-a.md`.
- Break-glass path.

## What unit tests prove vs do not

| Proves | Does not prove |
|--------|----------------|
| Wrapper argv and profile selection | Real bwrap on AL2023 AMI |
| Seeds present and contributor stricter | Portal RBAC end-to-end |
| CI smoke layout | Pen-test or microVM isolation |

Runtime staging is required for MVP done (**prove-it-works**).
