# Omnibox policy seeds + Mode A wrapper

Backend: **bwrap_inrepo** (phase 0). Policy seeds (phase 1) + `run-under-omnibox` wrapper (phase 2) + egress render (phase 6).

Does **not** require Omnigent server (Mode A only).

## Mapping

| Hermes profile | Omnibox policy | Tool allowlist | Hermes profile seed |
|----------------|----------------|----------------|---------------------|
| `admin` | [`admin.yaml`](./admin.yaml) | [`scripts/tool-allowlists/admin.json`](../tool-allowlists/admin.json) | [`scripts/hermes-profiles/admin.json`](../hermes-profiles/admin.json) |
| `contributor` | [`contributor.yaml`](./contributor.yaml) | [`scripts/tool-allowlists/contributor.json`](../tool-allowlists/contributor.json) | [`scripts/hermes-profiles/contributor.json`](../hermes-profiles/contributor.json) |

Install targets (phase 3 ensure installs; documented only here):

| Artifact | Host path |
|----------|-----------|
| Policies | `/etc/company-brain/omnibox/{admin,contributor}.yaml` |
| Wrapper | `/usr/local/sbin/run-under-omnibox` |

## Wrapper CLI

```bash
run-under-omnibox --profile admin|contributor \
  [--path-prefix PREFIX]... [--workdir PATH] -- command [args...]
```

Source in tree: [`run-under-omnibox.sh`](./run-under-omnibox.sh).

## Hermes env contract

| Variable | Purpose |
|----------|---------|
| `OMNIBOX_WRAPPER` | Path to wrapper binary; **`/usr/local/sbin/run-under-omnibox`** on hosts after ensure |
| `OMNIBOX_ENABLED` | `0`\|`1` feature flag for gateway/hook (phase 4/5; not read by the wrapper itself) |
| `OMNIBOX_CONFIG_DIR` | Host policy + registry dir (`/etc/company-brain/omnibox`) |
| `OMNIBOX_ARGV_BUILDER` | Optional deploy argv helper (`/usr/local/sbin/omnibox-build-shell-exec-argv`) |
| `OMNIBOX_POLICY_DIR` | Optional override for policy directory (default: script dir, then `/etc/company-brain/omnibox`) |
| `OMNIBOX_HOST_ROOT` | Lab-only host path remap for binds (unset in production) |
| `OMNIBOX_BWRAP` | Optional path to `bwrap` (default: `bwrap` on `PATH`) |

Exit non-zero if the profile is unknown, the policy file is missing, or the bubblewrap backend is missing when required.

## Hermes shell / host-tool hook (phase 5)

Contract: [`references/omnibox-mode-a-hermes-hook.md`](../../references/omnibox-mode-a-hermes-hook.md).

| Artifact | Role |
|----------|------|
| [`host-impacting-tools.json`](./host-impacting-tools.json) | Which tools wrap when `OMNIBOX_ENABLED=1` |
| [`build-shell-exec-argv.py`](./build-shell-exec-argv.py) | Session profile + command → wrapper argv (offline self-test + product reference) |

```bash
python3 scripts/omnibox/build-shell-exec-argv.py --self-test
# Contributor session must produce argv containing: --profile contributor
```

**Residual:** live gateway wrap requires a Hermes product PR; deploy env alone is not isolation.

## Egress allowlist render (phase 6)

| Artifact | Role |
|----------|------|
| [`render-egress-allowlist.sh`](./render-egress-allowlist.sh) | Merge static processor hosts + tenant model/relay hosts → runtime fragment |
| [`processor-hosts.static.list`](./processor-hosts.static.list) | Public documentation hostnames by catalog ID (no secrets) |
| Host output | `/etc/company-brain/omnibox/runtime/egress.yaml` (generated on host; not committed) |

Dry-run (no `/etc` write, no secrets):

```bash
bash scripts/omnibox/render-egress-allowlist.sh --dry-run \
  --processor-ids model-anthropic \
  --model-host api.anthropic.com \
  --relay-host relay.example.com
```

Catalog consumer note: `references/approved-data-processors.md` § Omnibox Mode A consumer.
