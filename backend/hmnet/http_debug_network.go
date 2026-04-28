package hmnet

import (
	"context"
	"fmt"
	"html/template"
	"math"
	"net/http"
	"sort"
	"time"

	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

// NetworkDebugHandler returns an interactive HTML report of per-phase
// sync/discovery latency, peer-table state, and reachability — modeled on
// /debug/traces. Latency cells are color-coded against fixed thresholds
// (p50>100ms, p95>1s, p99>5s warn).
func (n *Node) NetworkDebugHandler() http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")

		page := n.buildPage(r.Context())

		if err := pageTpl.Execute(w, page); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
		}
	})
}

// --- page data model --------------------------------------------------------

type networkPage struct {
	GeneratedAt  string
	Uptime       string
	PeerID       string
	ProtocolID   string
	HowToRead    template.HTML
	Sections     []section
	Reachability reachSection
}

type section struct {
	Title    string
	Subtitle string
	Note     string
	// Help is HTML rendered inside a collapsible <details> block beneath the
	// table. Use it for short row-by-row explanations so newcomers can
	// orient themselves without leaving the page.
	Help template.HTML
	// Each section renders one of:
	//   Latency: per-row p50/p95/p99 + count
	//   Counter: per-row label + count
	//   Bucket:  per-row "<= X" + count
	Latency *latencyTable
	Counter *counterTable
	Bucket  *bucketTable
}

// withHelp attaches a Help HTML blob to a section produced by one of the
// build* helpers. Lets buildPage stay declarative: each section is one line
// "build the table, attach the explanation."
func withHelp(s section, h template.HTML) section {
	s.Help = h
	return s
}

type latencyTable struct {
	LabelHeader string // e.g. "phase" or "outcome"
	N           uint64
	Rows        []latencyRow
}

type latencyRow struct {
	Label string
	HasData bool
	P50   string
	P95   string
	P99   string
	Count uint64
	// Severity classes computed at build time so the template stays simple.
	P50Class string
	P95Class string
	P99Class string
}

type counterTable struct {
	LabelHeader string
	Rows        []counterRow
	Total       uint64
}

type counterRow struct {
	Label string
	Count uint64
	Class string // optional severity (e.g. high idle_timeout share)
}

type bucketTable struct {
	N    uint64
	Mean string // pre-formatted mean (with unit)
	Rows []bucketRow
	UpperLabel string // e.g. "<= ratio" or "<= blobs"
}

type bucketRow struct {
	UpperBound string
	Count      uint64
}

type reachSection struct {
	Total      int
	Rows       []reachRow
	OverflowN  int
}

type reachRow struct {
	PID   string
	State string
	Class string // green for Connected, gray for NotConnected
}

// --- thresholds for severity highlighting ----------------------------------

const (
	warnP50 = 100 * time.Millisecond
	warnP95 = 1 * time.Second
	warnP99 = 5 * time.Second
)

// --- page builder -----------------------------------------------------------

