# Seed Knowledge Manager

*An autonomous moderator agent for Seed Hypermedia communities, grounded in 25+ years of network-knowledge-management practice.*

---

## Problem

Seed Hypermedia gives a community a place to publish documents, comment on them, and build a shared corpus. What it does not give the community is a way to turn that activity into **synthesised knowledge** — periodic bulletins, gap reports, expertise maps, network-health audits. Without that synthesis layer, communities exhibit what Luis Ángel Fernández Hermana (LAFH) called *choque infosomático* (an "info-somatic shock" — activity rises, knowledge production falls; members feel busy but the network forgets). The corpus accumulates and stays inert.

In LAFH's terms — built across en.red.ando (1996), Enredando.com (1998), lab_RSI, and HipotecaGratis — a network only produces knowledge when it has a **synthesis zone** worked by a moderator-role. Synthesis is the bottleneck. No one has time.

A second, narrower problem: Seed currently has no answer to "what does an autonomous agent inside a community look like?" If agents are coming, the substrate needs an opinion on how to host them, govern them, and bound their behaviour.

## Solution

A persistent agent — call it `@knowledge-manager` — that lives as a first-class member of a Seed community. Two equal-weight propositions:

1. **Methodologically**: the first operational implementation of LAFH's *Gestión de Conocimiento en Red* (GC-Red, "knowledge management in networks") methodology on a modern hypermedia substrate. The agent does the synthesis work that the human moderator role calls for: weekly bulletin (*boletín periódico*), gap detection, network-health audits, grounded answers to community questions.

2. **Architecturally**: the first agent governed *entirely by Seed documents*. Four community-editable docs — charter, rules, runbook, allowlist — define what the agent does, how it speaks, what it is allowed to write, and who can invoke it. No local YAML. No deploy to change behaviour. Edit the rules doc, save, the agent picks it up within 60 seconds. Proves the substrate can host autonomous participants on the same terms as human ones.

Stack: Bun MCP server wrapping `seed-cli`, DeepSeek for language, XState v5 for per-mention lifecycle, Docker Compose for `seed-daemon` + `seed-web`, systemd timers for cadences — all on one Ubuntu host (`oc.hyper.media`).

Status: **shipped, running in production on `oc.hyper.media`.**

## Three demos

### 1. Mention reply + multi-turn threads

Write `@knowledge-manager what do we believe about <topic>?` in a comment on any document. Within ~2 seconds a typing-indicator placeholder appears. Within ~30 seconds the placeholder is rewritten with a grounded answer citing existing docs via `hm://` links. If the question crosses prior debate, the answer flags agreement, disagreement, and open questions.

**Multi-turn**: reply to KM's answer without re-mentioning — KM detects it's a thread it already participated in and continues the conversation. The LLM sees the full comment thread so follow-ups feel natural. No `@` needed after the first mention.

### 2. Scheduled bulletin

Monday at 09:00 UTC, a new bulletin appears at `hm://oc.hyper.media/agents/knowledge-manager/boletines/2026-W19`: new docs (prioritised, not exhaustive), active threads with status, decisions made, new members, gaps surfaced or filled, recommended reading. Two-minute scan. Wednesday a gap report drops. First of each month, a network-health audit drops.

### 3. Telegram operator bot

The operator DMs the bot:
- `/status` — current activity, last run, queue depth.
- `/last-runs` — last five run summaries with mention IDs.
- `/show-rules` — currently-parsed rules and cache age.
- `/poll-now` — force one poll cycle now.
- `/ask <question>` — freeform multi-turn query.

Read-mostly by design; mutations live in governance docs, not in DMs.

## Scope

Three workstreams shipped on branch `knowledge-agent-server-setup`.

### A. Agent runtime — `seed-knowledge-manager/`

The agent itself: a Bun project at `agent/mcp/seed-cli-mcp/` wrapping `seed-cli` as MCP tools.

