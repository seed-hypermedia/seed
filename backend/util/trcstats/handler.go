// Package trcstats augments the trc debug page with p10/p50/p90/p99 columns
// computed over all currently retained traces in eztrc's collector.
package trcstats

import (
	"fmt"
	"html/template"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"

	"github.com/peterbourgon/trc"
	"github.com/peterbourgon/trc/eztrc"
)

// Handler returns an http.Handler that renders a summary page showing
// percentile latencies per trace category. Any request carrying a drill-down
// query param or requesting JSON is delegated to next, which should be the
// original eztrc.Handler().
func Handler(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if shouldDelegate(r) {
			next.ServeHTTP(w, r)
			return
		}

		resp, err := eztrc.Collector().Search(r.Context(), &trc.SearchRequest{
			Limit: math.MaxInt32,
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		render(w, compute(resp))
	})
}

var drilldownKeys = []string{"category", "min", "active", "errored", "id", "q", "source", "b", "limit", "n", "regexp", "stack"}

func shouldDelegate(r *http.Request) bool {
	if strings.Contains(r.Header.Get("Accept"), "application/json") {
		return true
	}
	q := r.URL.Query()
	for _, k := range drilldownKeys {
		if q.Has(k) {
			return true
		}
	}
	return false
}

// Thresholds above which percentile cells are rendered in red.
const (
	warnP50 = 100 * time.Millisecond
	warnP90 = 200 * time.Millisecond
	warnP99 = 500 * time.Millisecond
)

type row struct {
	Category string
	Count    int
	P10      time.Duration
	P50      time.Duration
	P90      time.Duration
	P99      time.Duration
}

func (r row) Href() string          { return "?category=" + url.QueryEscape(r.Category) }
func (r row) P10Str() string        { return formatDuration(r.P10) }
func (r row) P50Str() string        { return formatDuration(r.P50) }
func (r row) P90Str() string        { return formatDuration(r.P90) }
func (r row) P99Str() string        { return formatDuration(r.P99) }
func (r row) P50Class() string      { return warnClass(r.Count > 0 && r.P50 > warnP50) }
func (r row) P90Class() string      { return warnClass(r.Count > 0 && r.P90 > warnP90) }
func (r row) P99Class() string      { return warnClass(r.Count > 0 && r.P99 > warnP99) }
func warnClass(warn bool) string {
	if warn {
		return "num warn"
	}
	return "num"
}

func compute(resp *trc.SearchResponse) []row {
	// Seed categories from stats so rows line up with the full trc report
	// (even categories whose traces are all active or all errored).
	byCategory := map[string][]time.Duration{}
	for cat := range resp.Stats.Categories {
		byCategory[cat] = nil
	}
	for _, tr := range resp.Traces {
		if !tr.Finished() || tr.Errored() {
			continue
		}
		byCategory[tr.Category()] = append(byCategory[tr.Category()], tr.Duration())
	}

	rows := make([]row, 0, len(byCategory))
	for cat, durs := range byCategory {
		sort.Slice(durs, func(i, j int) bool { return durs[i] < durs[j] })
		rows = append(rows, row{
			Category: cat,
			Count:    len(durs),
			P10:      percentile(durs, 0.10),
			P50:      percentile(durs, 0.50),
			P90:      percentile(durs, 0.90),
			P99:      percentile(durs, 0.99),
		})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Category < rows[j].Category })
	return rows
}

// percentile returns the nearest-rank percentile of a pre-sorted duration slice.
func percentile(sorted []time.Duration, p float64) time.Duration {
	if len(sorted) == 0 {
		return 0
	}
	idx := int(math.Ceil(p*float64(len(sorted)))) - 1
	if idx < 0 {
		idx = 0
	}
	if idx >= len(sorted) {
		idx = len(sorted) - 1
	}
	return sorted[idx]
}

// formatDuration renders d with one decimal place in a human-friendly unit.
func formatDuration(d time.Duration) string {
	switch {
	case d <= 0:
		return "0"
	case d < time.Microsecond:
		return fmt.Sprintf("%.1fns", float64(d))
	case d < time.Millisecond:
		return fmt.Sprintf("%.1fµs", float64(d)/float64(time.Microsecond))
	case d < time.Second:
		return fmt.Sprintf("%.1fms", float64(d)/float64(time.Millisecond))
	default:
		return fmt.Sprintf("%.1fs", d.Seconds())
	}
}

var tpl = template.Must(template.New("trcstats").Parse(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>trc percentiles</title>
<style>
body{font-family:sans-serif;margin:1em}
table{border-collapse:collapse}
th,td{padding:4px 10px;border:1px solid #ccc;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
th{background:#f4f4f4;text-align:left}
td.num{text-align:right}
td.warn{background:#fde2e2}
tr:hover td{background:#fafafa}
tr:hover td.warn{background:#f9cccc}
p.hint{color:#555;font-size:13px}
a{color:#0a58ca;text-decoration:none}
a:hover{text-decoration:underline}
</style></head><body>
<h2>trc per-category percentiles</h2>
<p class="hint">Nearest-rank percentiles over all currently retained, finished, non-errored traces in eztrc's in-memory collector. Red cells exceed: p50&nbsp;&gt;&nbsp;100ms, p90&nbsp;&gt;&nbsp;200ms, p99&nbsp;&gt;&nbsp;500ms. Click a category for the full trc UI.</p>
<table>
  <tr>
    <th>Category</th>
    <th>Count</th>
    <th>p10</th>
    <th>p50</th>
    <th>p90</th>
    <th>p99</th>
  </tr>
  {{range .}}
  <tr>
    <td><a href="{{.Href}}">{{.Category}}</a></td>
    <td class="num">{{.Count}}</td>
    {{if .Count}}
    <td class="num">{{.P10Str}}</td>
    <td class="{{.P50Class}}">{{.P50Str}}</td>
    <td class="{{.P90Class}}">{{.P90Str}}</td>
    <td class="{{.P99Class}}">{{.P99Str}}</td>
    {{else}}
    <td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td>
    {{end}}
  </tr>
  {{end}}
</table>
</body></html>
`))

func render(w http.ResponseWriter, rows []row) {
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_ = tpl.Execute(w, rows)
}