func (n *Node) buildPage(ctx context.Context) networkPage {
	page := networkPage{
		GeneratedAt: time.Now().Format("15:04:05"),
		PeerID:      n.p2p.Host.ID().String(),
		ProtocolID:  string(n.protocol.ID),
		HowToRead:   helpHowToRead,
	}
	if !n.startedAt.IsZero() {
		page.Uptime = time.Since(n.startedAt).Truncate(time.Second).String()
	} else {
		page.Uptime = "—"
	}

	page.Sections = []section{
		withHelp(buildLatencySection(
			"Discovery latency",
			"time spent in each phase of one Subscribe / DiscoverObject call",
			"phase",
			"seed_discover_phase_seconds",
			[]string{"peer_select", "connected_sync", "dht_discover", "dht_sync"},
		), helpDiscoveryPhases),
		withHelp(buildLatencySection(
			"Discovery end-to-end",
			"total Subscribe wall-clock, grouped by how it ended",
			"outcome",
			"seed_discover_total_seconds",
			[]string{"connected", "dht", "notfound", "error"},
		), helpDiscoveryOutcomes),
		withHelp(buildLatencySection(
			"Sync-with-peer latency",
			"for each peer in a sync, time per phase (multiple peers run in parallel)",
			"phase",
			"seed_syncpeer_phase_seconds",
			[]string{"dial", "reconcile_rpc", "bitswap_fetch", "putmany"},
		), helpSyncPeerPhases),
		withHelp(buildBitswapOutcomesSection(), helpBitswapOutcomes),
		withHelp(buildLatencySection(
			"Bitswap fetch wall-clock by outcome",
			"same per-call timing as bitswap_fetch above, split by why the loop ended",
			"outcome",
			"seed_syncpeer_bitswap_seconds",
			[]string{"complete", "idle_timeout", "ctx_done"},
		), helpBitswapByOutcome),
		withHelp(buildLatencySection(
			"Bitswap last-block-age at loop exit",
			"time between the final block we received and the loop exit",
			"outcome",
			"seed_syncpeer_bitswap_last_block_age_seconds",
			[]string{"complete", "idle_timeout", "ctx_done"},
		), helpBitswapLastBlockAge),
		withHelp(buildBitswapCompletenessSection(), helpBitswapCompleteness),
		withHelp(buildLatencySection(
			"Reconcile server sub-phase",
			"when other peers call OUR ReconcileBlobs, what we spend time on (proxy for what gateways spend when WE call them)",
			"phase",
			"seed_reconcile_server_phase_seconds",
			[]string{"auth_resolve", "load_store", "rbsr_session", "rbsr_reconcile"},
		), helpReconcileServerPhases),
		withHelp(buildReconcileServerTotalSection(), helpReconcileServerTotal),
		withHelp(buildBucketSection(
			"Reconcile server: store size per request",
			"how many blobs the RBSR set ends up holding per inbound request",
			"<= blobs",
			"seed_reconcile_server_store_size",
			"%.0f",
		), helpReconcileServerStoreSize),
		withHelp(buildLatencySection(
			"Reconcile client by connection reuse",
			"per-round timing of OUR outbound ReconcileBlobs, split by whether we reused an existing gRPC connection to this peer",
			"call",
			"seed_reconcile_client_round_seconds",
			[]string{"new_conn", "reused_conn"},
		), helpReconcileClientConnReuse),
		withHelp(buildSyncOutcomesSection(), helpSyncOutcomes),
	}

	page.Reachability = n.buildReachability()
	return page
}

func buildLatencySection(title, subtitle, header, family string, rowLabels []string) section {
	stats, total, ok := collectHistogramStats(family)
	tbl := &latencyTable{LabelHeader: header, N: total}
	if !ok {
		return section{Title: title, Subtitle: subtitle, Note: "no observations yet", Latency: tbl}
	}
	for _, lbl := range rowLabels {
		s, found := stats[lbl]
		if !found || s.count == 0 {
			tbl.Rows = append(tbl.Rows, latencyRow{Label: lbl, HasData: false})
			continue
		}
		row := latencyRow{
			Label:   lbl,
			HasData: true,
			P50:     formatDuration(s.percentile(0.50)),
			P95:     formatDuration(s.percentile(0.95)),
			P99:     formatDuration(s.percentile(0.99)),
			Count:   s.count,
		}
		row.P50Class = warnClass(asDur(s.percentile(0.50)) > warnP50)
		row.P95Class = warnClass(asDur(s.percentile(0.95)) > warnP95)
		row.P99Class = warnClass(asDur(s.percentile(0.99)) > warnP99)
		tbl.Rows = append(tbl.Rows, row)
	}
	return section{Title: title, Subtitle: subtitle, Latency: tbl}
}

