package sqlitex

import (
	"html/template"
	"net/http"
	"sort"
	"strconv"
	"time"
)

// DebugHandler returns an HTML handler that renders per-caller statistics for
// write transactions opened through WithTx. Modeled on the /debug/network
// page in backend/hmnet/http_debug_network.go.
func DebugHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		page := buildSQLitePage()
		if err := sqliteTpl.Execute(w, page); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})
}

type sqlitePage struct {
	GeneratedAt     string
	Active          []activeRow
	WriteAggregate  []aggregateRow
	BusyAttribution []aggregateBusyRow
	WriteCallers    []callerRow
	ReadCallers     []readCallerRow
	RecentWrite     []recentRow
	RecentBusy      []recentRow
	RecentRead      []recentRow
	RecentWriteCap  int
	RecentBusyCap   int
	RecentReadCap   int
	BusyEventsCount int
}

// aggregateRow renders one entry on the "Aggregate writer-slot utilization"
// section. The Σ-hold view surfaces callers whose individual transactions
// never trip the slow ring's 100ms threshold but collectively saturate the
// writer slot. Read alongside p99 hold: high Σ + low p99 = death-by-a-
// thousand-short-writes; high Σ + high p99 = a single bad tx is also
// happening.
type aggregateRow struct {
	Caller         string
	Count          uint64
	TotalHoldMs    float64
	TotalHoldClass string
	SharePct       float64
	ShareClass     string
}

// aggregateBusyRow is the per-caller projection of the "Begin-busy
// attribution" section. Built by walking every begin_busy event in
// recentBusy and bucketing the holders that finished during its wait
// (DrainedDuringWait) plus the holder active at timeout (HeldBy). A
// caller at the top of this table — high Events count, high
// HeldDuringWaitMs — is the one whose work is starving everyone else.
type aggregateBusyRow struct {
	Caller              string
	Events              uint64  // distinct begin_busy events this caller appeared in
	HeldDuringWaitMs    float64 // Σ ms this caller held the writer slot inside begin_busy wait windows
	HeldDuringWaitClass string
	AvgPerEventMs       float64 // HeldDuringWaitMs / Events
}

type activeRow struct {
	Caller    string
	StartedAt string
	AgeMs     float64
	AgeClass  string
}

type callerRow struct {
	Caller           string
	Count            uint64
	Commits          uint64
	Rollbacks        uint64
	BusyCount        uint64
	BusyClass        string
	TotalHoldMs      float64
	TotalHoldClass   string
	SharePct         float64
	ShareClass       string
	TotalP10Ms       float64
	TotalP50Ms       float64
	TotalP90Ms       float64
	TotalP99Ms       float64
	TotalP99Class    string
	PoolWaitP10Ms    float64
	PoolWaitP50Ms    float64
	PoolWaitP90Ms    float64
	PoolWaitP99Ms    float64
	PoolWaitP99Class string
	HoldP10Ms        float64
	HoldP50Ms        float64
	HoldP90Ms        float64
	HoldP99Ms        float64
	HoldP99Class     string
	WaitP10Ms        float64
	WaitP50Ms        float64
	WaitP90Ms        float64
	WaitP99Ms        float64
	WaitP99Class     string
}

// readCallerRow is the page-render form of a read-only Save caller. Reads
// never own the writer slot, so there's no wait/busy/rollback dimension —
// just count + hold percentiles for SHARED-lock hold time.
type readCallerRow struct {
	Caller       string
	Count        uint64
	HoldP10Ms    float64
	HoldP50Ms    float64
	HoldP90Ms    float64
	HoldP99Ms    float64
	HoldP99Class string
}

type recentRow struct {
	When      string
	Caller    string
	HoldMs    float64
	HoldClass string
	WaitMs    float64
	WaitClass string
	// WaitNA renders the begin_wait cell as "—" instead of a number for
	// outcomes where begin_wait is not a writer-mutex wait — currently
	// just savepoint_top, whose begin_wait is the SAVEPOINT statement
	// duration (microseconds) and not the actual lock acquisition (which
	// happens lazily inside the first DML and lands in hold).
	WaitNA        bool
	PoolWaitMs    float64
	PoolWaitClass string
	Outcome       string
	OutClass      string
	Stmts         []recentStmt
	// HeldBy is populated for begin_busy rows: each entry is the caller +
	// how long it had been holding the writer slot at the moment this row's
	// BEGIN IMMEDIATE timed out.
	HeldBy []heldByEntry
	// DrainedDuringWait is populated for begin_busy rows with the lineup
	// of writer-slot holders that finished while this caller was waiting.
	// Complements HeldBy: HeldBy is whoever happens to be on the slot at
	// timeout (often the next caller in the queue, not the offender);
	// DrainedDuringWait is the actual sequence of holders that consumed
	// the 10 s wait.
	DrainedDuringWait []drainedEntry
}

// recentStmt is the page-render form of capturedStmt: pre-computed duration
// in ms and the colour class, so the template doesn't need to do unit math.
type recentStmt struct {
	SQL      string
	Args     string
	DurMs    float64
	DurClass string
}

type heldByEntry struct {
	Caller    string
	HeldForMs float64
	Class     string
}

