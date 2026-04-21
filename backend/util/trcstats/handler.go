// Package trcstats augments the trc debug page with p10/p50/p90/p99 columns
// computed over all currently retained traces in eztrc's collector.
package trcstats

import (
	"fmt"
	"html/template"
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

		// Search with a finer bucketing than trc's default so the
		// histogram-derived percentiles have reasonable resolution. Limit is
		// intentionally small — we don't consume resp.Traces, only resp.Stats,
		// and stats are observed over the full ring buffer regardless of Limit.
		resp, err := eztrc.Collector().Search(r.Context(), &trc.SearchRequest{
			Bucketing: fineBucketing,
			Limit:     1,
		})
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		render(w, compute(resp.Stats))
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

// fineBucketing is prepended-with-zero by trc.Normalize; the leading 0 is
// therefore optional but included for clarity.
var fineBucketing = []time.Duration{
	0,
	100 * time.Microsecond,
	500 * time.Microsecond,
	1 * time.Millisecond,
	2 * time.Millisecond,
	5 * time.Millisecond,
	10 * time.Millisecond,
	25 * time.Millisecond,
	50 * time.Millisecond,
	100 * time.Millisecond,
	250 * time.Millisecond,
	500 * time.Millisecond,
	1 * time.Second,
	2 * time.Second,
	5 * time.Second,
	10 * time.Second,
	30 * time.Second,
	60 * time.Second,
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
	// finishedCount is the number of finished, non-errored traces contributing
	// to the percentile estimates. Separate from Count (which also includes
	// active and errored) because percentiles are undefined when there are no
	// finished traces.
	finishedCount int
}

func (r row) Href() string     { return "?category=" + url.QueryEscape(r.Category) }
func (r row) P10Str() string   { return formatDuration(r.P10) }
func (r row) P50Str() string   { return formatDuration(r.P50) }
func (r row) P90Str() string   { return formatDuration(r.P90) }
func (r row) P99Str() string   { return formatDuration(r.P99) }
func (r row) P50Class() string { return warnClass(r.finishedCount > 0 && r.P50 > warnP50) }
func (r row) P90Class() string { return warnClass(r.finishedCount > 0 && r.P90 > warnP90) }
func (r row) P99Class() string { return warnClass(r.finishedCount > 0 && r.P99 > warnP99) }
func (r row) HasFinished() bool { return r.finishedCount > 0 }

func warnClass(warn bool) string {
	if warn {
		return "num warn"
	}
	return "num"
}

func compute(stats *trc.SearchStats) []row {
	if stats == nil {
		return nil
	}

	rows := make([]row, 0, len(stats.Categories))
	for cat, cs := range stats.Categories {
		finished := 0
		if len(cs.BucketCounts) > 0 {
			finished = cs.BucketCounts[0]
		}
		rows = append(rows, row{
			Category:      cat,
			Count:         cs.ActiveCount + finished + cs.ErroredCount,
			finishedCount: finished,
			P10:           histogramQuantile(0.10, stats.Bucketing, cs.BucketCounts),
			P50:           histogramQuantile(0.50, stats.Bucketing, cs.BucketCounts),
			P90:           histogramQuantile(0.90, stats.Bucketing, cs.BucketCounts),
			P99:           histogramQuantile(0.99, stats.Bucketing, cs.BucketCounts),
		})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].Category < rows[j].Category })
	return rows
}

// histogramQuantile estimates the p-quantile of trace durations from trc's
// at-or-above bucket counts, using linear interpolation inside the bucket that
// contains the target rank.
//
// buckets are the lower boundaries, sorted ascending, with buckets[0] == 0.
// counts[i] is the number of samples with duration >= buckets[i], so counts[0]
// is the total sample size. The last bucket (>= buckets[len-1]) has no upper
// bound — if the quantile falls there, we return the lower boundary.
func histogramQuantile(p float64, buckets []time.Duration, counts []int) time.Duration {
	if len(buckets) == 0 || len(counts) == 0 || len(buckets) != len(counts) {
		return 0
	}
	total := counts[0]
	if total == 0 {
		return 0
	}

	// Target rank among samples sorted ascending (1-indexed nearest-rank).
	rank := int(float64(total)*p + 0.5)
	if rank < 1 {
		rank = 1
	}
	if rank > total {
		rank = total
	}
	// We search for the bucket where the cumulative count (samples with
	// duration < bucket upper bound) first reaches rank. Working in the
	// at-or-above representation: samples strictly above buckets[i+1] is
	// counts[i+1]; we want to find i such that counts[i+1] < total-rank+1 and
	// counts[i] >= total-rank+1. Equivalently, find smallest i where
	// counts[i+1] <= total-rank.
	remaining := total - rank // number of samples allowed above the quantile

	for i := 0; i < len(buckets)-1; i++ {
		if counts[i+1] <= remaining {
			// Quantile lies in [buckets[i], buckets[i+1]).
			bucketSamples := counts[i] - counts[i+1]
			if bucketSamples <= 0 {
				return buckets[i]
			}
			// Position within the bucket: how many samples into this bucket
			// (from its low end) is the target rank (1..bucketSamples).
			// Midpoint interpolation: sample k sits at slot center
			// (k-0.5)/bucketSamples — so the result never pins to an exact
			// bucket boundary.
			within := counts[i] - remaining
			frac := (float64(within) - 0.5) / float64(bucketSamples)
			if frac < 0 {
				frac = 0
			}
			span := buckets[i+1] - buckets[i]
			return buckets[i] + time.Duration(float64(span)*frac)
		}
	}
	// Fell off the end — quantile is at or above the highest bucket boundary.
	return buckets[len(buckets)-1]
}

// formatDuration renders d with one decimal place in a human-friendly unit.
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
<p class="hint">Percentiles estimated from trc's in-memory histogram (active + finished + errored retained traces; same set as the native trc summary). Red cells exceed: p50&nbsp;&gt;&nbsp;100ms, p90&nbsp;&gt;&nbsp;200ms, p99&nbsp;&gt;&nbsp;500ms. Click a category for the full trc UI.</p>
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
    {{if .HasFinished}}
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
