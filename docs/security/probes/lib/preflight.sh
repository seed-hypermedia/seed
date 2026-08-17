#!/usr/bin/env bash
# Preflight gate for Seed security probes. Run this before ANY probe or measurement.
#
#   bash docs/security/probes/lib/preflight.sh [http_port] [grpc_port]
#
# Defaults to the devnet desktop dev ports (58001 / 58002). Exits non-zero naming the gate that
# failed. Its stdout is meant to be pasted into a finding record as evidence entry 0.
#
# The gate that matters most is gate 3: it refuses to let a probe run against a MAINNET daemon.
# Anything published on mainnet reaches real peers and cannot be recalled.
#
# See docs/security/auditor.md sections 1 and 6.1.

set -uo pipefail

HTTP="${1:-58001}"
GRPC="${2:-58002}"
H="http://127.0.0.1:${HTTP}"

fail() {
  echo ""
  echo "PREFLIGHT FAILED at gate $1: $2"
  exit 1
}
ok() { echo "  ok   gate $1: $2"; }
warn() { echo "  WARN gate $1: $2"; }

echo "Seed security preflight -- http=${HTTP} grpc=${GRPC} -- $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# --- gate 1: toolchain environment ------------------------------------------------------------
# The ./dev script exits immediately without DIRENV_DIR, and the toolchain comes from mise+direnv.
if [ -z "${DIRENV_DIR:-}" ]; then
  warn 1 "DIRENV_DIR is unset. Run repo commands as 'direnv exec . <cmd>'."
else
  ok 1 "direnv environment active"
fi

# --- gate 2: daemon reachable, and which build ------------------------------------------------
VERSION_JSON="$(curl -sf -m 3 "${H}/debug/version" 2>/dev/null)" ||
  fail 2 "no daemon answering on ${H}. Start one with 'direnv exec . ./dev run-desktop'."
echo "  ok   gate 2: daemon reachable"
echo "       version: ${VERSION_JSON}"

# --- gate 3: NETWORK ASSERTION (the anti-mainnet guard) ---------------------------------------
CONFIG_JSON="$(curl -sf -m 3 "${H}/hm/api/config" 2>/dev/null)" ||
  fail 3 "cannot read ${H}/hm/api/config, so the network cannot be verified. Refusing to proceed."

if command -v jq >/dev/null 2>&1; then
  PROTOCOL_ID="$(printf '%s' "${CONFIG_JSON}" | jq -r '.protocolId // empty')"
  PEER_ID="$(printf '%s' "${CONFIG_JSON}" | jq -r '.peerId // empty')"
else
  PROTOCOL_ID="$(printf '%s' "${CONFIG_JSON}" | sed -n 's/.*"protocolId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
  PEER_ID="$(printf '%s' "${CONFIG_JSON}" | sed -n 's/.*"peerId"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')"
fi

[ -n "${PROTOCOL_ID}" ] || fail 3 "protocolId missing from /hm/api/config response. Refusing to proceed."

# Mainnet is exactly "/hypermedia/<version>"; a testnet appends "-<name>". Neither the prefix nor
# the version contains a hyphen, so the presence of one is a reliable non-mainnet signal.
case "${PROTOCOL_ID}" in
*-*)
  ok 3 "network is NOT mainnet (protocolId ${PROTOCOL_ID})"
  ;;
*)
  fail 3 "protocolId is ${PROTOCOL_ID} -- this daemon is on MAINNET. Probes must run on devnet.
       Stop this daemon and start 'direnv exec . ./dev run-desktop' instead.
       For anything that publishes, use:
         VITE_DESKTOP_APPDATA=Seed-sec-audit direnv exec . ./dev run-desktop"
  ;;
esac
echo "       peerId: ${PEER_ID}"

# --- gate 4: which process, which data dir, which flags ---------------------------------------
# /debug/pprof/cmdline gives the daemon's argv, which is the only reliable way to see -data-dir
# and -public-only. argv entries are NUL-separated.
CMDLINE="$(curl -sf -m 3 "${H}/debug/pprof/cmdline" 2>/dev/null | tr '\0' '\n')"
if [ -z "${CMDLINE}" ]; then
  warn 4 "could not read /debug/pprof/cmdline (is this request coming from loopback?)"
  DATA_DIR=""