- **Read tools**: `seed_search`, `seed_get_document`, `seed_get_comment_thread`, `seed_site_sync_status`, `seed_get_governance`.
- **Write tools** (gated by governance + rate limits): `seed_create_comment`, `seed_reply_comment`. Document writes via cadence driver only.
- **Three-pass polling driver** (`poll-cli.ts`): pass A discovers mentions and posts placeholder comments within ~2s; pass B drafts the real reply via DeepSeek and edits the placeholder in place; pass C handles thread-reply mentions (see below) with direct-reply posting. Stateless deduplication by mention ID.
- **Thread-reply trigger**: walks the `replyParent` chain (up to 30 hops, with cycle guard and per-cycle cache) to detect comments replying to a thread where KM already participated. Uses a pure helper (`detectThreadReplyToKm`) with injected fetcher for testability. Thread-replies skip the placeholder→edit flow and post the final answer directly (pass C) to work around a seed-cli `--reply` bug (see "Rabbit holes"). `Mention` type carries a `triggerSource: 'mention' | 'thread-reply'` discriminator for audit logs.
- **Cadence driver** (`cadence-cli.ts`): three LAFH outputs — `boletin` (weekly), `gap` (weekly), `health` (monthly). One DeepSeek call per task, deterministic output path.
- **Telegram operator bot** (`telegram-bot.ts`): long-running poller, allowlisted by Telegram user ID.
- **XState v5 lifecycle** (`machines/mention-machine.ts` + `supervisor.ts`): per-mention state machine, snapshotted to jsonl, replayable on crash. Behind feature flag `KM_USE_STATE_MACHINE`.
- **Bounded tool-call agent loop** (`agent/mastra-agent.ts`): ≤30 tool calls then forced `final_answer`. Lets the model dynamically expand context instead of running one deterministic prompt. Behind feature flag `KM_USE_MASTRA_AGENT`.
- **Governance loader** (`governance.ts`): fetches the four governance docs, parses the machine-readable YAML in `rules` and `allowlist`, caches 60 seconds.
- **Audit + redaction** (`audit.ts`, `redact.ts`): per-run directories with `meta.json` (summary), `trace.jsonl` (events), `llm.jsonl` (DeepSeek calls), `seed-cli.jsonl` (commands). Secrets redacted on disk.
- **Skill + templates**: `SKILL.md` documents the seven capabilities; `templates/{synthesis-document, boletin-periodico, gap-report, onboarding-capsule, network-health}.md` shape the outputs; `references/lafh-framework.md` carries the theoretical grounding.
- **Infrastructure**: Docker `compose.yaml` (`seed-daemon` + `seed-web`), systemd user units and timers (`km-poll`, `km-boletin`, `km-gap`, `km-health`, `km-reconcile`, `km-telegram`), idempotent install scripts (`install-phase1.sh`, `bootstrap-subscription.sh`), `secret-tool-shim` (file-backed keyring replacement), `km-log` (log browser).

### B. `seed-cli site` commands — `frontend/apps/cli/src/commands/site.ts`

New subcommands to manage subscriptions and force convergence from the CLI:

- `seed-cli site subscribe <id> [--recursive] [--wait]`
- `seed-cli site unsubscribe <id>`
- `seed-cli site list-subscriptions`
- `seed-cli site sync-status <id> [--writer <accountId>]` — reports whether the local daemon has cached a given WRITER capability.
- `seed-cli site reconcile` — forces hot discovery via fan-out over `entities.discoverEntity`.

Shared API helpers: `frontend/packages/shared/src/api-subscriptions.ts`, `frontend/packages/shared/src/api-force-sync.ts`. Used by the agent's preflight gate — the polling driver refuses to run unless `sync-status` confirms the writer capability is locally cached.

### C. Backend hot-tier scheduler — `backend/hmnet/syncing/scheduler.go`

Two-tier discovery queue:

- `tierHot` (priority 0) preempts `tierCold` (priority 1).
- `hotDeadline` heartbeat TTL (~40s); expired hot tasks demote or drop.
- Hot tasks preempt running subscriptions and oldest in-flight hot tasks when workers saturate.
- New config flag `Syncing.SubscriptionHotTier` (`backend/config/config.go:312`): when on, subscription tasks ride the hot tier so writer-capability blobs converge in ~hotTTL instead of the next polling interval.
- `PRAGMA busy_timeout = 5000` in `backend/storage/sqlite.go:33` — wait 5 seconds on a writer lock instead of returning `SQLITE_BUSY` immediately. Protects reconcile transactions from being starved by peer-store writes on small VMs.

Without this, an agent that subscribes to a community sees the WRITER capability only after a multi-minute polling sweep — long enough that "subscribe then run" doesn't work in practice. With it, `subscribe --wait` converges in seconds.