func buildBitswapOutcomesSection() section {
	counts, ok := collectCounterVec("seed_syncpeer_bitswap_outcome_total")
	tbl := &counterTable{LabelHeader: "outcome"}
	if !ok || len(counts) == 0 {
		return section{Title: "Bitswap fetch outcome counts", Note: "no fetches yet", Counter: tbl}
	}
	var total uint64
	for _, lbl := range []string{"complete", "idle_timeout", "ctx_done"} {
		v := uint64(counts[lbl])
		total += v
	}
	for _, lbl := range []string{"complete", "idle_timeout", "ctx_done"} {
		c := uint64(counts[lbl])
		row := counterRow{Label: lbl, Count: c}
		// Highlight idle_timeout if it's >20% of total — that means the timer is firing on a meaningful share.
		if lbl == "idle_timeout" && total > 0 && float64(c)/float64(total) > 0.2 {
			row.Class = "warn"
		}
		tbl.Rows = append(tbl.Rows, row)
	}
	tbl.Total = total
	return section{
		Title:    "Bitswap fetch outcome counts",
		Subtitle: "termination reason for each download loop",
		Counter:  tbl,
	}
}

func buildBitswapCompletenessSection() section {
	mf, _ := findMetricFamily("seed_syncpeer_bitswap_completeness_ratio")
	if mf == nil || len(mf.Metric) == 0 || mf.Metric[0].Histogram == nil {
		return section{Title: "Bitswap completeness ratio", Note: "no fetches yet"}
	}
	h := mf.Metric[0].Histogram
	total := h.GetSampleCount()
	if total == 0 {
		return section{Title: "Bitswap completeness ratio", Note: "no fetches yet"}
	}
	tbl := &bucketTable{
		N:          total,
		Mean:       formatRatio(h.GetSampleSum() / float64(total)),
		UpperLabel: "<= ratio",
	}
	var prev uint64
	for _, b := range h.GetBucket() {
		cum := b.GetCumulativeCount()
		tbl.Rows = append(tbl.Rows, bucketRow{
			UpperBound: formatRatio(b.GetUpperBound()),
			Count:      cum - prev,
		})
		prev = cum
	}
	if overflow := total - prev; overflow > 0 {
		tbl.Rows = append(tbl.Rows, bucketRow{UpperBound: "> 1.0", Count: overflow})
	}
	return section{
		Title:    "Bitswap completeness ratio",
		Subtitle: "downloaded / wanted per fetch — 1.00 means we got every blob asked",
		Bucket:   tbl,
	}
}

func buildReconcileServerTotalSection() section {
	mf, _ := findMetricFamily("seed_reconcile_server_total_seconds")
	if mf == nil || len(mf.Metric) == 0 || mf.Metric[0].Histogram == nil {
		return section{Title: "Reconcile server: total handler", Note: "no inbound requests yet"}
	}
	h := mf.Metric[0].Histogram
	if h.GetSampleCount() == 0 {
		return section{Title: "Reconcile server: total handler", Note: "no inbound requests yet"}
	}
	s := &histStats{count: h.GetSampleCount(), sum: h.GetSampleSum(), buckets: h.GetBucket()}
	tbl := &latencyTable{LabelHeader: "row", N: s.count, Rows: []latencyRow{{
		Label:    "TOTAL",
		HasData:  true,
		P50:      formatDuration(s.percentile(0.50)),
		P95:      formatDuration(s.percentile(0.95)),
		P99:      formatDuration(s.percentile(0.99)),
		Count:    s.count,
		P50Class: warnClass(asDur(s.percentile(0.50)) > warnP50),
		P95Class: warnClass(asDur(s.percentile(0.95)) > warnP95),
		P99Class: warnClass(asDur(s.percentile(0.99)) > warnP99),
	}}}
	return section{
		Title:    "Reconcile server: total handler",
		Subtitle: "directly comparable to client-side reconcile_rpc",
		Latency:  tbl,
	}
}

func buildBucketSection(title, subtitle, upperLabel, family, fmtSpec string) section {
	mf, _ := findMetricFamily(family)
	if mf == nil || len(mf.Metric) == 0 || mf.Metric[0].Histogram == nil {
		return section{Title: title, Subtitle: subtitle, Note: "no observations yet"}
	}
	h := mf.Metric[0].Histogram
	total := h.GetSampleCount()
	if total == 0 {
		return section{Title: title, Subtitle: subtitle, Note: "no observations yet"}
	}
	mean := fmt.Sprintf(fmtSpec, h.GetSampleSum()/float64(total))
	tbl := &bucketTable{N: total, Mean: mean, UpperLabel: upperLabel}
	var prev uint64
	for _, b := range h.GetBucket() {
		cum := b.GetCumulativeCount()
		if cum-prev == 0 {
			prev = cum
			continue
		}
		tbl.Rows = append(tbl.Rows, bucketRow{
			UpperBound: fmt.Sprintf(fmtSpec, b.GetUpperBound()),
			Count:      cum - prev,
		})
		prev = cum
	}
	if overflow := total - prev; overflow > 0 {
		tbl.Rows = append(tbl.Rows, bucketRow{UpperBound: "+inf", Count: overflow})
	}
	return section{Title: title, Subtitle: subtitle, Bucket: tbl}
}

