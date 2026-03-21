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
#   sh <(curl -fsSL https://deploy.seed.hyper.media/deploy.sh)

set -e

SEED_DIR="${SEED_DIR:-/opt/seed}"
SEED_BRANCH="${SEED_BRANCH:-main}"
GH_RAW="${SEED_DEPLOY_URL:-https://raw.githubusercontent.com/seed-hypermedia/seed/${SEED_BRANCH}/ops}"
GH_RELEASES_API="https://api.github.com/repos/seed-hypermedia/seed/releases/latest"
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

if ! command_exists unzip; then
  info "Installing unzip (required for Bun)..."
  installed_unzip=0
  if command_exists apt-get; then
    # apt-get update may fail on EOL distros with broken repos, so we try
    # installing without update first, then with update, then fall through.
    if sudo apt-get install -y -qq unzip 2>/dev/null; then
      installed_unzip=1
    elif sudo apt-get update -qq 2>/dev/null && sudo apt-get install -y -qq unzip 2>/dev/null; then
      installed_unzip=1
    fi
  fi
  if [ "$installed_unzip" = 0 ] && command_exists dnf; then
    sudo dnf install -y -q unzip && installed_unzip=1
  fi
  if [ "$installed_unzip" = 0 ] && command_exists yum; then
    sudo yum install -y -q unzip && installed_unzip=1
  fi
  if [ "$installed_unzip" = 0 ] && command_exists apk; then
    sudo apk add --quiet unzip && installed_unzip=1
  fi
  if [ "$installed_unzip" = 0 ] && command_exists busybox && busybox unzip -l /dev/null >/dev/null 2>&1; then
    # busybox provides a built-in unzip applet on many minimal systems.
    info "Using busybox unzip as fallback..."
    sudo ln -sf "$(command -v busybox)" /usr/local/bin/unzip
    installed_unzip=1
  fi
  if [ "$installed_unzip" = 0 ]; then
    echo "ERROR: 'unzip' is required to install Bun but could not be installed automatically." >&2
    echo "Your system's package manager could not install it (repositories may be" >&2
    echo "broken or the OS may have reached end-of-life)." >&2
    echo "Please install 'unzip' manually and re-run this script." >&2
    exit 1
  fi
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
# Try to fetch deploy.js from the latest GitHub Release asset (production).
# Falls back to the raw GitHub URL if the release API is unreachable or
# the asset is not found (e.g. before the first release with deploy.js).
DEPLOY_JS_URL=""
if [ -z "${SEED_DEPLOY_URL:-}" ]; then
  DEPLOY_JS_URL=$(curl -fsSL "$GH_RELEASES_API" 2>/dev/null \
    | grep -o '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]*deploy\.js"' \
    | head -1 \
    | sed 's/.*"browser_download_url"[[:space:]]*:[[:space:]]*"\(.*\)"/\1/' \
    || true)
fi
if [ -z "$DEPLOY_JS_URL" ]; then
  info "Release asset not found, falling back to raw GitHub URL..."
  DEPLOY_JS_URL="${GH_RAW}/dist/deploy.js"
fi
curl -fsSL "$DEPLOY_JS_URL" -o "${SEED_DIR}/deploy.js"

# Install the 'seed-deploy' CLI wrapper so users can run commands from anywhere.
# /usr/local/bin is in $PATH on every UNIX system, so no shell-config changes
# are needed. If we can't write there we try sudo; if that also fails we skip
# the wrapper and let deploy.js show curl-based hints instead.
BUN_PATH="$(command -v bun)"
WRAPPER="/usr/local/bin/seed-deploy"
WRAPPER_CONTENT="#!/bin/sh
exec \"${BUN_PATH}\" \"${SEED_DIR}/deploy.js\" \"\$@\""

SEED_DEPLOY_CLI_INSTALLED=0
if [ -w /usr/local/bin ]; then
  printf '%s\n' "$WRAPPER_CONTENT" > "$WRAPPER"
  chmod +x "$WRAPPER"
  SEED_DEPLOY_CLI_INSTALLED=1
  info "Installed 'seed-deploy' command at ${WRAPPER}"
elif command_exists sudo; then
  info "Installing seed-deploy to /usr/local/bin (requires sudo)"
  if printf '%s\n' "$WRAPPER_CONTENT" | sudo tee "$WRAPPER" > /dev/null 2>&1 \
     && sudo chmod +x "$WRAPPER"; then
    SEED_DEPLOY_CLI_INSTALLED=1
    info "Installed 'seed-deploy' command at ${WRAPPER}"
  else
    info "Warning: Could not install 'seed-deploy' to /usr/local/bin."
    info "You can still manage your node by re-running the curl command with flags."
  fi
else
  info "Warning: Could not install 'seed-deploy' to /usr/local/bin (no write access and sudo not available)."
  info "You can still manage your node by re-running the curl command with flags."
fi

export SEED_DEPLOY_CLI_INSTALLED

info "Running deployment script..."
exec bun "${SEED_DIR}/deploy.js" "$@" </dev/tty
