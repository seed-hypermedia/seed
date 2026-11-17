---
name: Logs
summary: This page lists the log lines an app environment writes, grouped by the part of the server that writes them, and says what a log line must never contain.
---
An [app environment](../software/app-environment.md) writes its log to standard output, one line per event. This page lists those lines, so you can search a log for the right text. If you are following a problem, start from [troubleshooting](./troubleshooting.md) and come back here for the exact line.

The first thing to check: a line starts with a tag in square brackets, such as `[agents/runs]`. Search the log for the tag of the part you are looking at.

# Levels <!-- id:DR_9rULX -->

Log lines carry IDs, counts, statuses, sizes, timings and [trigger](../trigger.md) sources. They never carry secrets. <!-- id:sRtUySO2 -->

There are four levels: `debug`, `info`, `warn` and `error`. You set the lowest level to print with `SEED_APPS_LOG_LEVEL` or `--log-level`. The default is `info`. The code is in `apps/src/log.ts`. <!-- id:OS2CBsMW -->

Only some lines obey the level:

- The lines that fire on every poll log at `debug`, so they are silent by default: `Polling feed`, `Feed page received` and `Checked activity against trigger`. `Processing feed events` logs at `debug` when a poll found nothing new, and at `info` when it found events.
- The slow-statement line and the `[agents/retention]` lines also obey the level.
- Every other line on this page is written straight to the console. It prints at every level.

Set the level to `debug` when you trace why a trigger did or did not fire.

One thing is not a log line. While a model writes a reply, the server also writes the reply text to standard output. It does not do this for a private session.

# Triggers and the activity feed

The activity monitor reads the feed of new events. Trigger matching decides which events fire a trigger. These are their lines: <!-- id:LZjDOFOi -->
  - `[Agents Activity] Polling feed` <!-- id:CzKZDYrP -->
  - `[Agents Activity] Feed page received` <!-- id:mYmN01Cf -->
  - `[Agents Activity] First poll processing events` <!-- id:ovKIXloc -->
  - `[Agents Activity] Processing feed events` <!-- id:Jsb-sz4Q -->
  - `[Agents Activity] Poll failed` <!-- id:gJhHYcPM -->
  - `[Agents Activity] Poll aborted mid-cycle`
  - `[Agents Activity] Poll cycle aborted, skipping remaining accounts`
  - `[Agents Trigger] Skipping activity without stable key` <!-- id:YB8_h-7L -->
  - `[Agents Trigger] Checked activity against trigger` <!-- id:hvBJi4x9 -->
  - `[Agents Trigger] Skipping duplicate trigger firing` <!-- id:eTxjrti2 -->
  - `[Agents Trigger] Skipping run-completed trigger already in this chain` <!-- id:jESnWMeT -->
  - `[Agents Trigger] Fired trigger` <!-- id:rQ4EBAB_ -->
  - `[Agents Trigger] Trigger session run enqueued` <!-- id:x6tcJogd -->
  - `[Agents Trigger] Trigger session dispatch failed` <!-- id:f5n1P8TH -->
  - `[Agents Trigger] Trigger started headless run`
  - `[Agents Trigger] Trigger woke a parked run` <!-- id:N6Eb9Kio -->
  - `[Agents Trigger] Trigger fired with no run listening` <!-- id:PRUZg7PL -->
  - `[Agents Trigger] Trigger firing failed` <!-- id:oeFTB4Kf -->
  - `[Agents Trigger] Started sessions of firings left waiting`

The server also keeps its triggers in step with trigger [documents](../protocol/documents.md), and the names of its [agents](../agent.md) in step with their mount documents. Those tasks write:

  - `[Agents Trigger Documents] Synced trigger documents`
  - `[Agents Trigger Documents] Published stored triggers as documents`
  - `[Agents Triggers] Published a stored trigger as a document`
  - `[Agents Triggers] Trigger stays stored on the server`
  - `[Agents Triggers] Could not sync trigger documents`
  - `[Agents Mount Names] Renamed mounted agents after their documents`
  - `[agents/mount] could not read the mount document for a name check`

[Triggers](../agent/triggers.md) describes the monitors that write these lines.

# Startup and the run queue

  - `[agents/boot] step finished`, `[agents/boot] recovery finished`, `[agents/boot] recovery failed`
  - `[agents/sqlite] connection settings`
  - `[agents/runs] boot sweep requeued interrupted runs` <!-- id:eh_YCZuP -->
  - `[agents/outbox] boot sweep settled effects a dead process left running`
  - `[agents/outbox] pruning receipts failed`
  - `[agents/runs] boot reconcile: replaying finished child into parked parent` <!-- id:_RsqNClX -->
  - `[agents/runs] dispatch paused`, `[agents/runs] dispatch resumed`
  - `[agents/runs] dispatch pump failed`
  - `[agents/runs] activity woke a waiting run` <!-- id:tpFxLg1i -->

[Startup and shutdown](./startup-and-shutdown.md) and the [run queue](./run-queue.md) explain what these steps do.

# One agent run

