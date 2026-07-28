package hmnet

import (
	"context"
	"fmt"
	"html/template"
	"strings"
	"time"

	"seed/backend/blob"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"seed/backend/util/syncperf"
)

// buildSyncThroughputSection renders one table: the byte counts and rates
// disaggregated across blob kinds, the timings and stage shares that only exist
// in aggregate, and a collapsible per-site breakdown.
//
// Rows that don't disaggregate leave the kind columns blank rather than living
// in a second table, so a rate can be read against its composition without
// scrolling.
func (n *Node) buildSyncThroughputSection(ctx context.Context) section {
	s := syncperf.Default.Snapshot()
	st := syncperf.Default.Stages()
	b := syncperf.Default.Breakdown()
	// Blobs that carried no space at index time (Changes) are parked under their
	// document's genesis. Any Ref for that genesis knows the space, so one query
	// resolves them — the association exists in the database by then even though
	// it didn't when the Change was written.
	//
	// pendingDocs/resolvedDocs are kept so the footnote can report how much of
	// (unattributed) is simply waiting on a Ref, rather than leaving the reader
	// to guess whether it's a backlog or a bug.
	pendingDocs := len(b.PendingDocs)
	spaces := n.docSpaces(ctx, b.PendingDocs)
	resolvedDocs := len(spaces)
	b.ResolveDocs(spaces)
	b.Finish()

	cols := make([]string, 0, len(b.Kinds)+1)
	cols = append(cols, "total")
	cols = append(cols, b.Kinds...)

	m := &matrixTable{RowHeader: "", Columns: cols}

	// Per-site rows are attached to every metric that has a per-space meaning,
	// so the biggest consumers are one click away from any figure. The tracker
	// keeps every site regardless; this only bounds what's rendered.
	global := syncperf.Default.GlobalStats()
	siteStats := syncperf.Default.SiteStats()
	names := n.siteNames(ctx)
	shown := b.Sites
	if len(shown) > maxSiteRows {
		shown = shown[:maxSiteRows]
	}

	// scalar adds a metric that exists only in aggregate: no kind columns, and
	// nothing to expand.
	scalar := func(label, value, class string) {
		cells := make([]string, len(cols))
		cells[0] = value
		m.Groups = append(m.Groups, matrixGroup{Row: matrixRow{Label: label, Cells: cells, Class: class}})
	}

	// split adds a metric disaggregated across kinds, plus one child row per
	// site carrying the same metric. f is applied identically to the totals and
	// to each site, so a child row is directly comparable to its parent.
	split := func(label string, f func(bytes, blobs int64) string) {
		cells := func(bytes, blobs func(kind string) int64, totalBytes, totalBlobs int64) []string {
			out := make([]string, 0, len(cols))
			out = append(out, f(totalBytes, totalBlobs))
			for _, k := range b.Kinds {
				out = append(out, f(bytes(k), blobs(k)))
			}
			return out
		}

		g := matrixGroup{Row: matrixRow{
			Label: label,
			Cells: cells(b.Bytes, b.Blobs, b.Total.TotalBytes, b.Total.TotalBlobs),
			Class: "num",
		}}
		for _, site := range shown {
			g.Children = append(g.Children, matrixRow{
				Label: siteLabel(site.Site, names),
				Cells: cells(
					func(k string) int64 { return site.Bytes[k] },
					func(k string) int64 { return site.Blobs[k] },
					site.TotalBytes, site.TotalBlobs,
				),
			})
		}
		m.Groups = append(m.Groups, g)
	}

	split("bytes persisted", func(by, _ int64) string { return humanBytesOrDash(by) })
	split("blobs persisted", func(_, cnt int64) string {
		if cnt <= 0 {
			return "—"
		}
		return fmt.Sprintf("%d", cnt)
	})
	split("share of bytes", func(by, _ int64) string {
		if b.Total.TotalBytes <= 0 || by <= 0 {
			return "—"
		}
		return fmt.Sprintf("%.1f%%", float64(by)/float64(b.Total.TotalBytes)*100)
	})
	// These decompose the scalar wall/transfer throughputs below: the kind cells
	// sum to the total cell, and expanding shows which site the rate came from.
	split("wall throughput", func(by, _ int64) string {
		if by <= 0 || s.Uptime <= 0 {
			return "—"
		}
		return humanRate(float64(by) / s.Uptime.Seconds())
	})
	split("transfer throughput", func(by, _ int64) string {
		if by <= 0 || st.WeightedTransfer <= 0 {
			return "—"
		}
		return humanRate(float64(by) / st.WeightedTransfer.Seconds())
	})

	dutyClass := "num"
	if s.Sessions > 0 && s.DutyCycle() < 0.05 {
		dutyClass = "num warn"
	}
	transferClass := "num"
	if st.Uptime > 0 && st.Share(st.WeightedTransfer) < 0.10 {
		transferClass = "num warn"
	}

	// timed adds a row computed from the session/stage figures, which exist both
	// globally and per space. f runs against the daemon-wide Stats for the
	// parent and each site's own for the children, so "gabo.es was 40 KiB/s"
	// becomes answerable: was that little time spent, or a slow pipe?
	//
	// The value sits in the total column only — these have no per-kind split.
	timed := func(label, class string, f func(syncperf.Stats) string) {
		mk := func(st syncperf.Stats) []string {
			cells := make([]string, len(cols))
			cells[0] = f(st)
			return cells
		}
		g := matrixGroup{Row: matrixRow{Label: label, Cells: mk(global), Class: class}}
		for _, site := range shown {
			ss, ok := siteStats[site.Site]
			if !ok {
				// A space with bytes but no session of its own: its blobs
				// arrived via another space's sync (a cross-space link walk).
				continue
			}
			g.Children = append(g.Children, matrixRow{Label: siteLabel(site.Site, names), Cells: mk(ss)})
		}
		m.Groups = append(m.Groups, g)
	}

	dur := func(d time.Duration) string { return d.Truncate(time.Second).String() }
	share := func(st syncperf.Stats, d time.Duration) string {
		if st.Uptime <= 0 {
			return "—"
		}
		return fmt.Sprintf("%s (%.1f%%)", dur(d), d.Seconds()/st.Uptime.Seconds()*100)
	}
	rate := func(n int64, d time.Duration) string {
		if n <= 0 || d <= 0 {
			return "—"
		}
		return humanRate(float64(n) / d.Seconds())
	}

	// Uptime is the one figure with no per-site meaning — it's the wall clock,
	// the same for every space — so it stays a plain row.
	scalar("uptime", dur(s.Uptime), "num")

	timed("busy time (union)", "num", func(st syncperf.Stats) string { return dur(st.BusyTime) })
	timed("session time (Σ)", "num", func(st syncperf.Stats) string { return dur(st.SumSessionTime) })
	timed("sessions (done / active)", "num", func(st syncperf.Stats) string {
		return fmt.Sprintf("%d / %d", st.Sessions, st.ActiveSessions)
	})
	timed("session duty cycle", dutyClass, func(st syncperf.Stats) string {
		return fmt.Sprintf("%.1f%%", st.DutyCycle()*100)
	})
	timed("avg concurrency", "num", func(st syncperf.Stats) string {
		return fmt.Sprintf("%.2f", st.AvgConcurrency())
	})
	// The stage split, shared out by how many peer-syncs occupy each stage.
	// These four sum to uptime, globally and per space alike.
	timed("— idle", "num", func(st syncperf.Stats) string { return share(st, st.WeightedIdle) })
	timed("— connecting", "num", func(st syncperf.Stats) string { return share(st, st.WeightedConnecting) })
	timed("— exchange (haves/wants)", "num", func(st syncperf.Stats) string { return share(st, st.WeightedExchange) })
	timed("— transfer (bytes moving)", transferClass, func(st syncperf.Stats) string { return share(st, st.WeightedTransfer) })
	// Not part of the split: wall time with at least one fetch open, which under
	// fan-out is far larger than transfer's share of the work.
	timed("any fetch open", "num", func(st syncperf.Stats) string { return share(st, st.AnyTransfer) })

	// The throughput rows need bytes as well as time, so they close over the
	// site's byte total rather than going through timed().
	perSite := func(label, class string, f func(bytes int64, st syncperf.Stats) string) {
		cells := func(bytes int64, st syncperf.Stats) []string {
			out := make([]string, len(cols))
			out[0] = f(bytes, st)
			return out
		}
		g := matrixGroup{Row: matrixRow{Label: label, Cells: cells(b.Total.TotalBytes, global), Class: class}}
		for _, site := range shown {
			if ss, ok := siteStats[site.Site]; ok {
				g.Children = append(g.Children, matrixRow{
					Label: siteLabel(site.Site, names),
					Cells: cells(site.TotalBytes, ss),
				})
			}
		}
		m.Groups = append(m.Groups, g)
	}

	perSite("wall throughput", "num", func(by int64, st syncperf.Stats) string { return rate(by, st.Uptime) })
	perSite("active throughput (session busy)", "num", func(by int64, st syncperf.Stats) string {
		return rate(by, st.BusyTime)
	})
	perSite("productive throughput (exchange+transfer)", "num", func(by int64, st syncperf.Stats) string {
		return rate(by, st.WeightedExchange+st.WeightedTransfer)
	})
	perSite("transfer throughput (real ceiling)", "num", func(by int64, st syncperf.Stats) string {
		return rate(by, st.WeightedTransfer)
	})
	perSite("per-session throughput", "num", func(by int64, st syncperf.Stats) string {
		return rate(by, st.SumSessionTime)
	})

	physical := "—"
	if walBytes, ok := collectSingleMetricValue("seed_sqlite_wal_written_bytes_total"); ok && walBytes > 0 {
		physical = humanBytes(uint64(walBytes))
		if s.Bytes > 0 {
			physical += fmt.Sprintf(" (%.1f× logical)", walBytes/float64(s.Bytes))
		}
	}
	scalar("sqlite bytes written (all writers)", physical, "num")

	// Neither media nor Change carries a space of its own, so both reach one
	// indirectly. Saying how keeps a row in (unattributed) from looking like a
	// bug when it just means the linking blob hasn't arrived yet.
	notes := []string{"media is credited to the space whose sync pulled it; a Change to the space of any Ref sharing its genesis. Either stays unattributed until that link exists"}
	// The expanders show a subset, so say so — otherwise the child rows look
	// like they should add up to the parent and don't.
	if len(b.Sites) > len(shown) {
		notes = append(notes, fmt.Sprintf("expanded rows show the top %d of %d sites by bytes; parent rows are the full total",
			len(shown), len(b.Sites)))
	}
	// Says outright how much of (unattributed) is a backlog rather than a
	// failure: a document with no indexed Ref yet cannot be placed, and will be
	// once one arrives. A count that stops falling is the signal something is
	// actually wrong.
	if pendingDocs > 0 {
		notes = append(notes, fmt.Sprintf("%d of %d documents have no indexed Ref yet, so their Changes stay unattributed until one arrives",
			pendingDocs-resolvedDocs, pendingDocs))
	}
	if b.UnclassifiedBytes > 0 {
		notes = append(notes, fmt.Sprintf("%s / %d blobs persisted but not yet classified (blobs stashed awaiting a dependency are classified when they unstash)",
			humanBytes(uint64(b.UnclassifiedBytes)), b.UnclassifiedBlobs))
	}
	m.Footnote = strings.Join(notes, " · ")

	return section{
		Title:    "Sync write throughput",
		Subtitle: "how fast we ingest content we didn't already have",
		Matrix:   m,
	}
}

