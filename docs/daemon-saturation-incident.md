# ACTIVE INCIDENT: daemon CPU saturation — hyper.media and all hosted sites

> **Status: ACTIVE / UNRESOLVED.** Last verified 2026-08-11 09:42 UTC. Production degrades to unusable roughly **10
> minutes after each daemon restart**, under ordinary traffic. Two of three known causes are fixed and deployed; the
> third is identified, has a written fix, and is **not deployed**.
>
> **No data loss.** All damage is availability.

**Affected:** hyper.media, seedteamtalks, ifebitcoin.org, arkad.blog, and ~30 other custom domains — everything served
by the single gateway host (`ssh hm`).

---

## 1. Current state (update this section as things change)

### Live numbers, 09:42 UTC

| Metric               | Value                                                              |
| -------------------- | ------------------------------------------------------------------ |
| `daemon_gateway` CPU | **671%** of 800% (saturating)                                      |
| Load average         | 9.43                                                               |
| hyper.media          | 200, but latency climbing                                          |
| `notify` container   | Stopped 08:55 UTC — **deliberate**, stopped by Eric. Not a symptom |

### The decay cycle (measured, organic traffic only — no synthetic load)

After a daemon restart at 09:35 UTC, with no load testing running:

| Elapsed | Daemon CPU | hyper.media TTFB |
| ------- | ---------- | ---------------- |
| +2m     | 54%        | 0.45s            |
| +4m     | 55%        | 0.52s            |
| +6m     | 444%       | 0.73s            |
| +8m     | 394%       | 1.48s            |
| +10m    | **702%**   | **26.1s**        |

**This is the single most important fact in this document.** Ordinary traffic re-saturates the box in ~10 minutes. A
restart buys roughly 6 minutes of good service. Any claim of "fixed" must survive at least 30 minutes of organic traffic
before it is believed — this incident has produced three premature "recovered" calls, each from a measurement taken
inside the quiet window after a restart.

### What is deployed vs. what is in git

