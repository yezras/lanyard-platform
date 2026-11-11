#!/usr/bin/env bash
# run-under-omnibox — Mode A Omnibox wrapper (bwrap_inrepo)
#
# Single entrypoint for Hermes (or bootstrap) to run host-impacting tool
# children under an OS cage. Does NOT require Omnigent server / Mode B.
# Does NOT wrap the long-lived hermes-gateway process — only tool argv.
#
# Install target (phase 3 ensure installs):
#   /usr/local/sbin/run-under-omnibox
#
# Hermes env contract:
#   OMNIBOX_WRAPPER=/usr/local/sbin/run-under-omnibox
#   OMNIBOX_ENABLED=0|1          # feature flag (gateway/hook; not read here)
#   OMNIBOX_POLICY_DIR=...       # optional; default: beside this script, then
#                                # /etc/company-brain/omnibox
#   OMNIBOX_HOST_ROOT=...        # optional lab remap: bind ${HOST_ROOT}${path}
#                                # → ${path} inside the box (unset in production)
#   OMNIBOX_BWRAP=bwrap          # optional path to bubblewrap binary
#
# CLI:
#   run-under-omnibox --profile admin|contributor \
#     [--path-prefix PREFIX]... [--workdir PATH] -- command [args...]
#
# Exit non-zero if: unknown profile, missing policy, backend missing when
# required, or the sandboxed command fails.
#
# Backend: bwrap_inrepo (phase 0 decision). See:
#   references/runbooks/omnibox-mode-a-spike.md
#   references/plans/omnibox-hermes-mode-a/phase-2-wrapper.md
#   scripts/omnibox/{admin,contributor}.yaml
#
# Bead: cbd-o9s.8
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OMNIBOX_BWRAP="${OMNIBOX_BWRAP:-bwrap}"
OMNIBOX_HOST_ROOT="${OMNIBOX_HOST_ROOT:-}"
PROFILE=""
WORKDIR=""
PATH_PREFIXES=()
CMD=()

usage() {
  cat <<'EOF'
Usage: run-under-omnibox --profile admin|contributor \
  [--path-prefix PREFIX]... [--workdir PATH] -- command [args...]

Run command under Omnibox Mode A sandbox (bubblewrap / bwrap_inrepo).

Options:
  --profile NAME       Omnibox profile (admin | contributor). Required.
  --path-prefix PATH   Grant only this vault/workspace prefix (repeatable).
                       Contributor vault is path_prefixes_only by policy.
  --workdir PATH       chdir inside the sandbox before exec.
  --                   End of options; remaining argv is the command.
  -h, --help           Show this help.

Environment:
  OMNIBOX_WRAPPER      Install path for Hermes (document only here):
                       /usr/local/sbin/run-under-omnibox
  OMNIBOX_POLICY_DIR   Directory with {profile}.yaml policies
  OMNIBOX_HOST_ROOT    Lab-only host path prefix remap for binds
  OMNIBOX_BWRAP        bubblewrap binary (default: bwrap on PATH)

Does not require Omnigent server. Network default-deny via --unshare-net
until phase-6 egress allowlist. Shared-kernel residual risk applies.
EOF
}

log() { echo "[run-under-omnibox] $*" >&2; }
err() { echo "[run-under-omnibox] ERROR: $*" >&2; }

# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------
while [ $# -gt 0 ]; do
  case "$1" in
    --profile)
      [ $# -ge 2 ] || { err "--profile requires a value"; exit 2; }
      PROFILE="$2"
      shift 2
      ;;
    --path-prefix)
      [ $# -ge 2 ] || { err "--path-prefix requires a value"; exit 2; }
      if [ -z "$2" ]; then
        err "--path-prefix must be non-empty"
        exit 2
      fi
      PATH_PREFIXES+=("$2")
      shift 2
      ;;
    --workdir)
      [ $# -ge 2 ] || { err "--workdir requires a value"; exit 2; }
      WORKDIR="$2"
      shift 2
      ;;
    --)
      shift
      CMD=("$@")
      break
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      err "unknown argument: $1 (use -- before command)"
      usage >&2
      exit 2
      ;;
  esac