// maxSiteRows caps how many sites each expandable metric row reveals. The
// tracker keeps far more so the parent totals stay exact; this only bounds what
// a single expansion renders, and it applies to every expandable row.
const maxSiteRows = 25

// siteLabel renders a space as its published domain when it has one, since
// "gabo.es" is what anyone actually recognizes. Falls back to a shortened
// principal for spaces that publish no site URL.
func siteLabel(space string, names map[string]string) string {
	if strings.HasPrefix(space, "(") {
		return space
	}
	if name := names[space]; name != "" {
		return name
	}
	return shortSite(space)
}

// docSpaces resolves document genesis multihashes to the space that owns them.
//
// Only Refs carry both a genesis and a resource, which is exactly why Changes
// can't attribute themselves at index time. Restricting to Refs also keeps the
// scan small — one row per document version rather than per change.
//
// Joins through to blobs.multihash rather than selecting genesis_blob directly:
// blobs.id is REASSIGNED when a placeholder row is filled with real data (see
// blobsUpdateMissingData). The database cascades that change, but an id captured
// in memory beforehand silently stops matching — which is exactly the documents
// whose genesis we later fetched, i.e. the popular ones.
func (n *Node) docSpaces(ctx context.Context, docs []string) map[string]string {
	out := make(map[string]string, len(docs))
	if len(docs) == 0 {
		return out
	}

	want := make(map[string]struct{}, len(docs))
	for _, d := range docs {
		want[d] = struct{}{}
	}

	conn, release, err := n.db.ReadConn(ctx)
	if err != nil {
		return out
	}
	defer release()

	// Filtering in Go rather than with an IN clause: the pending set can hold
	// tens of thousands of documents, which is far past what a bound-parameter
	// list should carry, and the Ref-only row set is small either way.
	const q = `
		SELECT DISTINCT b.multihash, r.iri
		FROM structural_blobs sb
		JOIN resources r ON r.id = sb.resource
		JOIN blobs b ON b.id = sb.genesis_blob
		WHERE sb.type = 'Ref' AND sb.genesis_blob IS NOT NULL
	`
	if err := sqlitex.Exec(conn, q, func(stmt *sqlite.Stmt) error {
		key := string(stmt.ColumnBytes(0))
		if _, ok := want[key]; !ok {
			return nil
		}
		space, _, err := blob.IRI(stmt.ColumnText(1)).SpacePath()
		if err != nil {
			return nil
		}
		out[key] = space.String()
		return nil
	}); err != nil {
		return out
	}
	return out
}