## How it works — Architecture

Single Ubuntu 24.04 host. User `km` with linger + docker group.

```
                 ┌───────────────────────┐
   :55000 P2P →  │   seed-daemon         │ ← Docker
   :55001 HTTP   │   (seedhypermedia/    │
   :55002 gRPC   │    site:latest)       │
                 └─────────┬─────────────┘
                           │ seed-cli
                           ▼
              ┌──────────────────────────┐
              │  seed-cli-mcp (Bun)      │ ─── DeepSeek API
              │  + governance cache      │
              │  + audit                 │
              └──┬────────┬──────────┬───┘
                 │        │          │
        invoked by each timer / service
                 │        │          │
                 ▼        ▼          ▼
            km-poll   km-{boletin,  km-telegram
            (15-30s)   gap,health}  (long-running)
                 │
                 ▼
         posts comments / docs to
         oc.hyper.media (seed-web :3000)
```

**Governance flow.** On every action point the agent reads the four docs at `hm://oc.hyper.media/agents/knowledge-manager/{charter,rules,runbook,allowlist}` (cache TTL 60s). The `rules` doc carries a YAML block with caps (`max_docs_per_run`, `max_comments_per_run`, `max_comments_per_day`), mention triggers, invoker source (WRITER capability or allowlist doc), and a `draft_only` kill switch. Toggling `draft_only: true` stops document writes within 60 seconds; comments continue.

**Hardcoded denylist.** Regardless of permissions, `limits.ts` refuses to write to the four governance paths. Operators can edit governance; the agent cannot.

**Feature flags** (default off, ready to ship on):
- `KM_USE_LOCAL_DAEMON` — talk to the local daemon instead of a public gateway. Required for self-contained operation.
- `KM_USE_STATE_MACHINE` — XState lifecycle with snapshot/replay across crashes.
- `KM_USE_MASTRA_AGENT` — bounded tool-call loop instead of single-shot prompt.

## How to interact

### As a community member
- Mention `@knowledge-manager` in any comment to get a grounded answer with `hm://` citations.
- Reply to KM's answers directly — no need to re-mention. KM continues the conversation as a follow-up turn.
- Read the auto-published cadence docs under `hm://oc.hyper.media/agents/knowledge-manager/`.

### As an operator (write access to governance docs)
- Edit `…/rules` to change caps, set `draft_only: true`, or restrict invokers.
- Edit `…/runbook` to change tone, citation style, or escalation policy.
- Edit `…/allowlist` to whitelist mentioners (when `invoker_source: allowlist-doc`; default is WRITER capability).
- Edit `…/charter` to redefine scope.

### As a Telegram operator (allowlisted by Telegram user ID)
- `/status`, `/last-runs`, `/show-rules`, `/poll-now`, `/ask <question>`.

### As an SRE on the host

```bash
sudo -u km bash -lc '/home/km/.local/bin/km-log tail'
sudo -u km bash -lc '/home/km/.local/bin/km-log latest 5'
sudo -u km bash -lc '/home/km/.local/bin/km-log show <run-id>'
sudo -u km XDG_RUNTIME_DIR=/run/user/$(id -u km) systemctl --user start km-poll.service
```

## State machines

Behind feature flag `KM_USE_STATE_MACHINE`. One XState v5 machine definition with a supervisor layer for persistence and crash recovery.

### Mention machine (`machines/mention-machine.ts`)

Per-mention lifecycle. Each incoming mention spawns one actor. Side effects (placeholder posting, LLM drafting, comment editing) are injected via `fromPromise` actors — the machine itself is pure.