done

if [ -z "$PROFILE" ]; then
  err "--profile is required"
  usage >&2
  exit 2
fi

case "$PROFILE" in
  admin|contributor) ;;
  *)
    err "unknown profile: ${PROFILE} (expected admin|contributor)"
    exit 2
    ;;
esac

if [ "${#CMD[@]}" -eq 0 ]; then
  err "command required after --"
  usage >&2
  exit 2
fi

# ---------------------------------------------------------------------------
# Resolve policy file
# ---------------------------------------------------------------------------
resolve_policy_dir() {
  if [ -n "${OMNIBOX_POLICY_DIR:-}" ]; then
    printf '%s\n' "$OMNIBOX_POLICY_DIR"
    return 0
  fi
  if [ -f "${SCRIPT_DIR}/${PROFILE}.yaml" ]; then
    printf '%s\n' "$SCRIPT_DIR"
    return 0
  fi
  if [ -f "/etc/company-brain/omnibox/${PROFILE}.yaml" ]; then
    printf '%s\n' "/etc/company-brain/omnibox"
    return 0
  fi
  # Prefer install-adjacent then repo seeds when both missing (clear error later)
  if [ -d "/etc/company-brain/omnibox" ]; then
    printf '%s\n' "/etc/company-brain/omnibox"
  else
    printf '%s\n' "$SCRIPT_DIR"
  fi
}

POLICY_DIR="$(resolve_policy_dir)"
POLICY_FILE="${POLICY_DIR}/${PROFILE}.yaml"

if [ ! -f "$POLICY_FILE" ]; then
  err "policy not found for profile '${PROFILE}': ${POLICY_FILE}"
  err "set OMNIBOX_POLICY_DIR or install seeds under /etc/company-brain/omnibox/"
  exit 2
fi

# ---------------------------------------------------------------------------
# Backend required (bwrap_inrepo)
# ---------------------------------------------------------------------------
if ! command -v "$OMNIBOX_BWRAP" >/dev/null 2>&1; then
  err "backend missing: bubblewrap not found (OMNIBOX_BWRAP=${OMNIBOX_BWRAP})"
  err "install bubblewrap package (phase 3 ensure-omnibox) or set OMNIBOX_BWRAP"
  exit 2
fi

# ---------------------------------------------------------------------------
# Parse policy (stdlib python; optional PyYAML, else schema-v1 line parser)
# ---------------------------------------------------------------------------
POLICY_JSON="$(
  POLICY_FILE="$POLICY_FILE" python3 - <<'PY'
import json, os, re, sys

path = os.environ["POLICY_FILE"]
text = open(path, encoding="utf-8").read()

def load_yaml(src: str):
    try:
        import yaml  # type: ignore
        return yaml.safe_load(src)
    except Exception:
        return None

data = load_yaml(text)