// siteNames maps space principals to their published domain, read once per page
// fetch from the home document's siteUrl metadata. One read query on a debug
// page render — never on the sync path.
func (n *Node) siteNames(ctx context.Context) map[string]string {
	out := make(map[string]string)
	conn, release, err := n.db.ReadConn(ctx)
	if err != nil {
		return out
	}
	defer release()

	// Same shape as qLookupLocalDomainAccount in the daemon API: the instr()
	// pair restricts to home documents (an "hm://" IRI with no path), and the
	// correlated subquery picks the latest generation. Deliberately mirrors that
	// proven query rather than relying on SQLite's bare-column-with-MAX()
	// behaviour, which is easy to get subtly wrong.
	const q = `
		SELECT substr(r.iri, 6) AS space, COALESCE(dg.metadata->>'$.siteUrl.v', '') AS site_url
		FROM document_generations dg
		JOIN resources r ON r.id = dg.resource
		WHERE instr(r.iri, 'hm://') = 1
			AND instr(substr(r.iri, 6), '/') = 0
			AND dg.generation = (
				SELECT MAX(dg2.generation)
				FROM document_generations dg2
				WHERE dg2.resource = dg.resource
			)
	`
	if err := sqlitex.Exec(conn, q, func(stmt *sqlite.Stmt) error {
		if url := stmt.ColumnText(1); url != "" {
			out[stmt.ColumnText(0)] = prettyDomain(url)
		}
		return nil
	}); err != nil {
		return out
	}
	return out
}

