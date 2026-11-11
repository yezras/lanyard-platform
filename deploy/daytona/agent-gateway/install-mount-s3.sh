#!/usr/bin/env bash
# Build-time install of Mountpoint for Amazon S3 (mount-s3).
#
# Beads: lp-zuh.9.3 (image bake + snapshot pin), lp-kng.6.2 (prebake design)
# Spike-proven version: 1.23.0
#   docs/plans/0008-daytona-agent-sandboxes/spike-3en-s3-vault-mount.md
#
# Usage (as root, during docker build):
#   install-mount-s3.sh [VERSION]
# Env overrides:
#   MOUNT_S3_VERSION   default 1.23.0
#   MOUNT_S3_ARCH      default: auto from dpkg (x86_64 | arm64)
#   MOUNT_S3_BASE_URL  default https://s3.amazonaws.com/mountpoint-s3-release
#
# Do NOT call from entrypoint.sh (plan §4.3 — no install-on-boot).

set -euo pipefail

VERSION="${1:-${MOUNT_S3_VERSION:-1.23.0}}"
BASE_URL="${MOUNT_S3_BASE_URL:-https://s3.amazonaws.com/mountpoint-s3-release}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "install-mount-s3: must run as root (image build only)" >&2
  exit 1
fi

if ! [[ "${VERSION}" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "install-mount-s3: invalid version '${VERSION}' (expect X.Y.Z)" >&2
  exit 2
fi

if [[ -n "${MOUNT_S3_ARCH:-}" ]]; then
  ARCH="${MOUNT_S3_ARCH}"
else
  dpkg_arch="$(dpkg --print-architecture 2>/dev/null || uname -m)"
  case "${dpkg_arch}" in
    amd64|x86_64) ARCH=x86_64 ;;
    arm64|aarch64) ARCH=arm64 ;;
    *)
      echo "install-mount-s3: unsupported arch '${dpkg_arch}' (need amd64/x86_64 or arm64)" >&2
      exit 1
      ;;
  esac
fi

# Versioned object name (not "latest") so image builds are reproducible.
DEB_NAME="mount-s3-${VERSION}-${ARCH}.deb"
URL="${BASE_URL}/${VERSION}/${ARCH}/${DEB_NAME}"

tmp="$(mktemp -d)"
trap 'rm -rf "${tmp}"' EXIT

echo "install-mount-s3: fetching ${URL}"
curl -fsSL -o "${tmp}/${DEB_NAME}" "${URL}"

# Runtime deps (ca-certificates already in product CLI prebake).
export DEBIAN_FRONTEND=noninteractive
apt-get update
# fuse + libfuse2 provide fusermount; util-linux provides findmnt for entrypoint.
# force-confold: Dockerfile may pre-seed /etc/fuse.conf with user_allow_other
# (lp-zuh.9.4) before the fuse package lands — avoid interactive conffile prompt.
apt-get install -y --no-install-recommends   -o Dpkg::Options::="--force-confdef"   -o Dpkg::Options::="--force-confold"   fuse libfuse2 util-linux
apt-get install -y --no-install-recommends "${tmp}/${DEB_NAME}"
rm -rf /var/lib/apt/lists/*
# Re-assert user_allow_other so non-root brain may pass mount-s3 --allow-other.
if ! grep -Eq '^[[:space:]]*user_allow_other' /etc/fuse.conf 2>/dev/null; then
  echo 'user_allow_other' >> /etc/fuse.conf
fi

command -v mount-s3 >/dev/null
command -v fusermount >/dev/null
got="$(mount-s3 --version 2>&1 | head -1 || true)"
echo "install-mount-s3: installed: ${got}"
if ! echo "${got}" | grep -Eq "mount-s3[[:space:]]+${VERSION}"; then
  echo "install-mount-s3: version mismatch (want ${VERSION}, got '${got}')" >&2
  exit 1
fi
echo "install-mount-s3: fusermount=$(command -v fusermount) arch=${ARCH}"
