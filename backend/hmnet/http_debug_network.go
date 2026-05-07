package hmnet

import (
	"context"
	"fmt"
	"html/template"
	"math"
	"net/http"
	"sort"
	"time"

	"seed/backend/util/bwcounter"

	"github.com/libp2p/go-libp2p/core/network"
	"github.com/libp2p/go-libp2p/core/peer"
	"github.com/prometheus/client_golang/prometheus"
	dto "github.com/prometheus/client_model/go"
)

// NetworkDebugHandler returns an interactive HTML report of per-phase
// sync/discovery latency, peer-table state, and reachability — modeled on
// /debug/traces. Latency cells are color-coded against fixed thresholds
// (p10>50ms, p50>100ms, p90>1s, p99>5s warn).
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
	Bandwidth    bandwidthSection
	Reachability reachSection
}

// bandwidthSection holds all bandwidth-related tables for the page. Each table
// is independent and may be empty if no traffic has been recorded for that
// layer yet. The layout is intentionally a single H2 with multiple sub-tables
// so the user can compare loopback vs remote across libp2p / HTTP server /
// HTTP client without scrolling.
type bandwidthSection struct {
	Help          template.HTML
	Layers        []bwLayerRow
	Protocols     []bwTagRow // libp2p protocol breakdown
	Peers         []bwPeerRow
	HTTPIn        []bwTagRow // inbound HTTP by URL-prefix tag
	HTTPOut       []bwTagRow // outbound HTTP by destination host
	Bitswap       *bitswapDedupRow
	DB            *dbGrowthRow
	SyncDiscard   *syncDiscardRow
	Drift         *indexDriftRow
	CodecMismatch []codecMismatchRow
	Preflight     *preflightRow
}

// preflightRow shows how many CIDs the syncing pre-flight Has filter has
// dropped from RBSR-produced wantlists before bitswap got to fetch them.
// Each skipped CID is one WANT_HAVE → HAVE → WANT_BLOCK → BLOCK round-trip
// AND one block delivery NOT paid for on the wire — the inbound bandwidth
// the filter is actively saving versus letting the request go through and
// dropping at putBlock with the `exists` outcome.
type preflightRow struct {
	Skipped string
	// SkippedClass goes "good" when we're saving real fetches, neutral
	// when nothing has been filtered yet (newly started daemon).
	SkippedClass string
}

// indexDriftRow surfaces the count of blobs present on disk but missing from
// structural_blobs — exactly the rows RBSR's local-set query (collectBlobs in
// discovery.go) cannot see. Non-zero DagCbor here is the smoking gun for
// "RBSR keeps asking for blobs we already have."
type indexDriftRow struct {
	Total      string
	TotalBytes string
	DagCbor    string
	DagPb      string
	Other      string
	Class      string
}

// codecMismatchRow shows the (stored_codec → incoming_codec) pairs whenever
// putBlock takes the `exists` branch. Non-zero rows mean RBSR's CID-keyed set
// diff is asymmetric for the same content because peers ship the same
// multihash under a different codec than we have stored.
type codecMismatchRow struct {
	StoredCodec   string
	IncomingCodec string
	Count         string
}

// dbGrowthRow shows SQLite logical size at startup vs now, with the absolute
// growth and the implied compression-ratio against bitswap-received unique
// bytes. Surfaced so a user can compare on-the-wire downloads against actual
// disk growth in the same session.
type dbGrowthRow struct {
	StartSize    string
	NowSize      string
	Growth       string
	Elapsed      string
	GrowthVsRecv string // e.g. "growth / unique recv = 0.42 (i.e. ~58% of unique blob bytes never reached disk)"
}

// syncDiscardRow now surfaces persist-pipeline health. The original "ctx
// cancelled before persist" path no longer exists post-streaming refactor,
// but we keep the discard counter (should be 0) and add the rollback counter
// for the new failure mode: a streaming PutMany batch that fails inside
// indexBlob (most often a cross-blob ordering dependency).
type syncDiscardRow struct {
	Events            string
	Blocks            string
	RollbackBatches   string
	RollbackBlocks    string
	HasDiscard        bool
	HasRollback       bool
}

// bitswapDedupRow shows how much of the bitswap recv stream is wasted on
// duplicate blocks (the same blob delivered by multiple peers). A high
// duplicate share is the smoking gun for "WANT broadcast to N peers, M
// peers raced to send the block" — it directly explains spikes in libp2p
// remote-in without corresponding new content downloaded.
//
// The Already* fields surface putBlock outcome counters so we can see the
// distinct case "block delivered from the network but blobs row already
// populated" — that means we re-fetched something we already had.
type bitswapDedupRow struct {
	BlocksReceived  string
	DataReceived    string
	DupBlocks       string
	DupData         string
	DupDataPct      string
	DupDataPctClass string
	BlocksSent      string
	DataSent        string
	NewBlocks       string
	NewBytes        string
	UpdateBlocks    string
	UpdateBytes     string
	AlreadyBlocks   string
	AlreadyBytes    string
	AlreadyPct      string
	AlreadyPctClass string
}

type bwLayerRow struct {
	Layer       string
	LoopbackIn  string
	LoopbackOut string
	RemoteIn    string
	RemoteOut   string
	Total       string
}

