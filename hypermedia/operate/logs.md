---
name: Logs
summary: What an app environment logs and at which level, the catalogue of log lines by subsystem, how to read a session's durable store, and what a log line must never contain.
---
This page is the catalogue of what an [app environment](../software/app-environment.md) writes to its log: the levels, the lines each subsystem emits, and the rules for adding a line. To follow a symptom through these lines, start from [troubleshooting](./troubleshooting.md).

# Levels <!-- id:DR_9rULX -->

Logs include IDs, counts, statuses, sizes, timings, trigger sources, and compact activity metadata, on purpose. They never include secrets or full message or session content. <!-- id:sRtUySO2 -->

Logging is leveled (`apps/src/log.ts`, `SEED_APPS_LOG_LEVEL` or `--log-level`, default `info`). The per-event hot paths log at `debug` and are silent by default: every WebSocket partial (`publish partial`, `send partial`, `skip partial`) and every no-op activity poll (`Polling feed`, `Feed page received`, `Processing feed events` with nothing new). They are most of the lines a busy server would write. Set the level to `debug` when tracing streaming or trigger delivery. <!-- id:OS2CBsMW -->

# Triggers and the activity feed

Activity trigger diagnostics use: <!-- id:LZjDOFOi -->
  - `[Agents Activity] Polling feed` <!-- id:CzKZDYrP -->
  - `[Agents Activity] Feed page received` <!-- id:mYmN01Cf -->
  - `[Agents Activity] First poll processing events` <!-- id:ovKIXloc -->
  - `[Agents Activity] Processing feed events` <!-- id:Jsb-sz4Q -->
  - `[Agents Activity] Poll failed` <!-- id:gJhHYcPM -->
  - `[Agents Trigger] Skipping activity without stable key` <!-- id:YB8_h-7L -->
  - `[Agents Trigger] Checked activity against trigger` <!-- id:hvBJi4x9 -->
  - `[Agents Trigger] Skipping duplicate trigger firing` <!-- id:eTxjrti2 -->
  - `[Agents Trigger] Skipping run-completed trigger already in this chain` <!-- id:jESnWMeT -->
  - `[Agents Trigger] Fired trigger and created session` <!-- id:rQ4EBAB_ -->
  - `[Agents Trigger] Trigger session run enqueued` <!-- id:x6tcJogd -->
  - `[Agents Trigger] Trigger session dispatch failed` <!-- id:f5n1P8TH -->
  - `[Agents Trigger] Trigger woke a parked run` <!-- id:N6Eb9Kio -->
  - `[Agents Trigger] Trigger fired with no run listening` <!-- id:PRUZg7PL -->
  - `[Agents Trigger] Trigger firing failed` <!-- id:oeFTB4Kf -->

[Triggers](../agent/triggers.md) describes the monitors that write these lines.

# Runs, the runtime and scripts

Run, runtime, and script diagnostics: <!-- id:0OVrLoWY -->
  - `[agents/runs] boot sweep requeued interrupted runs` <!-- id:eh_YCZuP -->
  - `[agents/outbox] boot sweep settled effects a dead process left running`
  - `[agents/runs] dispatch paused` / `[agents/runs] dispatch resumed`
  - `[agents/runtime] tool call answered from its receipt` / `tool call answered as interrupted` / `recording a tool effect failed`
  - `[agents/runs] boot reconcile: replaying finished child into parked parent` <!-- id:_RsqNClX -->
  - `[agents/boot] step finished` / `[agents/boot] recovery finished` / `[agents/boot] recovery failed`
  - `[agents/runs] activity woke a waiting run` <!-- id:tpFxLg1i -->
  - `[agents/runtime] sending provider request` <!-- id:C2_CfkIS -->
  - `[agents/runtime] ending turn after tool batch` <!-- id:qZT_X9Yq -->
  - `[agents/runtime] sub-session spawned` / `[agents/runtime] sub-session resolved` <!-- id:rrfbE_Wv -->
  - `[agents/runtime] plan step settled from children` <!-- id:dCijbIeI -->
  - `[agents/runtime] agent started session` / `[agents/runtime] agent-started session run failed` <!-- id:gIm1siw2 -->
  - `[agents/runtime] session titled by model` / `[agents/runtime] session title generation failed` <!-- id:dBx3vxUA -->
  - `[agents/workflow] workflow spawned from chat` <!-- id:vnIHKeTj -->
  - `[agents/workflow] continued as new run` <!-- id:fH-VDeMa -->
  - `[agents/workflow] run paused on its time budget` <!-- id:u0b-olQJ -->