// prettyDomain strips the scheme and any trailing slash so the column stays
// narrow: "https://gabo.es/" becomes "gabo.es".
func prettyDomain(raw string) string {
	s := strings.TrimSuffix(raw, "/")
	if rest, ok := strings.CutPrefix(s, "https://"); ok {
		s = rest
	} else if rest, ok := strings.CutPrefix(s, "http://"); ok {
		s = rest
	}
	return s
}

func humanBytesOrDash(n int64) string {
	if n <= 0 {
		return "—"
	}
	return humanBytes(uint64(n))
}

// buildSyncDelaySection renders how stale blobs are when they land.
//
// This deliberately doesn't reuse buildLatencySection: that one hardcodes
// warn thresholds around 100ms/5s, which are right for RPC phases and would
// paint every row red here, where seconds-to-minutes is the healthy range.
func buildSyncDelaySection() section {
	const (
		title    = "Blob arrival delay"
		subtitle = "author-claimed timestamp → our receipt, for content authored since this daemon started"
	)

	// Compute the exclusion breakdown before the empty check, not after. It
	// matters MOST when the histogram is empty: during a cold catch-up every
	// blob was authored long before we booted, so zero observations is the
	// expected outcome — and the skip counts are the only thing distinguishing
	// "correctly gated" from "instrumentation never fired".
	note := skippedDelayNote()

	stats, total, ok := collectHistogramStats("seed_sync_blob_delay_seconds")
	tbl := &latencyTable{LabelHeader: "blob type", N: total}
	if !ok || total == 0 {
		if note == "" {
			note = "no observations, and nothing excluded either — no structural blobs have been indexed from the network yet"
		} else {
			note = "no observations yet — every arrival so far was excluded. " + note
		}
		return section{Title: title, Subtitle: subtitle, Note: note, Latency: tbl}
	}

	for _, lbl := range []string{"Ref", "Change", "Comment", "Capability", "Profile", "Contact"} {
		st, found := stats[lbl]
		if !found || st.count == 0 {
			tbl.Rows = append(tbl.Rows, latencyRow{Label: lbl, HasData: false})
			continue
		}
		tbl.Rows = append(tbl.Rows, latencyRow{
			Label:   lbl,
			HasData: true,
			P10:     formatDuration(st.percentile(0.10)),
			P50:     formatDuration(st.percentile(0.50)),
			P90:     formatDuration(st.percentile(0.90)),
			P99:     formatDuration(st.percentile(0.99)),
			Count:   st.count,
			// Delay-appropriate thresholds: a minute at p50 or five at p99
			// means fresh writes are not reaching us promptly.
			P50Class: warnClass(asDur(st.percentile(0.50)) > time.Minute),
			P90Class: warnClass(asDur(st.percentile(0.90)) > 2*time.Minute),
			P99Class: warnClass(asDur(st.percentile(0.99)) > 5*time.Minute),
		})
	}

	return section{Title: title, Subtitle: subtitle, Note: note, Latency: tbl}
}