func buildSyncOutcomesSection() section {
	counts, ok := collectCounterVec("seed_sync_outcome_total")
	tbl := &counterTable{LabelHeader: "outcome"}
	if !ok || len(counts) == 0 {
		return section{Title: "Sync-with-peer outcomes", Note: "no observations yet", Counter: tbl}
	}
	labels := []string{"ok", "protocol_mismatch", "dial_failed", "rpc_error", "preempted", "putmany_failed"}
	var total uint64
	for _, lbl := range labels {
		total += uint64(counts[lbl])
	}
	for _, lbl := range labels {
		c := uint64(counts[lbl])
		row := counterRow{Label: lbl, Count: c}
		// Highlight any non-trivial error class.
		if lbl != "ok" && c > 0 && total > 0 && float64(c)/float64(total) > 0.05 {
			row.Class = "warn"
		}
		tbl.Rows = append(tbl.Rows, row)
	}
	tbl.Total = total
	return section{
		Title:    "Sync-with-peer outcomes",
		Subtitle: "cumulative count per syncWithPeer call",
		Counter:  tbl,
	}
}

func (n *Node) buildReachability() reachSection {
	peers := n.p2p.Peerstore().Peers()
	out := reachSection{Total: len(peers)}
	if len(peers) == 0 {
		return out
	}
	type entry struct {
		pid   peer.ID
		state string
	}
	rows := make([]entry, 0, len(peers))
	net := n.p2p.Network()
	self := n.p2p.Host.ID()
	for _, pid := range peers {
		if pid == self {
			continue
		}
		rows = append(rows, entry{pid: pid, state: net.Connectedness(pid).String()})
	}
	sort.Slice(rows, func(i, j int) bool {
		if rows[i].state != rows[j].state {
			if rows[i].state == network.Connected.String() {
				return true
			}
			if rows[j].state == network.Connected.String() {
				return false
			}
		}
		return rows[i].pid < rows[j].pid
	})

	const limit = 30
	end := limit
	if len(rows) < end {
		end = len(rows)
	}
	for _, r := range rows[:end] {
		cls := "muted"
		if r.state == network.Connected.String() {
			cls = "ok"
		}
		out.Rows = append(out.Rows, reachRow{PID: r.pid.String(), State: r.state, Class: cls})
	}
	if len(rows) > end {
		out.OverflowN = len(rows) - end
	}
	return out
}

// --- Prometheus gathering helpers (unchanged from earlier rounds) ----------

type histStats struct {
	count   uint64
	sum     float64
	buckets []*dto.Bucket
}

func (h *histStats) percentile(p float64) float64 {
	if h.count == 0 {
		return -1
	}
	target := float64(h.count) * p
	var prevUpper, prevCount float64
	for _, b := range h.buckets {
		upper := b.GetUpperBound()
		cum := float64(b.GetCumulativeCount())
		if cum >= target {
			// +Inf bucket has no finite upper bound to interpolate to;
			// fall back to the previous bucket's upper bound.
			if math.IsInf(upper, +1) {
				if prevUpper > 0 {
					return prevUpper
				}
				return -1
			}
			// Empty bucket (no observations between prev and this) —
			// nothing to interpolate; return the bucket's upper bound.
			if cum <= prevCount {
				return upper
			}
			frac := (target - prevCount) / (cum - prevCount)
			return prevUpper + frac*(upper-prevUpper)
		}
		prevUpper = upper
		prevCount = cum
	}
	if len(h.buckets) > 0 {
		return h.buckets[len(h.buckets)-1].GetUpperBound()
	}
	return -1
}