type bwTagRow struct {
	Scope string // "loopback" or "remote"
	Tag   string
	In    string
	Out   string
}

type bwPeerRow struct {
	PeerID     string
	Scope      string
	In         string
	Out        string
	LastActive string
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
	//   Latency: per-row p10/p50/p90/p99 + count
	//   Counter: per-row label + count
	//   Bucket:  per-row "<= X" + count
	//   KV:      per-row key/value diagnostic values
	Latency *latencyTable
	Counter *counterTable
	Bucket  *bucketTable
	KV      *kvTable
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
	Label   string
	HasData bool
	P10     string
	P50     string
	P90     string
	P99     string
	Count   uint64
	// Severity classes computed at build time so the template stays simple.
	P10Class string
	P50Class string
	P90Class string
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

type kvTable struct {
	Rows []kvRow
}

type kvRow struct {
	Key   string
	Value string
	Class string
}

type bucketTable struct {
	N          uint64
	Mean       string // pre-formatted mean (with unit)
	Rows       []bucketRow
	UpperLabel string // e.g. "<= ratio" or "<= blobs"
}

type bucketRow struct {
	UpperBound string
	Count      uint64
}

type reachSection struct {
	Total     int
	Rows      []reachRow
	OverflowN int
}

type reachRow struct {
	PID   string
	State string
	Class string // green for Connected, gray for NotConnected
}

// --- thresholds for severity highlighting ----------------------------------

const (
	warnP10 = 50 * time.Millisecond
	warnP50 = 100 * time.Millisecond
	warnP90 = 1 * time.Second
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
		withHelp(buildBucketSection(
			"Wantlist size per peer-sync (RBSR diff)",
			"how many blobs RBSR identified as missing from us, per peer. Healthy: clusters near 0. High and stable: RBSR's local-set query is undercounting what we have on disk and we re-fetch every cycle.",
			"<= wants",
			"seed_syncpeer_wanted_blobs",
			"%.0f",
		), helpWantlistSize),
		withHelp(buildLatencySection(
			"Reconcile server sub-phase",
			"when other peers call OUR ReconcileBlobs, what we spend time on (proxy for what gateways spend when WE call them)",
			"phase",
			"seed_reconcile_server_phase_seconds",
			[]string{"auth_resolve", "load_store", "rbsr_session", "rbsr_reconcile"},
		), helpReconcileServerPhases),
		withHelp(buildReconcileServerTotalSection(), helpReconcileServerTotal),
		withHelp(buildReconcileLimiterSection(), helpReconcileLimiter),
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

	page.Bandwidth = n.buildBandwidth(ctx)
	page.Reachability = n.buildReachability()
	return page
}

// buildBandwidth assembles the bandwidth section from the libp2p metrics and
// the two HTTP counters owned by the Node. Numbers are pre-formatted into
// human-readable strings so the template stays simple.
func (n *Node) buildBandwidth(ctx context.Context) bandwidthSection {
	out := bandwidthSection{Help: helpBandwidth}

	var p2p bwcounter.Snapshot
	if n.metrics != nil {
		p2p = n.metrics.BW.Snapshot()
	}
	srv := bwcounter.Snapshot{}
	if n.httpServerBW != nil {
		srv = n.httpServerBW.Snapshot()
	}
	cli := bwcounter.Snapshot{}
	if n.httpClientBW != nil {
		cli = n.httpClientBW.Snapshot()
	}

	out.Layers = []bwLayerRow{
		makeLayerRow("libp2p", p2p),
		makeLayerRow("http server", srv),
		makeLayerRow("http client", cli),
		makeTotalLayerRow(p2p, srv, cli),
	}

	for _, t := range topNTagRows(p2p.Tags, 12) {
		out.Protocols = append(out.Protocols, formatTagRow(t))
	}
	for _, t := range topNTagRows(srv.Tags, 12) {
		out.HTTPIn = append(out.HTTPIn, formatTagRow(t))
	}
	for _, t := range topNTagRows(cli.Tags, 12) {
		out.HTTPOut = append(out.HTTPOut, formatTagRow(t))
	}

	if n.metrics != nil {
		now := time.Now()
		for _, p := range n.metrics.PeerBytesSnapshot(10) {
			scope := "remote"
			if p.Loopback {
				scope = "loopback"
			}
			last := "—"
			if !p.LastActive.IsZero() {
				last = humanAgo(now.Sub(p.LastActive))
			}
			out.Peers = append(out.Peers, bwPeerRow{
				PeerID:     p.PeerID.String(),
				Scope:      scope,
				In:         humanBytes(p.In),
				Out:        humanBytes(p.Out),
				LastActive: last,
			})
		}
	}

	var bitswapUniqueRecv uint64 // for the DB growth ratio below
	if n.bitswap != nil && n.bitswap.Bitswap != nil {
		if st, err := n.bitswap.Bitswap.Stat(); err == nil && st != nil {
			row := &bitswapDedupRow{
				BlocksReceived: fmt.Sprintf("%d", st.BlocksReceived),
				DataReceived:   humanBytes(st.DataReceived),
				DupBlocks:      fmt.Sprintf("%d", st.DupBlksReceived),
				DupData:        humanBytes(st.DupDataReceived),
				BlocksSent:     fmt.Sprintf("%d", st.BlocksSent),
				DataSent:       humanBytes(st.DataSent),
			}
			if st.DataReceived > 0 {
				pct := float64(st.DupDataReceived) / float64(st.DataReceived) * 100
				row.DupDataPct = fmt.Sprintf("%.1f%%", pct)
				if pct > 20 {
					row.DupDataPctClass = "warn"
				}
			} else {
				row.DupDataPct = "—"
			}

			outcomeCounts, _ := collectCounterVec("seed_blob_putblock_outcome_total")
			outcomeBytes, _ := collectCounterVec("seed_blob_putblock_bytes_total")
			newBlocks := outcomeCounts["new"]
			newBytes := outcomeBytes["new"]
			updBlocks := outcomeCounts["update"]
			updBytes := outcomeBytes["update"]
			alrBlocks := outcomeCounts["exists"]
			alrBytes := outcomeBytes["exists"]
			row.NewBlocks = fmt.Sprintf("%.0f", newBlocks)
			row.NewBytes = humanBytes(uint64(newBytes))
			row.UpdateBlocks = fmt.Sprintf("%.0f", updBlocks)
			row.UpdateBytes = humanBytes(uint64(updBytes))
			row.AlreadyBlocks = fmt.Sprintf("%.0f", alrBlocks)
			row.AlreadyBytes = humanBytes(uint64(alrBytes))
			if total := newBytes + updBytes + alrBytes; total > 0 {
				pct := alrBytes / total * 100
				row.AlreadyPct = fmt.Sprintf("%.1f%%", pct)
				if pct > 20 {
					row.AlreadyPctClass = "warn"
				}
			} else {
				row.AlreadyPct = "—"
			}

			out.Bitswap = row

			if st.DataReceived > st.DupDataReceived {
				bitswapUniqueRecv = st.DataReceived - st.DupDataReceived
			}
		}
	}

	// codec-mismatch table: rows are (stored,incoming) → count, sorted desc
	if mfs, err := prometheus.DefaultGatherer.Gather(); err == nil {
		var rows []codecMismatchRow
		for _, mf := range mfs {
			if mf.GetName() != "seed_blob_putblock_codec_mismatch_total" {
				continue
			}
			for _, m := range mf.GetMetric() {
				if m.Counter == nil {
					continue
				}
				var stored, incoming string
				for _, l := range m.GetLabel() {
					switch l.GetName() {
					case "stored_codec":
						stored = l.GetValue()
					case "incoming_codec":
						incoming = l.GetValue()
					}
				}
				rows = append(rows, codecMismatchRow{
					StoredCodec:   stored + " (" + codecName(stored) + ")",
					IncomingCodec: incoming + " (" + codecName(incoming) + ")",
					Count:         fmt.Sprintf("%.0f", m.Counter.GetValue()),
				})
			}
		}
		if len(rows) > 0 {
			out.CodecMismatch = rows
		}
	}

	if drift, err := n.IndexDrift(ctx); err == nil {
		row := &indexDriftRow{
			Total:      fmt.Sprintf("%d", drift.Total),
			TotalBytes: humanBytes(uint64(drift.TotalBytes)),
			DagCbor:    fmt.Sprintf("%d", drift.DagCbor),
			DagPb:      fmt.Sprintf("%d", drift.DagPb),
			Other:      fmt.Sprintf("%d", drift.Other),
		}
		if drift.DagCbor > 0 {
			row.Class = "warn"
		}
		out.Drift = row
	}

	discardEvents, _ := collectSingleMetricValue("seed_syncpeer_discarded_events_total")
	discardBlocks, _ := collectSingleMetricValue("seed_syncpeer_discarded_blobs_total")
	rollbackBatches, _ := collectSingleMetricValue("seed_syncpeer_persist_rollback_total")
	rollbackBlocks, _ := collectSingleMetricValue("seed_syncpeer_persist_rollback_blocks_total")
	preflightSkipped, _ := collectSingleMetricValue("seed_syncpeer_preflight_skipped_total")
	{
		row := &preflightRow{
			Skipped: fmt.Sprintf("%.0f", preflightSkipped),
		}
		if preflightSkipped > 0 {
			row.SkippedClass = "good"
		}
		out.Preflight = row
	}
	if discardEvents > 0 || rollbackBatches > 0 {
		out.SyncDiscard = &syncDiscardRow{
			Events:          fmt.Sprintf("%.0f", discardEvents),
			Blocks:          fmt.Sprintf("%.0f", discardBlocks),
			RollbackBatches: fmt.Sprintf("%.0f", rollbackBatches),
			RollbackBlocks:  fmt.Sprintf("%.0f", rollbackBlocks),
			HasDiscard:      discardEvents > 0,
			HasRollback:     rollbackBatches > 0,
		}
	}

	startSize, startTime := n.DBSizeAtStart()
	if startSize > 0 {
		nowSize, err := n.DBSizeNow(ctx)
		if err == nil {
			var growth uint64
			if nowSize > startSize {
				growth = nowSize - startSize
			}
			elapsed := "—"
			if !startTime.IsZero() {
				elapsed = time.Since(startTime).Truncate(time.Second).String()
			}
			row := &dbGrowthRow{
				StartSize: humanBytes(startSize),
				NowSize:   humanBytes(nowSize),
				Growth:    humanBytes(growth),
				Elapsed:   elapsed,
			}
			if bitswapUniqueRecv > 0 {
				ratio := float64(growth) / float64(bitswapUniqueRecv)
				gone := 1 - ratio
				row.GrowthVsRecv = fmt.Sprintf(
					"growth / unique-bitswap-recv = %s / %s = %.2f (≈%.0f%% of unique recv never reached disk)",
					humanBytes(growth), humanBytes(bitswapUniqueRecv), ratio, gone*100,
				)
			}
			out.DB = row
		}
	}

	return out
}

func makeLayerRow(name string, s bwcounter.Snapshot) bwLayerRow {
	return bwLayerRow{
		Layer:       name,
		LoopbackIn:  humanBytes(s.LoopbackIn),
		LoopbackOut: humanBytes(s.LoopbackOut),
		RemoteIn:    humanBytes(s.RemoteIn),
		RemoteOut:   humanBytes(s.RemoteOut),
		Total:       humanBytes(s.LoopbackIn + s.LoopbackOut + s.RemoteIn + s.RemoteOut),
	}
}

func makeTotalLayerRow(snaps ...bwcounter.Snapshot) bwLayerRow {
	var li, lo, ri, ro uint64
	for _, s := range snaps {
		li += s.LoopbackIn
		lo += s.LoopbackOut
		ri += s.RemoteIn
		ro += s.RemoteOut
	}
	return bwLayerRow{
		Layer:       "TOTAL",
		LoopbackIn:  humanBytes(li),
		LoopbackOut: humanBytes(lo),
		RemoteIn:    humanBytes(ri),
		RemoteOut:   humanBytes(ro),
		Total:       humanBytes(li + lo + ri + ro),
	}
}

func topNTagRows(rows []bwcounter.TagRow, n int) []bwcounter.TagRow {
	// Snapshot already sorts by Total() desc.
	if n > 0 && len(rows) > n {
		return rows[:n]
	}
	return rows
}

func formatTagRow(t bwcounter.TagRow) bwTagRow {
	scope := "remote"
	if t.Scope == bwcounter.ScopeLoopback {
		scope = "loopback"
	}
	tag := t.Tag
	if tag == "" {
		tag = "(unlabeled)"
	}
	return bwTagRow{
		Scope: scope,
		Tag:   tag,
		In:    humanBytes(t.In),
		Out:   humanBytes(t.Out),
	}
}

// humanBytes formats a byte count as a short string (e.g. "1.2 MB").
// Uses 1024-based units to match what users see in OS-level network monitors.
func humanBytes(n uint64) string {
	const unit = 1024
	if n < unit {
		return fmt.Sprintf("%d B", n)
	}
	div, exp := uint64(unit), 0
	for x := n / unit; x >= unit; x /= unit {
		div *= unit
		exp++
	}
	return fmt.Sprintf("%.1f %ciB", float64(n)/float64(div), "KMGTPE"[exp])
}

// codecName returns the short multicodec name for a numeric codec string.
// Covers the codecs we actually see in this codebase; everything else is "?".
func codecName(s string) string {
	switch s {
	case "85":
		return "raw"
	case "112":
		return "dag-pb"
	case "113":
		return "dag-cbor"
	case "0":
		return "identity"
	}
	return "?"
}

func humanAgo(d time.Duration) string {
	if d < time.Second {
		return "just now"
	}
	if d < time.Minute {
		return fmt.Sprintf("%ds ago", int(d.Seconds()))
	}
	if d < time.Hour {
		return fmt.Sprintf("%dm ago", int(d.Minutes()))
	}
	return fmt.Sprintf("%dh ago", int(d.Hours()))
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
			P10:     formatDuration(s.percentile(0.10)),
			P50:     formatDuration(s.percentile(0.50)),
			P90:     formatDuration(s.percentile(0.90)),
			P99:     formatDuration(s.percentile(0.99)),
			Count:   s.count,
		}
		row.P10Class = warnClass(asDur(s.percentile(0.10)) > warnP10)
		row.P50Class = warnClass(asDur(s.percentile(0.50)) > warnP50)
		row.P90Class = warnClass(asDur(s.percentile(0.90)) > warnP90)
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
		P10:      formatDuration(s.percentile(0.10)),
		P50:      formatDuration(s.percentile(0.50)),
		P90:      formatDuration(s.percentile(0.90)),
		P99:      formatDuration(s.percentile(0.99)),
		Count:    s.count,
		P10Class: warnClass(asDur(s.percentile(0.10)) > warnP10),
		P50Class: warnClass(asDur(s.percentile(0.50)) > warnP50),
		P90Class: warnClass(asDur(s.percentile(0.90)) > warnP90),
		P99Class: warnClass(asDur(s.percentile(0.99)) > warnP99),
	}}}
	return section{
		Title:    "Reconcile server: total handler",
		Subtitle: "directly comparable to client-side reconcile_rpc",
		Latency:  tbl,
	}
}