Every line of one agent [run](../agent/runs.md) starts with `[agents/runtime]` and carries the `sessionId`, the `agentId`, the provider and the model. In the order a turn usually writes them: <!-- id:0OVrLoWY -->
  - `agent run starting`
  - `resuming the durable turn an earlier process left unfinished`
  - `turn already answered in the durable conversation; nothing to run`
  - `sending provider request` <!-- id:C2_CfkIS -->
  - `provider first output`, with `ttftMs`, the time to the first output
  - `assistant text streaming`
  - `assistant turn complete`, or `assistant turn reported error`
  - `tool call start`, then `tool call end` or `tool call failed`
  - `tool call answered from its receipt`, `tool call recovered from what its effect left behind`, `tool call answered as interrupted`
  - `recording a tool effect failed`, `recording a tool receipt failed`
  - `turn ended after tool batch`, `turn ended silently`, `ending turn before the next provider request` <!-- id:qZT_X9Yq -->
  - `the model sent nothing for too long; ending the turn`
  - `agent run finished`, or `agent run threw`

A run that picked up a turn left by an earlier process carries `resumed: true` on its `agent run finished` line.

Other `[agents/runtime]` lines:

  - `sub-session spawned`, `sub-session resolved` <!-- id:rrfbE_Wv -->
  - `plan step settled from children` <!-- id:dCijbIeI -->
  - `agent started session`, `agent-started session run failed` <!-- id:gIm1siw2 -->
  - `session continued`, `continuation could not carry attachment`
  - `session titled by model`, `session title generation failed`, `ignored agent session title update` <!-- id:dBx3vxUA -->
  - `learned reasoning efforts the model accepts; the next request will use them`
  - `durable task failed`, `durable harness reported`, `harness event handling failed`, `aborting the durable turn failed`, `durable store close failed`

# Scripts

  - `[agents/workflow] workflow spawned from chat` <!-- id:vnIHKeTj -->
  - `[agents/workflow] continued as new run` <!-- id:fH-VDeMa -->
  - `[agents/workflow] run paused on its time budget` <!-- id:u0b-olQJ -->
  - `[agents/workflow] replay finished with unconsumed journal groups`

# The database, sandboxes and other parts

  - `[agents/sql] slow statement`, at `warn`: a prepared statement ran for more than 20 ms. See [diagnosing a stalled server](./stalled-server.md).
  - `[agents/retention] scheduled`, `off`, `durable stores of idle sessions`, `compacted journals of finished runs`, `pass finished`, `pass failed`: the [retention](./database-retention.md) task.
  - `[agents/sqlite] added columns missing from older databases`, `could not create missing baseline object`, `created baseline tables missing despite an up-to-date migration version`, `migration statement skipped: its schema object already exists`: repairs made when the database opens.
  - `[Exec Canary] Sandbox probe failed`, `[Exec Canary] Sandbox probe recovered`: the [code execution](./code-execution-backend.md#is-code-execution-working) probe.
  - `[agents/mcp] discovered MCP server tools`, `could not reach MCP server`, `remote tools shadowed by authored tools of the same name`: [MCP servers](../agent/mcp.md).
  - `[agents/privacy] transcript privacy backfill`, `transcript privacy backfill failed; queue dropped`.
  - `[agents/oauth] openai code->token failed:` and the untagged `[agents]` lines about subscription sign-in: see [model providers](../agent/model-providers.md).
  - `[Agents API] Unhandled error in`, followed by the action name: an action of the [signed API](../build/signed-api.md) threw an error the server did not expect.

# Reading a session's durable store

The log lines tell you what a run did. To see what the model was given, read the session itself. Use `GetSession`, or the session page in the desktop app. <!-- id:KNt6k5MM -->

The server runs models through pi-ai and Pi Durable. Each session has a [durable store](../agent/durable-sessions.md), kept as plain JSONL in the `session_durable_files` table. This query prints its main file:

```sql
SELECT CAST(data AS TEXT) FROM session_durable_files WHERE session_id = ? AND file = 'main.jsonl' ORDER BY seq
```

# WebSocket

The server does not log WebSocket traffic. <!-- id:LFKybXaZ -->

The client logs two lines in its own console: <!-- id:Fmgbj2nL -->
  - `[agents/ui] sending session message` <!-- id:kDAKLiRi -->
  - `[agents/ui] rendering streaming assistant partial` <!-- id:LA86XvUl -->

It also warns with `[agents/ws] ignored malformed message` when it cannot read a frame.

To see what a socket received, open the network tab of the browser, or of the developer tools in the [desktop app](../software/desktop.md). [WebSocket subscriptions](../build/websocket-subscriptions.md) describes the frames, and [troubleshooting](./troubleshooting.md#streaming-response-does-not-appear-while-model-is-typing) uses them.

# What a log line must never contain <!-- id:m2vIrzlQ -->

Do not add a log line that includes: <!-- id:ltN5wXmx -->
  - plaintext secrets; <!-- id:y5ZHGjET -->
  - decrypted API keys; <!-- id:c_eEjEjn -->
  - signed request bodies; <!-- id:m0iuHrnW -->
  - full model request or response bodies; <!-- id:PqYvNucC -->
  - full session messages; <!-- id:w74VDOkI -->
  - large tool outputs. <!-- id:uNVtqLqH -->

Log IDs, lengths, counts, timings, statuses and booleans instead. <!-- id:xoQNhH3- -->

[Security](../agent/security.md) has the reasons.

# See also

- [Troubleshooting](./troubleshooting.md), symptom first
- [Diagnosing a stalled server](./stalled-server.md), for the slow-statement and loop-lag signals
- [Debugging runs](./debugging-runs.md), for run and script lines
- [Configuration](./configuration.md), for `SEED_APPS_LOG_LEVEL`
- [Security](../agent/security.md), logging security