def parse_schema_v1(src: str) -> dict:
    """Minimal OmniboxPolicy schema_version 1 parser (no PyYAML required)."""
    out = {
        "schema_version": 1,
        "profile": None,
        "backend": None,
        "fs": {"grants": [], "never_grant": []},
        "network": {"unshare_net": True, "default": "deny"},
        "credentials": {"never_pass_env_prefixes": []},
    }
    section = None
    grant = None
    list_key = None
    for raw in src.splitlines():
        line = raw.split("#", 1)[0].rstrip()
        if not line.strip():
            continue
        # top-level scalars
        m = re.match(r"^(schema_version|profile|backend):\s*(.+)$", line)
        if m:
            key, val = m.group(1), m.group(2).strip().strip('"').strip("'")
            if key == "schema_version":
                out[key] = int(val)
            else:
                out[key] = val
            section = None
            list_key = None
            grant = None
            continue
        if re.match(r"^fs:\s*$", line):
            section = "fs"
            list_key = None
            grant = None
            continue
        if re.match(r"^network:\s*$", line):
            section = "network"
            list_key = None
            grant = None
            continue
        if re.match(r"^credentials:\s*$", line):
            section = "credentials"
            list_key = None
            grant = None
            continue
        if re.match(r"^[a-z_]+:\s*", line) and not line.startswith(" "):
            section = None
            list_key = None
            grant = None
            continue
        if section == "fs":
            if re.match(r"^\s+grants:\s*$", line):
                list_key = "grants"
                grant = None
                continue
            if re.match(r"^\s+never_grant:\s*$", line):
                list_key = "never_grant"
                grant = None
                continue
            if list_key == "grants":
                m = re.match(r"^\s+-\s+path:\s*(.+)$", line)
                if m:
                    grant = {
                        "path": m.group(1).strip().strip('"').strip("'"),
                        "mode": "rw",
                        "path_prefixes_only": False,
                    }
                    out["fs"]["grants"].append(grant)
                    continue
                if grant is not None:
                    m = re.match(r"^\s+mode:\s*(.+)$", line)
                    if m:
                        grant["mode"] = m.group(1).strip()
                        continue
                    m = re.match(r"^\s+path_prefixes_only:\s*(.+)$", line)
                    if m:
                        grant["path_prefixes_only"] = m.group(1).strip().lower() in (
                            "true",
                            "yes",
                            "1",
                        )
                        continue
            if list_key == "never_grant":
                m = re.match(r"^\s+-\s+(.+)$", line)
                if m:
                    out["fs"]["never_grant"].append(
                        m.group(1).strip().strip('"').strip("'")
                    )
                continue
        if section == "network":
            m = re.match(r"^\s+unshare_net:\s*(.+)$", line)
            if m:
                out["network"]["unshare_net"] = m.group(1).strip().lower() in (
                    "true",
                    "yes",
                    "1",
                )
                continue
            m = re.match(r"^\s+default:\s*(.+)$", line)
            if m:
                out["network"]["default"] = m.group(1).strip()
                continue
        if section == "credentials":
            if re.match(r"^\s+never_pass_env_prefixes:\s*$", line):
                list_key = "never_pass_env_prefixes"
                continue
            if list_key == "never_pass_env_prefixes":
                m = re.match(r"^\s+-\s+(.+)$", line)
                if m:
                    out["credentials"]["never_pass_env_prefixes"].append(
                        m.group(1).strip().strip('"').strip("'")
                    )
    return out

if data is None:
    data = parse_schema_v1(text)

if not isinstance(data, dict):
    print("policy root must be a mapping", file=sys.stderr)
    sys.exit(3)

fs = data.get("fs") or {}
grants = []
for g in fs.get("grants") or []:
    if not isinstance(g, dict) or not g.get("path"):
        continue
    grants.append(
        {
            "path": str(g["path"]),
            "mode": str(g.get("mode") or "rw"),
            "path_prefixes_only": bool(g.get("path_prefixes_only") or False),
        }
    )
never_grant = [str(p) for p in (fs.get("never_grant") or [])]
net = data.get("network") or {}
creds = data.get("credentials") or {}
prefixes = [str(p) for p in (creds.get("never_pass_env_prefixes") or [])]

out = {
    "schema_version": data.get("schema_version"),
    "profile": data.get("profile"),
    "backend": data.get("backend"),
    "grants": grants,
    "never_grant": never_grant,
    "unshare_net": bool(net.get("unshare_net", True)),
    "never_pass_env_prefixes": prefixes,
}
print(json.dumps(out))
PY
)" || {
  err "failed to parse policy: ${POLICY_FILE}"
  exit 3
}

# shellcheck disable=SC2034
POLICY_PROFILE="$(printf '%s' "$POLICY_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["profile"] or "")')"
POLICY_BACKEND="$(printf '%s' "$POLICY_JSON" | python3 -c 'import json,sys; print(json.load(sys.stdin)["backend"] or "")')"
UNSHARE_NET="$(printf '%s' "$POLICY_JSON" | python3 -c 'import json,sys; print("1" if json.load(sys.stdin)["unshare_net"] else "0")')"