// buildSchedulerSection answers "the worker pool is idle — why?".
//
// Wall throughput factors as per-session × concurrency × dutyCycle. The last
// two are scheduling policy, so when utilization is low this section says which
// policy is responsible: the schedule holding work back, the worker cap, or the
// cold-lane reserve.
func buildSchedulerSection() section {
	const (
		title    = "Scheduler occupancy"
		subtitle = "why worker slots are idle: schedule, worker cap, or cold-lane reserve"
	)

	busy, ok := collectSingleMetricValue("seed_sync_scheduler_slots_busy")
	if !ok {
		return section{Title: title, Subtitle: subtitle, Note: "scheduler has not run a dispatch pass yet"}
	}
	total, _ := collectSingleMetricValue("seed_sync_scheduler_slots_total")
	busyCold, _ := collectSingleMetricValue("seed_sync_scheduler_slots_busy_cold")
	coldCap, _ := collectSingleMetricValue("seed_sync_scheduler_cold_cap")
	queue, _ := collectSingleMetricValue("seed_sync_scheduler_queue_depth")
	coldBlocked, _ := collectSingleMetricValue("seed_sync_scheduler_cold_blocked_total")

	tbl := &kvTable{}

	slotsClass := "num"
	if total > 0 && busy >= total {
		slotsClass = "num warn"
	}
	tbl.Rows = append(tbl.Rows,
		kvRow{Key: "slots busy / total", Value: fmt.Sprintf("%.0f / %.0f", busy, total), Class: slotsClass},
		kvRow{Key: "cold slots busy / cap", Value: fmt.Sprintf("%.0f / %.0f", busyCold, coldCap), Class: "num"},
		kvRow{Key: "queue depth", Value: fmt.Sprintf("%.0f", queue), Class: "num"},
	)

	// A large cold-blocked count means the MaxWorkers-1 reserve, not MaxWorkers,
	// is what caps bulk catch-up concurrency.
	coldBlockedClass := "num"
	if coldBlocked > 0 {
		coldBlockedClass = "num warn"
	}
	tbl.Rows = append(tbl.Rows, kvRow{
		Key:   "cold tasks deferred (cold lane full)",
		Value: fmt.Sprintf("%.0f", coldBlocked),
		Class: coldBlockedClass,
	})

	// Dispatch-end reasons, as shares of all passes.
	ends, _ := collectCounterVec("seed_sync_scheduler_dispatch_end_total")
	var endTotal float64
	for _, r := range dispatchEndReasons {
		endTotal += ends[r]
	}
	for _, r := range dispatchEndReasons {
		v := ends[r]
		share := "—"
		if endTotal > 0 {
			share = fmt.Sprintf("%.0f (%.1f%%)", v, v/endTotal*100)
		}
		tbl.Rows = append(tbl.Rows, kvRow{Key: "dispatch ended: " + r, Value: share, Class: "num"})
	}

	// Spell out the conclusion rather than leaving the operator to derive it.
	note := ""
	if endTotal > 0 {
		freeSlots := total - busy
		switch {
		case ends["saturated"]/endTotal > 0.2:
			note = "worker cap is binding — a ready task had nowhere to run on >20% of passes; raising MaxWorkers should help"
		case coldBlocked > 0 && busyCold >= coldCap && coldCap < total:
			note = "cold-lane reserve is binding — bulk catch-up is capped at MaxWorkers-1, not MaxWorkers"
		case ends["not_due"]/endTotal > 0.5 && freeSlots > 0:
			note = "schedule is the constraint — slots are free and nothing is due; intervals, not capacity, set the pace"
		case ends["queue_drained"]/endTotal > 0.5:
			note = "nothing to sync — the queue runs empty, so idle slots are expected"
		}
	}

	return section{Title: title, Subtitle: subtitle, Note: note, KV: tbl}
}

