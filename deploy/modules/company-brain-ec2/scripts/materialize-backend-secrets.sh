#!/usr/bin/env bash
# Host wrapper: materialize BackendRuntimeSecretsEnvelope from AWS SM.
# Installed by setup.sh / ensure-runtime-hardening.sh (not embedded in user_data —
# keeps EC2 user_data ≤16 KiB with bootstrap inject). Invoked from systemd
# ExecStartPre and setup.sh. Never logs secret values.
#
# Config (non-secret ARN/region only): /etc/company-brain/backend-runtime-secrets.env
# Tool: /usr/local/lib/company-brain/materialize-backend-secrets.py
set -euo pipefail

ENV_FILE="${BACKEND_RUNTIME_SECRETS_ENV_FILE:-/etc/company-brain/backend-runtime-secrets.env}"
TOOL="${MATERIALIZE_BACKEND_SECRETS_PY:-/usr/local/lib/company-brain/materialize-backend-secrets.py}"

if [[ -f "$ENV_FILE" ]]; then
  # shellcheck disable=SC1090
  set -a
  # File contains ARN/region only — never secret values. Mode 0644 (readable by service user).
  # shellcheck source=/dev/null
  source "$ENV_FILE"
  set +a
fi

if [[ -z "${BACKEND_RUNTIME_SECRETS_ARN:-}" ]]; then
  # Not configured — no-op (lab / secrets disabled).
  exit 0
fi

if [[ ! -f "$TOOL" ]]; then
  echo "materialize-backend-secrets: tool missing at $TOOL" >&2
  echo "materialize-backend-secrets: install via setup.sh or ensure-runtime-hardening.sh" >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "materialize-backend-secrets: python3 not found" >&2
  exit 1
fi

# Ensure runtime home exists before write (mode 0755; secret files get 0600).
BACKEND_HOME="${BACKEND_HOME:-${HERMES_HOME:-/var/lib/company-brain-backend}}"
mkdir -p "$BACKEND_HOME"

export BACKEND_RUNTIME_SECRETS_ARN
export BACKEND_HOME
if [[ -n "${AWS_REGION:-}" ]]; then
  export AWS_REGION
  export AWS_DEFAULT_REGION="${AWS_DEFAULT_REGION:-$AWS_REGION}"
fi
if [[ -n "${BACKEND_KIND:-}" ]]; then
  export BACKEND_KIND
fi

# ARN only on argv — secret body stays in SM / on-disk mode-0600 outputs.
python3 "$TOOL" --secret-arn "$BACKEND_RUNTIME_SECRETS_ARN"
rc=$?

# When run as root (user_data / setup / +ExecStartPre), chown secret files so the
# service user can re-materialize on start and EnvironmentFile remains loadable.
if [[ $rc -eq 0 && "$(id -u)" -eq 0 ]]; then
  owner="${MATERIALIZE_FILE_OWNER:-}"
  if [[ -z "$owner" ]]; then
    if id company-brain >/dev/null 2>&1; then
      owner=company-brain
    elif id hermes >/dev/null 2>&1; then
      owner=hermes
    fi
  fi
  if [[ -n "$owner" ]]; then
    for f in "$BACKEND_HOME/.env.secrets" "$BACKEND_HOME/config.secrets.yaml"; do
      if [[ -f "$f" ]]; then
        chown "$owner:$owner" "$f" || true
        chmod 0600 "$f" || true
      fi
    done
  fi
fi

exit "$rc"
