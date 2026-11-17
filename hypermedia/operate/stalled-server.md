---
name: Diagnosing a stalled server
summary: This page shows how to tell that the one thread of an app environment is busy or stuck, how to find what holds it, and how to profile it when the counters do not say.
---
An [app environment](../software/app-environment.md) that stops answering is usually not down. Its one thread is busy. This page gives the signs, the counters that name the cause, and a way to profile the thread when the counters do not say.

The first thing to check:

```bash
curl -s http://127.0.0.1:3050/api/perf | jq '.loop, (.metrics | with_entries(select(.key | startswith("api.") or startswith("sql."))))'
```

If this answers, it shows how late the thread is and which actions and statements take the time. If nothing answers at all, go to [A loop that never yields](#a-loop-that-never-yields). For other symptoms see [troubleshooting](./troubleshooting.md).

# Why one busy thread stops everything

Everything on this server runs on one thread: HTTP, WebSockets, every SQLite statement, the matching of [triggers](../trigger.md), and the [agent](../agent.md) runs themselves. When that thread is busy:

- `/api/health` answers late or never;
- the reverse proxy logs timeouts when it tries to connect;
- the provider and tool timings in `/api/perf` look normal, because nothing reaches them.

A loop that never ends and never waits stops the whole server, while the process looks healthy from outside. Health, API and WebSocket requests all time out. The container stays "Up". One CPU core sits at about 100%.

# What makes a stall visible

  - **`loop.lag` in `GET /api/perf`.** A 100 ms timer records how late it fires. `p50`, `p95` and `max` cover the last minute (`windowMs`). `maxSinceStart` keeps the worst stall since the server started, so you still see a spike that has passed. A healthy server shows less than ten milliseconds. The same answer carries `api.<ActionName>`, the time of every action of the [signed API](../build/signed-api.md) by name; `sql.<keyword>`, the time inside every prepared statement by its first keyword; and the `sql.slow` counter. The command at the top of this page prints all of them.
  - **`GET /api/health` answers `503`** with `{status: 'unhealthy', reason: 'loop-lag', p95}` while the p95 lag over the last minute is above 250 ms (`LOOP_LAG_UNHEALTHY_P95_MS` in `apps/src/perf.ts`). A healthy answer still carries `loop.lag` with the numbers. The image's `HEALTHCHECK` calls it every 30 seconds with a 5 second timeout and three retries. So a stalled server shows as `unhealthy` in `docker ps`, and to Watchtower, instead of "Up".
  - **`[agents/sql] slow statement`**, logged at `warn`. Every call of a prepared statement that takes more than 20 ms logs how long it took, its first keyword and the first 200 characters of the SQL. It never logs the values. Each statement logs at most three lines a minute, and the next line says how many repeats were left out.

# A loop that never yields <!-- id:r6qSTRho -->

When the server does not answer at all, you cannot read the counters. Check from outside: <!-- id:qdTU6rbl -->
  - `docker stats`: one core at full use with no change in network traffic means a busy loop in the JavaScript code, not heavy load. <!-- id:CLDSxI8J -->
  - `docker logs -t --tail 50`: find the last event before the log went silent. Look for a `tool call start` line with no `tool call end` or `tool call failed` line after it. <!-- id:Fh2OFium -->
  - `strace -p <pid> -c` on the host: many reads of `/proc/self/statm`, with `futex` and `sched_yield`, are the memory checks of a loop that spins in compiled JavaScript. <!-- id:lnefkJD0 -->
  - The full input of every tool call is stored in `session_events`, as [DAG-CBOR](../schema/dag-cbor.md) in `event_cbor`, even when the log line is cut short. Decode it and run the same input through the suspect code on your own machine. See [persistence](./persistence.md). <!-- id:Vzfv2OJ5 -->

# Profiling the thread

Use this when the lag is high and nothing above names the cause. You sample the thread with Bun's inspector.

The inspector has no password. Never bind it to a public address.

1. Start the container with the inspector on its own port. Change the command to `bun --inspect=127.0.0.1:9230 run --no-install main.js`.
2. Find the inspector's session id in the startup log: `docker logs agents-stable | grep ws://`.
3. Write a small script, about 40 lines, that opens that WebSocket and speaks WebKit's inspector protocol. It sends `ScriptProfiler.startTracking {includeSamples: true}`, waits, and sends `ScriptProfiler.stopTracking`. The samples come in the `ScriptProfiler.trackingComplete` event, as `samples.stackTraces[].stackFrames` with `sourceID`, `line` and `column`. The script counts the top frame of every sample.
4. Run it. For example, `docker exec agents-stable bun /tmp/prof2.js ws://127.0.0.1:9230/<id> 15` samples for 15 seconds and prints the frames that ran most.
5. Read the code behind each frame. The bundle is minified, so turn each `line:column` back into code in `/app/main.js`: `sed -n '<line>p' /app/main.js | cut -c<column-40>-<column+80>`.

`agents-stable` is the name of the production container on the hosted Seed servers. Use your own container's name.

# After a restart

Restarting the server is always safe. The boot sweep puts interrupted [runs](../agent/runs.md) back in the queue, and the [effect outbox](../agent/effect-outbox.md) answers the tool calls they left open.

If the same input stops the server again within minutes, the cause is in the data a run replays. Look at the stored tool input.

# See also

- [Endpoints and health](./endpoints-and-health.md), the health, perf and metrics endpoints
- [Logs](./logs.md), the slow-statement line and the other log lines
- [Run queue](./run-queue.md), what the boot sweep does
- [Persistence](./persistence.md), the tables the stored inputs live in
- [Troubleshooting](./troubleshooting.md), other symptoms