func collectHistogramStats(name string) (stats map[string]*histStats, totalObs uint64, ok bool) {
	stats = make(map[string]*histStats)
	mfs, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		return nil, 0, false
	}
	for _, mf := range mfs {
		if mf.GetName() != name {
			continue
		}
		for _, m := range mf.GetMetric() {
			if m.Histogram == nil {
				continue
			}
			var key string
			for _, l := range m.GetLabel() {
				key = l.GetValue()
			}
			h := &histStats{
				count:   m.Histogram.GetSampleCount(),
				sum:     m.Histogram.GetSampleSum(),
				buckets: m.Histogram.GetBucket(),
			}
			stats[key] = h
			totalObs += h.count
		}
		ok = true
		break
	}
	return stats, totalObs, ok
}

func collectCounterVec(name string) (map[string]float64, bool) {
	out := make(map[string]float64)
	mfs, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		return nil, false
	}
	for _, mf := range mfs {
		if mf.GetName() != name {
			continue
		}
		for _, m := range mf.GetMetric() {
			if m.Counter == nil {
				continue
			}
			var key string
			for _, l := range m.GetLabel() {
				key = l.GetValue()
			}
			out[key] = m.Counter.GetValue()
		}
		return out, true
	}
	return out, false
}

func findMetricFamily(name string) (*dto.MetricFamily, error) {
	mfs, err := prometheus.DefaultGatherer.Gather()
	if err != nil {
		return nil, err
	}
	for _, mf := range mfs {
		if mf.GetName() == name {
			return mf, nil
		}
	}
	return nil, nil
}

// --- formatting --------------------------------------------------------------

func formatDuration(sec float64) string {
	if sec < 0 {
		return "—"
	}
	d := time.Duration(sec * float64(time.Second))
	switch {
	case d < time.Millisecond:
		return fmt.Sprintf("%dµs", d.Microseconds())
	case d < time.Second:
		return fmt.Sprintf("%dms", d.Milliseconds())
	case d < time.Minute:
		return fmt.Sprintf("%.2fs", d.Seconds())
	default:
		return d.Truncate(100 * time.Millisecond).String()
	}
}

func formatRatio(r float64) string {
	return fmt.Sprintf("%.2f", r)
}

func asDur(sec float64) time.Duration {
	if sec < 0 {
		return 0
	}
	return time.Duration(sec * float64(time.Second))
}

func warnClass(warn bool) string {
	if warn {
		return "num warn"
	}
	return "num"
}

// --- inline help content -----------------------------------------------------
// Short row-by-row explanations rendered inside a collapsible <details> block
// under each section. Aimed at someone seeing the page for the first time —
// dense enough to scan, opinionated about what's healthy.

const helpDiscoveryPhases template.HTML = `
<dl>
<dt>peer_select</dt><dd>One DB query — which peers do we ask? Should be milliseconds.</dd>
<dt>connected_sync</dt><dd>Reconcile + download from already-connected peers in parallel. Waits for ALL of them. This is what dominates the user-visible "click → content" delay.</dd>
<dt>dht_discover</dt><dd>Only fires if connected_sync didn't find content. Asks the Kademlia DHT for providers of the requested CID.</dd>
<dt>dht_sync</dt><dd>If DHT returned providers, reconcile + download from them. Often empty in healthy operation.</dd>
</dl>`

const helpDiscoveryOutcomes template.HTML = `
<dl>
<dt>connected</dt><dd>Content was found via an already-connected peer. The fast happy path.</dd>
<dt>dht</dt><dd>Already-connected peers didn't have it; DHT discovery + sync succeeded.</dd>
<dt>notfound</dt><dd>Nothing found anywhere. User sees a stuck spinner or "not found."</dd>
<dt>error</dt><dd>Discovery aborted with an error.</dd>
</dl>`

