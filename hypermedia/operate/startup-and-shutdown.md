---
name: Startup and shutdown
summary: The order in which an app environment starts, the background tasks it runs while it is up, and what it does when it is told to stop.
---
This page follows one process of the [app environment](../software/app-environment.md) from start to stop (`apps/src/main.ts`). It says what each boot step does, which background tasks run afterwards, and how the server shuts down. What the server answers during boot is in [endpoints and health](./endpoints-and-health.md#while-the-server-starts).

# Startup <!-- id:AzD4c8yi -->

On startup: <!-- id:UERmMWWo -->
  1. `config.create(config.parseArgs())` builds config. An invalid setting or an unknown flag stops the process here. <!-- id:karVPX4S -->
  2. The HTTP server binds its port and answers `503` `starting` until the full routes are in place.
  3. `sqlite.open(cfg.dbPath)` validates or initializes the DB: migrations, the open settings and the planner statistics. <!-- id:0WgOMLsF -->
  4. If the schema is mismatched, the server stays up in schema-mismatch mode, returns a JSON error on every route, and goes no further. <!-- id:gQtOx1bh -->
  5. If schema is valid, `Service` is created, which boot-sweeps the run queue and the effect outbox. Then the activity trigger monitor, the schedule trigger monitor and the other background tasks start, and the full routes replace the boot routes. <!-- id:bldAXA78 -->
  6. Once it is serving, the parked-run reconcile and receipt pruning run, a step at a time.

The schema mismatch log includes the stored and expected version. [Persistence](./persistence.md#schema-gate) describes the gate, and [troubleshooting](./troubleshooting.md#schema-mismatch) what to do about it. <!-- id:_J_gv5T9 -->

Each step logs `[agents/boot] step finished` with its duration. The startup log then prints the address, the database path, the HM API and IPFS URLs, the knowledge base account, the web tools that are wired, and the SQLite settings in effect.

# Background tasks

These run for the life of the process:

- **Activity monitor.** Polls the HM activity feed every `SEED_APPS_ACTIVITY_POLL_INTERVAL_MS` (default 5 seconds), for accounts that have an enabled trigger that needs it, and offers each event to trigger matching and to runs waiting for an event. An account with no such trigger is never polled. See [triggers](../agent/triggers.md#the-monitors).
- **Schedule monitor.** Evaluates enabled `schedule` triggers on the same interval and records a firing for each due occurrence.
- **Trigger document sync.** Every minute, turns trigger documents under mounted agents and running apps into triggers on this server, and follows their edits and removals.
- **Mount name sync.** Every minute, renames mounted agents after their documents.
- **Run queue dispatcher.** Claims queued runs and wakes due timers every second. See the [run queue](./run-queue.md).
- **Loop-lag gauge.** A 100 ms timer that measures how late it fires. See [diagnosing a stalled server](./stalled-server.md).
- **Exec canary.** Off unless `SEED_APPS_EXEC_CANARY_SECS` is set. See the [code execution backend](./code-execution-backend.md#is-code-execution-working).
- **Retention task.** See [database retention](./database-retention.md).

Each hosted deployment has its own database, and the monitors act only on triggers in their own database, so several servers reading the same feed do not fire on each other's agents.

# Shutdown <!-- id:6sqQiSsC -->

The service handles `SIGINT` and `SIGTERM`: <!-- id:27DpYHG3 -->
  1. stop repeated shutdown handling; <!-- id:DJIfQ3v4 -->
  2. stop the background tasks: the loop-lag gauge, the exec canary, the activity trigger monitor, the schedule monitor, the two sync loops, and the retention task (bounded at 2 seconds); <!-- id:ZjI-8tpm -->
  3. close WebSocket clients with code `1001`; <!-- id:J6207Axe -->
  4. clear client set; <!-- id:sCNZyrwv -->
  5. stop Bun server; <!-- id:aDJ3JZvP -->
  6. drain in-flight background runs, bounded at 5 seconds so one stuck session cannot block shutdown (the HTTP server's own stop is bounded at 3 seconds before it is forced), then stop the run-queue timers; <!-- id:X8QzoNFd -->
  7. close SQLite DB; <!-- id:PpbedZlo -->
  8. exit. <!-- id:bAUcIud1 -->

# See also

- [Endpoints and health](./endpoints-and-health.md), what the server answers while it starts
- [Run queue](./run-queue.md), the boot sweep and the reconcile pass
- [Triggers](../agent/triggers.md), the monitors in detail
- [Persistence](./persistence.md), the schema gate
- [Logs](./logs.md), the boot and monitor lines