| Component              | Running in production                                 | In git                                                            | On Docker Hub                                            |
| ---------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------- |
| Daemon (`site:latest`) | hand-built image `0450172e5bef`, contains the CTE fix | merged as `f2170df66` (#945)                                      | `:latest` rebuilt 07:53 with same fix — **never pulled** |
| Web (`web:latest`)     | hand-built image `3b31a24b2a32`, no SSR summaries     | branch `fix/no-ssr-interaction-summaries`, **unmerged, unpushed** | **not published**                                        |
| Citation cap           | **not deployed**                                      | uncommitted working-tree edit to `api-interaction-summary.ts`     | —                                                        |

Production is running two images that exist **only on that host**. If the host's Docker storage is lost, the running
configuration cannot be reproduced without rebuilding from the branch.

### Risks currently being carried

1. **`notify` is stopped deliberately** (by Eric, 08:55 UTC). Listed here only so nobody mistakes it for a symptom or
   restarts it without intent. Notification emails are not being delivered while it is down.
2. **Daemon rollback is gone.** `site:rollback-2026.8.4` and `site:hotfix-cte-20260811` tags no longer exist on the
   host; only `site:latest` remains. Recovery path if the daemon needs replacing is now
   `docker pull seedhypermedia/site:latest` from Hub (which contains the merged CTE fix, so this is acceptable — but it
   is no longer a _rollback_, it is a re-pull). `web:rollback-2026.8.4` (`956e35de2e49`) does still exist.
3. **Watchtower is stopped** (`autoupdater`, exited 2h ago). Nothing auto-deploys. This is deliberate — it would
   overwrite the hand-built web image with Hub's `:latest`, which lacks the SSR fix — but it must be restarted once the
   web fix ships. In July it sat silently stopped for 3 days and no deploys happened.
4. **No automated database backups exist on this host.** The only backup is the one taken during this incident:
   `/shm/backups/db-2026-08-11T0656Z.sqlite` (8GB, `PRAGMA quick_check` → `ok`), taken 06:56 UTC.
5. **Two debug containers are still running** (`web_debug`, `web_debug2`) plus ~14GB of copied web data in
   `/tmp/webdebug-data` and `/tmp/webdebug2-data`. Harmless but should be cleaned.
6. **Traefik carries incident config** — a bot-UA block and per-IP limits across 34 routers. Neither had any measurable
   effect on CPU. Original config preserved at `/home/ubuntu/.reverse-proxy/config.yml.pre-incident-20260811`.

---

## 2. Triage runbook — if it is down right now

```sh
# 1. Confirm the shape: is the daemon pinned and is web idle?
ssh hm 'docker stats --no-stream --format "{{.Name}} {{.CPUPerc}}" daemon_gateway web_gateway'
#    daemon ~700% + web near 0% == this incident.

# 2. What is it burning CPU on? (daemon has no published debug port)
ssh hm 'PID=$(docker inspect -f "{{.State.Pid}}" daemon_gateway); \
  sudo nsenter -t $PID -n curl -s "http://localhost:56000/debug/pprof/profile?seconds=20" -o /tmp/cpu.pprof'
scp hm:/tmp/cpu.pprof . && go tool pprof -top -cum -nodecount=40 cpu.pprof
#    Expect ListCitations and/or ListDirectory at the top.

# 3. Temporary relief: restart the daemon. Buys ~6 minutes. NOT a fix.
ssh hm 'docker restart daemon_gateway'
#    Confirm no reindex was triggered (it should print 0):
ssh hm 'docker logs --since 2m daemon_gateway 2>&1 | grep -c ReindexingStarted'
```

**Do not** interpret post-restart numbers as evidence that anything is fixed. See the decay table above.

**Do not** bother blocking traffic. It was tried twice with rigorous measurement (bot UAs, then the two heaviest client
IPs, which held 108 of 236 connections) and moved CPU by **zero percent** both times. Real traffic is ~1.9
requests/second. This is not a traffic problem.

---

## 3. Architecture context needed to reason about this

### The request path

```
browser/crawler
  → traefik (host network, :443)                     [file config: ~/.reverse-proxy/config.yml]
    → web_gateway  (remix SSR, container :3500)      [seedhypermedia/web]
      → daemon_gateway (gRPC/connect, :56000)        [seedhypermedia/site]
        → SQLite  (/shm/gateway/daemon/db/db.sqlite, 8GB)
```

`web_gateway` also proxies the browser's own API calls (`/api/*`) through to the daemon, so the daemon sees both SSR
prefetches and client-side queries — the tcpdump on `:56000` cannot tell them apart without inspecting payloads.

### The SQLite read pool — the reason one slow query hurts everything

`backend/storage/storage.go`:

```go
poolSize := max(runtime.NumCPU(), 12)   // → 12 read connections on this 8-core host
```

Every read RPC must take a pool slot before it can execute. **A query that holds a slot for 2.5 seconds is not merely
slow — it removes 1/12th of the server's read capacity for that duration.** Twelve of them and the server is dead to all
other reads, no matter how cheap.

This is why a `GetAccount` that costs microseconds of CPU was observed taking 23 seconds: it was waiting for a
_connection_, not for compute. Confirmed by a symbolized goroutine dump with **546 goroutines parked** at:

```
sqlitex.(*Pool).get              pool.go:249
sqlitex.(*Pool).ReadConn         pool.go:204
v3alpha.(*Server).GetAccount     documents.go:1430
```

It also explains why the CPU profile is misleading: the expensive queries appear to be ~90% of CPU because they are the
only queries holding slots long enough to _use_ CPU. The cheap ones mostly cannot get a slot at all.

### The SSR prefetch waves

`frontend/apps/web/app/loaders.ts` renders in three sequential waves so HTML ships complete:

- **Wave 1** — the resource, home resource, both directories (`'Children'` mode, cheap), collaborators. _Formerly also
  the document's own interaction summary._
- **Wave 2** — one prefetch per query block (`extractQueryBlocks`), one per embedded ref (`extractRefs`), one per
  author.
- **Wave 3** — _formerly_ up to `MAX_RESULT_SUMMARIES = 30` interaction summaries, one per embed card.

Because the waves are sequential, a slow call in Wave 1 delays everything after it.

### The caches that exist (and their limits)

`frontend/apps/web/app/server-universal-client.ts` holds a **30-second, 500-entry** shared SSR cache over `Query`,
`QueryBlock`, `InteractionSummary`, and `ListCitations`, storing in-flight promises so concurrent renders of the same
page share one gRPC call. It works — but only for _repeats_. Measured traffic is spread across many distinct hosts and
documents, so most calls are distinct targets and miss the cache.

Responses carry `Cache-Control: no-store`; there is no HTTP caching layer in front of any of this.

---

## 4. Cause 1 — un-materialized redirect CTE (FIXED, MERGED, DEPLOYED)

`qListDocsCommentAggScoped` in `backend/api/documents/v3alpha/documents.go` builds a `redirected` CTE and references it
from the **recursive term** of `chains`. Without an explicit hint, SQLite re-derives it for every row the recursion
visits, and each derivation pays a correlated `MAX(generation)` subquery over `document_generations`. ~2,222 visited
rows × ~2.5ms ≈ the 5.5s measured.

Every listing carries this aggregation, and SSR issues one recursive whole-subtree listing per query block per page
view.

**Fix:** `redirected AS MATERIALIZED ( … )` — one keyword.

Benchmarked against a consistent snapshot of the production database (8GB, 91,951 structural blobs, 13,921 comments),
scoped to the space with the most comments (10,227), returning 1,627 rows:

| Query                    | Unfixed | Fixed      |
| ------------------------ | ------- | ---------- |
| `chains` CTE alone       | 5.166s  | **0.009s** |
| Full comment aggregation | 5.495s  | **0.089s** |

Result sets byte-identical (matching md5). Run order alternated across two rounds to rule out page-cache warming; the
fixed variant ran _first_ both times and was still ~60× faster.

**Verified in production:** after deploying, `ListDirectory` fell from **92.5% → 7.31%** of daemon CPU in a live
profile.

### Warning left in the code

A pre-existing comment stated MATERIALIZED hints on `targets`, `redirected` or `chains` "did not help". That was
accurate about the _IN-list quadratic_ it describes — fixed separately — but read more broadly it points directly away
from this fix, and it did misdirect this investigation. It has been scoped and cross-referenced in #945.

---

## 5. Cause 2 — counting citations by enumerating them (FIXED IN PROD, NOT MERGED)

`frontend/packages/shared/src/api-interaction-summary.ts` derives
`{citations, comments, changes, children, authorUids, blocks}` — small integers shown on embed card footers, the
document header, and per-block margin markers — by fetching **every citation object** for the target via `listAllPages`
at 500 per page. A document with 6,426 citations costs **13 sequential `ListCitations` round-trips**.

`ListCitations` is expensive regardless of page size: `qListCitationsTpl` materializes the target's whole citation
fan-out (`changes` → `citing_blobs`, a `UNION` expanding each change by every `Ref` blob in its genesis chain), sorts
and groups it in temp B-trees, and **only then** applies `LIMIT :page_size + 1`. Measured on the snapshot: **2.4–2.5s**
for target `382` (`/short-posts`, 1,369 links) and **0.34s** for target `10478` (6,426 links) — cost tracks fan-out
shape, not citation count.

SSR called this for the document itself (Wave 1) **and** up to 30 embed cards (Wave 3).

### Measured per-page attribution

An instrumented build (`SEED_INSTRUMENTATION=dev`) rendering `/lobby` on seedteamtalks, isolated from serving traffic:

```
GET /lobby ......................................... 269.6s total
├─ getHomeMetadata ................... 22.7s
├─ fetchResource ..................... 16.4s
├─ Wave1 ............................ 112.5s
│  └─ prefetchInteractionSummary .... 112.5s   ← 41.7%, largest single item
├─ Wave2 ............................. 51.4s
├─ Wave3 ............................. 66.5s   ← 24.7%, entirely summaries
└─ reactSSR ........................... 0.09s  ← rendering itself is FREE
```

**Summaries were 179 of 269 seconds — 66%.** React rendering was 86 milliseconds; everything else was waiting on the
daemon. Note this page has only **2 embeds**: it does not take an embed-heavy page to hurt, because every document page
pays at least its own summary.

### A/B, same page, interleaved

|               | Patched (no SSR summaries)      | Control (unpatched)                  |
| ------------- | ------------------------------- | ------------------------------------ |
| Run order     | first (cold-cache disadvantage) | second                               |
| TTFB          | **200.0s**                      | 369.4s                               |
| HTTP / size   | 200 / 180.9KB                   | 200 / 185.4KB                        |
| Summary spans | **absent**                      | 152.2s + 96.3s = **67.3%** of render |

**Fix:** delete both SSR prefetch sites (`loaders.ts:276` and Wave 3). Counts load client-side via
`useInteractionSummary` for cards a real reader has on screen. Crawlers never run JS, so serving them these counts was
pure waste. Query-block cards and list items were never affected — their counts ride each listing item's
`activitySummary`.

**Deployed 09:09 UTC.** Immediately after: daemon 690% → 24.8%, sites 0.54s.

---

## 6. Cause 3 — the client-side path is uncapped (IDENTIFIED, FIX WRITTEN, NOT DEPLOYED)

**This is the open problem and the most likely explanation for the 10-minute decay cycle.**

Removing the SSR prefetch did not remove the work — it _moved_ it. Real readers' browsers now call
`/api/InteractionSummary`, which runs the identical unbounded enumeration through `web_gateway`. Crawlers stopped
triggering it (they don't run JS), which is why the crawler simulation looked clean, but human readers still do.

### Evidence it can saturate the box on its own

Load test, 8 concurrent requests to `/api/InteractionSummary` against the two most-cited documents:

|                | Result                                                                                                            |
| -------------- | ----------------------------------------------------------------------------------------------------------------- |
| Daemon CPU     | 60% → **677% within 6 seconds**                                                                                   |
| Response times | avg 51s, max 90s (timeout)                                                                                        |
| Sites during   | timing out                                                                                                        |
| Recovery       | **did not self-recover** — ~300 queued enumerations ground on for 10+ minutes after every client had disconnected |

Remix keeps running handlers after clients disconnect, so abandoned work is not cancelled. A 30-second burst is
self-sustaining. This is reachable by an attacker, by an unlucky burst of readers on a popular document, or by a
JS-executing crawler such as Googlebot.

### The written fix (uncommitted, in the working tree)

Replace `listAllPages(...)` in `api-interaction-summary.ts` with a **single** `listCitations` page. This bounds every
caller — SSR, client API, everything — to one enumeration instead of up to 13.

Trade-off: documents with more than `LIST_PAGE_SIZE` (500) citations under-report their counts until the daemon can
supply a real count. Two production documents exceed this (6,426 and 6,423 citations).

Status: typecheck clean, prettier clean, 1010 shared-package tests pass. Not committed, not built, not deployed.

**Honest caveat:** this bounds the blast radius, it does not eliminate it. One `ListCitations` still costs 0.3–2.5s and
still holds a pool slot. Eight concurrent requests can still occupy 8 of 12 slots. The cap turns "unbounded and
self-sustaining" into "expensive but bounded"; the real fix is #7 below.

---

## 7. Follow-ups, priority order

1. **Deploy the citation cap** (§6). Smallest change that meaningfully reduces the recurring saturation.
2. **Merge and release the web fix.** Production is running an unreleased hand-built image; git and Docker Hub do not
   reflect what is deployed. Then restart watchtower.
3. **Daemon-maintained citation count**, exactly as `children_count` already works for directories — see
   `getDocumentInfo` in the same `Promise.all`, which does the cheap indexed thing three lines away. This removes the
   enumeration entirely and would let counts return to SSR if desired. **This is the real fix.**
4. **Per-RPC deadlines and an in-flight cap on the daemon.** Goroutines reached 60,000 with no ceiling. The server
   should shed load rather than convoy.
5. **Propagate client disconnects** from Remix into gRPC cancellation so abandoned work stops.
6. **Pool-wait metric** — time spent in `Pool.get`. This single number would have named the bottleneck on day one.
7. **Traefik access logs** (JSON + User-Agent) and `--metrics.prometheus.addRoutersLabels=true`. Days were spent
   theorizing about traffic that could simply have been read.
8. **Automated database backups.** There are none.
9. **Version-tagged Docker images.** `--cleanup` plus publishing only `:latest` means there is no way to roll back to a
   previous release; this incident lost its rollback tags entirely.
10. **Restart `notify`** when the incident is over (it was stopped deliberately, not by a fault).

---

## 8. Timeline (UTC, 2026-08-11)

| Time        | Event                                                                                        |
| ----------- | -------------------------------------------------------------------------------------------- |
| 00:06       | Release 2026.8.4 images published                                                            |
| 00:10       | Watchtower deploys; daemon restarts; full reindex begins (schema change in release)          |
| 00:43       | `ReindexingFinished` after 33 min — saturation continues, making the reindex a red herring   |
| ~06:00      | Investigation begins. Profile: `ListDirectory` = 92.5% of CPU                                |
| 06:16       | Daemon restart → 0.46% for ~3 min → back to 794%. Restart alone does not fix                 |
| 06:26       | `web_gateway` stopped as attribution test → daemon **761% → 37%**. Web is the sole driver    |
| 06:56       | Database snapshot taken (`/shm/backups/db-2026-08-11T0656Z.sqlite`)                          |
| ~07:00      | Bot-UA block deployed → **no CPU change**. Two heaviest IPs blocked → **no CPU change**      |
| ~07:05      | Snapshot benchmarks isolate the `redirected` CTE; `MATERIALIZED` = 60×, identical results    |
| 07:21       | Hand-built patched daemon deployed. `ListDirectory` 92.5% → **7.31%**. Sites 200 in 0.48s    |
| 07:2x       | **"Production is recovered" declared — prematurely** (measured in the post-restart window)   |
| ~07:40      | Saturation returns. `ListCitations` now 86.85% of CPU — second bottleneck, previously masked |
| 07:53       | #945 merged; `Release - Docker Images` publishes `:latest` with the CTE fix                  |
| 08:40       | Instrumented debug container attributes 66% of a page render to interaction summaries        |
| 08:55       | `notify` stopped deliberately by Eric (not a symptom)                                        |
| 09:09       | Patched web deployed. Daemon 690% → **24.8%**, sites 0.54s                                   |
| 09:13–09:16 | Sustained: 61–102% CPU, sites 0.45s, load < 1                                                |
| ~09:19      | Load test (8× `/api/InteractionSummary`) re-saturates to 677%; does not self-recover         |
| 09:35       | Daemon restarted to flush the induced backlog                                                |
| 09:37–09:45 | **Organic-only decay measured: 54% → 702% over 10 minutes, TTFB 0.45s → 26.1s**              |

---

## 9. Hypotheses ruled out (each killed by measurement, not argument)

| Hypothesis                                     | How it died                                                                             |
| ---------------------------------------------- | --------------------------------------------------------------------------------------- |
| Crawler storm / abuse                          | Bot UAs blocked at the edge → zero CPU change. Real traffic is 1.9 req/s                |
| Two heavy client IPs                           | Both blocked (108 of 236 connections) → connections halved, **CPU unchanged**           |
| The 2026.8.4 reindex                           | Finished 00:43; saturation continued 6+ hours                                           |
| SSR retry storm                                | SSR query client is `retry: false` (`queries.server.ts`)                                |
| `MATERIALIZED` would also help `ListCitations` | Tested: **worse** (3.7s vs 2.4s) — temp B-tree writes tripled sys time. Shipped nothing |
| The new file-browser sidebar (#937)            | Renders a skeleton during SSR; only fetches after hydration on wide viewports           |
| Missing database index                         | Query plans are all index seeks; the cost is row fan-out                                |
| Table-style query blocks rendering eagerly     | Real trigger was the summaries, not the table view                                      |

---

## 10. Open questions / not verified

- **Where did the `site:rollback-2026.8.4` and `site:hotfix-cte-20260811` tags go?** They were created at ~07:15 and are
  absent now. Watchtower was stopped before then and exited with code 1, which is itself unexplained.
- **Which documents** the live `ListCitations` calls target — payloads are protobuf and only method names were captured.
  The hot candidates are known from the database (targets `382`, `10478`, `10644`) but not confirmed against live
  traffic.
- **What exactly drives the 10-minute decay** — cause 3 is the leading hypothesis but has not been proven to be the
  whole story. It should be confirmed by capturing `/api/InteractionSummary` request rates from `web_gateway` logs
  during a decay cycle.
- **Average embeds per page** in real traffic — 30 was the ceiling, not an observed mean.

---

## 11. Diagnostic recipes worth keeping

**CPU profile from the production daemon** (no published debug port):

```sh
PID=$(docker inspect -f '{{.State.Pid}}' daemon_gateway)
sudo nsenter -t $PID -n curl -s "http://localhost:56000/debug/pprof/profile?seconds=20" -o /tmp/cpu.pprof
go tool pprof -top -cum -nodecount=40 cpu.pprof
```

**Attribute load to a caller** — stop the suspected caller, watch the daemon. Blunt and unambiguous; this is what proved
web was the sole driver.

**Count RPCs by method:**

```sh
PID=$(docker inspect -f '{{.State.Pid}}' daemon_gateway)
sudo nsenter -t $PID -n timeout 20 tcpdump -i any -s 200 -A \
  'tcp port 56000 and tcp[((tcp[12:1] & 0xf0) >> 2):4] = 0x504f5354' 2>/dev/null \
  | grep -aoE 'POST /com.seed[a-zA-Z0-9._/]+' | sort | uniq -c | sort -rn
```

Then divide profile CPU-seconds by call count to get **cost per call**. This single step is what reframed the whole
investigation from "volume" to "cost".

**Read real traffic without touching traefik** — the traefik→web hop is plaintext:

```sh
PID=$(docker inspect -f '{{.State.Pid}}' web_gateway)
sudo nsenter -t $PID -n timeout 20 tcpdump -i any -s 1600 -A 'tcp dst port 3500' > /tmp/http.txt
grep -aoE 'X-Forwarded-For: [0-9a-f.:]+' /tmp/http.txt | sort | uniq -c | sort -rn
```

Do **not** anchor greps to line start against `tcpdump -A` output — it silently under-counts.

**Per-page SSR attribution** — run a second web container with `SEED_INSTRUMENTATION=dev`, on the internal network,
`traefik.enable=false`, against a _copy_ of the web data dir. It prints a full span tree per request and never touches
serving traffic.

**Benchmark a query against production data safely:**

```sh
sudo sqlite3 -readonly "file:/shm/gateway/daemon/db/db.sqlite?mode=ro" ".backup /tmp/verify.db"
```

Dump the exact SQL from the compiled Go via a scratch test rather than transcribing it, substitute real parameters,
compare **full result sets** (md5, not row counts), and **alternate run order** so page-cache warming cannot flatter the
result.

---

## 12. Why this has been hard

Structural reasons, not effort ones. Worth internalizing:

**Under saturation, a correct fix is indistinguishable from a wrong one.** At 700% of 800%, removing 30% of the load
changes nothing observable. #938 was correct and looked like nothing. The CTE fix took `ListDirectory` from 92.5% to
7.3% and the site went down again 20 minutes later. Several real fixes in a row can each look like failures, which is
exhausting and misleading.

**The bug lives in the product of the layers, not in any file.** Prefetching in SSR is good practice; `listAllPages` is
how you get an accurate count; `ListCitations` has a `LIMIT` so it looks bounded. The pathology only exists when you
multiply them, and nothing writes that multiplication down.

**Restarts manufacture false positives.** A restart buys ~6 minutes, so whatever changed last gets the credit. This
incident produced three premature "recovered" calls from exactly that window.

**There were no instruments.** Access logs off, no router metrics, no pool-wait metric, and a slow-query threshold high
enough that it only ever caught a 33-minute reindex. With no data, the available story — "traffic storm" — was supported
by real-looking artifacts (294,687 `499`s, 14,800 connections, 60,000 goroutines, July's 66-IP crawler fleet). Hours
went into blocking a workload that was never abusive.

**The codebase actively misdirected**, via the comment saying the fix "did not help".

**The move that worked:** stop the caller to attribute load, count calls in a fixed window, divide CPU by calls. Until
"2.7 CPU-seconds per call" exists as a number, the volume and cost hypotheses look identical.
