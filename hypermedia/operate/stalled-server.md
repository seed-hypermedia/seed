---
name: Diagnosing a stalled server
summary: How to tell that an app environment's single thread is busy or stuck, find what is holding it, and profile it when the counters do not say.
---
An [app environment](../software/app-environment.md) that stops answering is usually not down. Its one thread is busy. This page gives the signs, the counters that name the cause, and a profiling recipe for when they do not. For other symptoms see [troubleshooting](./troubleshooting.md).

# Why one busy thread stops everything

Everything on this server runs on one thread: HTTP, WebSockets, every SQLite statement, trigger evaluation and the agent runs themselves. When that thread is busy, `/api/health` is late or never answers, the reverse proxy logs dial timeouts, and the provider and tool spans in `/api/perf` look normal because nothing reaches them. A synchronous infinite loop wedges the whole server while the process looks healthy from outside: health, API, and WebSocket requests all time out, the container stays "Up", and CPU sits at \~100% on one core.

# What makes a stall visible

  - **`loop.lag` in `GET /api/perf`**: a 100 ms timer records how late it fires. `p50`, `p95` and `max` cover the last minute (`windowMs`); `maxSinceStart` keeps the worst stall since boot so a spike that already passed is still visible. A healthy server shows single-digit milliseconds. The same snapshot carries `api.<ActionName>` (wall time of every signed action, by name), `sql.<keyword>` (time inside every prepared statement, by its first keyword) and the `sql.slow` counter, so "slow, and where" is one curl: `curl -s http://127.0.0.1:3050/api/perf | jq '.loop, (.metrics | with_entries(select(.key | startswith("api.") or startswith("sql."))))'`.
  - **`GET /api/health` is 503** with `{status: 'unhealthy', reason: 'loop-lag', p95}` while the p95 lag over the last minute exceeds 250 ms (`LOOP_LAG_UNHEALTHY_P95_MS` in `apps/src/perf.ts`); a healthy answer still carries `loop.lag` with the current numbers. The image's `HEALTHCHECK` fetches it every 30 s with a 5 s timeout and three retries, so a stalled server shows as `unhealthy` in `docker ps` and to Watchtower instead of "Up".
  - **`[agents/sql] slow statement`** at `warn`: any prepared-statement call over 20 ms logs its duration, first keyword and the first 200 characters of the SQL (never the bindings), at most three lines per statement per minute, with the number of suppressed repeats on the next line.

# A loop that never yields <!-- id:r6qSTRho -->

When the server does not answer at all, the counters cannot be read. Check from outside: <!-- id:qdTU6rbl -->
  - `docker stats`: one core pegged with flat network I/O points to a JS busy loop, not load; <!-- id:CLDSxI8J -->
  - `docker logs -t --tail 50`: find the last event before the logs went silent, and look for a `tool call start` with no matching `tool call end`; <!-- id:Fh2OFium -->
  - `strace -p <pid> -c` on the host: repeated reads of `/proc/self/statm` plus `futex` and `sched_yield` are GC allocation checks inside a spinning JIT loop; <!-- id:lnefkJD0 -->
  - full tool inputs are stored in `session_events` (DAG-CBOR in `event_cbor`) even when the log line is truncated. Decode them and replay the input against the suspect code path locally. See [persistence](./persistence.md). <!-- id:Vzfv2OJ5 -->

# Profiling the thread

When the lag is high and nothing above names the cause, sample the thread with the inspector. The container must have been started with the inspector listening on its own port (override the command to `bun --inspect=127.0.0.1:9230 run --no-install main.js`; the inspector is unauthenticated, so never bind it to a public interface), and the session id is in the startup log: `docker logs agents-stable | grep ws://`. The protocol is WebKit's: `ScriptProfiler.startTracking {includeSamples: true}`, wait, `ScriptProfiler.stopTracking`; the samples arrive in the `ScriptProfiler.trackingComplete` event as `samples.stackTraces[].stackFrames` with `sourceID`, `line` and `column`. A \~40-line script that opens the WebSocket, sends those two commands, and counts the top frame of every sample is enough: `docker exec agents-stable bun /tmp/prof2.js ws://127.0.0.1:9230/<id> 15` samples for 15 s and prints the hottest frames. The bundle is minified, so map each `line:column` back into `/app/main.js` (`sed -n '<line>p' /app/main.js | cut -c<column-40>-<column+80>`) to read the function that was running.

# After a restart

Restarting the service is always safe: the boot sweep requeues interrupted [runs](../agent/runs.md) and the [effect outbox](../agent/effect-outbox.md) answers the tool calls they left open. If the same input wedges the server again within minutes, the cause is in the data a run replays, and the stored tool input is the place to look.

# See also

- [Endpoints and health](./endpoints-and-health.md), the health, perf and metrics endpoints
- [Logs](./logs.md), the slow-statement line and the rest of the log catalogue
- [Run queue](./run-queue.md), what the boot sweep does
- [Persistence](./persistence.md), the tables the stored inputs live in
- [Troubleshooting](./troubleshooting.md), other symptoms