```
                         ┌─────────────────┐
                         │    detected      │ (initial)
                         └──┬──────┬───────┘
                   ENQUEUE  │      │ NOT_ALLOWED / CAP_DENIED
                            ▼      ▼
                      ┌──────────┐  ┌──────────────────┐
                      │ enqueued │  │ skipped_not_      │ (final)
                      └────┬─────┘  │ allowed /         │
              POST_        │        │ cap_exceeded      │
              PLACEHOLDER  │        └──────────────────┘
                           ▼
                   ┌───────────────────┐
                   │ placeholder_      │
                   │ pending           │
                   └──┬────────────┬───┘
      PLACEHOLDER_    │            │ PLACEHOLDER_FAILED
      POSTED          ▼            ▼
              ┌────────────────┐  ┌─────────────────┐
              │ placeholder_   │  │ failed_terminal  │ (final)
              │ posted         │  └─────────────────┘
              └──────┬─────────┘
             RUN_    │
             AGENT   ▼
              ┌────────────────┐
              │ agent_running  │◄──────────────────┐
              └──┬─────────┬───┘                   │
      AGENT_     │         │ AGENT_ERROR           │
      DONE       │         ▼                       │
                 │   [canRetryDraft?]               │
                 │     yes → agent_backoff ─────────┘
                 │     no  → failed_terminal (final)
                 ▼
              ┌────────────────┐
              │ draft_ready    │
              └──────┬─────────┘
            FINALISE │
                     ▼
              ┌────────────────┐
              │ finalising     │◄──────────────────┐
              └──┬─────────┬───┘                   │
      FINALISED  │         │ FINALISE_ERROR        │
                 │         ▼                       │
                 │   [canRetryFinalise?]            │
                 │     yes → finalise_backoff ──────┘
                 │     no  → failed_terminal (final)
                 ▼
              ┌────────────────┐
              │ done           │ (final)
              └────────────────┘
```

**9 states**: `detected`, `enqueued`, `placeholder_pending`, `placeholder_posted`, `agent_running`, `agent_backoff`, `draft_ready`, `finalising`, `finalise_backoff`.

**4 terminal states**: `done`, `skipped_not_allowed`, `cap_exceeded`, `failed_terminal`.

**12 events**: `ENQUEUE`, `CAP_DENIED{reason}`, `NOT_ALLOWED{reason}`, `POST_PLACEHOLDER`, `PLACEHOLDER_POSTED{placeholderId}`, `PLACEHOLDER_FAILED{reason}`, `RUN_AGENT`, `AGENT_DONE{replyBody}`, `AGENT_ERROR{reason}`, `FINALISE`, `FINALISED`, `FINALISE_ERROR{reason}`.

**2 guards**: `canRetryDraft` (`draftRetries < 3`), `canRetryFinalise` (`finaliseRetries < 3`).

**2 delays** (exponential backoff): `draftBackoff` = `2000ms × 2^retries`, `finaliseBackoff` = `2000ms × 2^retries`.

**Context** carried per mention:
| Field | Type | Set by |
|---|---|---|
| `mention` | `Mention` | spawn |
| `placeholderId` | `string \| null` | `PLACEHOLDER_POSTED` |
| `replyBody` | `string \| null` | `AGENT_DONE` |
| `failureReason` | `string \| null` | terminal events |
| `draftRetries` | `number` | `AGENT_ERROR` (increment) |
| `finaliseRetries` | `number` | `FINALISE_ERROR` (increment) |
| `lastError` | `string \| null` | transient failures |

### Supervisor (`machines/supervisor.ts`)

Orchestrates one actor per mention. Responsibilities:

- **Spawn**: creates and starts a fresh actor for each mention.
- **Persist**: appends every transition to `${stateDir}/machines/<mentionKey>.jsonl`. Each line is `{ts, type, payload?, initialMention?}`.
- **Rehydrate**: on startup, replays all JSONL event logs. Terminal actors are dropped; in-flight actors are restored to their last state.
- **Stop**: graceful shutdown of all actors.

### Poll driver (`machines/poll-driver.ts`)

Bridges `poll-cli.ts` Pass B with the supervisor. Called when `config.useStateMachine` is enabled:

1. Creates `MentionSupervisor` with side-effect callbacks.
2. Rehydrates from prior runs (crash recovery).
3. For each pending placeholder: spawn actor → feed bootstrap events (`POST_PLACEHOLDER` → `PLACEHOLDER_POSTED` → `RUN_AGENT`) → execute LLM → send `AGENT_DONE`/`AGENT_ERROR` → attempt finalization → send `FINALISED`/`FINALISE_ERROR`.
4. Stops all actors.

Note: the state machine path currently handles **placeholder-based mentions only** (Pass B). Thread-reply mentions (Pass C, direct-reply) bypass the machine and run a single-shot draft→post flow. Once seed-cli `--reply` is fixed upstream, thread-replies can rejoin the machine-driven path.

## Rabbit holes (we went there)