else
  DATA_DIR="$(printf '%s\n' "${CMDLINE}" | sed -n 's/^-\{1,2\}data-dir=\(.*\)$/\1/p' | head -1)"
  ok 4 "daemon argv read"
  echo "       data-dir: ${DATA_DIR:-<default>}"
  case "${DATA_DIR}" in
  *Seed-sec-audit*) echo "       throwaway data dir -- safe for probes that publish" ;;
  *) echo "       NOT a throwaway data dir. Read-only and load probes are fine here." ;;
  esac
  echo "       WRITE PROBES: only proceed if data-dir contains 'Seed-sec-audit' (agent rule 4)."
fi

# --- gate 5: PublicOnly state (changes which findings are even reachable) ----------------------
if [ -n "${CMDLINE}" ]; then
  if printf '%s\n' "${CMDLINE}" | grep -q -- '-public-only'; then
    ok 5 "daemon is running with -public-only (gateway/hosted mode)"
  else
    ok 5 "daemon is NOT public-only (desktop mode). The VULN-1..8 family only reproduces with -public-only."
  fi
fi

# --- gate 6: gRPC reachable and reflecting ----------------------------------------------------
if command -v grpcurl >/dev/null 2>&1; then
  if grpcurl -plaintext -max-time 5 "127.0.0.1:${GRPC}" list >/dev/null 2>&1; then
    ok 6 "gRPC on ${GRPC} is up and reflecting"
  else
    warn 6 "gRPC on ${GRPC} did not answer a reflection query"
  fi
else
  warn 6 "grpcurl not installed. Use ${H}/debug/grpcui/ or the web /api/* surface instead."
fi

# --- gate 7: logs are not suppressed ----------------------------------------------------------
# mprocs.yaml sets SEED_LOG_ONLY=seed/vault-merge on the desktop pane, silencing nearly everything.
if [ -n "${SEED_LOG_ONLY:-}" ]; then
  warn 7 "SEED_LOG_ONLY=${SEED_LOG_ONLY} is set -- most daemon logging is suppressed.
       Raise a subsystem at runtime instead of restarting:
         curl -s -X POST ${H}/debug/logs -d '{\"subsystem\":\"seed/syncing\",\"level\":\"debug\"}'"
else
  ok 7 "SEED_LOG_ONLY not set in this shell"
fi

# --- gate 8: quiescence baseline --------------------------------------------------------------
# Any measurement taken from a busy or mid-reindex daemon produces both false positives and
# false negatives. Capture the idle CPU rate and the read-pool size.
scrape_cpu() {
  curl -sf -m 5 "${H}/debug/metrics" 2>/dev/null |
    awk '/^process_cpu_seconds_total/ {print $2; exit}'
}
NPROC_METRIC="$(curl -sf -m 5 "${H}/debug/metrics" 2>/dev/null |
  awk '/^process_num_cpus/ {print $2; exit}')"

C0="$(scrape_cpu)"
sleep 10
C1="$(scrape_cpu)"

if [ -n "${C0}" ] && [ -n "${C1}" ]; then
  IDLE_CORES="$(awk -v a="${C0}" -v b="${C1}" 'BEGIN{printf "%.3f", (b-a)/10}')"
  P="$(awk -v n="${NPROC_METRIC:-0}" 'BEGIN{printf "%d", (n<12)?12:n}')"
  ok 8 "idle baseline captured over 10s"
  echo "       idle_cpu_cores: ${IDLE_CORES}"
  echo "       read_pool_size P: ${P}  (max(process_num_cpus, 12))"
  echo "       RPS_to_saturate = P / hold_p99  -- read hold_p99 from ${H}/debug/sqlite"
  BUSY="$(awk -v i="${IDLE_CORES}" 'BEGIN{print (i>0.20)?"yes":"no"}')"
  if [ "${BUSY}" = "yes" ]; then
    warn 8 "daemon is NOT quiescent (${IDLE_CORES} cores at idle). Wait for it to settle before measuring,
       or your baseline will absorb the very work you are trying to measure."
  fi
else
  warn 8 "could not scrape process_cpu_seconds_total; amplification numbers will not be trustworthy"
fi

echo ""
echo "PREFLIGHT PASSED -- protocolId=${PROTOCOL_ID} data-dir=${DATA_DIR:-<default>}"