// dispatchEndReasons is the render order for the dispatch-end breakdown. It
// mirrors the reason constants in the syncing package, which this package
// cannot import (syncing depends on hmnet), so the values travel via Prometheus
// labels instead.
var dispatchEndReasons = []string{"not_due", "saturated", "preempted", "queue_drained"}

// shortSite trims a space principal to something scannable while staying
// unambiguous. The bracketed pseudo-sites are passed through untouched.
func shortSite(s string) string {
	if strings.HasPrefix(s, "(") || len(s) <= 20 {
		return s
	}
	return s[:10] + "…" + s[len(s)-6:]
}

// skippedDelayNote summarizes the arrivals deliberately kept out of the delay
// histogram. Empty string when nothing has been excluded yet.
func skippedDelayNote() string {
	skipped, ok := collectCounterVec("seed_sync_blob_delay_skipped_total")
	if !ok {
		return ""
	}

	backfill := skipped[syncperf.SkipBeforeSessionStart]
	noTS := skipped[syncperf.SkipNoTimestamp]
	skew := skipped[syncperf.SkipNegativeSkew]
	unstash := skipped[syncperf.SkipDeferredUnstash]
	sentinel := skipped[syncperf.SkipSentinelTimestamp]
	total := backfill + noTS + skew + unstash + sentinel
	if total == 0 {
		return ""
	}

	return fmt.Sprintf("excluded %.0f — offline backfill: %.0f, no timestamp: %.0f, epoch sentinel: %.0f, clock skew: %.0f, unstashed: %.0f",
		total, backfill, noTS, sentinel, skew, unstash)
}

// buildEffortSection shows where per-peer sync effort goes, in peer-seconds.
//
// The stage partition above measures WALL time (one peer transferring makes the
// daemon "transferring"). This measures EFFORT: summed across every concurrent
// peer-sync, so it exposes work that the wall-clock view hides — twenty peers
// failing to dial while one transfers costs twenty peers' worth of time and
// shows up here, not there.
func buildEffortSection() section {
	const (
		title    = "Where sync effort goes"
		subtitle = "summed peer-seconds per phase — exposes waste the wall-clock view hides"
	)

	stats, _, ok := collectHistogramStats("seed_syncpeer_phase_seconds")
	if !ok || len(stats) == 0 {
		return section{Title: title, Subtitle: subtitle, Note: "no peer syncs yet"}
	}

	// histStats already carries the sum and count we need — no new collector.
	sums := func(p string) float64 {
		if s := stats[p]; s != nil {
			return s.sum
		}
		return 0
	}
	counts := func(p string) float64 {
		if s := stats[p]; s != nil {
			return float64(s.count)
		}
		return 0
	}

	// Grouped into the same stages as the partition above.
	groups := []struct {
		label  string
		stage  string
		phases []string
	}{
		{"dial", "connecting", []string{"dial"}},
		{"reconcile_rpc", "exchange", []string{"reconcile_rpc"}},
		{"preflight_has", "exchange", []string{"preflight_has"}},
		{"bitswap_fetch", "transfer", []string{"bitswap_fetch"}},
		{"putmany", "transfer", []string{"putmany"}},
	}

	var total float64
	for _, g := range groups {
		for _, p := range g.phases {
			total += sums(p)
		}
	}
	if total <= 0 {
		return section{Title: title, Subtitle: subtitle, Note: "no peer syncs yet"}
	}

	tbl := &kvTable{}
	for _, g := range groups {
		var sec, n float64
		for _, p := range g.phases {
			sec += sums(p)
			n += counts(p)
		}
		share := sec / total * 100
		class := "num"
		// Connecting produces nothing on its own, so a large share is worth
		// flagging.
		if g.stage == "connecting" && share > 40 {
			class = "num warn"
		}
		mean := "—"
		if n > 0 {
			mean = formatDuration(sec / n)
		}
		tbl.Rows = append(tbl.Rows, kvRow{
			Key:   fmt.Sprintf("%s (%s)", g.label, g.stage),
			Value: fmt.Sprintf("%.0fs · %.1f%% · n=%.0f · mean %s", sec, share, n, mean),
			Class: class,
		})
	}
	tbl.Rows = append(tbl.Rows, kvRow{
		Key:   "total peer-seconds",
		Value: fmt.Sprintf("%.0fs", total),
		Class: "num",
	})

	// Yield: how many dials it takes to produce one transfer.
	if d, f := counts("dial"), counts("bitswap_fetch"); d > 0 {
		tbl.Rows = append(tbl.Rows, kvRow{
			Key:   "dials per fetch",
			Value: fmt.Sprintf("%.0f dials → %.0f fetches (%.2f%% yield)", d, f, f/d*100),
			Class: "num warn",
		})
	}

	return section{Title: title, Subtitle: subtitle, KV: tbl}
}