- **Nanobot gateway.** Tried nanobot as the MCP gateway for free-form agent orchestration. It does not bundle cleanly with Bun, and the surface area we needed was small enough to re-implement inline. Result: kept `nanobot-gateway.service` as an optional off-path surface; built our own bounded tool-call loop in `agent/mastra-agent.ts`.
- **Cursor-based activity walker.** First pass scanned the activity feed with a persistent cursor to detect mentions. Race conditions on cursor advancement caused dropped mentions and double replies under load. Replaced with stateless per-poll deduplication keyed by mention ID (commit `0fcbb02cc`).
- **seed-cli `--reply` and edited comments.** `seed-cli comment create --reply <id>` uses `parentComment.threadRoot` (a RecordID containing `/`) instead of `parentComment.threadRootVersion` (a CID). `CID.parse()` chokes on the `/` with `"Non-base58btc character"`. Fails for any parent that is itself a threaded reply (has `threadRoot` set). The placeholder→edit flow makes it worse: editing a placeholder inserts an edited comment into the chain, breaking all subsequent `--reply` calls in that thread. Workaround: thread-reply mentions skip the placeholder phase and post the final answer directly (pass C). Upstream fix is a one-liner in `frontend/apps/cli/src/commands/comment.ts` line 131 — tracked in `.ai/seed-cli-reply-chain-fix.md`.
- **Gnome-keyring on a headless server.** `seed-cli` defaults to libsecret/Gnome-keyring for key storage; a headless Ubuntu host has no session bus to run `gnome-keyring-daemon`. Wrote `secret-tool-shim`: file-backed JSON at `~/.config/seed-keyring/secrets.json`, mode 600, drop-in compatible with the `secret-tool` CLI invocations `seed-cli` makes.

## No-gos (explicit boundaries)

- **Agent edits its own governance.** Hardcoded denylist in `limits.ts` prevents writes to the four governance paths regardless of permissions.
- **Destructive operations.** Agent has zero delete / unlink / move capability. Only creates comments and documents.
- **Mass DMs or outbound messaging.** No invite, no DM, no email. All output lives inside the community as comments or documents on the site.
- **Self-promotion / re-posting.** Caps of 1 doc per run, 5 comments per run, 30 comments per day, enforced *before* every write.
- **Mocked tests on the integration path.** Integration tests hit a real local `seed-daemon`; mocks only inside unit boundaries.
- **Cross-workspace imports that break the repo's dependency graph.** Vault stays Bun, repo stays pnpm, agent MCP stays Bun under `seed-knowledge-manager/`. No reach-across imports.

## Next steps

- **Operator dashboard.** Move beyond Telegram and logs. A small web UI on the existing `seed-web` container showing per-run audit traces, governance cache state, mention queue, cadence run history.
- **Multi-tenant.** Today one agent process serves one site. Generalise to one agent serving N sites via per-site governance docs, per-site state dirs, and a small site-registry doc. Will require factoring `config.ts` into a per-site loader.
- **Fix seed-cli `--reply` upstream.** One-line fix: `parentComment.threadRoot` → `parentComment.threadRootVersion` in `frontend/apps/cli/src/commands/comment.ts:131`. Once merged, thread-replies can rejoin the placeholder→edit flow for instant "Working on this..." feedback. Prompt at `.ai/seed-cli-reply-chain-fix.md`.
- **Remove the `km-reconcile.timer` band-aid.** Once `SubscriptionHotTier=true` ships on by default, the 60-second reconcile timer becomes redundant.
- **Wire the remaining capabilities.** Templates exist for synthesis docs (capability #2), expertise maps (#5), and cross-reference detection (#6) — no cadence driver yet. Likely mention-triggered, not scheduled.
- **Promote the bounded tool-call agent.** Default `KM_USE_MASTRA_AGENT=1` once we have a week of side-by-side reply quality against the single-shot path.

## Acknowledgement

The methodology this agent operationalises is not new. Luis Ángel Fernández Hermana developed *Gestión de Conocimiento en Red* across en.red.ando, Enredando.com, and lab_RSI over more than two decades, with hard-won evidence (HipotecaGratis converted a 30-person firm into a knowledge-producing network and lifted per-worker income 34–43% in nine months). What is new is having a substrate — Seed Hypermedia — where the moderator role can run as a software member, governed by community-editable documents, and a small enough operational surface that one operator can keep it healthy.
