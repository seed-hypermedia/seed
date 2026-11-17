---
name: Startup and shutdown
summary: This page gives the order in which an app environment starts, the background tasks it runs while it is up, and what it does when it is told to stop.
---
This page follows one process of the [app environment](../software/app-environment.md) from start to stop. It says what each start step does, which tasks run in the background afterwards, and how the server stops. The code is `apps/src/main.ts`.

The first thing to check when a server does not come up: search its log for `[agents/boot] step finished`. Each start step writes that line when it ends, so the last one tells you how far the server got. What the server answers while it starts is in [endpoints and health](./endpoints-and-health.md#while-the-server-starts).

# Startup <!-- id:AzD4c8yi -->

The server starts in this order: <!-- id:UERmMWWo -->
  1. `config.create(config.parseArgs())` reads the settings. An invalid setting or an unknown flag stops the process here. <!-- id:karVPX4S -->
  2. The HTTP server opens its port. It answers `503` with `starting` until the real routes are in place.
  3. `sqlite.open(cfg.dbPath)` checks the database or creates it: migrations, the open settings and the planner statistics. <!-- id:0WgOMLsF -->
  4. If the schema does not match, the server stays up in schema-mismatch mode. It answers a JSON error on every route and goes no further. <!-- id:gQtOx1bh -->
  5. If the schema matches, the server creates `Service`. That runs the boot sweep of the run queue and of the effect outbox. Then the activity monitor, the schedule monitor and the other background tasks start, and the real routes replace the start routes. <!-- id:bldAXA78 -->
  6. Once the server answers requests, it handles parked runs whose children finished, and removes old receipts, one small step at a time.

When the schema does not match, the log names the stored version and the expected version. [Persistence](./persistence.md#schema-gate) describes the check, and [troubleshooting](./troubleshooting.md#schema-mismatch) says what to do. <!-- id:_J_gv5T9 -->

Each step logs `[agents/boot] step finished` with how long it took. Then the startup log prints the address, the database path, the HM API and IPFS URLs, the knowledge base account, the web tools that are connected, and the SQLite settings in use.

# Background tasks

These run for as long as the process lives:

- **Activity monitor.** Every `SEED_APPS_ACTIVITY_POLL_INTERVAL_MS` (5 seconds by default) it reads the HM activity feed for each [account](../protocol/identity.md) that has an enabled [trigger](../trigger.md) that needs the feed. It offers each event to trigger matching and to runs that wait for an event. It never polls for an account with no such trigger. See [triggers](../agent/triggers.md#the-monitors).
- **Schedule monitor.** On the same interval it looks at the enabled `schedule` triggers and records a firing for each time that is due.
- **Trigger document task.** Every minute it turns the trigger [documents](../protocol/documents.md) under mounted [agents](../agent.md) and running apps into triggers on this server. It follows their edits and removals.
- **Mount name task.** Every minute it renames mounted agents after their documents.
- **Run queue dispatcher.** Every second it takes queued runs and wakes timers that are due. See the [run queue](./run-queue.md).
- **Loop-lag gauge.** A 100 ms timer that measures how late it fires. See [diagnosing a stalled server](./stalled-server.md).
- **Exec canary.** Off unless `SEED_APPS_EXEC_CANARY_SECS` is set. See the [code execution backend](./code-execution-backend.md#is-code-execution-working).
- **Retention task.** See [database retention](./database-retention.md).

The monitors act only on the triggers in their own database. So several servers that read the same feed, each with its own database, do not fire on each other's agents.

# Shutdown <!-- id:6sqQiSsC -->

The server stops when it gets `SIGINT` or `SIGTERM`. It does this, in order: <!-- id:27DpYHG3 -->
  1. It ignores any further stop signal. <!-- id:DJIfQ3v4 -->
  2. It stops the background tasks: the loop-lag gauge, the exec canary, the activity monitor, the schedule monitor, the trigger document task, the mount name task, and the retention task. This step takes at most 2 seconds. <!-- id:ZjI-8tpm -->
  3. It closes every WebSocket client with code `1001`. <!-- id:J6207Axe -->
  4. It empties its list of clients. <!-- id:sCNZyrwv -->
  5. It stops the HTTP server. If that takes more than 3 seconds, it forces the stop. <!-- id:aDJ3JZvP -->
  6. It waits for background runs in progress, for at most 5 seconds, so one stuck session cannot hold up the stop. Then it stops the run queue's timers. <!-- id:X8QzoNFd -->
  7. It closes the SQLite database. <!-- id:PpbedZlo -->
  8. It exits. <!-- id:bAUcIud1 -->

A run that was cut off is not lost. The next start puts it back in the queue; see the [run queue](./run-queue.md#across-a-restart).

# See also

- [Endpoints and health](./endpoints-and-health.md), what the server answers while it starts
- [Run queue](./run-queue.md), the boot sweep and the second pass
- [Triggers](../agent/triggers.md), the monitors in detail
- [Persistence](./persistence.md), the schema check
- [Logs](./logs.md), the start and monitor lines
