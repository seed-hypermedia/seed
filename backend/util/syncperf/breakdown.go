package syncperf

import (
	"cmp"
	"slices"

	"github.com/prometheus/client_golang/prometheus"
)

// KindMedia is the column raw and DagPB blobs are folded into.
const KindMedia = "media"

// numKinds is len(Kinds) as a constant, so counters can be fixed-size arrays
// instead of maps. Two maps per bucket cost ~430 bytes; two arrays cost 112,
// which matters once buckets are per-document rather than per-space.
const numKinds = 7

// Kinds is the column order of the write breakdown. Fixed rather than derived
// from observed data so the table has stable columns from the first paint.
var Kinds = []string{KindMedia, "Ref", "Change", "Comment", "Capability", "Profile", "Contact"}

// kindIndex is the reverse of Kinds, for slotting a sample into the arrays.
var kindIndex = func() map[string]int {
	if len(Kinds) != numKinds {
		panic("BUG: numKinds must equal len(Kinds)")
	}
	m := make(map[string]int, numKinds)
	for i, k := range Kinds {
		m[k] = i
	}
	return m
}()

const (
	// maxBreakdownSites bounds the per-space map. Sites beyond the cap are
	// folded into a single overflow bucket rather than dropped, so the totals
	// stay exact even for a node subscribed to more spaces than anyone wants to
	// scroll.
	//
	// The bucket is first-come-first-served, not smallest-first: a large space
	// discovered after the cap is reached disappears into it. So the cap sits
	// far above the number of spaces a real node touches (a long tail of spaces
	// contributing a single 244-byte Contact blob is normal) rather than at a
	// tight bound.
	maxBreakdownSites = 20000

	// maxBreakdownDocs bounds the per-document map used for blobs whose space
	// isn't known when they're indexed (Changes — see docs on Tracker.docs).
	// It grows with the number of distinct documents synced, NOT with blob
	// volume: a document with ten thousand changes is one entry. At ~190 bytes
	// per entry (multihash key plus two fixed counter arrays) this caps the map
	// at roughly 19MB.
	maxBreakdownDocs = 100000
)

// OverflowSite is the label the overflow bucket renders under.
const OverflowSite = "(other sites)"

// UnattributedSite is the label for bytes that could not be pinned to a space.
const UnattributedSite = "(unattributed)"

// KindSample is one persisted blob's contribution to the breakdown. Callers
// accumulate these inside a write transaction and hand the slice over only
// after it commits, so a rolled-back batch contributes nothing.
type KindSample struct {
	// Site is the space this blob belongs to, empty when not known at index
	// time.
	Site string

	// Doc is the multihash of the document's genesis blob, used when Site is
	// empty. A Change carries no resource IRI (it is only tied to a document by
	// the Refs pointing at it) but it does carry its genesis, and the genesis is
	// enough to recover the space later — see Tracker.docs.
	//
	// Deliberately the multihash and not the blobs.id: filling a placeholder row
	// REASSIGNS its id (see blobsUpdateMissingData), and while the database
	// cascades that change, an id held in memory silently stops matching.
	Doc string

	Kind  string
	Bytes int64
}

type counts struct {
	bytes [numKinds]int64
	blobs [numKinds]int64
}

func (c *counts) add(kind int, n int64) {
	c.bytes[kind] += n
	c.blobs[kind]++
}

func (c *counts) addAll(o *counts) {
	for i := range c.bytes {
		c.bytes[i] += o.bytes[i]
		c.blobs[i] += o.blobs[i]
	}
}

func (c *counts) totals() (bytes, blobs int64) {
	for i := range c.bytes {
		bytes += c.bytes[i]
		blobs += c.blobs[i]
	}
	return bytes, blobs
}