`[agents/sql] slow statement` at `warn` names any prepared statement that ran over 20 ms, and `[agents/retention]` lines report each [retention](./database-retention.md) pass. `[Exec Canary] Sandbox probe failed` and `recovered` come from the [code execution](./code-execution-backend.md#is-code-execution-working) probe.

Server model execution goes through pi-ai and Pi Durable. Use durable session events (via `GetSession` or the desktop session page), the `[agents/runtime]` run lines, WebSocket partial logs, and mocked tests for runtime diagnosis. A run that picked up a turn left by an earlier process logs `resuming the durable turn an earlier process left unfinished`, and its `agent run finished` line carries `resumed: true`. A session's durable store is plain JSONL inside the `session_durable_files` table: `SELECT CAST(data AS TEXT) FROM session_durable_files WHERE session_id = ? AND file = 'main.jsonl' ORDER BY seq` prints its main file. <!-- id:KNt6k5MM -->

# WebSocket

Server WebSocket logs: <!-- id:LFKybXaZ -->
  - `[agents/ws] open` <!-- id:J0oO3TLG -->
  - `[agents/ws] subscribed` <!-- id:0KGebWeE -->
  - `[agents/ws] publish partial` <!-- id:B6N9i06j -->
  - `[agents/ws] send partial` <!-- id:5PXSkCYU -->
  - `[agents/ws] skip partial; no subscription` <!-- id:7eqwzaLy -->
  - `[agents/ws] close` <!-- id:gAExGHP- -->

Desktop WebSocket and UI logs: <!-- id:Fmgbj2nL -->
  - `[agents/ws] connecting` <!-- id:gGhsKMZy -->
  - `[agents/ws] open; signing subscribe` <!-- id:rrl_HVjS -->
  - `[agents/ws] subscribe sent` <!-- id:-01o8fj- -->
  - `[agents/ws] subscribed event` <!-- id:clsDqaZw -->
  - `[agents/ws] partial event` <!-- id:mGlEgw9h -->
  - `[agents/ws] partial state updated` <!-- id:jPWPhKjw -->
  - `[agents/ws] partial marked done; keeping visible until durable append` <!-- id:qJve8KM3 -->
  - `[agents/ui] sending session message` <!-- id:kDAKLiRi -->
  - `[agents/ui] rendering streaming assistant partial` <!-- id:LA86XvUl -->

[WebSocket subscriptions](../build/websocket-subscriptions.md) describes the exchange these lines trace.

# What a log line must never contain <!-- id:m2vIrzlQ -->

Do not add logs that include: <!-- id:ltN5wXmx -->
  - plaintext secrets; <!-- id:y5ZHGjET -->
  - decrypted API keys; <!-- id:c_eEjEjn -->
  - signed request bodies; <!-- id:m0iuHrnW -->
  - full model request or response bodies; <!-- id:PqYvNucC -->
  - full session messages; <!-- id:w74VDOkI -->
  - large tool outputs. <!-- id:uNVtqLqH -->

Prefer logging IDs, lengths, counts, timings, statuses, and booleans. <!-- id:xoQNhH3- -->

[Security](../agent/security.md) has the reasons.

# See also

- [Troubleshooting](./troubleshooting.md), symptom first
- [Diagnosing a stalled server](./stalled-server.md), for the slow-statement and loop-lag signals
- [Debugging runs](./debugging-runs.md), for run and script lines
- [Configuration](./configuration.md), for `SEED_APPS_LOG_LEVEL`
- [Security](../agent/security.md), logging security
