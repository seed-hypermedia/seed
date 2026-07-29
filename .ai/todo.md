# unified-document-lifecycle-machine — DONE

## Completed

- [x] Document state machine (`document-machine.ts`)
- [x] React bindings (`use-document-machine.ts`)
- [x] Wired `DocumentMachineProvider` into `resource-page-common.tsx`
- [x] Desktop passes `canEdit` prop
- [x] Web defaults to `canEdit: false`
- [x] Re-exports from `@shm/shared/index.ts`
- [x] `pnpm typecheck` passes

---

# Follow-ups from the `simplify-editor-dom` / natural-typography PR

Parked work that deliberately stayed out of that PR so it landed small. Pick them up in order; each is its own branch.

## 1. Remove the desktop draft page (own PR)

**Why:** `apps/desktop/src/pages/draft.tsx` duplicates document-editor wiring that now lives in `pages/desktop-resource.tsx`. The two paths drifted (e.g. the draft page's `HyperMediaEditorView` missed the `.hm-prose` class until we patched it), and the draft route is already functionally a "document with a pending draft." Deleting it unifies the lifecycle and eliminates the class of bug where a fix has to be applied in two places.

**Scope (rough order):**

- [ ] Decide how draft-specific route fields (`editUid`, `editPath`, `locationUid`, `locationPath`, `selection`) carry into `DocumentRoute`: extend `DocumentRoute` or add an optional `draft` sub-shape.
- [ ] Update `@shm/shared/routes` to reflect the chosen shape; mark `DraftRoute` deprecated (or remove after all callers are migrated).
- [ ] Rewrite `apps/desktop/src/utils/publish-utils.ts::computeDraftRoute` to return a `DocumentRoute` with draft fields populated.
- [ ] Update `apps/desktop/src/utils/__tests__/publish-utils.test.ts` accordingly.
- [ ] Walk every `route.key === 'draft'` callsite and rewrite against the new fields:
  - `apps/desktop/src/components/titlebar-common.tsx` (≈20 refs — publish button, edit state, breadcrumbs).
  - `apps/desktop/src/components/publish-draft-button.tsx`.
  - `apps/desktop/src/components/assistant-panel.tsx`.
  - `apps/desktop/src/hooks/route-breadcrumbs.ts`.
  - `apps/desktop/src/app-api.ts`.
  - `apps/desktop/src/models/documents.ts`.
  - `apps/desktop/src/pages/__tests__/accessory-shortcuts.test.ts`.
  - `apps/desktop/src/components/__tests__/omnibar.test.ts`.
- [ ] Extend `pages/desktop-resource.tsx`'s `supportedKeys` if the draft route is absorbed; otherwise remove the `case 'draft'` branch in `pages/main.tsx`.
- [ ] Delete `apps/desktop/src/pages/draft.tsx` (≈1200 LoC).
- [ ] `pnpm typecheck` + `pnpm test` + smoke-test the import / paste / new-draft flows.

**Estimate:** ~2–3 focused hours + manual smoke test.

## 2. Try to really fix the xmldom high-severity CVEs (own PR)

**Why:** The latest commit on `simplify-editor-dom` (`713dab681`) adds 4 new xmldom CVEs to `pnpm-workspace.yaml`'s `auditConfig.ignoreCves` list. That unblocks CI but the `xmldom < 0.8.13` chain still sits in `node_modules`. The ignore list is already 7 entries long; each added ignore erodes the signal.

The advisories don't reach runtime code — `xmldom` is pulled in via `@electron-forge/cli → @electron/packager → plist` (a packaging-time devDep parsing our own Info.plist / entitlements), so exploitation requires attacker-controlled XML we never hand it. Still, we should stop adding ignores.

**Try, in order:**

1. [ ] **pnpm override to 0.8.13.** The old pnpm-workspace comment warns "0.9.x breaks plist" — but 0.8.13 is a patch on the same minor. Likely safe.
   ```yaml
   # pnpm-workspace.yaml
   overrides:
     '@xmldom/xmldom': '^0.8.13'
   ```
   Run `pnpm install`, then `pnpm --filter desktop make` and package for **macOS .dmg**, **Windows .exe**, **Linux .AppImage**. Launch each. If all pass:
   - [ ] Remove every xmldom CVE from `auditConfig.ignoreCves` (CVE-2026-34601, 41672, 41673, 41674, 41675).
   - [ ] Delete the xmldom ignore comment in `pnpm-workspace.yaml`.
2. [ ] **If 0.8.13 also breaks plist:** upgrade `@electron-forge/cli` + `@electron/packager` to the newest versions (packager ≥ 18.4 moved plist to xmldom 0.9.x). Electron-forge major bumps are usually accompanied by breaking config changes — budget ~half a day of CI + packaging regression testing.
3. [ ] **If both 1 and 2 fail:** file an upstream issue on `@electron/packager` (or `plist`) to unpin xmldom, and add a TODO in pnpm-workspace.yaml linking that issue so we can re-evaluate when it's resolved.

**Also consider, while we're there:**

- [ ] Revisit the `electron < 39.8.5` CVE cluster already in the ignore list (CVE-2026-34769/70/71/74). We're on Electron 35; 39 is a major jump. Schedule an Electron upgrade spike — even a dry run behind a feature flag — and file whatever regressions surface. Electron 36/37/38/39 each had real security fixes beyond these four.
- [ ] Revisit `ip < 2.0.2` (SSRF, no patch) — reaches us via `lighthouse > puppeteer-core` and `react-devtools`. Both are devDeps only. Track whether upstream publishes a fix, or swap `react-devtools` for the browser-extension equivalent so we stop shipping it as a dep.

**Estimate:** 30 min if option 1 works; half a day if option 2 is needed; no-go otherwise.

## 3. Web Edit Profile — switch to Account Profile blob (own PR)

**Why:** Issue #494 fixed the desktop `EditProfileDialog` to call `grpcClient.documents.updateProfile` (writes the Account Profile blob) instead of `desktopUniversalClient.publishDocument` (which appended a `setMetadata` change to the home document). The web app's `updateProfile` helper in `frontend/apps/web/app/auth.tsx:240-271` still does the wrong thing — it builds `setMetadata` ops and calls `seedClient.publishDocument(..., signer)`, mutating the home doc.

We deferred the web fix because the `UpdateProfile` RPC expects a daemon-resolved `signing_key_name`, but the web app holds a browser-held `CryptoKeyPair` and has no path to produce a server-signed Profile blob.

**Scope (rough order):**

- [ ] Add a `prepareProfileChange` (or similarly named) helper to `@shm/client` / `@shm/shared` that takes a `CryptoKeyPair` + `{ name, icon, description, account, timestamp }` and produces a signed Profile blob `{ data, cid }`. Mirror `backend/api/documents/v3alpha/blob_profile.go::NewProfile` so the browser-produced blob validates identically on the daemon side.
- [ ] Publish via `seedClient.publish({ blobs: [{ data, cid }] })` — the existing icon-upload path already uses this primitive.
- [ ] Rewrite `frontend/apps/web/app/auth.tsx::updateProfile` (≈lines 240-271) to build the Profile blob from form state and publish it. Preserve existing `description` by reading from the current `Account.profile.description` (not from `HMDocument.metadata`).
- [ ] Update the `EditProfileDialog` caller at `auth.tsx:674` — the signature changes (it no longer needs `document`).
- [ ] Walk other callers of `updateProfile` in `auth.tsx` (check `auth.tsx:659-708` and the account-creation flow around `createAccount`/`createIdentity` to confirm whether they should also write a Profile blob immediately instead of only a home-doc change).
- [ ] Add a Vitest for the new `prepareProfileChange` helper (round-trip the blob through the daemon's verifier if possible).
- [ ] Add an integration test (`tests/`) that signs in on web, edits profile, and asserts `Account.profile.name/icon` updates while the home document history does NOT gain a new change.
- [ ] `pnpm --filter @shm/web typecheck`, `pnpm --filter @shm/web test`, manual smoke test in browser.

**Reference files:**

- Desktop fix (done): `frontend/apps/desktop/src/components/edit-profile-dialog.tsx`.
- Desktop test pattern: `frontend/apps/desktop/src/__tests__/edit-profile-dialog.test.tsx`.
- Server-side Profile blob: `backend/api/documents/v3alpha/blob_profile.go::NewProfile`, `backend/api/documents/v3alpha/documents.go:927-967`.
- Proto: `proto/documents/v3alpha/documents.proto::UpdateProfile` / `Profile`.
- Read path (already coalesces profile → home-doc fallback): `frontend/packages/shared/src/account-metadata.ts:41-49`, `frontend/packages/shared/src/api-account.ts:22-47`.

**Estimate:** ~half a day (most of it is getting the client-side Profile blob signing + CID generation to match the daemon exactly).

---

# sync-performance-metrics — DONE (committed 192bba1ee, build + tests green)

Goal: measure (1) sync write throughput in bytes/sec and (2) delay between a blob's
author-claimed timestamp and our receipt of it. Hard constraint: add no SQLite work
that could contend with real queries.

## Decisions (Julio)
1. UI on `/debug/network` (not `/debug/sqlite` — that page is writer contention).
2. No windowed ring; lifetime aggregates only, Prometheus `rate()` covers windows.
3. No proto change; `Progress.BytesDownloaded` surfaced via a session-summary log.
4. Note for seedteamtalks.hyper.media published AFTER a real cold-start run.

## The design decision that matters
Bytes ÷ one session's elapsed time lies twice: sync arrives in bursts, and sessions
run concurrently. So: one numerator, three denominators.

| metric | formula | answers |
|---|---|---|
| wall throughput | bytes ÷ uptime | what the user perceives |
| active throughput | bytes ÷ busy time (UNION of active intervals) | pipe capacity |
| per-session throughput | bytes ÷ Σ session durations | one stream's speed |
| duty cycle | busy ÷ uptime | bridges them: wall = active × dutyCycle |
| avg concurrency | Σ sessions ÷ busy | parallelism actually achieved |

Union-not-sum is the concurrency fix. Time is exported as `_seconds_total` counters
so Prometheus derives every window for free.

## Completed
- [x] `backend/util/syncperf/` — Tracker (union busy-time, O(1) in-flight fold via
      `openStartSum`), Snapshot + 5 derivations, Prometheus collector, delay
      histogram labelled by blob type, 4 skip-reason counters.
- [x] `backend/blob/index_origin.go` — `ContextWithNetworkOrigin` via `ctxkey`, so
      local publishes never count as synced bytes.
- [x] `backend/blob/index.go` — `indexOpts` replaces two positional bools on
      `indexBlob`; `observedAt` + `childOpts()` on `indexingCtx`; `RecordDelay` at
      the single `sb.Ts` funnel; `reindexStashedBlobs` takes `indexOpts`.
- [x] `backend/blob/index_blockstore.go` — byte accounting from `putBlock`'s
      existing `exists` return; one clock read per batch tx; record only post-commit.
- [x] `backend/hmnet/syncing/` — `SessionStart()` in `DiscoverObjectWithProgress`
      (the single funnel for all sessions), `Progress.BytesDownloaded`,
      network-origin ctx on the persist feeder + AnnounceBlobs, session-summary log.
- [x] `backend/storage/checkpoint.go` — `seed_sqlite_wal_written_bytes_total` from
      WAL frames the checkpointer already read and discarded; PASSIVE path only.
- [x] `backend/hmnet/http_debug_syncperf.go` — two sections + help text.
- [x] `backend/daemon/daemon.go` — `SetSessionStart` at `Load`.
- [x] Tests: burst/gap divergence, union-vs-sum concurrency, sequential control,
      mid-burst snapshot, idempotent end, delay gating table.

## Verified before handing off (all green)
- `go build ./backend/...` clean; `go vet` clean on blob/hmnet/storage/syncperf.
- `go test ./backend/util/syncperf/...` ok
- `go test ./backend/storage/... ./backend/hmnet/...` ok (7 packages)
- `go test ./backend/blob/...` ok

## Perf budget
Exactly ONE new SQL statement daemon-wide: `PRAGMA page_size`, once, at checkpointer
construction, on its dedicated non-pool connection. Everything else is in-memory
atomics fed from values already in hand. Nothing polls; nothing runs inside a write tx.

## Verified on live daemon
Per-site breakdown across all 20 eligible rows; each site's four stage figures
sum to ~100% of uptime, and `wall = active x dutyCycle` / `active = per-session
x concurrency` hold per site as well as globally. Media ~99.98% attributed,
unattributed down to ~1% of bytes.

The payoff case, from a real run: a space showing 41.5 KiB/s transfer
throughput but 93 B/s wall, at 2.7% duty cycle -- a scheduling problem, not a
slow peer. That distinction was not previously observable.

## Remaining
- [ ] Write + publish the note to seedteamtalks.hyper.media/notes/ (help text in
      `http_debug_syncperf.go` is the first draft; real numbers now available).
- [ ] Unexplained, NOT from this work: `RBSRIndexServeFallback` warns ~5/sec
      from `rbsr_index.go:229`. A scope is materialized, then the verification
      read reports it unmaterialized. The documented cause (reindex in flight)
      is excluded by the guard above it. Harmless -- falls back to the
      authoritative legacy path -- but unexplained.
- [ ] `blobs.insert_time` is not reset by `blobsUpdateMissingData` when a
      placeholder is filled, so the activity feed's FEED_ORDER_OBSERVED_TIME
      sorts those blobs by discovery rather than arrival. One line to fix, but
      it changes feed semantics.

## Known caveat (documented on the page, not hidden)
Blobs that arrive before their dependencies get stashed and rolled back, so their
true arrival time is lost; only the later unstash moment survives. Recording that
would overstate the delay, so those are excluded and counted under
`skipped{deferred_unstash}`. A persistently large count there means the histogram
is missing a real slice of traffic.

---

# Daemon CPU: op decoding + document read cache (from `longCPU.pb.gz`, 2026-07-28)

Production profile: 466.16s samples / 300s wall = **155% CPU sustained**.
Server runs tag `2026.7.4` (verified: no tag contains `dab3f4668`).

## Done

- [x] **Step 1 — remove the CBOR round-trip in `OpMap.ToOp`** (was 61.94s, 13.3% of all CPU)
  - `backend/blob/blob_change_ops.go` (new): direct map→struct per variant.
  - `Block`/`Annotation` still go through `mapstruct` — the same function their atlas transform calls — so no schema behaviour changed.
  - `mapToCBOR` deleted from `blob.go`; survives in tests as `mapToCBORReference` (the equivalence oracle).
  - Behaviour changes, both deliberate: unknown op field is now a returned error instead of a **daemon panic**; `opUint64` accepts int64/uint/uint64 (as the old path did).
- [x] **Step 2 — resolve version before replaying** (was 102.21s, 22%, paid even on cache hits)
  - `(*Index).ResolveLatest` + `resolveLatestGeneration` in `backend/blob/index.go`; `iterChangesLatest` refactored onto it so redirect/tombstone errors have exactly one implementation.
  - `hydrateCache.peek` + shared `hydrateCacheKey`.
  - `GetDocument` probes the cache before `loadDocument`. Only for the current version — an explicit version may belong to an older generation, and visibility is per-generation.

## Deferred

- [ ] **Step 3 — `qListCitations`** (66s, 14.2%, all inside one `sqlite3_step`). Unshipped commit `dab3f4668` already targets this; ship it and re-profile before touching the SQL.
- [ ] `GetSpacesByAccount` (20s) and `buildStoreFromScopes` (17s) — re-profile after 1 & 2 land.
- [ ] Optional follow-up: hand-decode `Block` to remove the remaining ~25s of mapstructure.

## Not verified locally (per lessons.md — Go builds freeze this machine)

`go build`, `go test`, `gofmt -l`, and the benchmark were all **not run**. Needs Julio.

---

# Sync phases 1+2 — measured result (2026-07-29, clean profile, 12 min uptime)

Three metric samples at t=216s / 414s / 719s on the live daemon (port 58001).
This is the first trustworthy run: the previous one sampled the gateways away.

## Verdict: shipped as intended, and the bottleneck moved

| | baseline (41 min) | now | |
|---|---|---|---|
| wall throughput | 283 KB/s | **962 KB/s** | 3.4× |
| catch-up window (t=216→414s) | — | **1.79 MB/s** | 6.3× |
| pipe rate (weighted transfer) | — | 24.7 MB/s | — |
| dial failure rate | 57% | **11–13%** | backoff works |
| dials per fetch (first 216s) | 133:1 | **19.5:1** | 6.8× |
| peers per wave | uncapped (hundreds) | **exactly 20** | ceiling holds |
| peers benched | n/a | 136–287 | — |

- Structural blobs **converged at t≈216s** — every `written_bytes_by_kind`
  except media is byte-identical across all three samples.
- `seed_syncing_wanted_blobs` reached **0** by t=719s. Full convergence, 12 min.
- Cold-start `not_found` appeared only in the first 18s, then never again.
  Both gabo.es and hyper.media render. The regression is fixed.
- Media is still 98.7% of bytes (683 MB of 692 MB) — deferral reorders it, it
  doesn't reduce it, which is correct.

## The remaining problem: dialing never stops

Dial is now **80.6% of all peer-seconds**, up from 70.7% — not because it got
worse, but because everything else got cheaper.

In the last window (t=414→719s), with an **empty wantlist**:

- 9,251 dials in 305s = **30.3 dials/sec**, back at the pre-fix rate
- 440 discovery waves = 1.44 waves/sec × 20 peers
- weighted transfer: 0.95% of wall clock; connecting: 73.7%
- scheduler still pinned 6/6, queue 11, `dispatch_end{saturated}` 630 vs
  `queue_drained` 7

The ceiling bounded fan-out **per wave**; nothing bounds the **wave rate**. Once
caught up we spend 30 dials/sec discovering that there is nothing to discover.

### Root cause found (2026-07-29, second pass)

Julio's read of the page was right and mine was too kind: 6/6 busy, connecting
dominant, exchange > transfer were all unchanged. The arithmetic:

    77 subscriptions × 20 peers ÷ 60s Interval = 25.7 dials/sec

which is exactly what was measured. Capping the **width** of the fan-out did
nothing to the **rate**, because the fan-out runs on a timer per subscription
regardless of whether anything changed.

Underneath that, a real bug: `computeAuthInfo` resolves each space's site server
into `auth.addrInfos`, but `discovery.go` only added `auth.peerKeys` to the sync
set — the servers we hold a **key** for. For every space we merely follow we
resolved the host and then dropped it, so we never asked the one peer that
certainly has the content and left 20 random peers to search for it. A key is
needed for *private* content; public content needs none.

- [x] Sync with **all** resolved site servers (`auth.addrInfos`), authenticating
      only where `peerKeys` has an entry — which `syncWithPeer` already did.
- [x] Register their addresses in the peerstore; often a peer we've never dialed.
- [x] `len(allPeers) != 0` gate now also accepts a known site server, so a scope
      with a resolved host doesn't fall through to the DHT.
- [x] Speculative sample is now conditional: **20 when we don't know the host,
      2 when we do**. Searching is only worth paying for when there's nowhere
      authoritative to ask. Gateways and site servers are never subject to it.
- [x] `seed_discover_peers_source_total{source=site}`.

Expected: ~26 dials/sec → ~6, and the remaining dials go to already-connected
protected peers instead of random strangers.
### The cost model, and the three levers

    dials/sec = spaces × peers-per-wave ÷ cadence-per-space
              =   20   ×       20       ÷      11s          = 36/sec

Measured 38,999 dials in 21m36s. Each factor is a separate lever.

| lever | from | to | factor |
|---|---|---|---|
| A. peers per wave | 20 | ~4 (site + gateways + 2) | 5× |
| B. cadence per space | 11s | 60s (`cfg.Interval`) | 5.5× |
| C. reconcile per peer | 1 RBSR round | — | not attempted |

A × B ≈ **27×**: ~36 dials/sec → ~1.3/sec. Both are implemented.

**Lever B is width, NOT cadence.** First attempt slowed settled subscriptions to
`cfg.Interval`. Wrong, and Julio caught it: 60s to see a comment or an edit on an
open document is a product regression, not an optimisation. **The ~10s check is
the promise. It stays.** Reverted.

What is negotiable is how many peers each check asks. A random sample is a
*search*, and a search should cost in proportion to how lost we are:

| state | sample | why |
|---|---|---|
| no host known | 20 | no idea who has this |
| host known, content missing | 2 | ask the server, hedge a stale siteUrl |
| **host known, content held** | **0** | pure liveness — the host is authoritative |

The third row is the steady state and held all the waste. It costs one RBSR
round trip to the site server on an already-open stream: no dial, no search.

- [x] `haveLocally` in `discoverObject`: one local `GetResource` decides whether
      this wave is a search or a liveness check.
- [x] Three-tier `maxSample` from `haveLocally` × `len(auth.addrInfos)`.
- [x] Gateways are dropped from the always-set in liveness mode only. They are
      overhead when we already hold the content and know its host; they stay for
      the cold start they were added to fix.
- [x] `samplePeers(always, pool, 0, …)` returns `always` — a zero sample must
      never drop the authoritative peers, or a settled doc stops updating.
- [x] `taskHandle.isSettled()` kept, but **observability only**, labelling
      `seed_sync_scheduler_reschedule_total{cadence=hot_settled|hot_owed|interval}`.
      It does not gate cadence.
- [x] `TestScheduler_SettledStaysOnHotCadence` guards against re-introducing the
      slowdown; `TestScheduler_HotTouchPullsSubscriptionForward` restored intact.

Steady state: ~20 spaces × 1 peer ÷ ~11s ≈ **1.8 dials/sec**, down from 36, with
the 10s freshness guarantee untouched.

### Measured 2026-07-29 t=374s: the site path was dead — `source="site"` = 0

Converged (`wanted_blobs` 0) and still 0 site peers across 465 waves, sample
pinned at 19.996/wave, 29.2 dials/sec — i.e. identical to before. Lever A's
narrowing half had never fired.

Cause: `computeAuthInfo` populated `addrInfos` only *after* four key-dependent
early returns (`keyStore == nil`, `ListKeyPairs` empty, no local accounts,
`GetSpacesByAccount` error). That was harmless while the struct was purely about
authentication; the moment `addrInfos` started driving peer SELECTION it meant a
node with no local keys resolves no hosts and searches 20 peers forever.

- [x] Split the function: resolve every space's host first, with no key
      involvement; then, separately, work out which hosts we can authenticate
      with. `hosts` map carries space→peer between the halves.
- [x] `TestComputeAuthInfoResolvesHostsWithoutKeys` covers nil keystore and
      empty keystore.

The new reschedule metric also quantified the treadmill directly:
`hot_settled` 342 vs `hot_owed` 110 — **76% of hot re-runs had nothing owed**.
Those are exactly the waves that should now cost one round trip instead of 20
dials.

### Measured after the fix: site path live, 3.2× on a fully idle daemon

Converged at t=364s; the t=364→716s window moved **zero bytes**, so it is a pure
treadmill measurement.

| idle window | before | after |
|---|---|---|
| dials/sec | 32.2 | **10.1** |
| reconciles/sec | 26.0 | **6.7** |
| peers per wave | 20.0 | **6.3** |
| waves/sec | 1.44 | 1.42 (cadence intact) |
| `hot_owed` in window | — | **0** (495 settled, 0 owed) |

Also, for the first time, **transfer ≥ exchange** in the weighted stage split
(16.4% vs 15.6% to convergence). That was Julio's original "INSANE" complaint.
Logs clean: no `not_found` at all, 4× `ShadowVerifyDrift`, no RBSR fallback.

**The remaining 10 dials/sec was one hole in the tier table.** Source split per
wave: site 0.68, gateway 0.95, connected 2.98, stored 2.39. The ~68% of waves
that resolve a host cost ~1 peer. The other ~32% — accounts with no siteUrl,
the long tail — still ran the full 20-peer search every ~11s forever, finding
nothing, and accounted for essentially all of it.

- [x] Tier on **content held**, not on host known. Holding the content is what
      removes the need to search; a hostless space still has an authority (the
      gateways, already connected).
- [x] `livenessOnly` now requires `maxSample == 0 && len(auth.addrInfos) > 0`.
      Dropping gateways whenever the sample is zero would leave a hostless space
      with an EMPTY peer set — silently never syncing again.

Predicted: 0.68×1 + 0.32×3 ≈ 1.6 peers/wave → **~2.3 dials/sec**, ~14× off the
original 32.2.

- [ ] **Bench on uselessness, not just failure.** `Succeed()` clears backoff for
      any completed dial even when the peer served nothing. `ok` outcomes are
      11,170 against 353 fetches. A peer that connects fine and never has
      anything should rotate out like one that fails to connect.
- [ ] `maxSampledPeers` could likely drop 20 → 8; structural converges in 3.6
      min regardless.
- [ ] Phase 3 (type priority) still looks unnecessary: structural is 1.3% of
      bytes and converges first already.

## Fixed this session (uncommitted, needs a build)

- [x] Gateway check now runs **before** the protocol check in `discovery.go`,
      and uses a weaker test: a protected peer is kept unless the peerstore
      positively says it is incompatible. `livePeerSupportsProtocol` reads the
      peerstore, which is empty until Identify lands — so a gateway was dropped
      from both peer lists during exactly the cold-start window where it is the
      only peer that can serve us.
- [x] The weaker test is still a test: `ipfs/bootstrap_peers.go` mixes the Seed
      gateways with 7 public IPFS DHT bootstrappers, which speak no Hypermedia
      protocol. Force-dialing those every wave would be pure waste.
- [x] Added `seed_discover_peers_source_total{source=gateway|connected|stored}`.
      `seed_discover_peers_sampled` cannot answer whether the always-include
      path fires — it saturates at the ceiling either way, so "20 sampled, no
      gateways" and "3 gateways + 17 sampled" both read as exactly 20. Across
      935 waves the sum was 18,700 = 935 × 20 exactly, which is consistent with
      both. The new counter settles it on the next run.