const helpSyncPeerPhases template.HTML = `
<p>For each individual peer in a sync, four phases run in order:</p>
<dl>
<dt>dial</dt><dd>Open the gRPC-over-libp2p stream and run the protocol-version check. Fast on warm peers.</dd>
<dt>reconcile_rpc</dt><dd><strong>Per-round</strong> timing of the RBSR set-reconciliation RPC. A single sync can run several rounds. This is observed once per round, not once per sync.</dd>
<dt>bitswap_fetch</dt><dd>After RBSR identifies which blobs we want, the bitswap engine pulls them from any connected peer.</dd>
<dt>putmany</dt><dd>Bulk-insert the downloaded blobs into our local SQLite.</dd>
</dl>`

const helpBitswapOutcomes template.HTML = `
<p>How each bitswap download loop terminated. One increment per fetch.</p>
<dl>
<dt>complete</dt><dd>Channel closed naturally — bitswap delivered everything we asked for. The good outcome.</dd>
<dt>idle_timeout</dt><dd>40s passed with no new block arriving, so we gave up. Highlighted red if &gt;20% of fetches hit this.</dd>
<dt>ctx_done</dt><dd>Context was canceled mid-flight (caller went away). Should be near zero.</dd>
</dl>`

const helpBitswapByOutcome template.HTML = `
<p>Same per-call timing as the bitswap_fetch row above, but split by termination reason. Watch the <code>complete</code> row's p95/p99 — that's "real fetches, how long do they take" without the timeout cases skewing the picture. The <code>idle_timeout</code> row is always ≥40s by construction.</p>`

const helpBitswapLastBlockAge template.HTML = `
<p>For each fetch: time between the LAST block received and the moment the download loop exited. Tells us what each outcome actually means in practice.</p>
<dl>
<dt>complete</dt><dd>Near zero is healthy — bitswap closed the channel right after the last useful block. Larger values mean the channel lingered after delivery (wasted wait).</dd>
<dt>idle_timeout</dt><dd>Tautologically equals the idle-timer value (~40s).</dd>
<dt>ctx_done</dt><dd>How much time we'd already been idle when cancellation hit.</dd>
</dl>`

const helpBitswapCompleteness template.HTML = `
<p>Per fetch: <code>downloaded ÷ wanted</code>. A row at <code>≤ 1.00</code> with most of the count means we got every blob asked for. Counts in lower buckets mean blobs are missing — either gateways don't have them or bitswap couldn't find them within the idle window. <code>mean=1.00</code> healthy; <code>mean=0.85</code> means we lose ~15% of asked-for blobs on average.</p>`

const helpReconcileServerPhases template.HTML = `
<p>When OTHER peers call our ReconcileBlobs RPC, where does our time go? Same Go code runs on gateways, so this is a structural proxy for what they spend per request.</p>
<dl>
<dt>auth_resolve</dt><dd>Check which spaces the calling peer is authorized for. May trigger an HTTP fetch to a siteURL on cache miss (we just added stale-while-revalidate + persistent cache to mitigate this).</dd>
<dt>load_store</dt><dd>Build the per-filter RBSR set from our local blobs. Recursive CTEs over <code>structural_blobs</code> + <code>blob_links</code>. Scales with corpus size — a heavy gateway will spend a lot here.</dd>
<dt>rbsr_session</dt><dd>Allocate the RBSR session struct. Always trivial.</dd>
<dt>rbsr_reconcile</dt><dd>The actual set-reconciliation algorithm: fingerprint the set, compute the diff. O(n) over store size.</dd>
</dl>`

const helpReconcileServerTotal template.HTML = `
<p>Whole-handler wall-clock for inbound ReconcileBlobs requests. Compare directly against the client-side <code>reconcile_rpc</code> row higher up. If client p99 ≫ server p99, the gap is in the network/stream layer between us, not on either CPU.</p>`

const helpReconcileServerStoreSize template.HTML = `
<p>How many blobs the RBSR set ends up holding for one inbound request. Bigger store → more compute everywhere. A mean around 1-10 means most filters are tight; spikes into 1000+ mean a recursive filter pulled in a heavy account.</p>`