// drainedEntry is one writer-slot holder that finished while a begin_busy
// victim was waiting. Rendered in chronological (commit) order, oldest
// first, so the operator reads the contention chain top-to-bottom.
type drainedEntry struct {
	When      string
	Caller    string
	HoldMs    float64
	HoldClass string
	Outcome   string
	OutClass  string
}

func buildSQLitePage() sqlitePage {
	snap := tracker.snapshot()
	now := time.Now()

	page := sqlitePage{
		GeneratedAt: now.Format(time.RFC3339),
	}

	for _, a := range snap.Active {
		age := now.Sub(a.StartedAt)
		ms := float64(age) / float64(time.Millisecond)
		page.Active = append(page.Active, activeRow{
			Caller:    a.Caller,
			StartedAt: a.StartedAt.Format(time.RFC3339),
			AgeMs:     ms,
			AgeClass:  classForHoldMs(ms),
		})
	}
	sort.Slice(page.Active, func(i, j int) bool {
		return page.Active[i].AgeMs > page.Active[j].AgeMs
	})

	for name, s := range snap.WriteCallers {
		row := callerRow{
			Caller:           name,
			Count:            s.Count,
			Commits:          s.Commits,
			Rollbacks:        s.Rollbacks,
			BusyCount:        s.BusyCount,
			BusyClass:        classForBusy(s.BusyCount),
			TotalHoldMs:      s.TotalHoldMs,
			TotalHoldClass:   classForHoldMs(s.TotalHoldMs),
			SharePct:         s.SharePct,
			ShareClass:       classForSharePct(s.SharePct),
			TotalP10Ms:       s.TotalP10Ms,
			TotalP50Ms:       s.TotalP50Ms,
			TotalP90Ms:       s.TotalP90Ms,
			TotalP99Ms:       s.TotalP99Ms,
			TotalP99Class:    classForHoldMs(s.TotalP99Ms),
			PoolWaitP10Ms:    s.PoolWaitP10Ms,
			PoolWaitP50Ms:    s.PoolWaitP50Ms,
			PoolWaitP90Ms:    s.PoolWaitP90Ms,
			PoolWaitP99Ms:    s.PoolWaitP99Ms,
			PoolWaitP99Class: classForHoldMs(s.PoolWaitP99Ms),
			HoldP10Ms:        s.HoldP10Ms,
			HoldP50Ms:        s.HoldP50Ms,
			HoldP90Ms:        s.HoldP90Ms,
			HoldP99Ms:        s.HoldP99Ms,
			HoldP99Class:     classForHoldMs(s.HoldP99Ms),
			WaitP10Ms:        s.WaitP10Ms,
			WaitP50Ms:        s.WaitP50Ms,
			WaitP90Ms:        s.WaitP90Ms,
			WaitP99Ms:        s.WaitP99Ms,
			WaitP99Class:     classForHoldMs(s.WaitP99Ms),
		}
		page.WriteCallers = append(page.WriteCallers, row)

		// Aggregate-utilization table is a focused view of the same data:
		// drop callers with no writer-slot hold (begin_busy-only victims,
		// rollbacks of empty bodies) so the table stays a clean list of
		// real lock holders sortable by Σ hold.
		if s.TotalHoldMs > 0 {
			page.WriteAggregate = append(page.WriteAggregate, aggregateRow{
				Caller:         name,
				Count:          s.Count,
				TotalHoldMs:    s.TotalHoldMs,
				TotalHoldClass: classForHoldMs(s.TotalHoldMs),
				SharePct:       s.SharePct,
				ShareClass:     classForSharePct(s.SharePct),
			})
		}
	}
	// Sort by total p99 desc so the slowest caller-visible latency is on
	// top. Operators triage starting from "who's slow" rather than "who
	// holds the lock long" — the total view captures pool wait + writer-
	// mutex wait + actual hold, so a caller bottlenecked on the pool
	// surfaces here even if its hold p99 is small.
	sort.Slice(page.WriteCallers, func(i, j int) bool {
		return page.WriteCallers[i].TotalP99Ms > page.WriteCallers[j].TotalP99Ms
	})
	// Aggregate view sorted by Σ hold desc — the actual offender ordering
	// when the contention shape is volume rather than long individual holds.
	sort.Slice(page.WriteAggregate, func(i, j int) bool {
		return page.WriteAggregate[i].TotalHoldMs > page.WriteAggregate[j].TotalHoldMs
	})

	for name, s := range snap.ReadCallers {
		page.ReadCallers = append(page.ReadCallers, readCallerRow{
			Caller:       name,
			Count:        s.Count,
			HoldP10Ms:    s.HoldP10Ms,
			HoldP50Ms:    s.HoldP50Ms,
			HoldP90Ms:    s.HoldP90Ms,
			HoldP99Ms:    s.HoldP99Ms,
			HoldP99Class: classForHoldMs(s.HoldP99Ms),
		})
	}
	sort.Slice(page.ReadCallers, func(i, j int) bool {
		return page.ReadCallers[i].HoldP99Ms > page.ReadCallers[j].HoldP99Ms
	})

	// Begin-busy attribution: aggregate across all begin_busy events in
	// recentBusy. For each event, walk its DrainedDuringWait list
	// (holders that finished during the wait) and its HeldBy list
	// (holder still on the slot at timeout) — both are direct culprits.
	// A caller's Events count is how many distinct begin_busy events
	// named it; HeldDuringWaitMs is the Σ ms it held the writer slot
	// inside those wait windows.
	type busyBucket struct {
		events           map[*txSample]struct{} // set semantics: don't double-count if a caller appears twice in one event's drained list
		heldDuringWaitNs uint64
	}
	buckets := make(map[string]*busyBucket)
	getBucket := func(caller string) *busyBucket {
		b, ok := buckets[caller]
		if !ok {
			b = &busyBucket{events: make(map[*txSample]struct{})}
			buckets[caller] = b
		}
		return b
	}
	for i := range snap.RecentBusy {
		ev := &snap.RecentBusy[i]
		for _, d := range ev.DrainedDuringWait {
			b := getBucket(d.Caller)
			b.events[ev] = struct{}{}
			b.heldDuringWaitNs += uint64(d.Hold)
		}
		for _, h := range ev.HeldBy {
			// HeldBy carries the time the holder had been holding at the
			// moment of timeout (from StartedAt to ev.When). Treat that as
			// the hold contribution into the wait window — same semantics
			// as DrainedDuringWait entries.
			heldFor := ev.When.Sub(h.StartedAt)
			if heldFor < 0 {
				heldFor = 0
			}
			b := getBucket(h.Caller)
			b.events[ev] = struct{}{}
			b.heldDuringWaitNs += uint64(heldFor)
		}
	}
	for caller, b := range buckets {
		events := uint64(len(b.events))
		held := float64(b.heldDuringWaitNs) / float64(time.Millisecond)
		var avg float64
		if events > 0 {
			avg = held / float64(events)
		}
		page.BusyAttribution = append(page.BusyAttribution, aggregateBusyRow{
			Caller:              caller,
			Events:              events,
			HeldDuringWaitMs:    held,
			HeldDuringWaitClass: classForHoldMs(held),
			AvgPerEventMs:       avg,
		})
	}
	sort.Slice(page.BusyAttribution, func(i, j int) bool {
		return page.BusyAttribution[i].HeldDuringWaitMs > page.BusyAttribution[j].HeldDuringWaitMs
	})
	if len(page.BusyAttribution) > 10 {
		page.BusyAttribution = page.BusyAttribution[:10]
	}
	page.BusyEventsCount = len(snap.RecentBusy)

	page.RecentWrite = renderRecent(snap.RecentWrite)
	page.RecentBusy = renderRecent(snap.RecentBusy)
	page.RecentRead = renderRecent(snap.RecentRead)
	page.RecentWriteCap = recentWriteCap
	page.RecentBusyCap = recentBusyCap
	page.RecentReadCap = recentReadCap

	return page
}

