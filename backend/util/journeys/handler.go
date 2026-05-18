// Package journeys renders the /debug/journeys HTML page.
//
// It is the read-side companion to backend/api/telemetry/v1alpha: it pulls a
// snapshot of retained traces and produces a sortable, highlighted table so a
// developer can see — at a glance — where a blob's journey from daemon to
// renderer is dying.
package journeys

import (
	"fmt"
	"html/template"
	"net/http"
	"os"
	"sort"
	"strings"
	"time"

	telemetry "seed/backend/api/telemetry/v1alpha"
)

// Handler returns an http.Handler that renders retained journeys from the
// provided telemetry server.
func Handler(srv *telemetry.Server) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		snap := srv.Snapshot()
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		if err := tpl.Execute(w, buildView(snap)); err != nil {
			// Template execution may fail partway through after some HTML
			// has already been flushed (e.g. a struct field was removed
			// from view but the template still references it). We can't
			// change the status code, but we can append a visible marker
			// and a stderr log so the failure isn't silent.
			fmt.Fprintf(w, "\n<!-- TEMPLATE ERROR: %s -->\n", err)
			fmt.Fprintf(os.Stderr, "journeys: template execute failed: %v\n", err)
		}
	})
}

type row struct {
	Key       string
	Gen       int
	LastStage string
	Status    telemetry.Status
	StatusCSS string
	TotalSpan string
	Deltas    []delta
	IsAnomaly bool

	// HasFrontend is true when at least one checkpoint was emitted by the
	// Electron main or React renderer (stage prefix main.* or renderer.*).
	// Used to float frontend-touched traces above pure backend feed noise.
	HasFrontend bool
	// IsGroupHead marks the first row in a same-key group. The template
	// emits the Key cell only on the head and spans it across the group.
	IsGroupHead bool
	// GroupSize is the number of gens in this row's key group. Meaningful
	// only on the head row.
	GroupSize int
	// lastUpdate is the timestamp of the latest checkpoint; used to order
	// groups by recency.
	lastUpdate time.Time
}

type delta struct {
	Idx   int // 1-based position so the template can show "1. backend.feed_emitted"
	Stage string
	Dur   string
	CSS   string
}

type summaryBucket struct {
	Stage string
	Count int
}

type view struct {
	GeneratedAt      string
	Total            int
	Complete         int
	RenderedOnly     int
	Abandoned        int
	FrontendTouched  int
	AbandonedByStage []summaryBucket
	Rows             []row
}

// gapWarn is the threshold above which a per-stage delta is rendered red.
const gapWarn = 200 * time.Millisecond

// lateStages are checkpoints late enough in the pipeline that an abandonment
// there is suspicious (the data flowed almost all the way but never painted).
// Only emitted stages are listed; planned-but-unwired stages don't belong here.
// Both per-method *.response_sent stages qualify: reaching either means the
// daemon answered an RPC, so abandoning after that point means the renderer
// got data but never painted.
var lateStages = map[string]struct{}{
	telemetry.StageGetDocumentResponseSent: {},
	telemetry.StageGetAccountResponseSent:  {},
}

