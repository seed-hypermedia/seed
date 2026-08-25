package syncperf

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

// resolved runs the full render-time sequence a caller must follow.
func resolved(t *Tracker, spaces map[string]string) BreakdownSnapshot {
	b := t.Breakdown()
	b.ResolveDocs(spaces)
	b.Finish()
	return b
}

func row(t *testing.T, b BreakdownSnapshot, space string) SpaceBreakdown {
	t.Helper()
	for _, s := range b.Spaces {
		if s.Space == space {
			return s
		}
	}
	t.Fatalf("no row for %q; have %v", space, spaceNamesOf(b))
	return SpaceBreakdown{}
}

func spaceNamesOf(b BreakdownSnapshot) []string {
	out := make([]string, 0, len(b.Spaces))
	for _, s := range b.Spaces {
		out = append(out, s.Space)
	}
	return out
}

// TestBreakdownRoutesSamples covers the three-way split in RecordKinds: a known
// space goes straight to its row, an unknown space parks under the document,
// and a sample with neither is unattributed.
func TestBreakdownRoutesSamples(t *testing.T) {
	tr := NewTracker(time.Now())
	tr.RecordKinds([]KindSample{
		{Space: "spaceA", Kind: KindMedia, Bytes: 1000},
		{Doc: "g7", Kind: "Change", Bytes: 300},
		{Kind: "Ref", Bytes: 50},
	})

	b := tr.Breakdown()
	require.Equal(t, []string{"g7"}, b.PendingDocs, "the doc-keyed sample must be pending")

	b.ResolveDocs(map[string]string{"g7": "spaceB"})
	b.Finish()

	require.EqualValues(t, 1000, row(t, b, "spaceA").Bytes[KindMedia])
	require.EqualValues(t, 300, row(t, b, "spaceB").Bytes["Change"],
		"a resolved document's bytes belong to its space")
	require.EqualValues(t, 50, row(t, b, UnattributedSpace).Bytes["Ref"])
	require.EqualValues(t, 1350, b.Total.TotalBytes)
	require.EqualValues(t, 3, b.Total.TotalBlobs)
}

// TestBreakdownUnresolvedDocsAreUnattributed is the case that matters most in
// practice: a Change whose Ref hasn't arrived yet. It must not be lost, and it
// must not be credited to an arbitrary space.
func TestBreakdownUnresolvedDocsAreUnattributed(t *testing.T) {
	tr := NewTracker(time.Now())
	tr.RecordKinds([]KindSample{
		{Doc: "g1", Kind: "Change", Bytes: 100},
		{Doc: "g2", Kind: "Change", Bytes: 200},
	})

	// Only doc 1 has a Ref indexed so far.
	b := resolved(tr, map[string]string{"g1": "spaceA"})

	require.EqualValues(t, 100, row(t, b, "spaceA").Bytes["Change"])
	require.EqualValues(t, 200, row(t, b, UnattributedSpace).Bytes["Change"])
	require.EqualValues(t, 300, b.Total.TotalBytes, "nothing may be dropped")
}

// TestBreakdownDocsMergeIntoExistingSpace guards the fold: a space that already
// has directly-attributed bytes must accumulate the resolved ones, not replace
// or duplicate them.
func TestBreakdownDocsMergeIntoExistingSpace(t *testing.T) {
	tr := NewTracker(time.Now())
	tr.RecordKinds([]KindSample{
		{Space: "spaceA", Kind: KindMedia, Bytes: 1000},
		{Doc: "g9", Kind: "Change", Bytes: 400},
		{Doc: "g9", Kind: "Change", Bytes: 600},
	})

	b := resolved(tr, map[string]string{"g9": "spaceA"})

	r := row(t, b, "spaceA")
	require.EqualValues(t, 1000, r.Bytes[KindMedia])
	require.EqualValues(t, 1000, r.Bytes["Change"], "both change samples must accumulate")
	require.EqualValues(t, 2000, r.TotalBytes)
	require.EqualValues(t, 3, r.TotalBlobs)
	require.Len(t, b.Spaces, 1, "the resolved doc must not create a second row")
}

