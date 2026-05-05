# Knowledge Manager Agent — operator runbook

Autonomous **Moderador de Redes** (LAFH/GC-Red methodology) for a Seed Hypermedia community. Runs on `oc.hyper.media`. Governed by Seed documents.

> Status: Phase 0 scaffolding. Subsequent phases populate this README with deploy steps, kill-switch procedure, log paths, and Telegram setup.

## Architecture summary

- **Local Seed daemon** (`seed-daemon` Docker container) on `127.0.0.1:55001` (HTTP), `:55002` (gRPC), `:55000` (P2P).
- **HKUDS/nanobot** runtime (Python `pip install nanobot-ai`), DeepSeek LLM.
- **Custom stdio MCP wrapper** around `seed-cli` for security envelope, rate limits, audit logging.
- **Telegram channel** (operator-only) as secondary chat surface.
- All policy lives as **Seed documents** under `/agents/knowledge-manager/*` in the target site.

## Phase index

- Phase 0 — Repo scaffolding (this commit).
- Phase 1 — Server bootstrap (Docker, daemon, OS deps, `km` user).
- Phase 2 — Agent identity + capability grant.
- Phase 3 — `seed-cli` MCP wrapper.
- Phase 4 — nanobot install + governance bootstrap.
- Phase 5 — Mention polling + reaction.
- Phase 6 — Scheduled LAFH cadences.
- Phase 7 — Telegram secondary channel.
- Phase 8 — Audit-log polish + verification suite.

## Layout

```
agent/
├── config/             # nanobot.json template (Phase 4)
├── seed-daemon/        # docker compose for local daemon (Phase 1)
├── mcp/seed-cli-mcp/   # custom stdio MCP wrapping seed-cli (Phase 3)
├── systemd/            # user-mode unit files (all phases)
├── scripts/            # install.sh, km-log helper (Phases 1, 5)
├── templates/          # bootstrap seeds for Seed governance docs (Phase 4)
└── logrotate/          # km-logs.conf user logrotate rule (Phase 5)
```

## Governance docs (created by agent on first run)

| Path under target site | Purpose |
| --- | --- |
| `/agents/knowledge-manager/charter`   | Community purpose, voice, scope. |
| `/agents/knowledge-manager/rules`     | Hard policy: deny paths, caps, draft-only kill-switch. |
| `/agents/knowledge-manager/runbook`   | Soft instructions: tone, escalation, formatting. |
| `/agents/knowledge-manager/allowlist` | Optional invoker list (defaults to WRITER capability set). |

## Kill-switch

Edit `/agents/knowledge-manager/rules` in the Seed app, set `draft_only: true`. Effective within ≤60s (rules cache TTL). To force immediate refresh: `systemctl --user restart nanobot-gateway` on `oc.hyper.media`.

## Logs (browse from SSH)

```
/home/km/km-logs/
├── current -> runs/<latest>
├── runs/<UTC-ISO>__<trigger>__<ulid>/
│   ├── meta.json        # trigger, KM_AID, env hash, wall_ms
│   ├── trace.jsonl      # ordered events with timestamps
│   ├── llm.jsonl        # prompts, completions, DeepSeek reasoning, tokens
│   ├── tools.jsonl      # MCP tool calls + latency
│   ├── seed-cli.jsonl   # argv + stdout + stderr + exit + ms
│   ├── stdout.log
│   └── stderr.log
└── index.jsonl          # one summary line per run
```

Helper installed at `~km/.local/bin/km-log`:

```bash
km-log tail              # follow newest run
km-log show <runId>      # full pretty-printed run
km-log grep <pattern>    # rg across trace logs
km-log mention <id>      # find run that processed a given mention
```

Retention: logrotate 30d / 5GB, compressed after 1d. Secrets redacted from all streams.

## Environment variables (`/home/km/.nanobot/secrets.env`, mode 600)

```
DEEPSEEK_API_KEY=...
SEED_SERVER=http://127.0.0.1:55001
SEED_SITE=hm://...
TELEGRAM_TOKEN=...     # Phase 7
OPS_TELEGRAM_ID=...    # Phase 7, numeric Telegram user ID
```

## TODO (filled in by later phases)

- [ ] Phase 1: Docker / OS dep install steps + verification.
- [ ] Phase 2: key generation + capability grant exact commands.
- [ ] Phase 3: MCP wrapper build + test commands.
- [ ] Phase 4: nanobot install + bootstrap step-by-step.
- [ ] Phase 5: poll cadence + smoke test transcript.
- [ ] Phase 6: cadence schedules + manual triggers.
- [ ] Phase 7: Telegram bot setup + ops verbs.
- [ ] Phase 8: full verification checklist results.