// renderRecent converts a slice of raw tracker samples into the
// HTML-render shape. Output is sorted by hold duration descending so the
// worst outlier renders at the top within a kind-bucket. The caller
// (buildSQLitePage) hands in a copy of the tracker's ring, so this
// function is free to sort in place.
func renderRecent(samples []txSample) []recentRow {
	if len(samples) == 0 {
		return nil
	}
	cp := make([]txSample, len(samples))
	copy(cp, samples)
	sort.Slice(cp, func(i, j int) bool { return cp[i].Hold > cp[j].Hold })
	out := make([]recentRow, 0, len(cp))
	for _, s := range cp {
		ms := float64(s.Hold) / float64(time.Millisecond)
		waitMs := float64(s.BeginWait) / float64(time.Millisecond)
		poolWaitMs := float64(s.PoolWait) / float64(time.Millisecond)
		var held []heldByEntry
		for _, a := range s.HeldBy {
			ageMs := float64(s.When.Sub(a.StartedAt)) / float64(time.Millisecond)
			held = append(held, heldByEntry{
				Caller:    a.Caller,
				HeldForMs: ageMs,
				Class:     classForHoldMs(ageMs),
			})
		}
		stmts := make([]recentStmt, len(s.Stmts))
		for i, cs := range s.Stmts {
			d := float64(cs.Duration) / float64(time.Millisecond)
			stmts[i] = recentStmt{
				SQL:      cs.SQL,
				Args:     cs.Args,
				DurMs:    d,
				DurClass: classForHoldMs(d),
			}
		}
		var drained []drainedEntry
		for _, d := range s.DrainedDuringWait {
			hms := float64(d.Hold) / float64(time.Millisecond)
			drained = append(drained, drainedEntry{
				When:      d.When.Format("15:04:05.000"),
				Caller:    d.Caller,
				HoldMs:    hms,
				HoldClass: classForHoldMs(hms),
				Outcome:   string(d.Outcome),
				OutClass:  classForOutcome(d.Outcome),
			})
		}
		out = append(out, recentRow{
			When:              s.When.Format("15:04:05.000"),
			Caller:            s.Caller,
			HoldMs:            ms,
			HoldClass:         classForHoldMs(ms),
			WaitMs:            waitMs,
			WaitClass:         classForHoldMs(waitMs),
			WaitNA:            s.Outcome == outcomeSavepointTop,
			PoolWaitMs:        poolWaitMs,
			PoolWaitClass:     classForHoldMs(poolWaitMs),
			Outcome:           string(s.Outcome),
			OutClass:          classForOutcome(s.Outcome),
			Stmts:             stmts,
			HeldBy:            held,
			DrainedDuringWait: drained,
		})
	}
	return out
}