func buildView(traces []telemetry.Trace) view {
	v := view{
		GeneratedAt: time.Now().Format(time.RFC3339),
		Total:       len(traces),
		Rows:        make([]row, 0, len(traces)),
	}

	abandonedByStage := map[string]int{}

	for _, tr := range traces {
		r := row{
			Key:    tr.Key,
			Gen:    tr.Gen,
			Status: tr.Status,
		}

		r.lastUpdate = tr.LastUpdate

		if n := len(tr.Checkpoints); n > 0 {
			r.LastStage = tr.Checkpoints[n-1].Stage
			r.TotalSpan = formatDuration(tr.Checkpoints[n-1].TS.Sub(tr.Checkpoints[0].TS))

			r.Deltas = make([]delta, 0, n)
			for i, cp := range tr.Checkpoints {
				d := delta{Idx: i + 1, Stage: cp.Stage, CSS: "num"}
				if i == 0 {
					d.Dur = "—"
				} else {
					dur := cp.TS.Sub(tr.Checkpoints[i-1].TS)
					d.Dur = formatDuration(dur)
					if dur > gapWarn {
						d.CSS = "num warn"
						r.IsAnomaly = true
					}
				}
				r.Deltas = append(r.Deltas, d)
				if !r.HasFrontend && (strings.HasPrefix(cp.Stage, "main.") || strings.HasPrefix(cp.Stage, "renderer.")) {
					r.HasFrontend = true
				}
			}
		}

		switch tr.Status {
		case telemetry.StatusComplete:
			v.Complete++
			r.StatusCSS = "status-complete"
		case telemetry.StatusRenderedOnly:
			v.RenderedOnly++
			r.StatusCSS = "status-rendered-only"
		case telemetry.StatusAbandoned:
			v.Abandoned++
			abandonedByStage[r.LastStage]++
			if _, late := lateStages[r.LastStage]; late {
				r.StatusCSS = "status-abandoned-late"
				r.IsAnomaly = true
			} else {
				r.StatusCSS = "status-abandoned-early"
			}
		case telemetry.StatusLive:
			r.StatusCSS = "status-live"
		}

		if r.HasFrontend {
			v.FrontendTouched++
		}

		v.Rows = append(v.Rows, r)
	}

	for stage, count := range abandonedByStage {
		v.AbandonedByStage = append(v.AbandonedByStage, summaryBucket{Stage: stage, Count: count})
	}
	sort.Slice(v.AbandonedByStage, func(i, j int) bool {
		return v.AbandonedByStage[i].Count > v.AbandonedByStage[j].Count
	})

	v.Rows = groupAndSortRows(v.Rows)
	return v
}

// groupAndSortRows clusters rows by Key so every generation of the same URL
// renders as one visual block, then orders the groups so signal-rich keys
// rise to the top: any key with frontend feedback first, then keys with an
// anomaly, then keys by most-recent activity. Within a group, rows are
// ordered by Gen ascending so the journey timeline reads top-to-bottom.
// The first row of each group is marked with IsGroupHead and GroupSize so
// the template can render the Key cell with rowspan over the whole group.
func groupAndSortRows(rows []row) []row {
	if len(rows) == 0 {
		return rows
	}

	type group struct {
		key           string
		hasFrontend   bool
		hasAnomaly    bool
		maxLastUpdate time.Time
		rows          []row
	}
	byKey := map[string]*group{}
	order := []string{} // preserve first-seen order for stable secondary sort
	for _, r := range rows {
		g, ok := byKey[r.Key]
		if !ok {
			g = &group{key: r.Key}
			byKey[r.Key] = g
			order = append(order, r.Key)
		}
		if r.HasFrontend {
			g.hasFrontend = true
		}
		if r.IsAnomaly {
			g.hasAnomaly = true
		}
		if r.lastUpdate.After(g.maxLastUpdate) {
			g.maxLastUpdate = r.lastUpdate
		}
		g.rows = append(g.rows, r)
	}

	groups := make([]*group, 0, len(byKey))
	for _, k := range order {
		groups = append(groups, byKey[k])
	}
	sort.SliceStable(groups, func(i, j int) bool {
		a, b := groups[i], groups[j]
		if a.hasFrontend != b.hasFrontend {
			return a.hasFrontend
		}
		if a.hasAnomaly != b.hasAnomaly {
			return a.hasAnomaly
		}
		if !a.maxLastUpdate.Equal(b.maxLastUpdate) {
			return a.maxLastUpdate.After(b.maxLastUpdate)
		}
		return a.key < b.key
	})

	out := make([]row, 0, len(rows))
	for _, g := range groups {
		sort.Slice(g.rows, func(i, j int) bool { return g.rows[i].Gen < g.rows[j].Gen })
		g.rows[0].IsGroupHead = true
		g.rows[0].GroupSize = len(g.rows)
		out = append(out, g.rows...)
	}
	return out
}

