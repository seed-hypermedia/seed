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
		_ = tpl.Execute(w, buildView(snap))
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
	// lastUpdate is the timestamp of the latest checkpoint; used as a
	// tiebreaker so the most-recent activity floats to the top.
	lastUpdate time.Time
}

type delta struct {
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
var lateStages = map[string]struct{}{
	telemetry.StageGRPCResponseSent: {},
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
				d := delta{Stage: cp.Stage, CSS: "num"}
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

	// Sort rows so signal-rich entries float to the top:
	//   1. Traces with any main.* or renderer.* checkpoint (frontend feedback)
	//   2. Anomalies (any >200ms inter-stage gap, or abandoned-late)
	//   3. Most recently updated
	//   4. Stable order by key/gen for traces that tie on the above
	sort.SliceStable(v.Rows, func(i, j int) bool {
		a, b := v.Rows[i], v.Rows[j]
		if a.HasFrontend != b.HasFrontend {
			return a.HasFrontend
		}
		if a.IsAnomaly != b.IsAnomaly {
			return a.IsAnomaly
		}
		if !a.lastUpdate.Equal(b.lastUpdate) {
			return a.lastUpdate.After(b.lastUpdate)
		}
		if a.Key != b.Key {
			return a.Key < b.Key
		}
		return a.Gen < b.Gen
	})

	return v
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
tr.anomaly td:first-child{border-left:3px solid #d9534f}
.status-complete{color:#2e7d32;font-weight:bold}
.status-coalesced{color:#1565c0;font-weight:bold}
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
  <span class="status-coalesced">{{.Coalesced}} coalesced</span> ·
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
  <dd>Reached <code>renderer.component_rendered</code> &mdash; the data was painted. Healthy path.</dd>
  <dt><span class="status-abandoned-late">abandoned</span> (red, bold)</dt>
  <dd>30s elapsed without reaching <code>renderer.component_rendered</code>, and the last stage was <code>backend.grpc_response_sent</code>. The daemon answered but the renderer never painted &mdash; investigate.</dd>
  <dt><span class="status-abandoned-early">abandoned</span> (grey)</dt>
  <dd>30s elapsed earlier in the pipeline (e.g. only <code>backend.feed_emitted</code> ever fired, or a click was never followed by a render). Usually benign: the feed surfaced a blob the user never opened, or the user navigated away before the page mounted.</dd>
</dl>

<p><strong>Reading a row:</strong></p>
<ul>
  <li><b>Key</b> &mdash; the URL being tracked (an <code>hm://...</code> URL; optionally version-pinned if the caller specified one).</li>
  <li><b>Gen</b> &mdash; generation number for this key. Bumps to 2+ when the user clicks the same link again before the previous journey settles.</li>
  <li><b>Last stage</b> &mdash; the most recent checkpoint stamped. Helps you spot where the journey is currently parked.</li>
  <li><b>Status</b> &mdash; see legend above.</li>
  <li><b>Total</b> &mdash; wall-clock from first to last checkpoint. Single-checkpoint traces show 0 (nothing earlier to subtract from).</li>
  <li><b>Stages</b> &mdash; ordered list of checkpoints with the <em>delta from the previous stage</em>. A red cell means that hop took &gt;200ms; rows with any red cell are flagged as anomalies (red left border).</li>
</ul>

<p><strong>Stages emitted today.</strong> The proto wire format is a free-form string, but only the stages below have an emitter on this branch. Adding a new stage means wiring the emitter in the same change; we do not declare planned-but-unwired stages.</p>
<ul>
  <li><code>backend.feed_emitted</code> &mdash; <code>activity.ListEvents</code> stamps this for every new-blob event surfaced to the activity feed.</li>
  <li><code>backend.grpc_request_received</code> &mdash; <code>documents.v3.GetDocument</code> and <code>GetAccount</code> stamp this on entry. Other reads (discovery, list-events, comments, changes) do <em>not</em>.</li>
  <li><code>backend.grpc_response_sent</code> &mdash; same two RPCs, stamped on return via <code>defer</code>.</li>
  <li><code>renderer.link_click</code> &mdash; emitted by <code>frontend/apps/desktop/src/utils/navigation-container</code> and <code>useNavigate</code> on every navigation. The <em>only</em> initiating stage: a new click on the same key always opens a new generation, sealing the previous one as abandoned. Key is built from the route's id (typically <em>without</em> a resolved version).</li>
  <li><code>renderer.component_rendered</code> &mdash; emitted by <code>desktop-resource.tsx</code> once after the doc loads. Key is built from the <em>resolved</em> document version (<code>doc.version</code>).</li>
</ul>

<p><strong>Known issue &mdash; key mismatch.</strong> <code>renderer.link_click</code> keys on the route's id (often versionless, e.g. <code>hm://acc/path</code>) while <code>renderer.component_rendered</code> keys on the resolved document version (<code>hm://acc/path?v=bafy...</code>). These are different keys, so a single click&rarr;paint flow currently splits into <em>two</em> single-checkpoint traces and the click-to-paint duration is lost. The fix lives on the frontend side (have <code>desktop-resource.tsx</code> stamp using the route's <code>docId</code> instead of the resolved <code>doc.version</code>), but is intentionally not applied on this branch &mdash; that change is Eric's call.</p>

<p><strong>Row ordering:</strong> signal-rich rows float to the top &mdash; frontend-touched (any <code>renderer.*</code> stage) first, then anomalies (red 200ms+ cell or abandoned-late), then most-recent activity. Pure backend-only rows (the <code>backend.feed_emitted</code> noise from sync) are dimmed grey and sink to the bottom.</p>

<p><strong>Common patterns.</strong> A sea of dimmed live rows ending at <code>backend.feed_emitted</code> is normal during sync &mdash; the daemon surfaces new blobs to the activity feed, but the frontend has enough metadata in the feed event to render the feed card and never needs to call <code>GetDocument</code> for blobs the user doesn't drill into. Those generations time out to <em>abandoned-early</em> after 30s. Real problems are <em>abandoned-late</em> rows (daemon answered, renderer never painted) or red 200ms+ cells inside an otherwise-complete trace.</p>
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
  <tr class="{{if .IsAnomaly}}anomaly {{end}}{{if not .HasFrontend}}backend-only{{end}}">
    <td>{{.Key}}</td>
    <td class="num">{{.Gen}}</td>
    <td>{{.LastStage}}</td>
    <td class="{{.StatusCSS}}">{{.Status}}</td>
    <td class="num">{{.TotalSpan}}</td>
    <td>
      {{range .Deltas}}
        <span class="stage">{{.Stage}} <span class="{{.CSS}}">{{.Dur}}</span></span>
      {{end}}
    </td>
  </tr>
  {{end}}
</table>
</body></html>
`