if [ -n "$POLICY_PROFILE" ] && [ "$POLICY_PROFILE" != "$PROFILE" ]; then
  err "policy profile mismatch: file says '${POLICY_PROFILE}', CLI --profile '${PROFILE}'"
  exit 2
fi

if [ -z "$POLICY_BACKEND" ]; then
  err "policy missing backend field: ${POLICY_FILE}"
  exit 2
fi

if [ "$POLICY_BACKEND" != "bwrap_inrepo" ]; then
  err "unsupported backend '${POLICY_BACKEND}' (this wrapper implements bwrap_inrepo only; no Omnigent server)"
  exit 2
fi

# ---------------------------------------------------------------------------
# Host path helpers
# ---------------------------------------------------------------------------
host_src() {
  # Map sandbox path → host source path (optional OMNIBOX_HOST_ROOT remap).
  local p="$1"
  if [ -n "$OMNIBOX_HOST_ROOT" ]; then
    printf '%s%s\n' "${OMNIBOX_HOST_ROOT%/}" "$p"
  else
    printf '%s\n' "$p"
  fi
}

ensure_host_dir() {
  local host_path="$1"
  if [ -d "$host_path" ]; then
    return 0
  fi
  if mkdir -p "$host_path" 2>/dev/null; then
    return 0
  fi
  err "grant host path missing and not creatable: ${host_path}"
  err "create it on the host or set OMNIBOX_HOST_ROOT for lab remap"
  return 1
}

# Lexically canonicalize an absolute path (resolve . and ..; no symlink follow).
# Prints the canonical path on stdout. Returns non-zero for empty/relative input.
# Fail-closed: callers must not bind prefixes that do not canonicalize cleanly.
canonicalize_abs() {
  local path="$1"
  if [ -z "$path" ] || [[ "$path" != /* ]]; then
    return 1
  fi
  local rest="${path#/}" result="" seg
  while [ -n "$rest" ]; do
    seg="${rest%%/*}"
    if [ "$seg" = "$rest" ]; then
      rest=""
    else
      rest="${rest#*/}"
    fi
    case "$seg" in
      "" | ".")
        continue
        ;;
      "..")
        if [ -n "$result" ]; then
          result="${result%/*}"
        fi
        ;;
      *)
        result="${result}/${seg}"
        ;;
    esac
  done
  printf '%s\n' "${result:-/}"
}