const helpReconcileClientConnReuse template.HTML = `
<p>Per-round timing of our outbound ReconcileBlobs calls, split by whether the gRPC conn map already had a live connection to that peer at the start of the round.</p>
<dl>
<dt>new_conn</dt><dd>First RPC to this peer in this process — we paid the libp2p stream open + gRPC HTTP/2 setup cost before the request.</dd>
<dt>reused_conn</dt><dd>An existing gRPC ClientConn to this peer was already in <code>hmnet.Client.conns</code>, so this round skipped the dial and went straight to the request.</dd>
</dl>
<p>If <code>new_conn</code> p99 is dramatically higher than <code>reused_conn</code> p99, dial cost is the bottleneck. If they're comparable, time is being spent on the gateway side, not the wire.</p>`

const helpSyncOutcomes template.HTML = `
<p>Cumulative counter for how each sync-with-peer call ended.</p>
<dl>
<dt>ok</dt><dd>Success.</dd>
<dt>protocol_mismatch</dt><dd>Peer doesn't speak our Hypermedia protocol version. Expected on the public swarm; fast-fails at dial.</dd>
<dt>dial_failed</dt><dd>Couldn't establish a gRPC connection.</dd>
<dt>rpc_error</dt><dd>ReconcileBlobs returned an error.</dd>
<dt>preempted</dt><dd>Context was canceled mid-flight (e.g. scheduler killed the task).</dd>
<dt>putmany_failed</dt><dd>Couldn't write downloaded blobs to SQLite.</dd>
</dl>
<p>Highlighted red if any non-<code>ok</code> row is &gt;5% of total. <code>protocol_mismatch</code> volume is fine; the others should be near zero.</p>`

const helpHowToRead template.HTML = `
<p>This page is a live snapshot of how syncing is performing on this daemon.</p>
<ul>
<li><strong>Latency tables</strong> show p50/p95/p99 percentiles. Cells turn red when crossing fixed thresholds (p50&nbsp;&gt;&nbsp;100ms, p95&nbsp;&gt;&nbsp;1s, p99&nbsp;&gt;&nbsp;5s).</li>
<li><strong>Counter tables</strong> show cumulative counts since the daemon started. Some rows highlight red when they're a meaningful share of the total.</li>
<li><strong>Bucket tables</strong> show distributions — store size, completeness ratio, etc.</li>
<li>All percentile values are <em>lifetime</em> (since this daemon's last restart), not rolling.</li>
<li>Click any "<em>What does this mean?</em>" toggle below a section for row-by-row explanations.</li>
</ul>
<p>The two tails worth watching most:</p>
<ul>
<li><code>connected_sync</code> p99 in <strong>Discovery latency</strong> — what the user feels when clicking a document.</li>
<li><code>bitswap_fetch</code> in <strong>Sync-with-peer latency</strong> — usually the dominant wall-clock per peer.</li>
</ul>`

// --- HTML template -----------------------------------------------------------

