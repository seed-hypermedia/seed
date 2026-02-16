#!/bin/sh
# Seed Node Deployment Bootstrap
#
# Downloads the bundled deployment script and runs it with Bun.
# Installs Docker and Bun only if they are not already present.
#
# We use Bun as the production runtime (not Node.js) so that what developers
# test locally is exactly what runs on servers — one runtime, zero mismatch.
# Bun requires glibc >= 2.25, so older distros (CentOS 7, Amazon Linux 2, etc.)
# are not supported. The script checks this upfront and exits with a clear message.
#
# Usage:
#   sh <(curl -fsSL https://raw.githubusercontent.com/seed-hypermedia/seed/main/ops/deploy.sh)

set -e

SEED_DIR="${SEED_DIR:-/opt/seed}"
SEED_BRANCH="${SEED_BRANCH:-main}"
GH_RAW="https://raw.githubusercontent.com/seed-hypermedia/seed/${SEED_BRANCH}/ops"
MIN_GLIBC="2.25"

command_exists() {
  command -v "$@" > /dev/null 2>&1
}

info() {
  echo "===> $*"
}

ensure_dir() {
  if [ ! -d "$1" ]; then
    if [ -w "$(dirname "$1")" ]; then
      mkdir -p "$1"
    else
      info "Creating $1 (requires sudo)"
      sudo mkdir -p "$1"
      sudo chown "$(id -u):$(id -g)" "$1"
    fi
  fi
}

# Compare two dotted version strings. Returns 0 (true) if $1 >= $2.
version_gte() {
  # printf trick: pad each component to 3 digits, then compare lexicographically
  local v1; v1=$(printf '%03d%03d' $(echo "$1" | tr '.' ' '))
  local v2; v2=$(printf '%03d%03d' $(echo "$2" | tr '.' ' '))
  [ "$v1" -ge "$v2" ]
}

check_glibc() {
  if ! command_exists ldd; then
    info "Warning: Cannot determine glibc version (ldd not found). Proceeding anyway."
    return
  fi

  glibc_version=$(ldd --version 2>&1 | head -1 | grep -oE '[0-9]+\.[0-9]+$' || true)
  if [ -z "$glibc_version" ]; then
    info "Warning: Could not parse glibc version. Proceeding anyway."
    return
  fi

  if ! version_gte "$glibc_version" "$MIN_GLIBC"; then
    cat >&2 <<EOF

ERROR: Your system's glibc version ($glibc_version) is too old.
Bun requires glibc >= $MIN_GLIBC to run.

Minimum supported operating systems:
  - Ubuntu 18.04+
  - Debian 10+
  - CentOS/RHEL 8+
  - Fedora 28+
  - Amazon Linux 2023+

Please upgrade your operating system and re-run this script.

EOF
    exit 1
  fi

  info "glibc $glibc_version detected (>= $MIN_GLIBC). OK."
}

check_glibc

if ! command_exists docker; then
  info "Installing Docker (requires sudo)..."
  curl -fsSL https://get.docker.com -o /tmp/install-docker.sh
  sudo sh /tmp/install-docker.sh
  rm -f /tmp/install-docker.sh
  info "Docker installed."
else
  info "Docker already installed: $(docker --version)"
fi

if ! command_exists bun; then
  info "Installing Bun..."
  curl -fsSL https://bun.sh/install | bash
  export BUN_INSTALL="${HOME}/.bun"
  export PATH="${BUN_INSTALL}/bin:${PATH}"
  if ! command_exists bun; then
    echo "ERROR: Bun installation failed." >&2
    echo "This may be a glibc compatibility issue. Bun requires glibc >= $MIN_GLIBC." >&2
    echo "Check your version with: ldd --version" >&2
    exit 1
  fi
  info "Bun installed: $(bun --version)"
else
  info "Bun already installed: $(bun --version)"
fi

ensure_dir "${SEED_DIR}"

info "Downloading deployment script..."
curl -fsSL "${GH_RAW}/dist/deploy.js" -o "${SEED_DIR}/deploy.js"

info "Running deployment script..."
exec bun "${SEED_DIR}/deploy.js"
