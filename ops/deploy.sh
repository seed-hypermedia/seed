#!/bin/sh
# Seed Node Deployment Bootstrap
#
# Downloads the bundled deployment script and runs it with Bun.
# Installs Docker and Bun only if they are not already present.
#
# Usage:
#   sh <(curl -fsSL https://raw.githubusercontent.com/seed-hypermedia/seed/main/ops/deploy.sh)

set -e

SEED_DIR="${SEED_DIR:-/opt/seed}"
SEED_BRANCH="${SEED_BRANCH:-main}"
GH_RAW="https://raw.githubusercontent.com/seed-hypermedia/seed/${SEED_BRANCH}/ops"

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
    echo "ERROR: Bun installation failed. Please install manually: https://bun.sh" >&2
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