var pageTpl = template.Must(template.New("network").Funcs(template.FuncMap{
	"hasContent": func(s section) bool {
		return s.Latency != nil || s.Counter != nil || s.Bucket != nil
	},
}).Parse(`<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<title>seed network health</title>
<style>
body{font-family:sans-serif;margin:1em;color:#222;max-width:900px}
h1{font-size:18px;margin:0 0 6px 0}
h2{font-size:15px;margin:1.4em 0 4px 0}
.meta{color:#555;font-size:13px;margin-bottom:1em}
.subtitle{color:#666;font-size:12px;margin:0 0 6px 0}
.note{color:#999;font-size:12px;font-style:italic;margin:4px 0}
table{border-collapse:collapse;margin-bottom:0.4em}
th,td{padding:4px 10px;border:1px solid #ccc;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
th{background:#f4f4f4;text-align:left;font-weight:600}
td.num{text-align:right}
td.warn{background:#fde2e2}
tr:hover td{background:#fafafa}
tr:hover td.warn{background:#f9cccc}
.kv td:first-child{color:#555}
.kv td.note{color:#999;font-style:italic;font-size:12px}
.reach td.ok{color:#0a7c2f}
.reach td.muted{color:#999}
.controls{font-size:12px;color:#777;margin-bottom:6px}
.controls a{color:#0a58ca;text-decoration:none}
.controls a:hover{text-decoration:underline}
details.help{margin:4px 0 1em 0;color:#444;font-size:12.5px;max-width:820px}
details.help>summary{cursor:pointer;color:#0a58ca;font-weight:500;list-style:revert;display:list-item;padding:2px 0}
details.help>summary:hover{text-decoration:underline}
details.help dl{margin:6px 0 6px 6px}
details.help dt{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-weight:600;margin-top:4px;color:#222}
details.help dd{margin:1px 0 4px 16px}
details.help code{font-size:12px;background:#f4f4f4;padding:1px 4px;border-radius:3px}
details.help p{margin:6px 0}
details.help ul{margin:6px 0 6px 18px;padding:0}
details.help li{margin:2px 0}
details.howto{background:#f7faff;border:1px solid #d6e4ff;border-radius:4px;padding:8px 12px;margin:0 0 16px 0}
details.howto>summary{color:#0a58ca;font-weight:600}
</style></head><body>
<h1>Seed daemon network health</h1>
<div class="meta">
  uptime <strong>{{.Uptime}}</strong>
  · peer_id <code>{{.PeerID}}</code>
  · protocol <code>{{.ProtocolID}}</code>
  · generated {{.GeneratedAt}}
</div>
<div class="controls">
  red cells: p50&nbsp;&gt;&nbsp;100ms, p95&nbsp;&gt;&nbsp;1s, p99&nbsp;&gt;&nbsp;5s · counter rows highlight when error/timeout share &gt;&nbsp;5–20%
</div>

<details class="howto">
<summary>How to read this page</summary>
{{.HowToRead}}
</details>

{{range .Sections}}
<h2>{{.Title}}</h2>
{{if .Subtitle}}<div class="subtitle">{{.Subtitle}}</div>{{end}}
{{if .Note}}<div class="note">{{.Note}}</div>{{end}}

{{if .Latency}}
{{with .Latency}}
<table>
<tr><th>{{.LabelHeader}}</th><th>p50</th><th>p95</th><th>p99</th><th>count</th></tr>
{{range .Rows}}
<tr>
<td>{{.Label}}</td>
{{if .HasData}}
<td class="{{.P50Class}}">{{.P50}}</td>
<td class="{{.P95Class}}">{{.P95}}</td>
<td class="{{.P99Class}}">{{.P99}}</td>
<td class="num">{{.Count}}</td>
{{else}}
<td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">0</td>
{{end}}
</tr>
{{end}}
{{if .N}}<tr><td colspan="4" style="font-size:12px;color:#777">total observations: {{.N}}</td></tr>{{end}}
</table>
{{end}}
{{end}}

{{if .Counter}}
{{with .Counter}}
<table>
<tr><th>{{.LabelHeader}}</th><th>count</th></tr>
{{range .Rows}}
<tr><td>{{.Label}}</td><td class="num {{.Class}}">{{.Count}}</td></tr>
{{end}}
{{if .Total}}<tr><td colspan="2" style="font-size:12px;color:#777">total: {{.Total}}</td></tr>{{end}}
</table>
{{end}}
{{end}}

{{if .Bucket}}
{{with .Bucket}}
<table>
<tr><th>{{.UpperLabel}}</th><th>count</th></tr>
{{range .Rows}}
<tr><td>{{.UpperBound}}</td><td class="num">{{.Count}}</td></tr>
{{end}}
<tr><td colspan="2" style="font-size:12px;color:#777">n={{.N}} · mean={{.Mean}}</td></tr>
</table>
{{end}}
{{end}}

{{if .Help}}
<details class="help">
<summary>What does this mean?</summary>
{{.Help}}
</details>
{{end}}
{{end}}

<h2>Reachability snapshot</h2>
<div class="subtitle">peerstore peers, connected first; showing top {{len .Reachability.Rows}} of {{.Reachability.Total}}</div>
<table class="reach">
<tr><th>peer ID</th><th>state</th></tr>
{{range .Reachability.Rows}}
<tr><td><code>{{.PID}}</code></td><td class="{{.Class}}">{{.State}}</td></tr>
{{end}}
{{if .Reachability.OverflowN}}<tr><td colspan="2" style="color:#999;font-size:12px">… {{.Reachability.OverflowN}} more</td></tr>{{end}}
</table>

</body></html>
`))