// TestBreakdownSortsBySizeDescending pins the row order the page relies on.
func TestBreakdownSortsBySizeDescending(t *testing.T) {
	tr := NewTracker(time.Now())
	tr.RecordKinds([]KindSample{
		{Space: "small", Kind: KindMedia, Bytes: 10},
		{Space: "big", Kind: KindMedia, Bytes: 9000},
		{Space: "mid", Kind: KindMedia, Bytes: 500},
	})

	b := resolved(tr, nil)
	require.Equal(t, []string{"big", "mid", "small"}, spaceNamesOf(b))
}

// TestBreakdownUnclassifiedIsTheGap: the blockstore's byte total is
// authoritative, and anything it counted that never produced a sample (a
// stashed blob, say) must surface rather than being silently absorbed.
func TestBreakdownUnclassifiedIsTheGap(t *testing.T) {
	tr := NewTracker(time.Now())
	tr.RecordWrite(3, 1000) // what the blockstore actually wrote
	tr.RecordKinds([]KindSample{
		{Space: "spaceA", Kind: KindMedia, Bytes: 600},
	})

	b := resolved(tr, nil)
	require.EqualValues(t, 400, b.UnclassifiedBytes)
	require.EqualValues(t, 2, b.UnclassifiedBlobs)
}

func TestBreakdownNoUnclassifiedWhenFullyAccounted(t *testing.T) {
	tr := NewTracker(time.Now())
	tr.RecordWrite(1, 600)
	tr.RecordKinds([]KindSample{{Space: "spaceA", Kind: KindMedia, Bytes: 600}})

	b := resolved(tr, nil)
	require.Zero(t, b.UnclassifiedBytes)
	require.Zero(t, b.UnclassifiedBlobs)
}

// TestBreakdownDocCapKeepsTotalsExact exercises the overflow path: past
// maxBreakdownDocs the map stops growing, but the bytes must still be counted
// — under (unattributed), since their space can no longer be recovered.
func TestBreakdownDocCapKeepsTotalsExact(t *testing.T) {
	tr := NewTracker(time.Now())

	const over = maxBreakdownDocs + 500
	samples := make([]KindSample, 0, over)
	for i := 1; i <= over; i++ {
		samples = append(samples, KindSample{Doc: fmt.Sprintf("g%d", i), Kind: "Change", Bytes: 10})
	}
	tr.RecordKinds(samples)

	tr.bmu.Lock()
	docs := len(tr.docs)
	tr.bmu.Unlock()
	require.Equal(t, maxBreakdownDocs, docs, "the doc map must stop at the cap")

	b := resolved(tr, nil)
	require.EqualValues(t, over*10, b.Total.TotalBytes, "capped docs must still be counted")
	require.EqualValues(t, over, b.Total.TotalBlobs)
}

// TestBreakdownSpaceCapFoldsToOverflow is the same property for spaces, which
// fold into a named bucket rather than into unattributed.
func TestBreakdownSpaceCapFoldsToOverflow(t *testing.T) {
	tr := NewTracker(time.Now())

	const over = maxBreakdownSpaces + 25
	samples := make([]KindSample, 0, over)
	for i := range over {
		samples = append(samples, KindSample{Space: fmt.Sprintf("space%d", i), Kind: KindMedia, Bytes: 10})
	}
	tr.RecordKinds(samples)

	b := resolved(tr, nil)
	require.EqualValues(t, over*10, b.Total.TotalBytes, "overflowed spaces must still be counted")
	require.EqualValues(t, 250, row(t, b, OverflowSpace).TotalBytes, "the 25 past the cap land in overflow")
}

// TestBreakdownIgnoresUnknownKind: a kind outside Kinds has no column to land
// in, so it must be dropped from the breakdown rather than corrupting a slot.
func TestBreakdownIgnoresUnknownKind(t *testing.T) {
	tr := NewTracker(time.Now())
	tr.RecordKinds([]KindSample{
		{Space: "spaceA", Kind: "NotAKind", Bytes: 999},
		{Space: "spaceA", Kind: KindMedia, Bytes: 1},
	})

	b := resolved(tr, nil)
	require.EqualValues(t, 1, b.Total.TotalBytes)
}

func TestKindIndexCoversEveryKind(t *testing.T) {
	require.Len(t, Kinds, numKinds)
	for i, k := range Kinds {
		require.Equal(t, i, kindIndex[k], "kindIndex must mirror Kinds order")
	}
}
