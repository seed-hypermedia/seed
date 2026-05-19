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
	GeneratedAt string
	Active      []activeRow
	Callers     []callerRow
	Recent      []recentRow
}

type activeRow struct {
	Caller    string
	StartedAt string
	AgeMs     float64
	AgeClass  string
}

type callerRow struct {
	Caller       string
	Count        uint64
	Commits      uint64
	Rollbacks    uint64
	BusyCount    uint64
	BusyClass    string
	HoldP10Ms    float64
	HoldP50Ms    float64
	HoldP90Ms    float64
	HoldP99Ms    float64
	HoldP99Class string
	WaitP10Ms    float64
	WaitP50Ms    float64
	WaitP90Ms    float64
	WaitP99Ms    float64
	WaitP99Class string
}

type recentRow struct {
	When      string
	Caller    string
	HoldMs    float64
	HoldClass string
	WaitMs    float64
	WaitClass string
	Outcome   string
	OutClass  string
	Stmts     []recentStmt
	// HeldBy is populated for begin_busy rows: each entry is the caller +
	// how long it had been holding the writer slot at the moment this row's
	// BEGIN IMMEDIATE timed out.
	HeldBy []heldByEntry
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

	for name, s := range snap.Callers {
		row := callerRow{
			Caller:       name,
			Count:        s.Count,
			Commits:      s.Commits,
			Rollbacks:    s.Rollbacks,
			BusyCount:    s.BusyCount,
			BusyClass:    classForBusy(s.BusyCount),
			HoldP10Ms:    s.HoldP10Ms,
			HoldP50Ms:    s.HoldP50Ms,
			HoldP90Ms:    s.HoldP90Ms,
			HoldP99Ms:    s.HoldP99Ms,
			HoldP99Class: classForHoldMs(s.HoldP99Ms),
			WaitP10Ms:    s.WaitP10Ms,
			WaitP50Ms:    s.WaitP50Ms,
			WaitP90Ms:    s.WaitP90Ms,
			WaitP99Ms:    s.WaitP99Ms,
			WaitP99Class: classForHoldMs(s.WaitP99Ms),
		}
		page.Callers = append(page.Callers, row)
	}
	// Sort by hold p99 desc so the most-likely-to-block-publishers caller is
	// on top. Victims (high wait p99) can be spotted by skimming the same row.
	sort.Slice(page.Callers, func(i, j int) bool {
		return page.Callers[i].HoldP99Ms > page.Callers[j].HoldP99Ms
	})

	recent := make([]txSample, len(snap.Recent))
	copy(recent, snap.Recent)
	sort.Slice(recent, func(i, j int) bool { return recent[i].When.After(recent[j].When) })
	for _, s := range recent {
		ms := float64(s.Hold) / float64(time.Millisecond)
		waitMs := float64(s.BeginWait) / float64(time.Millisecond)
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
		page.Recent = append(page.Recent, recentRow{
			When:      s.When.Format("15:04:05.000"),
			Caller:    s.Caller,
			HoldMs:    ms,
			HoldClass: classForHoldMs(ms),
			WaitMs:    waitMs,
			WaitClass: classForHoldMs(waitMs),
			Outcome:   string(s.Outcome),
			OutClass:  classForOutcome(s.Outcome),
			Stmts:     stmts,
			HeldBy:    held,
		})
	}

	return page
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

func classForOutcome(o txOutcome) string {
	switch o {
	case outcomeBeginBusy, outcomeRollback:
		return "warn"
	case outcomeBeginInterrupted:
		// Yellow: interesting (BEGIN failed) but not a contention event —
		// usually ctx cancellation, no lock holder to blame.
		return "note"
	default:
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
}).Parse(sqliteHTML))