var (
	mWrittenBytesByKind = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "seed_sync_written_bytes_by_kind_total",
		Help: "Persisted network bytes by blob kind. Site is deliberately not a label (unbounded cardinality); see /debug/network for the per-site split.",
	}, []string{"kind"})

	mWrittenBlobsByKind = prometheus.NewCounterVec(prometheus.CounterOpts{
		Name: "seed_sync_written_blobs_by_kind_total",
		Help: "Persisted network blobs by blob kind.",
	}, []string{"kind"})
)

// RecordKinds folds a committed batch's samples into the breakdown. Call only
// after the transaction commits.
func (t *Tracker) RecordKinds(samples []KindSample) {
	if len(samples) == 0 {
		return
	}

	t.bmu.Lock()
	for _, s := range samples {
		ki, ok := kindIndex[s.Kind]
		if !ok {
			continue
		}
		switch {
		case s.Site != "":
			t.siteCountsLocked(s.Site).add(ki, s.Bytes)
		case s.Doc != "":
			// Space unknown now; parked under the document's genesis and
			// resolved at render time once a Ref ties that genesis to a space.
			t.docCountsLocked(s.Doc).add(ki, s.Bytes)
		default:
			t.siteCountsLocked(UnattributedSite).add(ki, s.Bytes)
		}
	}
	t.bmu.Unlock()

	for _, s := range samples {
		mWrittenBytesByKind.WithLabelValues(s.Kind).Add(float64(s.Bytes))
		mWrittenBlobsByKind.WithLabelValues(s.Kind).Inc()
	}
}

// siteCountsLocked returns the bucket for a space, folding into the overflow
// bucket once the cap is reached. Caller must hold bmu.
func (t *Tracker) siteCountsLocked(site string) *counts {
	if t.sites == nil {
		t.sites = make(map[string]*counts, 16)
	}
	if c, ok := t.sites[site]; ok {
		return c
	}
	if len(t.sites) >= maxBreakdownSites {
		site = OverflowSite
		if c, ok := t.sites[site]; ok {
			return c
		}
	}
	c := &counts{}
	t.sites[site] = c
	return c
}

// docCountsLocked returns the bucket for a document genesis. Past the cap the
// bytes go to the unattributed bucket rather than being dropped, so totals stay
// exact. Caller must hold bmu.
func (t *Tracker) docCountsLocked(doc string) *counts {
	if t.docs == nil {
		t.docs = make(map[string]*counts, 16)
	}
	if c, ok := t.docs[doc]; ok {
		return c
	}
	if len(t.docs) >= maxBreakdownDocs {
		return t.siteCountsLocked(UnattributedSite)
	}
	c := &counts{}
	t.docs[doc] = c
	return c
}

// SiteBreakdown is one row of the write breakdown.
type SiteBreakdown struct {
	Site       string
	Bytes      map[string]int64
	Blobs      map[string]int64
	TotalBytes int64
	TotalBlobs int64
}

// BreakdownSnapshot is the whole write breakdown, ready to render.
type BreakdownSnapshot struct {
	Kinds []string
	Sites []SiteBreakdown
	Total SiteBreakdown

	// PendingDocs are genesis multihashes holding bytes whose space is not yet
	// known. Pass them through ResolveDocs to fold them into Sites.
	PendingDocs []string

	// UnclassifiedBytes is the gap between the authoritative global counter and
	// the sum of this breakdown. Normally zero; non-zero means blobs were
	// persisted that never produced a classifiable sample — most often ones
	// stashed awaiting a dependency. Surfaced rather than hidden so the columns
	// can be trusted to add up.
	UnclassifiedBytes int64
	UnclassifiedBlobs int64

	docs map[string]*counts
}