func buildReconcileLimiterSection() section {
	tbl := &kvTable{}
	limit, limitOK := collectSingleMetricValue("seed_reconcile_server_limiter_limit")
	inFlight, _ := collectSingleMetricValue("seed_reconcile_server_limiter_in_flight")
	waiting, _ := collectSingleMetricValue("seed_reconcile_server_limiter_waiting")
	accepted, _ := collectSingleMetricValue("seed_reconcile_server_limiter_accepted_total")
	rejected, _ := collectSingleMetricValue("seed_reconcile_server_limiter_rejected_total")

	limitValue := "—"
	if limitOK {
		if limit < 0 {
			limitValue = "unlimited"
		} else {
			limitValue = fmt.Sprintf("%.0f", limit)
		}
	}

	inFlightClass := "num"
	if limitOK && limit > 0 && inFlight >= limit {
		inFlightClass = "num warn"
	}

	waitingClass := "num"
	if waiting > 0 {
		waitingClass = "num warn"
	}

	rejectedClass := "num"
	if rejected > 0 {
		rejectedClass = "num warn"
	}

	tbl.Rows = append(tbl.Rows,
		kvRow{Key: "limit", Value: limitValue, Class: "num"},
		kvRow{Key: "in_flight", Value: fmt.Sprintf("%.0f", inFlight), Class: inFlightClass},
		kvRow{Key: "waiting", Value: fmt.Sprintf("%.0f", waiting), Class: waitingClass},
		kvRow{Key: "accepted_total", Value: fmt.Sprintf("%.0f", accepted), Class: "num"},
		kvRow{Key: "rejected_total", Value: fmt.Sprintf("%.0f", rejected), Class: rejectedClass},
	)

	queueWait := "—"
	queueWaitClass := "num"
	if mf, _ := findMetricFamily("seed_reconcile_server_limiter_wait_seconds"); mf != nil && len(mf.Metric) > 0 && mf.Metric[0].Histogram != nil {
		h := mf.Metric[0].Histogram
		if h.GetSampleCount() > 0 {
			s := &histStats{count: h.GetSampleCount(), sum: h.GetSampleSum(), buckets: h.GetBucket()}
			p50 := s.percentile(0.50)
			p90 := s.percentile(0.90)
			p99 := s.percentile(0.99)
			queueWait = fmt.Sprintf("%s / %s / %s (n=%d)", formatDuration(p50), formatDuration(p90), formatDuration(p99), s.count)
			if asDur(p99) > 500*time.Millisecond {
				queueWaitClass = "num warn"
			}
		}
	}
	tbl.Rows = append(tbl.Rows, kvRow{Key: "queue_wait p50/p90/p99", Value: queueWait, Class: queueWaitClass})

	return section{
		Title:    "Inbound ReconcileBlobs limiter",
		Subtitle: "server-side backpressure before expensive RBSR/SQLite work",
		KV:       tbl,
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

func collectSingleMetricValue(name string) (float64, bool) {
	mf, _ := findMetricFamily(name)
	if mf == nil {
		return 0, false
	}
	for _, m := range mf.GetMetric() {
		if m.Gauge != nil {
			return m.Gauge.GetValue(), true
		}
		if m.Counter != nil {
			return m.Counter.GetValue(), true
		}
	}
	return 0, false
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
<p>Same per-call timing as the bitswap_fetch row above, but split by termination reason. Watch the <code>complete</code> row's p90/p99 — that's "real fetches, how long do they take" without the timeout cases skewing the picture.</p>`

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

const helpReconcileLimiter template.HTML = `
<p>Backpressure in front of inbound <code>ReconcileBlobs</code>. Default limit is <code>max(2, 2*GOMAXPROCS)</code>; callers wait up to 3s for a slot, then receive <code>ResourceExhausted</code>.</p>
<dl>
<dt>in_flight</dt><dd>Requests currently inside the expensive SQLite/RBSR handler. Red when it reaches the limit.</dd>
<dt>waiting</dt><dd>Requests queued for a slot right now. Any non-zero value means the limiter is saturated at this instant.</dd>
<dt>rejected_total</dt><dd>Requests that waited too long and were rejected. This should stay near zero; growth means the server is overloaded for its CPU.</dd>
<dt>queue_wait</dt><dd>How long accepted and rejected requests waited for capacity. A rising p90/p99 means saturation before outright rejects show up.</dd>
</dl>`

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

const helpWantlistSize template.HTML = `
<p>For each peer we sync with, RBSR computes "blobs the peer has that I don't" and asks bitswap to fetch them. This histogram is the size of that wantlist per peer-sync.</p>
<dl>
<dt>healthy</dt><dd>Mean near 0, with most observations in the <code>≤ 1</code> or <code>≤ 10</code> buckets — the diff is small because we already have most of what each peer has.</dd>
<dt>unhealthy</dt><dd>Persistent observations in <code>≤ 1000</code>+ buckets. Each one means we asked bitswap to fetch hundreds-to-thousands of blobs from this peer. If the <em>putBlock disposition → exists</em> share is also high, RBSR is undercounting our local set: it tells every peer we're missing blobs we actually have, peers ship them, the blockstore drops them, and the next sync repeats. Combined with the 2-minute <code>TimeoutPerPeer</code> hard cap, large wantlists trigger the <em>sync — late-cancellation waste</em> path.</dd>
</dl>`

const helpBandwidth template.HTML = `
<p>Where the daemon's bytes are going since startup. Three layers are tracked independently — they don't double-count each other:</p>
<dl>
<dt>libp2p</dt><dd>Raw stream bytes on the libp2p transport (bitswap, kad-dht, hypermedia gRPC-over-libp2p, identify, ping, autonat, holepunch, relay). The big libp2p protocols are broken out below.</dd>
<dt>http server</dt><dd>Bytes through the daemon's HTTP listener — gRPC-Web from the local desktop/web frontend, the public file gateway (<code>/ipfs/&lt;cid&gt;</code>), debug pages. <strong>The desktop app's gRPC-Web traffic shows up here as <em>loopback</em></strong> since the frontend connects to <code>127.0.0.1</code>.</dd>
<dt>http client</dt><dd>Outbound HTTP we own — primarily the delegated DHT client. Counted at our wrapper, so libp2p-internal HTTP probes (which we don't wrap) aren't included.</dd>
</dl>
<p><strong>scope</strong>: <em>loopback</em> means the remote endpoint is <code>127.0.0.0/8</code> or <code>::1</code>. <em>remote</em> means anything else, including LAN. So if your bandwidth feels too high but the loopback row is the dominant chunk, the bytes never left the machine.</p>
<p><strong>bitswap duplicate-block waste</strong>: bitswap broadcasts WANT messages to every connected peer. When several peers race to send the same block, we accept all copies. <em>Duplicate data received</em> is the share of the bitswap recv stream that was wasted on blocks we already had. A high value (red &gt;20%) means most of the bitswap inbound traffic is amplification, not new content. Multiplied across a few hundred connected peers this is usually the dominant source of "why is my bandwidth so high".</p>
<p><strong>putBlock disposition</strong>: every block that reaches our blockstore (delivered by bitswap or pushed via PutMany) goes through one of three branches in <code>blockStore.putBlock</code>: <em>new</em> writes a fresh row, <em>update</em> fills in a previously-known placeholder, <em>exists</em> means we already had a complete row and the data is dropped. A large <em>exists</em> share (red &gt;20%) means we paid full network cost to receive content already on disk — i.e. RBSR or bitswap thought we were missing blobs we actually have. Cross-check against <em>SQLite size — this session</em> below: if the DB barely grew but bitswap recv was big, the <em>exists</em> row is almost certainly where it went.</p>
<p><strong>codec mismatch</strong>: when a peer ships a block, the bitswap-delivered CID carries a codec (raw, dag-pb, dag-cbor, …). When that block reaches <code>putBlock</code> and we already have the same multihash stored under a <em>different</em> codec, we hit the <code>exists</code> branch and drop the data. RBSR's set diff identifies items by full CID — codec + multihash — so two valid encodings of the same content (e.g. small UnixFS files stored as <code>raw</code> by some peers and as <code>dag-pb</code> by others) look like different items and get repeatedly fetched and dropped. Each row is a (stored→incoming) codec pair we observed, with the count of redundant deliveries. Empty table means peers and us agree on codecs; non-empty means we're paying real bandwidth for content we already have under a different CID.</p>
<p><strong>syncing pre-flight Has filter</strong>: after RBSR computes a wantlist of CIDs the peer has and we don't, we run a multihash-keyed <code>blockstore.Has</code> on each before handing it to bitswap. CIDs we already have (codec mismatch or scope/orphan reachability — see the codec-mismatch table above) get filtered out at zero network cost, sparing us the WANT_HAVE → HAVE → WANT_BLOCK → BLOCK round-trip and the block delivery itself. The counter shows lifetime saved fetches; expect it to grow at the rate <code>putBlock disposition: exists</code> would have grown without the filter. A green non-zero value is direct inbound bandwidth saved; zero on a freshly-started daemon is normal.</p>
<p><strong>blob index drift</strong>: count of rows in <code>blobs</code> with <code>size &gt;= 0</code> that have NO matching row in <code>structural_blobs</code>. RBSR builds its local-set view from <code>structural_blobs</code> via <code>collectBlobs</code>, so these blobs are present on disk but invisible to the diff. Each one will be re-fetched from peers every sync cycle and dropped at <code>putBlock</code> as <code>exists</code>. Red when the dag-cbor count is non-zero — those <em>should</em> be indexed and aren't.</p>
<p><strong>persist pipeline — failures</strong>: post-streaming-refactor, fetched blocks are pipelined into <code>PutMany</code> batches and persisted on a detached ctx. Two failure modes can show up:</p>
<dl>
<dt>late-cancel discard</dt><dd>Legacy code path that lost work when the per-peer ctx fired during fetch. Should stay at 0 with the streaming refactor — non-zero here means a path slipped through and is still using the old all-or-nothing persist.</dd>
<dt>PutMany batch rollbacks</dt><dd>A streaming batch's <code>PutMany</code> tx rolled back, most often because <code>indexBlob</code> hit a cross-blob reference whose referent isn't in the DB yet (e.g. a Change ahead of its <code>genesis_blob</code>, a Capability before its parent). Those blocks come back from peers next sync and the order resolves. A small steady value during initial big syncs is expected; a sustained high value points at a real ordering / dependency bug worth chasing.</dd>
</dl>
<p><strong>SQLite size — this session</strong>: <code>page_count × page_size</code> sampled at daemon start vs now. Compared against bitswap unique-recv (data received minus duplicates). If <em>vs bitswap unique recv</em> is much less than 1, then unique blob bytes were received from peers but didn't reach disk — either still buffered, dropped by indexer validation, or never persisted. If it's roughly 1×, the on-the-wire bytes really did become disk bytes. The ratio assumes blob content is incompressible-ish; if your storage path applies compression this ratio drops accordingly without indicating a leak.</p>
<p>All counters reset on daemon restart; numbers are cumulative since then.</p>`

const helpHowToRead template.HTML = `
<p>This page is a live snapshot of how syncing is performing on this daemon.</p>
<ul>
<li><strong>Latency tables</strong> show p10/p50/p90/p99 percentiles. Cells turn red when crossing fixed thresholds (p10&nbsp;&gt;&nbsp;50ms, p50&nbsp;&gt;&nbsp;100ms, p90&nbsp;&gt;&nbsp;1s, p99&nbsp;&gt;&nbsp;5s).</li>
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
		return s.Latency != nil || s.Counter != nil || s.Bucket != nil || s.KV != nil
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
  red cells: p10&nbsp;&gt;&nbsp;50ms, p50&nbsp;&gt;&nbsp;100ms, p90&nbsp;&gt;&nbsp;1s, p99&nbsp;&gt;&nbsp;5s · counter rows highlight when error/timeout share &gt;&nbsp;5–20%
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
<tr><th>{{.LabelHeader}}</th><th>p10</th><th>p50</th><th>p90</th><th>p99</th><th>count</th></tr>
{{range .Rows}}
<tr>
<td>{{.Label}}</td>
{{if .HasData}}
<td class="{{.P10Class}}">{{.P10}}</td>
<td class="{{.P50Class}}">{{.P50}}</td>
<td class="{{.P90Class}}">{{.P90}}</td>
<td class="{{.P99Class}}">{{.P99}}</td>
<td class="num">{{.Count}}</td>
{{else}}
<td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">—</td><td class="num">0</td>
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

{{if .KV}}
{{with .KV}}
<table class="kv">
{{range .Rows}}
<tr><td>{{.Key}}</td><td class="{{.Class}}">{{.Value}}</td></tr>
{{end}}
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

<h2>Bandwidth (since startup)</h2>
<div class="subtitle">bytes split by scope (loopback vs remote) across libp2p / HTTP server / HTTP client. Loopback is anything on 127.0.0.0/8 or ::1.</div>
<table>
<tr><th>layer</th><th>loopback in</th><th>loopback out</th><th>remote in</th><th>remote out</th><th>total</th></tr>
{{range .Bandwidth.Layers}}
<tr>
<td>{{.Layer}}</td>
<td class="num">{{.LoopbackIn}}</td>
<td class="num">{{.LoopbackOut}}</td>
<td class="num">{{.RemoteIn}}</td>
<td class="num">{{.RemoteOut}}</td>
<td class="num">{{.Total}}</td>
</tr>
{{end}}
</table>

{{if .Bandwidth.Protocols}}
<h3 style="font-size:13px;margin:14px 0 4px 0">libp2p — top protocols by bytes</h3>
<table>
<tr><th>protocol</th><th>scope</th><th>recv</th><th>sent</th></tr>
{{range .Bandwidth.Protocols}}
<tr><td><code>{{.Tag}}</code></td><td>{{.Scope}}</td><td class="num">{{.In}}</td><td class="num">{{.Out}}</td></tr>
{{end}}
</table>
{{end}}

{{if .Bandwidth.Peers}}
<h3 style="font-size:13px;margin:14px 0 4px 0">libp2p — top peers by bytes (top 10)</h3>
<table>
<tr><th>peer ID</th><th>scope</th><th>recv</th><th>sent</th><th>last activity</th></tr>
{{range .Bandwidth.Peers}}
<tr><td><code>{{.PeerID}}</code></td><td>{{.Scope}}</td><td class="num">{{.In}}</td><td class="num">{{.Out}}</td><td>{{.LastActive}}</td></tr>
{{end}}
</table>
{{end}}

{{if .Bandwidth.HTTPIn}}
<h3 style="font-size:13px;margin:14px 0 4px 0">http server — by URL prefix</h3>
<table>
<tr><th>tag</th><th>scope</th><th>recv</th><th>sent</th></tr>
{{range .Bandwidth.HTTPIn}}
<tr><td>{{.Tag}}</td><td>{{.Scope}}</td><td class="num">{{.In}}</td><td class="num">{{.Out}}</td></tr>
{{end}}
</table>
{{end}}

{{if .Bandwidth.HTTPOut}}
<h3 style="font-size:13px;margin:14px 0 4px 0">http client — by destination host</h3>
<table>
<tr><th>host</th><th>scope</th><th>recv</th><th>sent</th></tr>
{{range .Bandwidth.HTTPOut}}
<tr><td><code>{{.Tag}}</code></td><td>{{.Scope}}</td><td class="num">{{.In}}</td><td class="num">{{.Out}}</td></tr>
{{end}}
</table>
{{end}}

{{if .Bandwidth.Bitswap}}
{{with .Bandwidth.Bitswap}}
<h3 style="font-size:13px;margin:14px 0 4px 0">bitswap — duplicate-block waste</h3>
<table class="kv">
<tr><td>blocks received</td><td class="num">{{.BlocksReceived}}</td></tr>
<tr><td>data received</td><td class="num">{{.DataReceived}}</td></tr>
<tr><td>duplicate blocks received</td><td class="num">{{.DupBlocks}}</td></tr>
<tr><td>duplicate data received</td><td class="num {{.DupDataPctClass}}">{{.DupData}} ({{.DupDataPct}})</td></tr>
<tr><td>blocks sent</td><td class="num">{{.BlocksSent}}</td></tr>
<tr><td>data sent</td><td class="num">{{.DataSent}}</td></tr>
</table>

<h3 style="font-size:13px;margin:14px 0 4px 0">putBlock disposition — what happened to received blocks</h3>
<table class="kv">
<tr><td>new (fresh insert into blobs)</td><td class="num">{{.NewBlocks}} blocks · {{.NewBytes}}</td></tr>
<tr><td>update (placeholder filled)</td><td class="num">{{.UpdateBlocks}} blocks · {{.UpdateBytes}}</td></tr>
<tr><td>exists (already had it, dropped)</td><td class="num {{.AlreadyPctClass}}">{{.AlreadyBlocks}} blocks · {{.AlreadyBytes}} ({{.AlreadyPct}} of bytes)</td></tr>
</table>
{{end}}
{{end}}

{{if .Bandwidth.CodecMismatch}}
<h3 style="font-size:13px;margin:14px 0 4px 0">codec mismatch — same multihash, different codec on the wire vs in our DB</h3>
<table>
<tr><th>stored codec</th><th>incoming codec (from peer)</th><th>count</th></tr>
{{range .Bandwidth.CodecMismatch}}
<tr><td>{{.StoredCodec}}</td><td>{{.IncomingCodec}}</td><td class="num warn">{{.Count}}</td></tr>
{{end}}
</table>
{{end}}

{{if .Bandwidth.Drift}}
{{with .Bandwidth.Drift}}
<h3 style="font-size:13px;margin:14px 0 4px 0">blob index drift — invisible to RBSR</h3>
<table class="kv">
<tr><td>blobs in <code>blobs</code> but NOT in <code>structural_blobs</code></td><td class="num {{.Class}}">{{.Total}} ({{.TotalBytes}})</td></tr>
<tr><td>&nbsp;&nbsp;dag-cbor (Hypermedia structural — should be indexed)</td><td class="num {{.Class}}">{{.DagCbor}}</td></tr>
<tr><td>&nbsp;&nbsp;dag-pb (UnixFS chunks — usually fine to be unindexed)</td><td class="num">{{.DagPb}}</td></tr>
<tr><td>&nbsp;&nbsp;other codec</td><td class="num">{{.Other}}</td></tr>
</table>
{{end}}
{{end}}

{{if .Bandwidth.Preflight}}
{{with .Bandwidth.Preflight}}
<h3 style="font-size:13px;margin:14px 0 4px 0">syncing pre-flight Has filter — wantlist CIDs we already have</h3>
<table class="kv">
<tr><td>CIDs skipped before bitswap (would have hit putBlock as <code>exists</code>)</td><td class="num {{.SkippedClass}}">{{.Skipped}}</td></tr>
</table>
{{end}}
{{end}}

{{if .Bandwidth.SyncDiscard}}
{{with .Bandwidth.SyncDiscard}}
<h3 style="font-size:13px;margin:14px 0 4px 0">persist pipeline — failures</h3>
<table class="kv">
{{if .HasDiscard}}
<tr><td>late-cancel discard events (legacy path; should stay at 0)</td><td class="num warn">{{.Events}}</td></tr>
<tr><td>late-cancel blocks discarded</td><td class="num warn">{{.Blocks}}</td></tr>
{{end}}
{{if .HasRollback}}
<tr><td>PutMany batch rollbacks (likely indexBlob ordering)</td><td class="num warn">{{.RollbackBatches}}</td></tr>
<tr><td>blocks rolled back (will return next sync cycle)</td><td class="num warn">{{.RollbackBlocks}}</td></tr>
{{end}}
</table>
{{end}}
{{end}}

{{if .Bandwidth.DB}}
{{with .Bandwidth.DB}}
<h3 style="font-size:13px;margin:14px 0 4px 0">SQLite size — this session</h3>
<table class="kv">
<tr><td>at startup</td><td class="num">{{.StartSize}}</td></tr>
<tr><td>now</td><td class="num">{{.NowSize}}</td></tr>
<tr><td>grew by</td><td class="num">{{.Growth}}</td></tr>
<tr><td>elapsed since startup snapshot</td><td>{{.Elapsed}}</td></tr>
{{if .GrowthVsRecv}}<tr><td>vs bitswap unique recv</td><td>{{.GrowthVsRecv}}</td></tr>{{end}}
</table>
{{end}}
{{end}}

<details class="help">
<summary>What does this mean?</summary>
{{.Bandwidth.Help}}
</details>

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