// humanRate formats a bytes-per-second figure.
func humanRate(bps float64) string {
	if bps <= 0 {
		return "—"
	}
	return humanBytes(uint64(bps)) + "/s"
}

const helpSyncThroughput template.HTML = `
<p>One numerator — bytes of network-received blobs that actually reached the disk — over three different denominators. Blobs a peer sent us that we already had wrote nothing, so they're excluded.</p>
<dl>
<dt>wall throughput</dt><dd><code>bytes ÷ uptime</code>. What the user perceives. This is the number to quote for "how fast do we catch up?".</dd>
<dt>active throughput</dt><dd><code>bytes ÷ busy time</code>, where busy time is the wall clock during which at least one sync was in flight. The capacity of the network plus write path. Overlapping sessions are counted once, so this stays meaningful under fan-out.</dd>
<dt>per-session throughput</dt><dd><code>bytes ÷ Σ session durations</code>. One stream's speed. Far below active throughput means we rely on parallelism to go fast.</dd>
<dt>session duty cycle</dt><dd><code>busy ÷ uptime</code>, and the bridge between the first two: <code>wall = active × dutyCycle</code>. <strong>Treat this as an upper bound, not a measure of productivity.</strong> Its clock starts the instant a discovery begins, so a daemon spending most of its life on failed dials reports a duty cycle near 100% while moving almost no data. The stage rows below are the honest version.</dd>
<dt>idle / connecting / exchange / transfer</dt><dd>Wall clock shared out across stages <strong>in proportion to how many peer-syncs occupy each</strong>. If at some moment 8 peers are dialing and 2 are fetching, that second counts as 0.8s connecting and 0.2s transfer. The four are disjoint and sum to uptime. <strong>connecting</strong> is dialing and DHT walks — necessary but productive of nothing on its own; <strong>exchange</strong> is RBSR trading haves and wants, productive even when the answer is "nothing needed"; <strong>transfer</strong> is the only stage where bytes move, and is flagged below 10%.</dd>
<dt>any fetch open</dt><dd>Deliberately <em>not</em> part of the split above: the wall time during which at least one fetch was open anywhere. With dozens of concurrent peer-syncs someone almost always has one open, so this runs far higher than transfer's share of the work. The gap between the two is the point — it separates "the pipe was in use" from "the pipe was what we were spending ourselves on".</dd>
<dt>transfer throughput</dt><dd>Bytes ÷ transfer time: the real ceiling of the write path, with connection and reconcile overhead excluded. Compare against <em>active throughput</em> — a large gap means the session-level number is being flattered by time spent not transferring.</dd>
<dt>avg concurrency</dt><dd><code>Σ sessions ÷ busy</code>. 1.0 means sessions never actually overlapped despite the worker pool.</dd>
<dt>sqlite bytes written</dt><dd>WAL frames checkpointed into the main DB file, for every writer in the process. Divided by the logical figure it gives write amplification from indexes and derived tables.</dd>
</dl>
<p>In Prometheus these compose directly, since the time denominators are exported as counters: <code>rate(seed_sync_written_bytes_total[5m]) / rate(seed_sync_busy_seconds_total[5m])</code> is windowed active throughput, and <code>rate(seed_sync_busy_seconds_total[5m])</code> is the windowed duty cycle.</p>
<p>The lower table splits the same bytes two ways: by blob kind across the columns, and by space in the expandable per-site rows. Only blobs that actually reached the disk are counted — ones a peer sent that we already had wrote nothing. The per-kind <em>wall throughput</em> row decomposes the overall figure, so those cells sum to the total.</p>
<p>What to read from it:</p>
<dl>
<dt>media dominating</dt><dd>Expected. Media is raw bytes with no derived-table rows, so it also drags write amplification down. If catch-up feels slow and media is most of the volume, the win is in media fetch scheduling, not structural sync.</dd>
<dt>one site dominating</dt><dd>The catch-up is really about that space. Worth checking whether it's a space you actually care about being current.</dd>
<dt>Ref ≫ Change</dt><dd>Lots of version pointers relative to actual content — a sign of re-reconciling heads rather than pulling new material.</dd>
<dt>(unattributed)</dt><dd>Media and DagPB. These are reached by walking links out of a document, and that document is no longer in scope by the time the block lands in the blockstore, so no space can be assigned without extra plumbing.</dd>
<dt>(other sites)</dt><dd>Sites beyond the 500-row cap, folded together so the totals stay exact.</dd>
</dl>
<p>Kind and site totals come from the indexer, which knows both; the authoritative byte total comes from the blockstore. If those disagree the gap is reported as <em>unclassified</em> rather than silently absorbed — normally zero, non-zero when blobs are stashed awaiting a dependency.</p>`

