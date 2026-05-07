#!/usr/bin/env bash
# Subscribe the local daemon to the production site so it mirrors all docs,
# capability blobs, and comments. Idempotent — relies on a flag file to avoid
# re-subscribing on every boot. Run as user `km`.
#
# Usage:
#   bash bootstrap-subscription.sh <hm://site> [<KM_AID>]
#
# The first arg is the site to subscribe (recursive). The optional second arg
# is the agent's account id; if provided, the script also waits until a
# WRITER capability for that account has converged locally.

set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "usage: $0 <hm://site> [<writer-account-id>]" >&2
  exit 2
fi

SITE="$1"
WRITER_AID="${2:-}"
LOCAL_DAEMON="${SEED_LOCAL_DAEMON_URL:-http://127.0.0.1:3000}"
STATE_DIR="${KM_STATE_DIR:-$HOME/km-state}"
FLAG="$STATE_DIR/subscribed.flag"

mkdir -p "$STATE_DIR"

if [[ -f "$FLAG" ]] && grep -qF "$SITE" "$FLAG"; then
  echo "[bootstrap] subscription for $SITE already recorded, skipping subscribe RPC"
else
  # Always async — the daemon's first DiscoverObject can run for ~10 minutes,
  # but the Remix /api proxy times the underlying socket out far sooner. We
  # poll sync-status below to know when it's actually ready.
  echo "[bootstrap] subscribing local daemon to $SITE (recursive, async)"
  /home/km/.local/bin/seed-cli -s "$LOCAL_DAEMON" site subscribe "$SITE" --recursive
  echo "$SITE" >> "$FLAG"
fi

# Wait until a writer cap is locally cached for the agent. Up to 15 minutes,
# nudging the daemon every 30s to keep the smart-sync hot.
if [[ -n "$WRITER_AID" ]]; then
  echo "[bootstrap] waiting for WRITER capability of $WRITER_AID on $SITE to converge"
  for i in $(seq 1 180); do
    STATUS=$(/home/km/.local/bin/seed-cli -s "$LOCAL_DAEMON" site sync-status "$SITE" --writer "$WRITER_AID" -q || true)
    if [[ "$STATUS" == "ready" ]]; then
      echo "[bootstrap] ready_for_writes=true after $i polls"
      exit 0
    fi
    # Nudge the daemon every 30s.
    if (( i % 6 == 0 )); then
      /home/km/.local/bin/seed-cli -s "$LOCAL_DAEMON" site reconcile -q || true
    fi
    sleep 5
  done
  echo "[bootstrap] WARN: writer cap did not converge in 15min — agent will still start, will keep retrying via km-poll preflight" >&2
  exit 0
fi
