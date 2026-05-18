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
	Coalesced        int
	Abandoned        int
	AbandonedByStage []summaryBucket
	Rows             []row
}

// gapWarn is the threshold above which a per-stage delta is rendered red.
const gapWarn = 200 * time.Millisecond

// lateStages are checkpoints late enough in the pipeline that an abandonment
// there is suspicious (the data flowed almost all the way but never painted).
var lateStages = map[string]struct{}{
	telemetry.StageRefetchStart:         {},
	telemetry.StageGRPCCallStart:        {},
	telemetry.StageGRPCCallEnd:          {},
	telemetry.StageCacheUpdated:         {},
	telemetry.StageInvalidationReceived: {},
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
			}
		}

		switch tr.Status {
		case telemetry.StatusComplete:
			v.Complete++
			r.StatusCSS = "status-complete"
		case telemetry.StatusCoalesced:
			v.Coalesced++
			r.StatusCSS = "status-coalesced"
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

		v.Rows = append(v.Rows, r)
	}

	for stage, count := range abandonedByStage {
		v.AbandonedByStage = append(v.AbandonedByStage, summaryBucket{Stage: stage, Count: count})
	}
	sort.Slice(v.AbandonedByStage, func(i, j int) bool {
		return v.AbandonedByStage[i].Count > v.AbandonedByStage[j].Count
	})

	sort.Slice(v.Rows, func(i, j int) bool {
		if v.Rows[i].Key == v.Rows[j].Key {
			return v.Rows[i].Gen < v.Rows[j].Gen
		}
		return v.Rows[i].Key < v.Rows[j].Key
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
body{font-family:sans-serif;margin:1em}
table{border-collapse:collapse;font-size:12px}
th,td{padding:3px 8px;border:1px solid #ccc;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;vertical-align:top}
th{background:#f4f4f4;text-align:left}
td.num{text-align:right}
td.warn{background:#fde2e2}
tr.anomaly td:first-child{border-left:3px solid #d9534f}
.status-complete{color:#2e7d32;font-weight:bold}
.status-coalesced{color:#1565c0;font-weight:bold}
.status-abandoned-late{color:#c62828;font-weight:bold}
.status-abandoned-early{color:#777}
.status-live{color:#000;font-style:italic}
.summary{padding:8px 12px;background:#f4f4f4;border:1px solid #ccc;margin-bottom:12px;font-size:13px}
.stage{display:block;color:#555;font-size:11px}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#eee;padding:0 3px}
p.hint{color:#555;font-size:12px}
</style></head><body>
<h2>Blob-to-render journeys</h2>
<div class="summary">
  Generated {{.GeneratedAt}} · <strong>{{.Total}}</strong> retained traces ·
  <span class="status-complete">{{.Complete}} complete</span> ·
  <span class="status-coalesced">{{.Coalesced}} coalesced</span> ·
  <span class="status-abandoned-late">{{.Abandoned}} abandoned</span>{{summary .AbandonedByStage}}
</div>
<p class="hint">Each row is one generation of a URL's journey. Multiple rows per key indicate retries. Per-stage cells show the delta from the previous stage; red cells exceed 200ms.</p>
<table>
  <tr>
    <th>Key</th>
    <th>Gen</th>
    <th>Last stage</th>
    <th>Status</th>
    <th>Total</th>
    <th>Stages</th>
  </tr>
  {{range .Rows}}
  <tr {{if .IsAnomaly}}class="anomaly"{{end}}>
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