// Breakdown returns the per-space, per-kind view of everything persisted from
// the network. Buckets whose space wasn't known at index time are left in
// PendingDocs; call ResolveDocs before Finish to fold them in.
func (t *Tracker) Breakdown() BreakdownSnapshot {
	out := BreakdownSnapshot{Kinds: Kinds, docs: make(map[string]*counts)}

	t.bmu.Lock()
	for site, c := range t.sites {
		cp := *c
		out.Sites = append(out.Sites, siteBreakdownFrom(site, &cp))
	}
	for doc, c := range t.docs {
		cp := *c
		out.docs[doc] = &cp
		out.PendingDocs = append(out.PendingDocs, doc)
	}
	t.bmu.Unlock()

	out.UnclassifiedBytes = t.bytes.Load()
	out.UnclassifiedBlobs = t.blobs.Load()
	return out
}

// ResolveDocs attributes parked per-document bytes to their space. Any document
// still unresolved (no Ref indexed for it yet) lands in the unattributed
// bucket. Call once, then Finish.
func (b *BreakdownSnapshot) ResolveDocs(spaces map[string]string) {
	byName := make(map[string]*counts, len(b.Sites))
	order := make([]string, 0, len(b.Sites))
	for i := range b.Sites {
		c := countsFromBreakdown(&b.Sites[i])
		byName[b.Sites[i].Site] = c
		order = append(order, b.Sites[i].Site)
	}

	get := func(name string) *counts {
		if c, ok := byName[name]; ok {
			return c
		}
		c := &counts{}
		byName[name] = c
		order = append(order, name)
		return c
	}

	for doc, c := range b.docs {
		name := spaces[doc]
		if name == "" {
			name = UnattributedSite
		}
		get(name).addAll(c)
	}
	b.docs = nil
	b.PendingDocs = nil

	b.Sites = b.Sites[:0]
	for _, name := range order {
		b.Sites = append(b.Sites, siteBreakdownFrom(name, byName[name]))
	}
}

// Finish sorts the rows, computes totals, and works out how much of the
// authoritative byte count this breakdown failed to classify.
func (b *BreakdownSnapshot) Finish() {
	b.Total = SiteBreakdown{
		Site:  "TOTAL",
		Bytes: make(map[string]int64, numKinds),
		Blobs: make(map[string]int64, numKinds),
	}
	for _, s := range b.Sites {
		for _, k := range Kinds {
			b.Total.Bytes[k] += s.Bytes[k]
			b.Total.Blobs[k] += s.Blobs[k]
		}
		b.Total.TotalBytes += s.TotalBytes
		b.Total.TotalBlobs += s.TotalBlobs
	}

	// Biggest consumer first — that's the site worth looking at.
	slices.SortFunc(b.Sites, func(x, y SiteBreakdown) int {
		if c := cmp.Compare(y.TotalBytes, x.TotalBytes); c != 0 {
			return c
		}
		return cmp.Compare(x.Site, y.Site)
	})

	b.UnclassifiedBytes = max(b.UnclassifiedBytes-b.Total.TotalBytes, 0)
	b.UnclassifiedBlobs = max(b.UnclassifiedBlobs-b.Total.TotalBlobs, 0)
}

// Bytes is the total persisted bytes for one kind across every site.
func (b BreakdownSnapshot) Bytes(kind string) int64 { return b.Total.Bytes[kind] }

// Blobs is the total persisted blobs for one kind across every site.
func (b BreakdownSnapshot) Blobs(kind string) int64 { return b.Total.Blobs[kind] }

func siteBreakdownFrom(site string, c *counts) SiteBreakdown {
	row := SiteBreakdown{
		Site:  site,
		Bytes: make(map[string]int64, numKinds),
		Blobs: make(map[string]int64, numKinds),
	}
	for i, k := range Kinds {
		row.Bytes[k] = c.bytes[i]
		row.Blobs[k] = c.blobs[i]
	}
	row.TotalBytes, row.TotalBlobs = c.totals()
	return row
}

func countsFromBreakdown(s *SiteBreakdown) *counts {
	c := &counts{}
	for i, k := range Kinds {
		c.bytes[i] = s.Bytes[k]
		c.blobs[i] = s.Blobs[k]
	}
	return c
}