func classForHoldMs(ms float64) string {
	switch {
	case ms >= 10000:
		return "warn"
	case ms >= 1000:
		return "warn"
	case ms >= 100:
		return "note"
	default:
		return ""
	}
}

func classForBusy(n uint64) string {
	if n > 0 {
		return "warn"
	}
	return ""
}

// classForSharePct colours the aggregate writer-slot share column. Thresholds
// pick the eye-catch points where a single caller is materially eating the
// slot under WAL (mutex-exclusive): ≥25% is hard to miss as a regression
// signal; ≥10% deserves a look during a contention triage.
func classForSharePct(pct float64) string {
	switch {
	case pct >= 25:
		return "warn"
	case pct >= 10:
		return "note"
	default:
		return ""
	}
}

func classForOutcome(o txOutcome) string {
	switch o {
	case outcomeBeginBusy, outcomeRollback:
		return "warn"
	case outcomeBeginInterrupted:
		// Yellow: interesting (BEGIN failed) but not a contention event —
		// usually ctx cancellation, no lock holder to blame.
		return "note"
	default:
		// outcomeCommit, outcomeSavepoint, outcomeSavepointTop,
		// outcomeSavepointReadOnly — all successful releases (or, for the
		// read-only case, never-acquired-in-the-first-place releases).
		// Neutral colour so the recent table doesn't scream at routine
		// read traffic.
		return ""
	}
}

var sqliteTpl = template.Must(template.New("sqlite").Funcs(template.FuncMap{
	"fmtMs": func(v float64) string {
		switch {
		case v >= 1000:
			return strconv.FormatFloat(v/1000, 'f', 2, 64) + " s"
		case v >= 1:
			return strconv.FormatFloat(v, 'f', 1, 64) + " ms"
		case v > 0:
			return strconv.FormatFloat(v, 'f', 3, 64) + " ms"
		default:
			return "0"
		}
	},
	"fmtPct": func(v float64) string {
		if v <= 0 {
			return "0"
		}
		// One decimal until 10%, none after — keeps the column narrow
		// while staying precise for the low end where most callers live.
		if v < 10 {
			return strconv.FormatFloat(v, 'f', 1, 64) + " %"
		}
		return strconv.FormatFloat(v, 'f', 0, 64) + " %"
	},
}).Parse(sqliteHTML))

const sqliteHTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>seed sqlite writer health</title>
<style>
body{font-family:sans-serif;margin:1em;color:#222;max-width:1100px}
h1{font-size:18px;margin:0 0 6px 0}
h2{font-size:15px;margin:1.4em 0 4px 0}
h3{font-size:13.5px;margin:1em 0 4px 0;color:#333}
.meta{color:#555;font-size:13px;margin-bottom:1em}
.subtitle{color:#666;font-size:12px;margin:0 0 6px 0}
.note{background:#fff7d6}
table{border-collapse:collapse;margin-bottom:0.4em;width:100%}
th,td{padding:4px 10px;border:1px solid #ccc;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
th{background:#f4f4f4;text-align:left;font-weight:600}
td.num{text-align:right}
td.warn{background:#fde2e2}
tr:hover td{background:#fafafa}
tr:hover td.warn{background:#f9cccc}
details.help{margin:4px 0 1em 0;color:#444;font-size:12.5px}
table.recent tr.stmts > td{padding:0;border:none;background:#fafafa}
table.recent table.inner{margin:4px 0 6px 24px;width:calc(100% - 24px);table-layout:fixed}
table.recent table.inner th,table.recent table.inner td{font-size:12px;vertical-align:top}
table.recent table.inner col.idx{width:3em}
table.recent table.inner col.dur{width:6em}
table.recent table.inner col.sql{width:52%}
table.recent table.inner col.args{width:48%}
table.recent code{white-space:pre-wrap;word-break:break-all}
th.grp{background:#ececec;text-align:center}
</style>
</head><body>
<h1>SQLite writer health</h1>
<div class="meta">snapshot: {{.GeneratedAt}} &middot; <a href="/debug/metrics">/debug/metrics</a> &middot; <a href="/debug/network">/debug/network</a></div>

<details class="help"><summary>What this page measures</summary>
<p>Every call to <code>sqlitex.WithTx</code> opens a real SQLite write transaction via <code>BEGIN IMMEDIATE</code>. Only one such transaction can be in flight at a time across the whole daemon. This page records per-caller wall durations and <code>SQLITE_BUSY</code> counts so we can tell who is holding the writer slot and who is being starved.</p>
<dl>
<dt>pool_wait</dt><dd>Time spent waiting for a connection from <code>sqlitex.Pool</code> via <code>Pool.WithTx</code> / <code>Pool.WithSave</code> / <code>Read[]</code> / <code>Write[]</code>. Large values mean the pool was starved — every conn was in use by someone else and this caller waited for one to be returned. Distinct from <code>begin_wait</code>, which is the writer-mutex wait <em>after</em> this caller already had a conn. Zero for bare-conn callers that bypass the pool (they pass a <code>*sqlite.Conn</code> directly to <code>WithTx</code> / <code>Save</code>).</dd>
<dt>begin_wait</dt><dd>Time spent inside <code>BEGIN IMMEDIATE</code> before it returned (includes SQLite's internal busy-handler backoff). Large values mean the writer slot was held by <em>someone else</em> while this caller waited.</dd>
<dt>hold</dt><dd>Wall time from successful <code>BEGIN IMMEDIATE</code> to <code>COMMIT</code>/<code>ROLLBACK</code>. Large values mean <em>this caller</em> is doing too much work inside the transaction.</dd>
<dt>total</dt><dd>Caller-visible end-to-end latency: <code>pool_wait + begin_wait + hold</code>. The single column an operator can use to spot "who is slow" without summing three percentile groups. The per-caller table is sorted by <code>total p99</code> for this reason.</dd>
<dt>begin_busy</dt><dd>The 10 s busy_timeout expired before <code>BEGIN IMMEDIATE</code> could succeed; the gRPC client sees this as <code>SQLITE_BUSY: database is locked</code>. Real contention. Each row carries a <em>held by</em> snapshot of whoever owned the writer slot at the moment of failure and a <em>drained during wait</em> list of holders that finished during the wait. <strong>For the aggregate "who caused all these busys" view see the <em>Begin-busy attribution</em> section below — usually the most useful starting point.</strong> begin_busy rows live in their own collapsed ring (separate from completed slow writes) so they can't evict real slow commits via their synthesised 10 s hold. The synthetic caller <code>sqlitex.WALCheckpointer</code> represents the background <code>PRAGMA wal_checkpoint(PASSIVE)</code> goroutine — it doesn't go through WithTx/Save, so without explicit hooks it would be invisible here; <strong>if it dominates HeldBy or DrainedDuringWait the disk's fsync floor is the bottleneck</strong> (see the WAL checkpoint section's recent-tick durations).</dd>
<dt>begin_interrupted</dt><dd><code>BEGIN IMMEDIATE</code> returned a non-busy error — almost always <code>SQLITE_INTERRUPT</code> from a context cancellation upstream. Not a lock-contention event; no <em>held by</em> snapshot. Common when a caller scopes a tx to a deadline that has expired, e.g. <code>connect.go</code>'s per-attempt timeout.</dd>
<dt>savepoint_top</dt><dd>Top-level <code>SAVEPOINT</code> on an autocommit connection that <em>actually wrote</em> at least once. The first DML/DDL statement promotes it to the writer-slot active set, so its hold time counts the same as a WithTx commit and it shows up on begin_busy "held by" snapshots. Pre-instrumentation these rows bypassed the page entirely, which is why the actual offender used to be invisible. <strong>begin_wait is renders as "—" for these rows</strong> and is excluded from the per-caller <em>wait</em> percentile: the SAVEPOINT keyword itself doesn't queue for the writer mutex (the deferred transaction is upgraded lazily by the first DML), so the only thing we could measure here is the SAVEPOINT statement's own ~µs execution time — not real contention. The actual writer-mutex wait, when it exists, is folded into the first DML's duration and shows up in hold.</dd>
<dt>savepoint</dt><dd>Nested <code>SAVEPOINT</code> issued while an outer transaction was already holding the writer slot. The outer tx is the lock holder — this row is recorded for completeness but excluded from hold percentiles to avoid double-counting.</dd>
</dl>
<p>Read-only <code>SAVEPOINT</code>s (Read[], ListEvents, ListPeers, etc.) are suppressed from this page entirely. They only ever held the SHARED reader lock and cannot cause SQLITE_BUSY on anyone's BEGIN IMMEDIATE; listing them would only dilute the writer-slot signal.</p>
<p><strong>Temp-table writes are a known false-positive — but the worst offenders now opt out.</strong> Statements like <code>INSERT INTO rbsr_iris ...</code> write to per-connection <code>TEMP</code> tables, which live in a separate SQLite database file and don't take the main DB's writer lock. The instrumentation can't tell main-DB writes from temp-DB writes without hooking the VFS xLock callbacks, so any plain <code>Save</code> scope that runs even one INSERT/DELETE — even purely against temp tables — promotes to <code>savepoint_top</code> and counts toward the writer-slot percentiles. <strong>Callers that know their scope only writes to TEMP can opt out via <code>sqlitex.SaveTempOnly</code> / <code>Pool.WithSaveTempOnly</code></strong>; the RBSR machinery (<code>syncing.(*Server).loadStore</code>, <code>syncing.(*Service).DiscoverObjectWithProgress</code>) does this, which is why they no longer dominate the Aggregate writer-slot utilization section. They render under <strong>Read operations</strong> instead. Cross-reference the captured statements on any remaining savepoint_top row before treating its caller as a real lock holder, and add a new opt-out only after auditing that the scope truly never writes to the main DB.</p>
<p><strong>Reading <code>hold</code> vs <code>begin_wait</code>:</strong> these phases are independent — <code>begin_wait</code> is contention <em>from others</em>, <code>hold</code> is <em>this caller's own work</em>. They have no reason to track each other; in a healthy daemon <code>hold</code> is much larger than <code>begin_wait</code> because most of the time the lock is free when you ask for it.</p>
<table style="margin-top:6px">
<thead><tr><th>shape</th><th>diagnosis</th></tr></thead>
<tbody>
<tr><td><code>hold</code> ≫ <code>begin_wait</code></td><td>This caller is the offender. It's the one whose work everyone else has to wait for.</td></tr>
<tr><td><code>begin_wait</code> ≫ <code>hold</code></td><td>Someone else is the offender. This caller barely worked but was queued behind a slow holder — look at recent rows committing around the same timestamp.</td></tr>
<tr><td><code>begin_wait</code> ≈ 10 s + <code>outcome=begin_busy</code></td><td>The actual publish-fails-with-SQLITE_BUSY case. Whoever was committing in the 10 s window before this row is the hog.</td></tr>
</tbody>
</table>
<p>Color thresholds: yellow ≥ 100 ms, red ≥ 1 s. The busy_timeout itself is 10 s.</p>
</details>

<h2>Currently in flight</h2>
{{if .Active}}
<table>
<thead><tr><th>caller</th><th>started</th><th class="num">age</th></tr></thead>
<tbody>
{{range .Active}}
<tr><td>{{.Caller}}</td><td>{{.StartedAt}}</td><td class="num {{.AgeClass}}">{{fmtMs .AgeMs}}</td></tr>
{{end}}
</tbody>
</table>
{{else}}
<div class="subtitle">No write transactions in flight right now.</div>
{{end}}

<h2>Per-caller stats</h2>
<div class="subtitle">Split into <strong>write operations</strong> (everything that interacted with the SQLite writer slot — WithTx commits/rollbacks, top-level Saves that wrote, plus BEGIN IMMEDIATE attempts that failed BUSY/INTERRUPT) and <strong>read operations</strong> (top-level Saves whose body never wrote — they only ever held the SHARED reader lock). A caller can appear in both tables if it does both kinds of work.</div>

<h3>Write operations</h3>
<div class="subtitle">Sorted by <code>total p99</code> (highest first) so the slowest caller-visible latency surfaces at the top. <em>total</em> = pool_wait + begin_wait + hold — the full caller-visible time, so a caller bottlenecked on the pool surfaces here even if its <em>hold</em> p99 is small. Drill in: <em>pool_wait</em> = queued for a conn; <em>begin_wait</em> = queued for the writer mutex (already had a conn); <em>hold</em> = caller's own work inside the writer slot. <strong>Σ hold</strong> and <strong>% wall</strong> catch aggregate-volume offenders whose individual <em>hold</em> stays under the 100 ms slow ring.</div>
{{if .WriteCallers}}
<table>
<thead>
<tr>
<th rowspan="2">caller</th>
<th class="num" rowspan="2">total</th>
<th class="num" rowspan="2">commits</th>
<th class="num" rowspan="2">rollbacks</th>
<th class="num" rowspan="2">busy</th>
<th class="num" rowspan="2">Σ hold</th>
<th class="num" rowspan="2">% wall</th>
<th class="grp" colspan="4">total (caller-visible latency)</th>
<th class="grp" colspan="4">pool_wait (queued for conn)</th>
<th class="grp" colspan="4">hold (caller's own work)</th>
<th class="grp" colspan="4">begin_wait (queued for writer mutex)</th>
</tr>
<tr>
<th class="num">p10</th>
<th class="num">p50</th>
<th class="num">p90</th>
<th class="num">p99</th>
<th class="num">p10</th>
<th class="num">p50</th>
<th class="num">p90</th>
<th class="num">p99</th>
<th class="num">p10</th>
<th class="num">p50</th>
<th class="num">p90</th>
<th class="num">p99</th>
<th class="num">p10</th>
<th class="num">p50</th>
<th class="num">p90</th>
<th class="num">p99</th>
</tr>
</thead>
<tbody>
{{range .WriteCallers}}
<tr>
<td>{{.Caller}}</td>
<td class="num">{{.Count}}</td>
<td class="num">{{.Commits}}</td>
<td class="num">{{.Rollbacks}}</td>
<td class="num {{.BusyClass}}">{{.BusyCount}}</td>
<td class="num {{.TotalHoldClass}}">{{fmtMs .TotalHoldMs}}</td>
<td class="num {{.ShareClass}}">{{fmtPct .SharePct}}</td>
<td class="num">{{fmtMs .TotalP10Ms}}</td>
<td class="num">{{fmtMs .TotalP50Ms}}</td>
<td class="num">{{fmtMs .TotalP90Ms}}</td>
<td class="num {{.TotalP99Class}}">{{fmtMs .TotalP99Ms}}</td>
<td class="num">{{fmtMs .PoolWaitP10Ms}}</td>
<td class="num">{{fmtMs .PoolWaitP50Ms}}</td>
<td class="num">{{fmtMs .PoolWaitP90Ms}}</td>
<td class="num {{.PoolWaitP99Class}}">{{fmtMs .PoolWaitP99Ms}}</td>
<td class="num">{{fmtMs .HoldP10Ms}}</td>
<td class="num">{{fmtMs .HoldP50Ms}}</td>
<td class="num">{{fmtMs .HoldP90Ms}}</td>
<td class="num {{.HoldP99Class}}">{{fmtMs .HoldP99Ms}}</td>
<td class="num">{{fmtMs .WaitP10Ms}}</td>
<td class="num">{{fmtMs .WaitP50Ms}}</td>
<td class="num">{{fmtMs .WaitP90Ms}}</td>
<td class="num {{.WaitP99Class}}">{{fmtMs .WaitP99Ms}}</td>
</tr>
{{end}}
</tbody>
</table>
{{else}}
<div class="subtitle">No write operations recorded yet.</div>
{{end}}

<h3>Aggregate writer-slot utilization</h3>
<div class="subtitle">Same data as the table above, projected down to the contention metric that catches the "death by a thousand short writes" case. Sorted by <code>Σ hold</code> descending. A caller at the top with low hold p99 is the kind of offender the old page hid: each individual transaction is too fast to trip the 100&nbsp;ms slow ring, but the aggregate has consumed enough writer-slot time to starve everyone else. Cross-reference against the <em>savepoint_top</em> / temp-table caveat above — promoted savepoints that only ever wrote to per-conn TEMP tables also count here.</div>
{{if .WriteAggregate}}
<table>
<thead><tr><th>caller</th><th class="num">count</th><th class="num">Σ hold</th><th class="num">% wall</th></tr></thead>
<tbody>
{{range .WriteAggregate}}
<tr>
<td>{{.Caller}}</td>
<td class="num">{{.Count}}</td>
<td class="num {{.TotalHoldClass}}">{{fmtMs .TotalHoldMs}}</td>
<td class="num {{.ShareClass}}">{{fmtPct .SharePct}}</td>
</tr>
{{end}}
</tbody>
</table>
{{else}}
<div class="subtitle">No writer-slot-owning operations recorded yet.</div>
{{end}}

<h3>Read operations</h3>
<div class="subtitle">Top-level Save scopes whose body never wrote. Hold = wall time the SHARED reader lock was held. No <code>wait</code> column: read-only Saves never queue for the writer slot (their SAVEPOINT statement runs immediately).</div>
{{if .ReadCallers}}
<table>
<thead>
<tr>
<th rowspan="2">caller</th>
<th class="num" rowspan="2">total</th>
<th class="grp" colspan="4">hold (SHARED reader lock)</th>
</tr>
<tr>
<th class="num">p10</th>
<th class="num">p50</th>
<th class="num">p90</th>
<th class="num">p99</th>
</tr>
</thead>
<tbody>
{{range .ReadCallers}}
<tr>
<td>{{.Caller}}</td>
<td class="num">{{.Count}}</td>
<td class="num">{{fmtMs .HoldP10Ms}}</td>
<td class="num">{{fmtMs .HoldP50Ms}}</td>
<td class="num">{{fmtMs .HoldP90Ms}}</td>
<td class="num {{.HoldP99Class}}">{{fmtMs .HoldP99Ms}}</td>
</tr>
{{end}}
</tbody>
</table>
{{else}}
<div class="subtitle">No read operations recorded yet.</div>
{{end}}

<h2>Slowest slow / busy transactions</h2>
<div class="subtitle">Split by kind: writes (capped at {{.RecentWriteCap}}) and reads (capped at {{.RecentReadCap}}) each have their own top-K-by-hold buffer, so a steady stream of slow reads can't evict a rare slow write or vice versa. Only operations whose hold exceeded 100 ms or that hit BEGIN IMMEDIATE busy enter either ring. Sorted by <code>hold</code> descending within each section so the worst outlier is always at the top; click a row to expand the statements that ran inside the scope (byte-slice args are summarised by length to avoid retaining blob payloads).</div>

<h3>Begin-busy attribution</h3>
<div class="subtitle">Aggregate view across the last <strong>{{.BusyEventsCount}}</strong> begin_busy events kept in the ring (cap {{.RecentBusyCap}}). For each event, we sum the writer-slot hold time contributed by every caller that finished during the wait (<em>drained during wait</em>) plus the caller still holding at timeout (<em>held by</em>). Top of this table = the caller most responsible for the recent busy storm. Empty if no begin_busy events have been recorded.</div>
{{if .BusyAttribution}}
<table>
<thead><tr><th>caller</th><th class="num">events</th><th class="num">Σ held during wait</th><th class="num">avg per event</th></tr></thead>
<tbody>
{{range .BusyAttribution}}
<tr>
<td>{{.Caller}}</td>
<td class="num">{{.Events}}</td>
<td class="num {{.HeldDuringWaitClass}}">{{fmtMs .HeldDuringWaitMs}}</td>
<td class="num">{{fmtMs .AvgPerEventMs}}</td>
</tr>
{{end}}
</tbody>
</table>
{{else}}
<div class="subtitle">No begin_busy events recorded yet (no recent SQLITE_BUSY). When BEGIN IMMEDIATE attempts start failing with the busy_timeout, this table will surface the callers responsible.</div>
{{end}}

<details><summary><strong>Slowest write operations</strong> — completed writes only; showing {{len .RecentWrite}} of up to {{.RecentWriteCap}} (click to expand)</summary>
<div class="subtitle">Outcomes here are <code>commit</code> / <code>rollback</code> / <code>savepoint_top</code> / <code>savepoint</code>. <strong>begin_busy and begin_interrupted are in their own collapsed section below</strong> — they synthesise hold == busy_timeout and would otherwise dominate this ring and evict real slow commits.</div>
{{if .RecentWrite}}
{{template "recentTable" .RecentWrite}}
{{else}}
<div class="subtitle">No slow write operations recorded yet.</div>
{{end}}
</details>

<details><summary><strong>Slowest begin_busy events</strong> — showing {{len .RecentBusy}} of up to {{.RecentBusyCap}} (click to expand)</summary>
<div class="subtitle">Each row is a BEGIN IMMEDIATE that hit the busy_timeout. <code>hold</code> and <code>begin_wait</code> are both ≈ busy_timeout (10 s) by construction. Use the Begin-busy attribution section above for the aggregate view across all of these; expand individual rows for the per-event <em>held by</em> and <em>drained during wait</em> drill-downs.</div>
{{if .RecentBusy}}
{{template "recentTable" .RecentBusy}}
{{else}}
<div class="subtitle">No begin_busy or begin_interrupted events recorded yet.</div>
{{end}}
</details>

<details><summary><strong>Slowest read operations</strong> — showing {{len .RecentRead}} of up to {{.RecentReadCap}} (click to expand)</summary>
<div class="subtitle">All entries here have outcome <code>savepoint_ro</code> — top-level Saves whose body never wrote. <code>begin_wait</code> is meaningless for reads (the SAVEPOINT statement never queues for the writer slot) and renders as 0.</div>
{{if .RecentRead}}
{{template "recentTable" .RecentRead}}
{{else}}
<div class="subtitle">No slow read operations recorded yet.</div>
{{end}}
</details>

{{define "recentTable"}}
<table class="recent">
<thead><tr>
<th>when</th><th>caller</th><th class="num">pool_wait</th><th class="num">begin_wait</th><th class="num">hold</th><th>outcome</th><th class="num">stmts</th>
</tr></thead>
<tbody>
{{range $i, $r := .}}
<tr>
<td>{{$r.When}}</td>
<td>{{$r.Caller}}</td>
<td class="num {{$r.PoolWaitClass}}">{{fmtMs $r.PoolWaitMs}}</td>
<td class="num {{if $r.WaitNA}}{{else}}{{$r.WaitClass}}{{end}}" title="{{if $r.WaitNA}}begin_wait n/a for savepoint_top — actual writer-mutex acquisition is lazy, hidden inside the first DML and counted as hold{{end}}">{{if $r.WaitNA}}—{{else}}{{fmtMs $r.WaitMs}}{{end}}</td>
<td class="num {{$r.HoldClass}}">{{fmtMs $r.HoldMs}}</td>
<td class="{{$r.OutClass}}">{{$r.Outcome}}</td>
<td class="num">{{len $r.Stmts}}</td>
</tr>
{{if $r.HeldBy}}
<tr class="stmts"><td colspan="7">
<details><summary>held by ({{len $r.HeldBy}}) — who had the writer slot when this row's BEGIN IMMEDIATE failed</summary>
<table class="inner">
<colgroup><col class="idx"><col class="sql"><col class="args"></colgroup>
<thead><tr><th class="num">#</th><th>caller</th><th class="num">held for</th></tr></thead>
<tbody>
{{range $k, $h := $r.HeldBy}}
<tr><td class="num">{{$k}}</td><td>{{$h.Caller}}</td><td class="num {{$h.Class}}">{{fmtMs $h.HeldForMs}}</td></tr>
{{end}}
</tbody>
</table>
</details>
</td></tr>
{{end}}
{{if $r.DrainedDuringWait}}
<tr class="stmts"><td colspan="7">
<details><summary>drained during wait ({{len $r.DrainedDuringWait}}) — holders that finished while this BEGIN IMMEDIATE was waiting</summary>
<table class="inner">
<thead><tr><th class="num">#</th><th>when</th><th>caller</th><th class="num">hold</th><th>outcome</th></tr></thead>
<tbody>
{{range $k, $d := $r.DrainedDuringWait}}
<tr><td class="num">{{$k}}</td><td>{{$d.When}}</td><td>{{$d.Caller}}</td><td class="num {{$d.HoldClass}}">{{fmtMs $d.HoldMs}}</td><td class="{{$d.OutClass}}">{{$d.Outcome}}</td></tr>
{{end}}
</tbody>
</table>
</details>
</td></tr>
{{end}}
{{if $r.Stmts}}
<tr class="stmts"><td colspan="7">
<details><summary>statements ({{len $r.Stmts}})</summary>
<table class="inner">
<colgroup><col class="idx"><col class="dur"><col class="sql"><col class="args"></colgroup>
<thead><tr><th class="num">#</th><th class="num">dur</th><th>sql</th><th>args</th></tr></thead>
<tbody>
{{range $j, $s := $r.Stmts}}
<tr><td class="num">{{$j}}</td><td class="num {{$s.DurClass}}">{{fmtMs $s.DurMs}}</td><td><code>{{$s.SQL}}</code></td><td><code>{{$s.Args}}</code></td></tr>
{{end}}
</tbody>
</table>
</details>
</td></tr>
{{end}}
{{end}}
</tbody>
</table>
{{end}}
</body></html>
`