const helpSchedulerOccupancy template.HTML = `
<p>Wall throughput factors exactly into <code>per-session × concurrency × dutyCycle</code>. Per-session speed is network physics; the other two are <strong>your scheduling policy</strong>. When pool utilization is low this section says which policy is responsible.</p>
<p>Every dispatch pass ends for one reason, and the dominant reason is the diagnosis:</p>
<dl>
<dt>not_due</dt><dd>Nothing was scheduled to run yet. Dominant <em>with free slots</em> means the schedule is the constraint — intervals, not capacity, set the pace. Look at task run intervals and the 10s cold look-ahead.</dd>
<dt>saturated</dt><dd>A task was ready and no slot was available. Dominant means <code>cfg.MaxWorkers</code> is the constraint; raising it should convert directly into throughput.</dd>
<dt>preempted</dt><dd>Room was made for an interactive (hot) task; the pass stops and retries. Normal in small numbers.</dd>
<dt>queue_drained</dt><dd>Nothing left to consider. Idle slots are expected and correct.</dd>
</dl>
<p><strong>cold tasks deferred</strong> is the third possibility, and easy to miss: the cold lane is capped at <code>MaxWorkers-1</code> so one slot is always reserved for interactive work. Bulk catch-up therefore can never use the whole pool. A large count here with <code>cold slots busy == cap</code> means that reserve is your ceiling, and raising MaxWorkers helps only because it raises the reserve too.</p>`

const helpSyncEffort template.HTML = `
<p>The stage rows above measure <strong>wall time</strong>: one peer transferring makes the whole daemon count as transferring. This measures <strong>effort</strong> — seconds summed across every concurrent peer-sync — so it exposes work the wall-clock view hides. Twenty peers failing to dial while one transfers costs twenty peers' worth of time, and only shows up here.</p>
<p>Read the shares, not the absolute seconds. Both views are needed and they answer different questions: wall time says "was the pipe in use?", effort says "what did we spend ourselves on?".</p>
<dl>
<dt>dial (connecting)</dt><dd>Pure overhead — it produces nothing by itself, and a failed dial produces nothing at all. Flagged above 40%. If this dominates, connection management is the bottleneck and no amount of scheduler or worker-pool tuning will help.</dd>
<dt>reconcile_rpc / preflight_has (exchange)</dt><dd>Productive even when the answer is "you need nothing" — establishing that is the job.</dd>
<dt>bitswap_fetch / putmany (transfer)</dt><dd>The only phases where bytes move. Compare against the transfer stage share above.</dd>
<dt>dials per fetch</dt><dd>The yield ratio, and the bluntest statement of connection waste: how many dial attempts it takes to produce one actual transfer.</dd>
</dl>`

const helpArrivalDelay template.HTML = `
<p>Every blob carries the timestamp its author claimed. Subtracting it from the moment we received the blob gives how far behind the network we are running.</p>
<p><strong>Only blobs claiming a timestamp after this daemon started are counted.</strong> Anything older was authored while we were offline, so its "delay" measures how long the machine was off, not how fast the network delivers. The excluded counts are shown so the histogram's coverage stays auditable:</p>
<dl>
<dt>offline backfill</dt><dd>Authored before this session started — the intended exclusion above. Large during a cold start, and that's expected.</dd>
<dt>no timestamp</dt><dd>Blob types that carry none (raw media, DagPB).</dd>
<dt>epoch sentinel</dt><dd><code>blob.ZeroUnixTime()</code> — the genesis Change and Ref of every Account/Space home document are stamped with the Unix epoch so their CIDs are reproducible. That's a determinism marker, not an authoring time; read as age it would be ~56 years and would dominate the mean for Change and Ref. Expect roughly two of these per space you sync.</dd>
<dt>clock skew</dt><dd>The peer claimed a timestamp in our future. A negative sample would drag the percentiles down, so it's bucketed here instead.</dd>
<dt>unstashed</dt><dd>Blobs that arrived before their dependencies, sat in the stash, and were indexed later. Their true arrival time is no longer known — only the later unstash moment — so recording it would overstate the delay. A persistently large count here means the histogram is missing a real slice of traffic.</dd>
</dl>`
