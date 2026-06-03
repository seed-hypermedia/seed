#!/usr/bin/env bash
# Phase 1 — Server bootstrap on oc.hyper.media.
# Idempotent. Safe to re-run.
#
# Usage:
#   bash seed-knowledge-manager/agent/scripts/install-phase1.sh ubuntu@oc.hyper.media
#
# What it does:
#   - Installs OS dependencies (libsecret tools, bubblewrap, node, pipx, jq, rsync).
#   - Creates system user `km` with linger enabled and added to the `docker` group.
#   - Drops the seed-daemon docker compose file under /home/km/seed-daemon/.
#   - Installs systemd --user unit for the seed-daemon container.
#   - Starts the daemon and waits for /debug/version on 127.0.0.1:55001.

set -euo pipefail

if [[ $# -ne 1 ]]; then
  echo "usage: $0 <ssh-target>" >&2
  exit 2
fi

TARGET="$1"
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
AGENT_DIR="$REPO_ROOT/seed-knowledge-manager/agent"

echo "==> Phase 1 bootstrap on $TARGET"

# ---- Step 1: apt packages -------------------------------------------------
ssh "$TARGET" 'sudo bash -s' <<'REMOTE_APT'
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq \
  python3.12 python3.12-venv pipx \
  libsecret-1-0 libsecret-tools dbus-user-session bubblewrap \
  nodejs npm jq curl rsync logrotate
REMOTE_APT

# ---- Step 2: km user, linger, docker group -------------------------------
ssh "$TARGET" 'sudo bash -s' <<'REMOTE_USER'
set -euo pipefail
if ! getent passwd km >/dev/null; then
  useradd --create-home --shell /bin/bash km
  echo "[+] created user km"
fi
usermod -aG docker km || true
loginctl enable-linger km
install -d -m 700 -o km -g km /home/km/seed-daemon /home/km/seed-daemon/data
install -d -m 700 -o km -g km /home/km/.config/systemd/user
install -d -m 700 -o km -g km /home/km/.local/bin
REMOTE_USER

# ---- Step 3: drop compose file + systemd unit ----------------------------
TMP=$(ssh "$TARGET" 'mktemp -d')
trap 'ssh "$TARGET" "rm -rf $TMP"' EXIT
rsync -avz "$AGENT_DIR/seed-daemon/compose.yaml" "$TARGET:$TMP/compose.yaml"
rsync -avz "$AGENT_DIR/systemd/seed-daemon.service" "$TARGET:$TMP/seed-daemon.service"

ssh "$TARGET" "sudo install -m 644 -o km -g km '$TMP/compose.yaml' /home/km/seed-daemon/compose.yaml"
ssh "$TARGET" "sudo install -m 644 -o km -g km '$TMP/seed-daemon.service' /home/km/.config/systemd/user/seed-daemon.service"

# ---- Step 4: enable + start daemon ---------------------------------------
ssh "$TARGET" 'sudo -u km XDG_RUNTIME_DIR=/run/user/$(id -u km) bash -s' <<'REMOTE_DAEMON'
set -euo pipefail
export XDG_RUNTIME_DIR="/run/user/$(id -u)"
systemctl --user daemon-reload
systemctl --user enable seed-daemon.service
systemctl --user start seed-daemon.service
REMOTE_DAEMON

# NOTE on seed-cli:
#   The published `@seed-hypermedia/cli@0.1.4` on npm currently has an
#   unresolved `workspace:*` dep (`@seed-hypermedia/client`) which makes
#   `npx -y @seed-hypermedia/cli` fail with `Unsupported URL Type "workspace:"`.
#   We deliberately do NOT install seed-cli in Phase 1. Phase 2 builds it from
#   this repo's `frontend/apps/cli/` workspace (pnpm + bun) on the server.

# ---- Step 5: wait for HTTP API -------------------------------------------
echo "==> waiting for daemon HTTP API on 127.0.0.1:55001"
for i in $(seq 1 30); do
  if ssh "$TARGET" 'curl -fsS http://127.0.0.1:55001/debug/version >/dev/null 2>&1'; then
    echo "==> daemon healthy after $i tries"
    ssh "$TARGET" 'curl -s http://127.0.0.1:55001/debug/version'
    echo
    exit 0
  fi
  sleep 2
done

echo "!! daemon did not become healthy in 60s" >&2
ssh "$TARGET" 'sudo -u km XDG_RUNTIME_DIR=/run/user/$(id -u km) journalctl --user -u seed-daemon.service --no-pager -n 100' || true
exit 1