is_under_prefix() {
  # true if $1 is equal to or under $2 (both absolute; prefer canonical inputs)
  local path="$1" prefix="$2"
  path="${path%/}"
  prefix="${prefix%/}"
  if [ -z "$path" ] || [ -z "$prefix" ]; then
    return 1
  fi
  # Grant root "/" would match every absolute path via the /* case below.
  if [ "$prefix" = "/" ]; then
    [[ "$path" == /* ]] && return 0
    return 1
  fi
  [ "$path" = "$prefix" ] && return 0
  case "$path" in
    "$prefix"/*) return 0 ;;
    *) return 1 ;;
  esac
}

normalize_prefix() {
  # Resolve path_prefix to a canonical absolute path.
  # Absolute prefixes are normalized as-is; relative are joined under grant root.
  # Lexical only (no symlink expansion) so .. cannot escape via string-prefix tricks.
  # Rejects empty input. Prints canonical path; returns non-zero on invalid.
  local pref="$1" vault="$2"
  local full
  if [ -z "$pref" ]; then
    return 1
  fi
  if [[ "$pref" == /* ]]; then
    full="$pref"
  else
    full="${vault%/}/${pref#./}"
  fi
  canonicalize_abs "$full"
}

# ---------------------------------------------------------------------------
# Build bind list from grants + path_prefixes
# ---------------------------------------------------------------------------
declare -a BIND_ARGS=()
declare -a BOUND_PATHS=()

add_bind() {
  local mode="$1" sandbox_path="$2"
  local src
  src="$(host_src "$sandbox_path")"
  ensure_host_dir "$src" || exit 2
  case "$mode" in
    ro)
      BIND_ARGS+=(--ro-bind "$src" "$sandbox_path")
      ;;
    rw|*)
      BIND_ARGS+=(--bind "$src" "$sandbox_path")
      ;;
  esac
  BOUND_PATHS+=("$sandbox_path")
}

# Extract grants via python once into shell-friendly lines: mode|path|ppo
while IFS='|' read -r g_mode g_path g_ppo; do
  [ -n "$g_path" ] || continue
  g_canon="$(canonicalize_abs "$g_path")" || {
    err "grant path is not a valid absolute path: ${g_path}"
    exit 2
  }
  if [ "$g_ppo" = "1" ]; then
    # path_prefixes_only: bind only CLI --path-prefix values under this root
    if [ "${#PATH_PREFIXES[@]}" -eq 0 ]; then
      log "profile=${PROFILE}: grant ${g_path} is path_prefixes_only and no --path-prefix given; skipping vault bind"
      continue
    fi
    for pref in "${PATH_PREFIXES[@]}"; do
      full="$(normalize_prefix "$pref" "$g_path")" || {
        err "--path-prefix '${pref}' is empty or invalid (must resolve to an absolute path)"
        exit 2
      }
      if ! is_under_prefix "$full" "$g_canon"; then
        err "--path-prefix '${pref}' escapes or is not under grant root ${g_path} (resolved: ${full})"
        exit 2
      fi
      # Bind canonical sandbox dest (no .. components) under the grant root.
      add_bind "$g_mode" "$full"
    done
  else
    # Full grant; optional path_prefixes narrow further when provided
    if [ "${#PATH_PREFIXES[@]}" -gt 0 ]; then
      narrowed=0
      for pref in "${PATH_PREFIXES[@]}"; do
        full="$(normalize_prefix "$pref" "$g_path")" || {
          err "--path-prefix '${pref}' is empty or invalid (must resolve to an absolute path)"
          exit 2
        }
        if is_under_prefix "$full" "$g_canon"; then
          add_bind "$g_mode" "$full"
          narrowed=1
        fi
      done
      # If no prefix fell under this grant root, still bind the full grant
      # only when prefixes targeted other roots (e.g. workspace). Workspace
      # grants without matching prefixes stay full.
      if [ "$narrowed" -eq 0 ]; then
        # Prefixes not under this grant → leave full grant (workspace case)
        # unless this looks like the vault root and prefixes were meant to narrow it.
        # Rule: if any prefix is under g_path we already bound; if none are,
        # bind full grant for non-vault workspaces only when path is not
        # /opt/company-brain, else skip (narrow-empty).
        if [ "$g_path" = "/opt/company-brain" ]; then
          log "path_prefixes set but none under ${g_path}; not binding full vault"
        else
          add_bind "$g_mode" "$g_canon"
        fi
      fi
    else
      add_bind "$g_mode" "$g_canon"
    fi
  fi
done < <(
  printf '%s' "$POLICY_JSON" | python3 -c '
import json, sys
d = json.load(sys.stdin)
for g in d["grants"]:
    ppo = "1" if g.get("path_prefixes_only") else "0"
    print("%s|%s|%s" % (g.get("mode") or "rw", g["path"], ppo))
'
)

# ---------------------------------------------------------------------------
# Env scrub (never pass secret-bearing prefixes into the box)
# ---------------------------------------------------------------------------
ENV_PREFIXES="$(
  printf '%s' "$POLICY_JSON" | python3 -c '
import json, sys
print("\n".join(json.load(sys.stdin).get("never_pass_env_prefixes") or []))
'
)"

scrub_env() {
  # Unset vars matching never_pass_env_prefixes; run in subshell before exec.
  local p
  while IFS= read -r p; do
    [ -n "$p" ] || continue
    # Match PREFIX or PREFIX* (e.g. GATEWAY_ / AWS_)
    local name
    while IFS= read -r name; do
      unset "$name" 2>/dev/null || true
    done < <(compgen -e | while read -r n; do
      case "$n" in
        "$p"*) printf '%s\n' "$n" ;;
      esac
    done)
  done <<< "$ENV_PREFIXES"
  # Placeholders (no real secrets): signal sandbox context to children.
  export OMNIBOX_ACTIVE=1
  export OMNIBOX_PROFILE="$PROFILE"
  # Drop common credential file hints
  unset AWS_SHARED_CREDENTIALS_FILE AWS_CONFIG_FILE AWS_ACCESS_KEY_ID \
    AWS_SECRET_ACCESS_KEY AWS_SESSION_TOKEN 2>/dev/null || true
}

# ---------------------------------------------------------------------------
# Default workdir
# ---------------------------------------------------------------------------
if [ -z "$WORKDIR" ]; then
  if [ "${#BOUND_PATHS[@]}" -gt 0 ]; then
    WORKDIR="${BOUND_PATHS[0]}"
  else
    WORKDIR="/tmp"
  fi
fi

# ---------------------------------------------------------------------------
# Assemble bwrap argv (spike invoke_template)
# ---------------------------------------------------------------------------
BWRAP_ARGS=(
  --die-with-parent
  --unshare-user
  --unshare-pid
)

if [ "$UNSHARE_NET" = "1" ]; then
  BWRAP_ARGS+=(--unshare-net)
fi

BWRAP_ARGS+=(
  --proc /proc
  --dev /dev
)

# Minimal RO rootfs pieces so common tools resolve
for p in /usr /bin /lib; do
  if [ -e "$p" ]; then
    BWRAP_ARGS+=(--ro-bind "$p" "$p")
  fi
done
if [ -e /lib64 ]; then
  BWRAP_ARGS+=(--ro-bind /lib64 /lib64)
fi
if [ -e /etc/ld.so.cache ]; then
  BWRAP_ARGS+=(--ro-bind /etc/ld.so.cache /etc/ld.so.cache)
fi
# Locale / nss often needed; keep RO and small. resolv not useful with unshare-net.
for p in /etc/passwd /etc/group /etc/nsswitch.conf /etc/hosts; do
  if [ -e "$p" ]; then
    BWRAP_ARGS+=(--ro-bind "$p" "$p")
  fi
done

# Empty home: never_grant hermes secrets (tmpfs stubs; host .env not bound)
BWRAP_ARGS+=(
  --tmpfs /tmp
  --tmpfs /home
  --dir /home/hermes
  --dir /home/hermes/.hermes
  --dir /root
)

# Apply policy FS grants
if [ "${#BIND_ARGS[@]}" -gt 0 ]; then
  BWRAP_ARGS+=("${BIND_ARGS[@]}")
fi

# never_grant overlays: if any bound path would expose a never_grant path,
# cover it with tmpfs (best-effort; primary protection is not binding secrets).
while IFS= read -r ng; do
  [ -n "$ng" ] || continue
  # Skip globs for overlay; exact paths only
  case "$ng" in
    *\**) continue ;;
  esac
  for bound in "${BOUND_PATHS[@]+"${BOUND_PATHS[@]}"}"; do
    if is_under_prefix "$ng" "$bound"; then
      BWRAP_ARGS+=(--tmpfs "$ng")
    fi
  done
done < <(
  printf '%s' "$POLICY_JSON" | python3 -c '
import json, sys
for p in json.load(sys.stdin).get("never_grant") or []:
    print(p)
'
)

BWRAP_ARGS+=(--chdir "$WORKDIR")

# Scrub env in this shell, then exec bwrap → command
scrub_env

exec "$OMNIBOX_BWRAP" "${BWRAP_ARGS[@]}" -- "${CMD[@]}"
