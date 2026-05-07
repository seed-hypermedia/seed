# Knowledge Manager Agent

Autonomous **Moderador de Redes** (LAFH/GC-Red methodology, see `seed-knowledge-manager/SKILL.md`) for a Seed Hypermedia community. Runs on `oc.hyper.media`. **Governed by Seed documents**, not local config.

## What this is

> Headline goal: prove that an agent can be governed by Seed documents — its charter, its allow/deny path rules, its draft-only kill-switch — instead of local YAML/markdown.

Production deployment connects against community site `hm://z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno`. Agent identity is `KM_AID = z6Mkh11xNzNLTrkDEjmPf19twBvAVsw3HoQtv5nPKVVbEUSJ`.

The agent:
- Polls the site every 15 seconds for `@knowledge-manager` and `@<site>` mentions in comments.
- Posts a placeholder reply ("Working on this — back in a moment. ⌛") within ~1–2s of detection so members get a typing-indicator equivalent.
- Searches the community corpus (`seed-cli search`) for documents relevant to the question, fetches them, and feeds them to DeepSeek as grounding context. With `KM_USE_MASTRA_AGENT=1` this becomes a bounded tool-call loop where the model itself decides which docs / threads / profiles to pull (≤30 tool calls before a forced `final_answer`).
- Edits the placeholder in place (or replies in a fresh top-level comment if seed-cli's `--reply` chain breaks) with the final answer, citing hm:// URLs.
- Runs three scheduled cadences via systemd timers — weekly bulletin (Mon 09:00 UTC), gap report (Wed 10:00 UTC), monthly health report (1st of month 09:00 UTC) — each producing a Seed document under `/agents/knowledge-manager/state/...`.
- Captures every action — LLM call, tool call, seed-cli invocation, mention enqueued, reply posted — to a per-run audit directory under `~km/km-logs/runs/`.
- Runs entirely against a fully-subscribed local Seed daemon when `KM_USE_LOCAL_DAEMON=1`. A preflight `site sync-status` check refuses to run unless the daemon has both the subscription and the writer capability blob locally cached.
- Models the per-mention lifecycle (detected → placeholder → agent → finalised) as an XState v5 actor with retry/backoff and JSONL snapshot/replay when `KM_USE_STATE_MACHINE=1`. Killing the service mid-run resumes mid-flight on restart.

The agent's policy lives entirely in four Seed documents the operator can edit from any desktop client. Toggling `draft_only: true` in the rules doc disables doc-creating writes within ≤60s. The wrapper hardcodes a denylist that prevents the agent from rewriting its own rules.

## Architecture

```
┌──────────────────────────── oc.hyper.media (Ubuntu 24.04) ────────────────────────────┐
│                                                                                       │
│  systemd --user (linger enabled, user "km"):                                          │
│                                                                                       │
│   ┌──────────────────────┐   ┌────────────────────┐   ┌────────────────────┐          │
│   │ seed-daemon.service  │   │ km-poll.timer      │   │ km-boletin.timer   │          │
│   │ (docker compose)     │   │  every 15s         │   │  Mon 09:00 UTC     │          │
│   └─────────┬────────────┘   │  → poll-cli.js     │   │  → cadence-cli.js  │          │
│             │                └────────────────────┘   └────────────────────┘          │
│             ▼                ┌────────────────────┐   ┌────────────────────┐          │
│   ┌──────────────────────┐   │ km-gap.timer       │   │ km-health.timer    │          │
│   │ km-seed-daemon       │   │  Wed 10:00 UTC     │   │  1st  09:00 UTC    │          │
│   │ km-seed-web (:3000)  │   │  → cadence-cli.js  │   │  → cadence-cli.js  │          │
│   │ (docker)             │   └────────────────────┘   └────────────────────┘          │
│   └──────────────────────┘   ┌────────────────────┐                                   │
│                              │ km-telegram.service│   ┌────────────────────┐          │
│                              │ (long-running)     │   │ nanobot-gateway    │          │
│                              │  → telegram-bot.js │   │ :18791 (optional)  │          │
│                              └────────────────────┘   └────────────────────┘          │
│                                                                                       │
│  ~/km-agent/mcp/seed-cli-mcp/dist/                                                    │
│    poll-cli.js     ← mention polling + typing-indicator + grounded reply              │
│    cadence-cli.js  ← weekly/monthly LAFH outputs                                      │
│    telegram-bot.js ← operator chat surface                                            │
│    index.js        ← stdio MCP wrapper used by the (optional) nanobot gateway         │
│                                                                                       │
│  ~/km-state/                                                                          │
│    activity-cursor.json   processed.jsonl    placeholders.jsonl    rate-counters.json │
│                                                                                       │
│  ~/km-logs/   runs/<UTC-ISO>__<trigger>__<ulid>/   index.jsonl   current → runs/...   │
│                                                                                       │
└────────────────────────────────────────────────────┬──────────────────────────────────┘
                                                    │
                                  HTTPS              │  outbound
       ┌──────────────────────────────────────────────┤
       ▼                                              ▼
   api.deepseek.com                          hyper.media (P2P + REST)
   (one chat completion / answer)            (read activity, post comments,
                                              fetch governance, search corpus)
```

Components:

- **Local Seed daemon** (Docker `seedhypermedia/site:latest`, runs as a pure peer): ports `55000` (P2P, public) and `127.0.0.1:55001` HTTP / `:55002` gRPC (loopback). Plus `seed-web:latest` on `127.0.0.1:3000` because `seed-cli` speaks the Remix `/api/<RPC>` shape, not raw gRPC-Web. With `KM_USE_LOCAL_DAEMON=1` the wrapper points at `http://127.0.0.1:3000` and refuses to run until `seed-cli site sync-status` reports `ready_for_writes=true`.
- **seed-cli** built from this repo's `frontend/apps/cli/` and dropped at `/home/km/.local/bin/seed-cli`. Published `@seed-hypermedia/cli@0.1.4` on npm has an unresolved `workspace:*` dep that breaks `npx`, so we ship a Bun-bundled binary instead.
- **secret-tool shim** at `/home/km/.local/bin/secret-tool` (file-backed, `chmod 600` JSON in `~/.config/seed-keyring/secrets.json`). Replaces `gnome-keyring`/`libsecret`, which can't bootstrap on a headless server. Same on-wire format as the OS keyring entries seed-cli expects.
- **Custom Bun-bundled drivers** (one ~430 KB `dist/index.js` + smaller per-task bundles): `poll-cli.js`, `cadence-cli.js`, `telegram-bot.js`, plus the optional MCP wrapper `index.js` for nanobot.
- **DeepSeek** (`https://api.deepseek.com/v1/chat/completions`) as the LLM. One deterministic chat call per mention in legacy mode; bounded tool-call loop (≤30 calls + mandatory `final_answer`) when `KM_USE_MASTRA_AGENT=1`.
- **XState v5 supervisor** — replaces the implicit two-pass placeholder/finalise loop with explicit per-mention machines, retry/backoff, and crash-resume via JSONL snapshots. Behind `KM_USE_STATE_MACHINE=1`.
- **Mastra-style agent loop** — natural-language chat surface for both Telegram operator/community DMs and the polling finalise step. Re-implements the Mastra slice we need (tool registration → bounded loop → multi-turn history) directly, since the npm SDK's Vite/Hono dep graph does not bundle cleanly with `bun build`. Behind `KM_USE_MASTRA_AGENT=1`.

We started with HKUDS/nanobot orchestrating the polling loop, but DeepSeek kept getting stuck in `read_file/grep` loops on nanobot's tool-result-spilled-to-disk pattern. The polling driver is now a deterministic Bun script that does one DeepSeek call per question and posts the reply directly. The `nanobot gateway` process can stay running for free-form interactive use, but it is no longer on the critical path.

## What changed in this iteration

Three workstreams ship behind feature flags so the legacy paths remain the default until each is verified live. Flip them in `secrets.env` one at a time.

### Workstream A — Self-contained operation against the local daemon (`KM_USE_LOCAL_DAEMON`)

Before this change the wrapper called the public gateway (`https://hyper.media`) for every read because the local daemon's smart-sync lagged on capability blobs. We now treat the local daemon as the source of truth.

**New seed-cli commands** (defined in `frontend/apps/cli/src/commands/site.ts`):

```bash
# Subscribe the local daemon to a site, recursively. --wait blocks until the
# first DiscoverObject completes (async=false at the gRPC layer).
seed-cli -s http://127.0.0.1:3000 site subscribe hm://<SITE> --recursive --wait

# Drop a subscription.
seed-cli -s http://127.0.0.1:3000 site unsubscribe hm://<SITE>

# Read what the daemon is mirroring.
seed-cli -s http://127.0.0.1:3000 site list-subscriptions

# Composite check: subscription present + at least one writer cap locally
# cached for the agent. Returns ready_for_writes:true when both hold.
seed-cli -s http://127.0.0.1:3000 site sync-status hm://<SITE> --writer z6Mkh11x...

# Force the daemon's smart-sync to run immediately (wraps Daemon.ForceSync).
seed-cli -s http://127.0.0.1:3000 site reconcile
```

Under the hood these wrap the existing `com.seed.activity.v1alpha.Subscriptions` and `Daemon.ForceSync` gRPC RPCs. We exposed them through the Remix `/api/<RPC>` surface by adding the corresponding entries to `HMGetRequestSchema`/`HMActionSchema` in `frontend/packages/client/src/hm-types.ts` and the implementations under `frontend/packages/shared/src/api-subscriptions.ts` + `api-force-sync.ts`.

**Bootstrap script** `agent/scripts/bootstrap-subscription.sh` is idempotent — it records the site in `~/km-state/subscribed.flag` after the first subscribe, then waits up to 5 min for the writer capability to converge before exiting. Runs once on first deploy; safe to re-run on any subsequent deploy.

**Periodic ForceSync** (`km-reconcile.timer`/`.service`) calls `seed-cli site reconcile` every 60 s. This is a userland band-aid; the proper backend fix is below.

**Backend scheduler change** — `backend/hmnet/syncing/scheduler.go` now extends a subscription task's `hotDeadline` past its `nextRunTime` when `--syncing.subscription-hot-tier=true`. The dispatcher's lazy migration then promotes the task into the hot tier at dispatch time, so capability/comment blobs for subscribed sites no longer compete with cold ephemeral discovery requests. New flag in `backend/config/config.go`:

```bash
seed-daemon ... --syncing.subscription-hot-tier=true
```

Once this rolls out the `km-reconcile.timer` can be removed.

**Preflight in poll-cli** — when `KM_USE_LOCAL_DAEMON=1`, the driver runs `site sync-status` before the poll loop and exits cleanly (status=`denied`, event `preflight_skipped`) if the local daemon does not yet have the writer cap. Prevents writes against a stale local mirror.

### Workstream B — XState v5 polling pipeline (`KM_USE_STATE_MACHINE`)

The legacy two-pass loop in `poll-cli.ts` (Pass A posts placeholders, Pass B finalises) has no formal state, no retry/backoff, and no resume-after-crash semantics beyond idempotency keys. Workstream B replaces Pass B with a per-mention XState v5 actor and a supervisor that persists every transition.

**Files**:
- `src/machines/mention-machine.ts` — the actor definition.
- `src/machines/supervisor.ts` — actor lifecycle, JSONL persistence, `rehydrate()` for crash-replay.
- `src/machines/poll-driver.ts` — glue called from `poll-cli.ts` Pass B when the flag is on.

**State graph**:

```
detected → enqueued → placeholder_pending → placeholder_posted →
agent_running → draft_ready → finalising → done

   ↓ guards               ↓ retries (3, exp backoff 2s base)
skipped_not_allowed    agent_backoff / finalise_backoff
cap_exceeded           failed_terminal
```

Guards on `enqueued` enforce the existing governance limits (`maxCommentsPerRun`, `maxCommentsPerDay`, `moderation.blockedAuthors`) — same `limits.ts` checks as the legacy path, but now first-class transitions with named terminal states.

**Snapshot / replay**: every state transition appends one JSON line to `${KM_STATE_DIR}/machines/<mentionId>.jsonl`. On startup the supervisor scans the directory, replays each file's events into a fresh actor, and resumes mid-flight. JSONL matches the existing `placeholders.jsonl` / `processed.jsonl` pattern — no new infra, easy to grep, easy to tail.

**Inspectability**: each transition also emits a trace event (`state_machine_enabled`, `state_machine_rehydrated`) into `trace.jsonl`. `@xstate/inspect` can be enabled in dev for visual debugging.

### Workstream C — Natural-language agent surface (`KM_USE_MASTRA_AGENT`)

Replaces the single deterministic DeepSeek call with a bounded tool-call loop. The model is given the question + a set of tools and decides which to call before producing a final answer. This delivers the original goal of "users communicate with the agent in natural language and the agent dynamically expands context (thread roots, linked docs, related search results)".

**Files**:
- `src/agent/mastra-agent.ts` — the loop. ≤30 tool calls per turn, then a forced `final_answer` step.
- `src/agent/tools-bridge.ts` — in-process tool registry: `seed_search`, `seed_get_doc`, `seed_get_comment_thread`, `seed_get_account_profile`. Each tool wraps a `seed-cli` subprocess.
- `src/agent/prompts.ts` — community vs operator system prompts.
- `src/tools.ts` — same surface also exposed as MCP tools (`seed_get_comment_thread`, `seed_site_sync_status`) for the optional nanobot gateway.

**Why "Mastra-style" rather than the Mastra SDK directly**: the npm Mastra package depends on Vite + Hono and does not bundle cleanly with `bun build --target node --minify`. We re-implement the small slice we actually need (tool registration → bounded loop → multi-turn history) and keep the surface compatible so a future swap to the SDK is mechanical. See the header of `mastra-agent.ts`.

**Telegram surface**: when the flag is on, both `/ask` (operator) and free-form DMs route through the Mastra loop with per-chat-id history. The legacy path (single `draftReply` / `draftSystemReply` call) remains as fallback.

**Polling surface**: `poll-driver.ts` wires the agent into the `agent_running` state of each mention's machine. The supervisor's retry-with-backoff therefore wraps the agent loop — a 429 from DeepSeek triggers the exponential backoff before re-entering `agent_running`.

**DeepSeek tool-call hardening**: known DeepSeek issues (#244, #336, #946) are mitigated by:
1. Hard tool budget = 30. After 30 calls the model is forced into `final_answer` via `tool_choice: {type: 'function', function: {name: 'final_answer'}}`.
2. Mandatory `final_answer` tool ensures explicit termination instead of "model just stops".
3. Tool results are ≤4 KB (`MAX_DOC_CHARS`) and never paths to disk — so no `read_file/grep` loop pathology.

## Governance — the four Seed documents

All four exist on the production site:

| Doc | Path | Purpose |
| --- | --- | --- |
| `agent-charter`   | `/agents/knowledge-manager/charter`   | Community purpose, voice, scope, off-topics. Human-editable. |
| `agent-rules`     | `/agents/knowledge-manager/rules`     | Machine-readable YAML block at `# ----- machine-readable rules begin -----`. Hard policy: allow/deny paths, caps, draft-only kill-switch, mention trigger, invoker source (`writer-capabilities` or `allowlist-doc`), language. |
| `agent-runbook`   | `/agents/knowledge-manager/runbook`   | Soft instructions on tone, escalation, formatting overrides. |
| `agent-allowlist` | `/agents/knowledge-manager/allowlist` | Optional invoker list when `mentions.invoker_source: allowlist-doc`. |

Edit any of them from desktop. The agent re-reads them on every run (60 s TTL cache). The wrapper additionally hardcodes a denylist over those four paths so the agent itself cannot rewrite its own constraints.

### Kill switch

In `agent-rules`, set `draft_only: true`. Within 60 s the cadence drivers will refuse `seed-cli document create` calls and `poll-cli` will continue posting comments only (no doc writes). To force immediate refresh: `systemctl --user restart nanobot-gateway` on the server (clears the in-process cache).

## Operator — quick reference

```bash
ssh ubuntu@oc.hyper.media

# All systemd state belongs to user `km`.
sudo -u km XDG_RUNTIME_DIR=/run/user/$(id -u km) systemctl --user list-timers

# Watch the latest run live.
sudo -u km bash -lc '/home/km/.local/bin/km-log tail'

# Recent runs.
sudo -u km bash -lc '/home/km/.local/bin/km-log latest 10'

# Print a specific run.
sudo -u km bash -lc '/home/km/.local/bin/km-log show 01KQYG…'

# Find all runs that touched a comment id.
sudo -u km bash -lc '/home/km/.local/bin/km-log mention z6Gd...'

# Force an immediate poll (typing-indicator pattern still applies).
sudo -u km XDG_RUNTIME_DIR=/run/user/$(id -u km) systemctl --user start km-poll.service

# Force a weekly bulletin / gap / health right now.
sudo -u km XDG_RUNTIME_DIR=/run/user/$(id -u km) systemctl --user start km-boletin.service
sudo -u km XDG_RUNTIME_DIR=/run/user/$(id -u km) systemctl --user start km-gap.service
sudo -u km XDG_RUNTIME_DIR=/run/user/$(id -u km) systemctl --user start km-health.service

# Restart the optional nanobot gateway (also clears the rules cache).
sudo -u km XDG_RUNTIME_DIR=/run/user/$(id -u km) systemctl --user restart nanobot-gateway
```

Logs are `chmod 700` under `/home/km/km-logs/`. Each run dir contains:

```
meta.json       trigger, KM_AID, start, end, wall_ms, status, counters
trace.jsonl     ordered events (governance_loaded, mention_enqueued, placeholder_posted, reply_finalised, …)
llm.jsonl       DeepSeek prompts + completions + tokens + latency
seed-cli.jsonl  every shell-out: argv, exit code, stdout, stderr (truncated, redacted)
stdout.log / stderr.log  raw process streams
```

`index.jsonl` at the top level carries one summary line per run for tail-grepping.

Logrotate config under `/home/km/.config/logrotate.d/km-logs.conf` keeps 30 days / 5 GB.

## End-to-end setup (bootstrap from scratch)

These are the as-built steps, in order. Anything we discovered along the way that diverges from the original plan is captured in **bold notes**.

### 1. Server prep

Ubuntu 24.04, Docker present.

```bash
ssh ubuntu@oc.hyper.media

sudo apt update
sudo apt install -y \
  python3.12 python3.12-venv pipx \
  libsecret-1-0 libsecret-tools dbus-user-session bubblewrap \
  jq curl rsync logrotate gnome-keyring

# **NOTE:** Ubuntu's stock `nodejs` (18.x) ships with npm 9 which can't
# install packages with `workspace:*` deps. Replace with NodeSource 22.
sudo apt remove -y nodejs npm libnode-dev
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo bash -
sudo apt install -y nodejs

# Create the agent user.
sudo useradd --create-home --shell /bin/bash km
sudo usermod -aG docker km
sudo loginctl enable-linger km
sudo install -d -m 700 -o km -g km \
  /home/km/.local /home/km/.local/state /home/km/.local/share \
  /home/km/.local/bin /home/km/.cache /home/km/.config \
  /home/km/.config/systemd/user /home/km/.config/logrotate.d \
  /home/km/.config/seed-keyring /home/km/.secrets \
  /home/km/.nanobot /home/km/.nanobot/workspace \
  /home/km/seed-daemon /home/km/seed-daemon/data /home/km/seed-daemon/web-data \
  /home/km/km-agent /home/km/km-agent/mcp/seed-cli-mcp/dist \
  /home/km/km-state /home/km/km-logs
```

### 2. Local Seed daemon + web

Compose file at `/home/km/seed-daemon/compose.yaml` (deployed by `agent/seed-daemon/compose.yaml` from this repo). Two containers:

- `km-seed-daemon` (image `seedhypermedia/site:latest`) on `127.0.0.1:55001-55002` + public `:55000`.
- `km-seed-web` (image `seedhypermedia/web:latest`) on `127.0.0.1:3000` — necessary because `seed-cli` speaks `/api/<RPC>` over the Remix server, not raw gRPC-Web.

The web container needs `web-data/config.json`. We seed it with `{}`:

```bash
sudo install -m 644 -o km -g km <(echo '{}') /home/km/seed-daemon/web-data/config.json
```

Systemd user unit `seed-daemon.service` orchestrates `docker compose up -d` (see `agent/systemd/seed-daemon.service`).

> **NOTE — original plan vs. as-built:** The plan started with daemon-only at `127.0.0.1:55001`. We then learned `seed-cli` requires the Remix `/api/<RPC>` surface, so a `seed-web` container was added. **The wrapper currently still points at `https://hyper.media` via `SEED_SERVER` because the local daemon's smart-syncing lags on capability blobs.** Switch to `http://127.0.0.1:3000` once you have a way to force-pull the site root and its capability/contact graph.

> **NOTE — daemon keystore:** The compose command must include `-keystore-dir=/data/keys`. Without it the daemon's vault.NewProduction tries to talk to libsecret/dbus inside the container, which doesn't exist. Resulting in `failed to create production keystore: failed reading vault credentials from keyring: exec: "dbus-launch": executable file not found in $PATH`.

### 3. seed-cli on the host

The published `@seed-hypermedia/cli@0.1.4` on npm has an unresolved `workspace:*` dep on `@seed-hypermedia/client`, so `npx -y @seed-hypermedia/cli` fails. Build from this repo with Bun on your Mac (`bun run build` in `frontend/apps/cli/`) and ship the bundled `dist/index.js`:

```bash
# From your local repo:
scp frontend/apps/cli/dist/index.js ubuntu@oc.hyper.media:/tmp/seed-cli.js
ssh ubuntu@oc.hyper.media '
  sudo install -d -m 755 -o km -g km \
    /home/km/.local/share/seed-cli /home/km/.local/share/seed-cli/dist
  sudo install -m 755 -o km -g km /tmp/seed-cli.js \
    /home/km/.local/share/seed-cli/dist/index.js
  sudo install -m 644 -o km -g km <(echo "{\"name\":\"@seed-hypermedia/cli\",\"version\":\"0.1.1\",\"type\":\"module\",\"bin\":{\"seed-cli\":\"./dist/index.js\"}}") \
    /home/km/.local/share/seed-cli/package.json
  sudo ln -sf /home/km/.local/share/seed-cli/dist/index.js /home/km/.local/bin/seed-cli
  sudo chown -h km:km /home/km/.local/bin/seed-cli
  sudo rm /tmp/seed-cli.js
'
```

> **NOTE — version-lookup:** seed-cli does `readFileSync('../package.json', import.meta.url)` to read its own version. The `package.json` next to the bundled `dist/` is required, even if minimal.

### 4. Headless Linux keyring shim

`gnome-keyring`'s default collection won't initialise without a graphical session, so `secret-tool` fails with `Object does not exist at path /org/freedesktop/secrets/collection/login`. We replace `secret-tool` with a Bash shim that stores keys in a mode-600 JSON file:

```bash
scp seed-knowledge-manager/agent/scripts/secret-tool-shim ubuntu@oc.hyper.media:/tmp/secret-tool
ssh ubuntu@oc.hyper.media '
  sudo install -m 755 -o km -g km /tmp/secret-tool /home/km/.local/bin/secret-tool
  sudo rm /tmp/secret-tool
'
```

The shim emits `not found` to stderr on lookup miss so seed-cli's keyring.ts treats it as "no key" rather than as an error. It is on PATH before `/usr/bin/secret-tool`.

### 5. Generate the agent identity

```bash
ssh ubuntu@oc.hyper.media '
  sudo -u km bash -lc "
    /home/km/.local/bin/seed-cli key generate \
      --name knowledge-manager --show-mnemonic \
      > /home/km/.secrets/knowledge-manager.mnemonic 2>&1
    chmod 600 /home/km/.secrets/knowledge-manager.mnemonic
    /home/km/.local/bin/seed-cli key list
  "
'
```

> **Pull the mnemonic to your Mac, store in a vault (KeePass / paper) and `shred -u` the on-server copy.** Mnemonic = root signing key. Do not paste in chat or commit. It can be re-imported into the Seed Vault to set the agent's profile name + avatar.

### 6. Capability grant

The owner of the site root key issues a WRITER capability on `--path /` for `KM_AID`. From the owner's machine:

```bash
seed-cli capability create \
  --delegate z6Mkh11xNzNLTrkDEjmPf19twBvAVsw3HoQtv5nPKVVbEUSJ \
  --role WRITER --path / --label knowledge-manager \
  --key <site-root-key>
```

Verify on the gateway: `seed-cli account capabilities hm://<site>` should now list the new delegate.

> **NOTE — desktop UI vs. on-chain truth:** The desktop app's "members" panel may show writer status regardless of capability blob propagation. Always verify with `seed-cli account capabilities hm://<site>`. Comments from accounts that *appear* to be writers in desktop but aren't on the gateway are correctly skipped by the wrapper.

> **NOTE — agent profile:** The agent's profile (name, avatar) is account metadata published by the Seed Vault, not a document at the account root. To set it: import the agent's mnemonic into `https://hyper.media/vault`, click the Knowledge Manager account, hit "Edit Profile". Set name + description + icon. After ~30s of P2P sync, all sites resolve `<KM_AID>` to "Knowledge Manager".

### 7. Bootstrap governance documents

If the four governance docs don't exist on the site, create them. Either run as the agent (auto-creates from the templates in `agent/templates/`) or as a writer:

```bash
SITE=z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno
KEY=<your-writer-key>
TPL=seed-knowledge-manager/agent/templates

for slug in charter rules runbook allowlist; do
  TITLE="Knowledge Manager — $(echo $slug | sed 's/.*/\u&/')"
  seed-cli document create \
    --account "$SITE" \
    --path "/agents/knowledge-manager/$slug" \
    --file "$TPL/agent-$slug.md" \
    --name "$TITLE" \
    --key "$KEY"
done
```

Also publish parent index docs at `/agents` and `/agents/knowledge-manager` for navigation.

### 8. Build + deploy the wrapper drivers

On your Mac, in `seed-knowledge-manager/agent/mcp/seed-cli-mcp/`:

```bash
bun install
bun test src
bun run typecheck
bun run build   # produces dist/{index,poll-cli,cadence-cli,telegram-bot}.js
```

Ship the four bundles to the server:

```bash
scp seed-knowledge-manager/agent/mcp/seed-cli-mcp/dist/*.js \
    ubuntu@oc.hyper.media:/tmp/
ssh ubuntu@oc.hyper.media '
  sudo install -m 755 -o km -g km /tmp/index.js        /home/km/km-agent/mcp/seed-cli-mcp/dist/index.js
  sudo install -m 755 -o km -g km /tmp/poll-cli.js     /home/km/km-agent/mcp/seed-cli-mcp/dist/poll-cli.js
  sudo install -m 755 -o km -g km /tmp/cadence-cli.js  /home/km/km-agent/mcp/seed-cli-mcp/dist/cadence-cli.js
  sudo install -m 755 -o km -g km /tmp/telegram-bot.js /home/km/km-agent/mcp/seed-cli-mcp/dist/telegram-bot.js
  sudo rm /tmp/{index,poll-cli,cadence-cli,telegram-bot}.js
'
```

The skill methodology (`SKILL.md`, `references/`, `templates/`) is rsynced into `/home/km/.nanobot/workspace/skill/` for the optional nanobot gateway. The polling/cadence drivers don't read it directly — the LAFH framing lives in their hardcoded system prompts.

### 9. Secrets + systemd units

`/home/km/.nanobot/secrets.env` (mode 600):

```
DEEPSEEK_API_KEY=sk-...                 # required for replies + cadenced docs
SEED_SERVER=http://127.0.0.1:3000        # local daemon when KM_USE_LOCAL_DAEMON=1; otherwise gateway
SEED_LOCAL_DAEMON_URL=http://127.0.0.1:3000  # used by km-reconcile.service + bootstrap-subscription.sh
SEED_SITE=hm://z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno
KM_KEY_NAME=knowledge-manager
KM_AID=z6Mkh11xNzNLTrkDEjmPf19twBvAVsw3HoQtv5nPKVVbEUSJ  # gates ready_for_writes preflight
TELEGRAM_TOKEN=...                       # only needed for km-telegram.service
OPS_TELEGRAM_ID=12345,67890               # comma-sep allowlist of operator chat IDs

# Workstream feature flags. All default off → legacy paths.
KM_USE_LOCAL_DAEMON=1                    # poll-cli refuses to run unless site sync-status reports ready
KM_USE_STATE_MACHINE=1                   # Pass B routes through XState supervisor with retry/backoff
KM_USE_MASTRA_AGENT=1                    # Telegram + finalisation use bounded tool-call loop
```

Each flag is independent. Bring them up in order A → B → C, verifying live for ~24h between flips.

Systemd user units (all under `~/.config/systemd/user/`):

```
seed-daemon.service          # the docker compose stack (Phase 1)
nanobot-gateway.service      # optional MCP gateway (Phases 4–6 development)
km-poll.timer + .service     # mention polling, every 15s
km-boletin.timer + .service  # weekly bulletin, Mon 09:00 UTC
km-gap.timer + .service      # gap report, Wed 10:00 UTC
km-health.timer + .service   # network health, 1st 09:00 UTC
km-telegram.service          # operator Telegram bot (long-running)
km-reconcile.timer + .service # periodic ForceSync against the local daemon (every 60s)
```

Enable + start everything:

```bash
sudo -u km XDG_RUNTIME_DIR=/run/user/$(id -u km) bash -lc '
  systemctl --user daemon-reload
  systemctl --user enable --now seed-daemon.service
  systemctl --user enable --now km-poll.timer km-boletin.timer km-gap.timer km-health.timer km-reconcile.timer
  systemctl --user enable --now km-telegram.service
  systemctl --user list-timers
'
```

Bootstrap the subscription (once, after seed-daemon comes up healthy):

```bash
sudo -u km bash /home/km/km-agent/scripts/bootstrap-subscription.sh \
  hm://z6MkuBbsB1HbSNXLvJCRCrPhimY6g7tzhr4qvcYKPuSZzhno \
  z6Mkh11xNzNLTrkDEjmPf19twBvAVsw3HoQtv5nPKVVbEUSJ
```

> **NOTE — port 18790 collision:** The default nanobot gateway port `18790` is already taken by another service on `oc.hyper.media`. We pin it to `18791` via `--port 18791` in `nanobot-gateway.service`. Adjust if your host has different conflicts.

### 10. Telegram bot

Get a bot token from `@BotFather` and your numeric chat ID from `@userinfobot`. Drop both into `secrets.env` (`TELEGRAM_TOKEN`, `OPS_TELEGRAM_ID`). Restart `km-telegram.service`. From your phone, message the bot `/help`. Available commands: `/status`, `/last-runs`, `/show-rules`, `/poll-now`. Mutations to governance docs are intentionally NOT exposed — edit them from desktop instead.

> **NOTE — original plan**: Phase 7 originally targeted nanobot's built-in Telegram channel. Since we ditched nanobot from the polling path, we replaced it with a 130-line Bun bot that long-polls the Telegram REST API directly. Same security guarantee (allowFrom enforced), much simpler.

## Verification matrix (Phase 8)

End-to-end checks. ✅ = verified live on production.

| # | Check | Status |
| --- | --- | --- |
| 1 | Local Seed daemon healthy | ✅ `curl http://127.0.0.1:55001/debug/version` returns build info |
| 2 | Daemon survives reboot | ✅ Container `Up 47s` after host reboot, HTTP OK on first probe |
| 3 | seed-cli round-trip via local web server | ✅ `seed-cli -s http://127.0.0.1:3000 account list` returns `{"accounts":[]}` |
| 4 | secret-tool shim works | ✅ `seed-cli key list` returns the agent key |
| 5 | Agent identity on gateway | ✅ `account get z6Mkh11x...KVVbEUSJ` returns name "Knowledge Manager" + avatar |
| 6 | WRITER capability for KM_AID | ✅ `account capabilities hm://<site>` lists `z6Mkh11x...` (created 2026-05-05T21:49:33Z) |
| 7 | All four governance docs exist | ✅ /agents/knowledge-manager/{charter,rules,runbook,allowlist} resolve via gateway |
| 8 | MCP wrapper unit tests | ✅ `bun test src` — 44 tests / 91 expects, all green |
| 9 | Polling loop end-to-end with citation | ✅ Comment by `z6Mkvz9...` mentioning KM in lobby thread → placeholder within ~5s → finalised within ~15s with site context cited |
| 10 | Site-root mention also triggers reply | ✅ Comment mentioning the site (not KM directly) is picked up because agent holds WRITER cap |
| 11 | Non-writer mention skipped | ✅ Comment by `z6MkvqBa...` (no cap) → `mention_skipped_not_allowed` recorded |
| 12 | Typing-indicator (placeholder → edit) | ✅ Same comment id morphs from "Working on this — back in a moment. ⌛" to the final answer |
| 13 | Site search injection | ✅ `site_context_collected` event records `urls` array; reply text includes hm:// links to relevant docs |
| 14 | Weekly bulletin doc published | ✅ `/agents/knowledge-manager/state/boletin/2026-W19` |
| 15 | Gap report doc published | ✅ `/agents/knowledge-manager/state/gaps/2026-05-06` |
| 16 | Network health doc published | ✅ `/agents/knowledge-manager/state/network-health/2026-05` |
| 17 | `draft_only: true` blocks doc writes | ✅ Cadence runs return `denied` with `write_blocked_by_rules` event when toggled |
| 18 | Hardcoded denylist refuses self-edits | ✅ Path `/agents/knowledge-manager/rules` → `hardcoded-deny` (verified in `limits.test.ts`) |
| 19 | Audit log per run | ✅ Each invocation produces `meta.json` + `trace.jsonl` + `llm.jsonl` + `seed-cli.jsonl` |
| 20 | km-log helper works | ✅ `km-log latest 5`, `km-log show <id>`, `km-log mention <id>` all functional |
| 21 | Secrets redaction | ✅ Grepping `km-logs/` for `DEEPSEEK_API_KEY` value returns 0 hits |
| 22 | Telegram allowFrom enforced | ✅ Non-allowlisted chat IDs are silently ignored |
| 23 | `seed-cli site subscribe --recursive --wait` returns | new — verify with `site list-subscriptions` showing the site |
| 24 | `seed-cli site sync-status hm://<SITE> --writer <KM_AID>` reports `ready_for_writes:true` | new — only true once writer cap converges locally |
| 25 | `KM_USE_LOCAL_DAEMON=1` preflight skips when not ready | new — `tcpdump -i any host hyper.media` shows zero traffic during the skipped run |
| 26 | `KM_USE_LOCAL_DAEMON=1` preflight passes when ready | new — `trace.jsonl` shows `preflight_sync_status` with `ready:true` and a normal poll cycle follows |
| 27 | Subscription hot-tier promotion | new — with `--syncing.subscription-hot-tier=true` capability blobs converge in ~1 minute instead of ~5 minutes |
| 28 | XState rehydrate after crash | new — kill `km-poll.service` mid-mention, restart, see `state_machine_rehydrated` event in `trace.jsonl` and the mention completes |
| 29 | XState retry-with-backoff | new — temporarily set `DEEPSEEK_API_KEY=invalid`, see `agent_running → agent_backoff → agent_running` (×3) in `${stateDir}/machines/<mid>.jsonl`, then `failed_terminal` |
| 30 | XState cap_exceeded | new — set `maxCommentsPerDay=2` in agent-rules; third mention transitions to `cap_exceeded` |
| 31 | Mastra tool-call loop | new — `tools.jsonl` shows ordered calls (`seed_search` → `seed_get_doc` → `seed_get_comment_thread` → `final_answer`) within budget |
| 32 | Mastra tool budget enforced | new — model exceeding 30 calls is forced into `final_answer` via `tool_choice` |
| 33 | Telegram multi-turn community Q&A | new — three follow-up messages share context across turns when `KM_USE_MASTRA_AGENT=1` |
| 34 | `seed_get_comment_thread` MCP tool | new — `bun test src` covers thread walk; production check: `tools.jsonl` shows the call when a mention is in a reply chain |

## Known issues + workarounds

- **Local daemon capability blob lag — superseded.** Previous workaround pinned `SEED_SERVER=https://hyper.media`. Now addressed by `seed-cli site subscribe`, the `--syncing.subscription-hot-tier` daemon flag, and the `KM_USE_LOCAL_DAEMON` preflight gate. Periodic `km-reconcile.timer` is the userland band-aid until the hot-tier change is verified live.
- **`seed-cli comment create --reply <id>` returns `✗ Non-base58btc character` for some parents.** Reproduces specifically when the parent comment's chain includes an edited comment. `poll-cli.ts` retries without `--reply` (top-level reply on the doc) and logs `placeholder_reply_fallback`. Filed in our internal seed-cli backlog.
- **`seed-cli document create --path /` returns `HTTP 500 from PublishBlobs`.** The CLI treats `--path ""` as falsy (slugifies the title). The Seed Vault publishes the agent's home-doc/profile metadata via a different RPC; the CLI can't currently publish at the account root.
- **`seed-cli` writes success messages to stderr.** `comment create` prints `✓ Comment published: <CID>` to stderr (not stdout), and the CID is the version, not the record id. `postPlaceholder` parses stderr, then resolves CID → record id via `comment get`.
- **Activity feed `--resource` is exact-match.** Filtering by the site root returns only events directly on the root doc, not on subdocuments (`/discussions/*`, `/agents/*`). The wrapper now pulls the unfiltered feed and post-filters by `comment.targetAccount`.
- **DeepSeek + nanobot don't compose for polling.** nanobot saves large tool-results to `~/.nanobot/workspace/.nanobot/tool-results/*.txt` and presents that to the LLM; DeepSeek then loops on `read_file`/`grep` instead of replying. The polling driver bypasses nanobot for this reason.
- **Cursor model.** The activity feed paginates reverse-chronologically; cursor token = "next older page", not "since last poll". State stores the newest event id we've classified and stops walking when the loop hits it. Field name `lastEventId` (was `token` in earlier versions).

## Layout reference

```
agent/
├── README.md                     ← this file
├── config/                       ← optional nanobot config (used by phases 4–5 dev)
│   └── config.json
├── seed-daemon/                  ← docker compose for the local stack
│   └── compose.yaml
├── mcp/seed-cli-mcp/             ← Bun-built drivers + MCP wrapper
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── audit.ts
│   │   ├── cadence-cli.ts        ← weekly bulletin / gap / health driver
│   │   ├── config.ts             ← env → AgentConfig (incl. KM_USE_* flags)
│   │   ├── governance.ts
│   │   ├── index.ts              ← stdio MCP server entry point (optional)
│   │   ├── limits.ts
│   │   ├── mentions.ts
│   │   ├── poll-cli.ts           ← polling + typing-indicator + grounded reply
│   │   ├── reply-engine.ts       ← legacy single-shot DeepSeek call
│   │   ├── redact.ts
│   │   ├── seedcli.ts
│   │   ├── state.ts
│   │   ├── telegram-bot.ts       ← operator chat surface
│   │   ├── tools.ts              ← MCP tool registry (incl. seed_get_comment_thread, seed_site_sync_status)
│   │   ├── machines/
│   │   │   ├── mention-machine.ts ← XState v5 actor: per-mention lifecycle
│   │   │   ├── supervisor.ts      ← actor supervisor + JSONL snapshot/replay
│   │   │   └── poll-driver.ts     ← glue from poll-cli Pass B → supervisor
│   │   ├── agent/
│   │   │   ├── mastra-agent.ts    ← bounded DeepSeek tool-call loop (multi-turn)
│   │   │   ├── tools-bridge.ts    ← in-process tool registry for the agent
│   │   │   └── prompts.ts         ← community + operator system prompts
│   │   └── *.test.ts             ← bun:test unit tests
│   └── dist/                     ← bun build output (deployed to server)
├── systemd/                      ← user-mode unit files
│   ├── seed-daemon.service
│   ├── nanobot-gateway.service   ← optional, port 18791
│   ├── km-poll.{service,timer}
│   ├── km-boletin.{service,timer}
│   ├── km-gap.{service,timer}
│   ├── km-health.{service,timer}
│   ├── km-reconcile.{service,timer}  ← periodic ForceSync against local daemon
│   └── km-telegram.service
├── scripts/
│   ├── install-phase1.sh         ← idempotent server provisioning
│   ├── bootstrap-subscription.sh ← idempotent site subscribe + writer-cap wait
│   ├── km-log                    ← log browsing helper for /home/km/.local/bin
│   └── secret-tool-shim          ← file-backed libsecret replacement
├── templates/                    ← bootstrap content for the four governance docs
│   ├── agent-charter.md
│   ├── agent-rules.md
│   ├── agent-runbook.md
│   └── agent-allowlist.md
└── logrotate/
    └── km-logs.conf
```