const sqliteHTML = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>seed sqlite writer health</title>
<style>
body{font-family:sans-serif;margin:1em;color:#222;max-width:1100px}
h1{font-size:18px;margin:0 0 6px 0}
h2{font-size:15px;margin:1.4em 0 4px 0}
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
<dt>begin_wait</dt><dd>Time spent inside <code>BEGIN IMMEDIATE</code> before it returned (includes SQLite's internal busy-handler backoff). Large values mean the writer slot was held by <em>someone else</em> while this caller waited.</dd>
<dt>hold</dt><dd>Wall time from successful <code>BEGIN IMMEDIATE</code> to <code>COMMIT</code>/<code>ROLLBACK</code>. Large values mean <em>this caller</em> is doing too much work inside the transaction.</dd>
<dt>begin_busy</dt><dd>The 10 s busy_timeout expired before <code>BEGIN IMMEDIATE</code> could succeed; the gRPC client sees this as <code>SQLITE_BUSY: database is locked</code>. Real contention. Surfaces a <em>held by</em> snapshot of whoever had the writer slot at the moment of failure.</dd>
<dt>begin_interrupted</dt><dd><code>BEGIN IMMEDIATE</code> returned a non-busy error — almost always <code>SQLITE_INTERRUPT</code> from a context cancellation upstream. Not a lock-contention event; no <em>held by</em> snapshot. Common when a caller scopes a tx to a deadline that has expired, e.g. <code>connect.go</code>'s per-attempt timeout.</dd>
</dl>
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
<div class="subtitle">Sorted by <code>hold p99</code> (highest first). The <em>hold</em> group is this caller's own work inside the writer slot; the <em>wait</em> group is how long this caller was queued behind others. Offender = high hold; victim = high wait.</div>
{{if .Callers}}
<table>
<thead>
<tr>
<th rowspan="2">caller</th>
<th class="num" rowspan="2">total</th>
<th class="num" rowspan="2">commits</th>
<th class="num" rowspan="2">rollbacks</th>
<th class="num" rowspan="2">busy</th>
<th class="grp" colspan="4">hold (caller's own work)</th>
<th class="grp" colspan="4">wait (queued behind others)</th>
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
</tr>
</thead>
<tbody>
{{range .Callers}}
<tr>
<td>{{.Caller}}</td>
<td class="num">{{.Count}}</td>
<td class="num">{{.Commits}}</td>
<td class="num">{{.Rollbacks}}</td>
<td class="num {{.BusyClass}}">{{.BusyCount}}</td>
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
<div class="subtitle">No write transactions recorded yet.</div>
{{end}}

<h2>Recent slow / busy transactions</h2>
<div class="subtitle">Last {{len .Recent}} transactions whose hold time exceeded 100 ms or that hit BEGIN IMMEDIATE busy. Click a row to see the statements that ran inside the tx; byte-slice args are summarised by length to avoid retaining blob payloads.</div>
{{if .Recent}}
<table class="recent">
<thead><tr>
<th>when</th><th>caller</th><th class="num">hold</th><th class="num">begin_wait</th><th>outcome</th><th class="num">stmts</th>
</tr></thead>
<tbody>
{{range $i, $r := .Recent}}
<tr>
<td>{{$r.When}}</td>
<td>{{$r.Caller}}</td>
<td class="num {{$r.HoldClass}}">{{fmtMs $r.HoldMs}}</td>
<td class="num {{$r.WaitClass}}">{{fmtMs $r.WaitMs}}</td>
<td class="{{$r.OutClass}}">{{$r.Outcome}}</td>
<td class="num">{{len $r.Stmts}}</td>
</tr>
{{if $r.HeldBy}}
<tr class="stmts"><td colspan="6">
<details open><summary>held by ({{len $r.HeldBy}}) — who had the writer slot when this row's BEGIN IMMEDIATE failed</summary>
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
{{if $r.Stmts}}
<tr class="stmts"><td colspan="6">
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
{{else}}
<div class="subtitle">No slow or busy transactions recorded yet.</div>
{{end}}
</body></html>
`