func formatDuration(d time.Duration) string {
	switch {
	case d <= 0:
		return "0"
	case d < time.Microsecond:
		return fmt.Sprintf("%dns", d)
	case d < time.Millisecond:
		return fmt.Sprintf("%.1fµs", float64(d)/float64(time.Microsecond))
	case d < time.Second:
		return fmt.Sprintf("%.1fms", float64(d)/float64(time.Millisecond))
	default:
		return fmt.Sprintf("%.2fs", d.Seconds())
	}
}

// summarySafeHTML renders a one-line abandoned-by-stage summary that the
// template embeds verbatim. Pre-rendered to avoid a Go template loop. The
// dynamic Stage value is HTML-escaped before being wrapped in <code> tags,
// so the resulting template.HTML is safe even when stages originate from
// external gRPC emitters.
func summarySafeHTML(buckets []summaryBucket) template.HTML {
	if len(buckets) == 0 {
		return ""
	}
	parts := make([]string, 0, len(buckets))
	for _, b := range buckets {
		parts = append(parts, fmt.Sprintf("%d at <code>%s</code>", b.Count, template.HTMLEscapeString(b.Stage)))
	}
	return template.HTML(" (" + strings.Join(parts, ", ") + ")") // #nosec G203 -- Stage is escaped above; surrounding markup is static.
}

func init() {
	tpl = tpl.Funcs(template.FuncMap{
		"summary": summarySafeHTML,
	})
	tpl = template.Must(tpl.Parse(tplSrc))
}

var tpl = template.New("journeys")

