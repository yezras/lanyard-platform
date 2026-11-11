# 0017 issue map

Epic: **`lp-vqr0`** First-chat sandbox speed. Created by [create-beads.sh](create-beads.sh).

Related open bugs (do not duplicate): `lp-puzc` Mountpoint first-write, `lp-sjn9` CloudFront clip / evening create, `lp-cuvh` warm remount proof.

`lp-6bg` closed as retain-on-stop + stub pool. This epic implements the pool and the product-ready split.

Non-goals (every leaf): **no Fargate/DS sleep**, no terraform apply unless a human lifts OPERATOR HOLD.

| Bead | Title | Depends | Stream |
|-------|-------|---------|--------|
| `lp-vqr0.3` | Plan docs on disk | - | docs |
| `lp-vqr0.5` | SLO harness real harness (frozen ruler) | .3 | A |
| `lp-vqr0.4` | Readiness: agent_ready vs vault_writable | .5 | A |
| `lp-vqr0.6` | Send never cold_create when sandbox_id bound | .4 | A |
| `lp-vqr0.7` | Create-ahead so first visit is not a click-create | .6 | A |
| `lp-vqr0.8` | Detach chat POST from wake wait (CloudFront 60s) | .3 | B |
| `lp-vqr0.9` | Speculative ensure_online on chat route | .8 | C |
| `lp-vqr0.10` | Warm pool claim + replenish (real harness) | .5, .6 | A |
| `lp-vqr0.11` | Harness no-tool turn skips sandbox wake | .8 | B |
| `lp-vqr0.12` | Entrypoint: gateway not gated on post-mount writable | .4 | D |
| `lp-vqr0.13` | Encode SLO T1–T9 in CI | .6 .8 .10 .11 .12 | A/B |
| `lp-vqr0.14` | Live MockLab T10 residual | .13, `lp-puzc` | E |
| `lp-vqr0.1` | Playbook: principles + scope recorded in overview.md | .3 | docs |
| `lp-vqr0.2` | Playbook: throughput checkpoint | .3 | docs |

Playbook tracking beads (close with this plan, not product code):

- principles + scope
- blocking first steps / independent streams / shared state / smallest decomposition (this file + [checkpoint.md](checkpoint.md))