const tplSrc = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>journeys</title>
<style>
body{font-family:sans-serif;margin:1em;max-width:1400px}
table{border-collapse:collapse;font-size:12px;table-layout:fixed;width:100%}
th,td{padding:3px 8px;border:1px solid #ccc;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;vertical-align:top;word-break:break-all}
th{background:#f4f4f4;text-align:left}
col.col-key{width:34%}
col.col-gen{width:3em}
col.col-last{width:18%}
col.col-status{width:6em}
col.col-total{width:5em}
col.col-stages{width:auto}
td.num{text-align:right;word-break:normal}
td.warn{background:#fde2e2}
tr.anomaly td.key-cell, tr.anomaly.group-tail td:first-child{border-left:3px solid #d9534f}
tr.group-tail td{border-top:1px dashed #e4e4e4}
td.key-cell{background:#fafafa}
.stage-idx{display:inline-block;min-width:1.6em;color:#888;font-size:10px;text-align:right;margin-right:2px}
.status-complete{color:#2e7d32;font-weight:bold}
.status-rendered-only{color:#00838f;font-weight:bold}
.status-abandoned-late{color:#c62828;font-weight:bold}
.status-abandoned-early{color:#777}
.status-live{color:#000;font-style:italic}
.summary{padding:8px 12px;background:#f4f4f4;border:1px solid #ccc;margin-bottom:12px;font-size:13px}
tr.backend-only td{color:#999;background:#fcfcfc}
tr.backend-only td.status-live{color:#999}
.stage{display:block;color:#555;font-size:11px;word-break:normal}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#eee;padding:0 3px}
p.hint{color:#555;font-size:12px}
details.legend{margin:10px 0;padding:8px 12px;background:#fafafa;border:1px solid #ddd;font-size:12px}
details.legend summary{cursor:pointer;font-weight:bold;font-family:sans-serif}
details.legend dl{margin:8px 0 0 0}
details.legend dt{margin-top:6px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
details.legend dd{margin:2px 0 0 1.4em;color:#444}
details.legend ul{margin:6px 0 0 1.4em;padding:0}
</style></head><body>
<h2>Blob-to-render journeys</h2>
<div class="summary">
  Generated {{.GeneratedAt}} · <strong>{{.Total}}</strong> retained traces ·
  <strong>{{.FrontendTouched}}</strong> with frontend feedback ·
  <span class="status-complete">{{.Complete}} complete</span> ·
  <span class="status-rendered-only">{{.RenderedOnly}} rendered-only</span> ·
  <span class="status-abandoned-late">{{.Abandoned}} abandoned</span>{{summary .AbandonedByStage}}
</div>

<details class="legend">
<summary>How to read this page</summary>
<p>This page traces the lifecycle of every URL (key) that flows through the daemon &rarr; desktop &rarr; renderer pipeline. Each row is <strong>one generation</strong> of that URL's journey (a fresh user-initiated attempt starts a new generation). The ring buffer keeps the <strong>500 most-recent generations</strong> (LRU eviction); older traces are dropped to bound memory. Tune <code>DefaultMaxTraces</code> in <code>backend/api/telemetry/v1alpha/telemetry.go</code> if you need a larger window.</p>

<p><strong>Status values</strong> (column 4):</p>
<dl>
  <dt><span class="status-live">live</span></dt>
  <dd>Still in flight. New checkpoints may still arrive. Re-classified as <em>abandoned</em> automatically after 30s of inactivity.</dd>
  <dt><span class="status-complete">complete</span></dt>
  <dd>Reached <code>renderer.component_rendered</code> after at least one preceding stage in the same generation. Healthy end-to-end journey: we saw a start, we saw a finish.</dd>
  <dt><span class="status-rendered-only">rendered-only</span> (teal, bold)</dt>
  <dd>We saw the <em>finish</em> (<code>renderer.component_rendered</code>) but no start. Typical sources: window restore from a previous session, React Query cache hits (the data was already in memory so no <code>GetDocument</code> call), and deep links that bypass the in-app navigation dispatcher. The page painted fine; we just have no observable cause for it.</dd>
  <dt><span class="status-abandoned-late">abandoned</span> (red, bold)</dt>
  <dd>The opposite of rendered-only: we saw a <em>start</em> but no finish, and the last stage we saw was deep in the pipeline (currently <code>backend.get_document.response_sent</code> or <code>backend.get_account.response_sent</code>). The daemon answered an RPC, but no <code>renderer.component_rendered</code> ever followed. Worth investigating &mdash; the renderer got data but the page never painted, or the user navigated away before it could.</dd>
  <dt><span class="status-abandoned-early">abandoned</span> (grey)</dt>
  <dd>Also a start-without-finish, but the last stage was earlier (e.g. only <code>backend.feed_emitted</code> ever fired, or a <code>renderer.link_click</code> was never followed by anything). Usually benign: the feed surfaced a blob the user never opened, or the user clicked then immediately navigated away.</dd>
</dl>

<p><strong>The two "incomplete" Statuses are mirror images:</strong> <code>abandoned</code> means "we saw the journey start but it never reached the renderer". <code>rendered-only</code> means "we saw the renderer paint but the journey's start was never observed". One is missing the tail of the timeline, the other is missing the head.</p>

<p><strong>Reading a row:</strong></p>
<ul>
  <li><b>Key</b> &mdash; the URL being tracked (an <code>hm://...</code> URL; optionally version-pinned if the caller specified one). All generations of one key are grouped under a single Key cell so you can read every attempt at a glance.</li>
  <li><b>Gen</b> &mdash; generation number for this key. A new generation opens whenever a fresh initiating stamp arrives (currently only <code>renderer.link_click</code>); rows inside a group are sorted gen-ascending so the oldest journey is on top.</li>
  <li><b>Last stage</b> &mdash; the most recent checkpoint stamped. Helps you spot where the journey is currently parked.</li>
  <li><b>Status</b> &mdash; see legend above.</li>
  <li><b>Total</b> &mdash; wall-clock from first to last checkpoint. Single-checkpoint traces show 0 (nothing earlier to subtract from).</li>
  <li><b>Stages</b> &mdash; chronologically-ordered checkpoints, <em>top is first, bottom is last</em>. The number prefix (<code>1.</code>, <code>2.</code> &hellip;) makes the order explicit; the duration shown beside each stage is the delta <em>from the previous stage</em>, not from the start. Red cells mark hops &gt;200ms; any red cell flags the whole row as an anomaly (red left border).</li>
</ul>

<p><strong>Stages emitted today.</strong> The proto wire format is a free-form string, but only the stages below have an emitter on this branch. Adding a new stage means wiring the emitter in the same change; we do not declare planned-but-unwired stages. Stage names follow <code>&lt;process&gt;.&lt;scope&gt;.&lt;event&gt;</code> so you can tell at a glance which RPC handled a request.</p>
<ul>
  <li><code>backend.feed_emitted</code> &mdash; <code>activity.ListEvents</code> stamps this the <em>first time</em> a given blob is surfaced in a feed response. The frontend polls the feed on a timer; the emitter dedupes per process so each blob stamps once.</li>
  <li><code>backend.get_document.request_received</code> / <code>backend.get_document.response_sent</code> &mdash; the daemon's <code>GetDocument</code> RPC (Documents v3) stamps these on entry and via <code>defer</code> on return. So "received" is the RPC call arriving, "sent" is the response leaving. <em>Only</em> <code>GetDocument</code> stamps these &mdash; other document reads (<code>GetDocumentInfo</code>, <code>ListDocuments</code>, change-log queries, etc.) do not.</li>
  <li><code>backend.get_account.request_received</code> / <code>backend.get_account.response_sent</code> &mdash; same pattern, for <code>GetAccount</code>. The key is just <code>hm://&lt;uid&gt;</code> with no path, so these always show up on account-only rows.</li>
  <li><code>renderer.link_click</code> &mdash; emitted by <code>frontend/apps/desktop/src/utils/navigation-container</code> and <code>useNavigate</code> on every navigation. The <em>only</em> initiating stage: a new click on the same key opens a new generation, sealing the previous one as abandoned &mdash; <em>unless</em> the previous generation has only backend stages (no prior <code>renderer.*</code> or <code>main.*</code>), in which case the click is interpreted as belonging to the existing journey (e.g. a sidebar prefetched, then the user clicked) and we append instead.</li>
  <li><code>renderer.component_rendered</code> &mdash; emitted by <code>desktop-resource.tsx</code> once after the doc loads. Key is the route's id (matches what link_click emits).</li>
</ul>

<p><strong>Why does the page rarely show what the renderer "did" with a daemon response?</strong> Because the desktop renderer currently only stamps two stages: <code>renderer.link_click</code> (on navigation) and <code>renderer.component_rendered</code> (on the resource page mount). Side-effects of a response &mdash; React Query cache writes, avatar/sidebar re-renders, related-card hydration &mdash; have no telemetry today. So a row that ends at <code>backend.get_account.response_sent</code> with no following <code>renderer.component_rendered</code> doesn't necessarily mean the renderer dropped the data; more likely the data was consumed by some non-page UI (sidebar avatar, hover preview) that doesn't stamp anything. To see those interactions, the renderer would need additional stamps wired into the React Query / cache layer.</p>

<p><strong>Row ordering:</strong> signal-rich rows float to the top &mdash; frontend-touched (any <code>renderer.*</code> stage) first, then anomalies (red 200ms+ cell or abandoned-late), then most-recent activity. Pure backend-only rows (the <code>backend.feed_emitted</code> noise from sync) are dimmed grey and sink to the bottom.</p>

<p><strong>Common patterns.</strong> A sea of dimmed live rows ending at <code>backend.feed_emitted</code> is normal during sync &mdash; the daemon surfaces new blobs to the activity feed, but the frontend has enough metadata in the feed event to render the feed card and never needs to call <code>GetDocument</code> for blobs the user doesn't drill into. Those generations time out to <em>abandoned-early</em> after 30s. Real problems are <em>abandoned-late</em> rows (daemon answered, renderer never painted) or red 200ms+ cells inside an otherwise-complete trace.</p>

<p><strong>Things that look weird but aren't bugs:</strong></p>
<ul>
  <li><em>A key has multiple <code>backend.get_document.request_received</code>/<code>backend.get_document.response_sent</code> (or the <code>get_account</code> equivalent) pairs in one generation.</em> Means the renderer made multiple calls of that RPC for the same key during that page load &mdash; a common case is a page-level <code>useResource(docId)</code> plus a parallel <code>useResource(hmId(docId.uid))</code> for the same account uid in a sibling component (avatar, related cards). Two pairs = two RPCs, not a single retry.</li>
  <li><em>A key shows multiple generations of <code>renderer.link_click &rarr; renderer.component_rendered</code> but no <code>backend.feed_emitted</code> anywhere.</em> Expected when the user navigated to that URL directly without seeing it in the feed first. Even if the feed <em>did</em> show that path, the feed stamps under a version-pinned key (<code>?v=&lt;blobCid&gt;</code>) while the click stamps under whatever version was in the route &mdash; if those versions differ, the two journeys live under different keys and don't share a row.</li>
  <li><em>A generation starts with <code>backend.grpc_request_received</code> instead of <code>renderer.link_click</code>.</em> Means a background hook (sidebar, hover preview, related-card avatar) called <code>GetDocument</code>/<code>GetAccount</code> for this key before any user action. If the user later clicks while the trace is still live, <code>renderer.link_click</code> appends to the <em>same</em> generation rather than opening a new one — so a healthy flow can read <code>request_received &rarr; response_sent &rarr; link_click &rarr; component_rendered</code> all under gen 1. If the prefetch's response_sent arrived more than 30s before the click, gen 1 will have already aged into <em>abandoned-early</em> and the click opens a fresh gen 2 with just <code>link_click &rarr; component_rendered</code>.</li>
  <li><em>A <span class="status-rendered-only">rendered-only</span> row appears.</em> The renderer painted but no upstream cause was observed (window restore, React Query cache hit, deep link bypassing the navigation dispatcher). The render itself worked; the journey just isn't observable end-to-end for this view.</li>
  <li><em>A key has many consecutive <code>backend.feed_emitted</code> stamps spaced ~10 seconds apart.</em> This was a real bug: the frontend polls the activity feed on a timer and the daemon re-stamped <code>feed_emitted</code> for every blob on every poll. The emitter now deduplicates so each blob stamps once per process; if you still see it, you're looking at a stale trace from before the dedup landed.</li>
</ul>
</details>

<table>
<colgroup>
  <col class="col-key"><col class="col-gen"><col class="col-last">
  <col class="col-status"><col class="col-total"><col class="col-stages">
</colgroup>
  <tr>
    <th>Key</th>
    <th>Gen</th>
    <th>Last stage</th>
    <th>Status</th>
    <th>Total</th>
    <th>Stages</th>
  </tr>
  {{range .Rows}}
  <tr class="{{if .IsAnomaly}}anomaly {{end}}{{if not .HasFrontend}}backend-only {{end}}{{if .IsGroupHead}}group-head{{else}}group-tail{{end}}">
    {{if .IsGroupHead}}<td rowspan="{{.GroupSize}}" class="key-cell">{{.Key}}</td>{{end}}
    <td class="num">{{.Gen}}</td>
    <td>{{.LastStage}}</td>
    <td class="{{.StatusCSS}}">{{.Status}}</td>
    <td class="num">{{.TotalSpan}}</td>
    <td>
      {{range .Deltas}}
        <span class="stage"><span class="stage-idx">{{.Idx}}.</span> {{.Stage}} <span class="{{.CSS}}">{{.Dur}}</span></span>
      {{end}}
    </td>
  </tr>
  {{end}}
</table>
</body></html>
`
