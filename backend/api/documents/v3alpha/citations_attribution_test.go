package documents

import (
	"context"
	"testing"
	"time"

	"seed/backend/blob"
	"seed/backend/core"
	"seed/backend/core/coretest"
	pb "seed/backend/genproto/documents/v3alpha"

	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
)

// These tests pin how a document citation is attributed to its source document.
// A link lives on a Change blob, and the document that published it is the one
// whose Ref lists that Change as a head (or, when no Ref heads the Change locally,
// the nearest headed descendant). Attributing by genesis instead let every
// document sharing a genesis (republish, takeover, or the older agent releases
// that put whole import batches on the account's home genesis) claim the link,
// so a document's own internal anchors surfaced as citations from unrelated
// documents.

// citDoc is a document built from raw Change and Ref blobs, so tests control
// genesis, deps and generations exactly.
type citDoc struct {
	idx        *blob.Index
	kp         *core.KeyPair
	path       string
	genesis    cid.Cid
	head       cid.Cid
	ref        cid.Cid
	depth      int
	generation int64
}

// citClock hands out strictly increasing timestamps at the blob clock precision.
type citClock struct{ now time.Time }

func newCitClock() *citClock {
	return &citClock{now: time.Now().UTC().Add(-time.Hour).Round(blob.ClockPrecision)}
}

func (c *citClock) next() time.Time {
	c.now = c.now.Add(time.Second)
	return c.now
}

func citTitleOp(t *testing.T, title string) blob.OpMap {
	t.Helper()
	op, err := blob.NewOpSetKey("title", title)
	require.NoError(t, err)
	return op
}

func citBlockOps(id, text string) []blob.OpMap {
	return []blob.OpMap{
		blob.NewOpMoveBlocks("", []string{id}, nil),
		blob.NewOpReplaceBlock(blob.Block{ID_Good: id, Type: "paragraph", Text: text}),
	}
}

// citLinkOps creates a paragraph whose block-level link points at another document.
// The indexer records it as a doc/paragraph resource link anchored at the block.
func citLinkOps(id, text, link string) []blob.OpMap {
	return []blob.OpMap{
		blob.NewOpMoveBlocks("", []string{id}, nil),
		blob.NewOpReplaceBlock(blob.Block{ID_Good: id, Type: "paragraph", Text: text, Link: link}),
	}
}

func citIRI(kp *core.KeyPair, path string) string {
	return "hm://" + kp.Principal().String() + path
}

// createCitDoc publishes a new document whose first Change is its own genesis.
func createCitDoc(t *testing.T, idx *blob.Index, kp *core.KeyPair, path string, generation int64, clock *citClock, ops ...blob.OpMap) *citDoc {
	t.Helper()
	return createCitDocOnGenesis(t, idx, kp, path, generation, cid.Undef, clock, ops...)
}

// createCitDocOnGenesis publishes a new document whose first Change builds on an
// existing genesis, the shape the pre-#1126 agents API produced for every
// document it created (all of them on the account's home genesis).
func createCitDocOnGenesis(t *testing.T, idx *blob.Index, kp *core.KeyPair, path string, generation int64, genesis cid.Cid, clock *citClock, ops ...blob.OpMap) *citDoc {
	t.Helper()
	ctx := context.Background()

	var deps []cid.Cid
	depth := 0
	if genesis.Defined() {
		deps = []cid.Cid{genesis}
		depth = 1
	}
	ch, err := blob.NewChange(kp, genesis, deps, depth, blob.ChangeBody{OpCount: len(ops), Ops: ops}, clock.next())
	require.NoError(t, err)
	require.NoError(t, idx.Put(ctx, ch))

	if !genesis.Defined() {
		genesis = ch.CID
	}

	d := &citDoc{idx: idx, kp: kp, path: path, genesis: genesis, head: ch.CID, depth: depth, generation: generation}
	d.publishRef(t, clock)
	return d
}

func (d *citDoc) publishRef(t *testing.T, clock *citClock) {
	t.Helper()
	ref, err := blob.NewRef(d.kp, d.generation, d.genesis, d.kp.Principal(), d.path, []cid.Cid{d.head}, clock.next(), blob.VisibilityPublic)
	require.NoError(t, err)
	require.NoError(t, d.idx.Put(context.Background(), ref))
	d.ref = ref.CID
}

// tombstone publishes a Ref with no heads for the current generation.
func (d *citDoc) tombstone(t *testing.T, clock *citClock) {
	t.Helper()
	ref, err := blob.NewRef(d.kp, d.generation, d.genesis, d.kp.Principal(), d.path, nil, clock.next(), blob.VisibilityPublic)
	require.NoError(t, err)
	require.NoError(t, d.idx.Put(context.Background(), ref))
}

// edit publishes a new version on top of the current head.
func (d *citDoc) edit(t *testing.T, clock *citClock, ops ...blob.OpMap) {
	t.Helper()
	ch, err := blob.NewChange(d.kp, d.genesis, []cid.Cid{d.head}, d.depth+1, blob.ChangeBody{OpCount: len(ops), Ops: ops}, clock.next())
	require.NoError(t, err)
	require.NoError(t, d.idx.Put(context.Background(), ch))
	d.head = ch.CID
	d.depth++
	d.publishRef(t, clock)
}

// moveTo publishes the current head at a new path and turns the old path into a redirect.
func (d *citDoc) moveTo(t *testing.T, clock *citClock, newPath string) {
	t.Helper()
	ctx := context.Background()
	ref, err := blob.NewRef(d.kp, d.generation, d.genesis, d.kp.Principal(), newPath, []cid.Cid{d.head}, clock.next(), blob.VisibilityPublic)
	require.NoError(t, err)
	require.NoError(t, d.idx.Put(ctx, ref))

	redirect, err := blob.NewRefRedirect(d.kp, d.generation, d.genesis, d.kp.Principal(), d.path, blob.RedirectTarget{Space: d.kp.Principal(), Path: newPath}, clock.next())
	require.NoError(t, err)
	require.NoError(t, d.idx.Put(ctx, redirect))

	d.path = newPath
	d.ref = ref.CID
}

func (d *citDoc) iri() string {
	return citIRI(d.kp, d.path)
}

func listCitationsAll(t *testing.T, srv testServer, iri string) []*pb.Citation {
	t.Helper()
	res, err := srv.ListCitations(context.Background(), &pb.ListCitationsRequest{Iri: iri, PageSize: 50})
	require.NoError(t, err)
	return res.Citations
}

func refCitations(cs []*pb.Citation) []*pb.Citation {
	var out []*pb.Citation
	for _, c := range cs {
		if c.SourceType == "Ref" {
			out = append(out, c)
		}
	}
	return out
}

func TestListCitations_SharedGenesisSelfLink(t *testing.T) {
	t.Parallel()

	srv := newTestDocsAPI(t, "alice")
	kp := srv.me.Account
	clock := newCitClock()

	aIRI := citIRI(kp, "/a")
	a := createCitDoc(t, srv.idx, kp, "/a", 1, clock,
		append([]blob.OpMap{citTitleOp(t, "A")}, citLinkOps("F6", "see discussion", aIRI+"#PB")...)...)
	b := createCitDocOnGenesis(t, srv.idx, kp, "/b", 1, a.genesis, clock, citTitleOp(t, "B"))

	got := refCitations(listCitationsAll(t, srv, a.iri()))
	require.Len(t, got, 1, "a document's internal link is one citation from itself")
	require.Equal(t, a.iri(), got[0].Source)
	require.Equal(t, "F6", got[0].SourceContext)
	require.Equal(t, "PB", got[0].TargetFragment)
	require.Equal(t, a.ref.String(), got[0].SourceBlob.Cid)

	require.Empty(t, refCitations(listCitationsAll(t, srv, b.iri())), "nothing links to B")

	t.Run("HomeGenesisBatch", func(t *testing.T) {
		// The pre-#1126 agents API created every document on the account's
		// home genesis. The home document and the batch siblings must not be
		// reported as sources of A's internal link.
		srv := newTestDocsAPI(t, "carol")
		kp := srv.me.Account
		ctx := context.Background()
		clock := newCitClock()

		home, err := blob.NewChange(kp, cid.Undef, nil, 0, blob.ChangeBody{}, blob.ZeroUnixTime())
		require.NoError(t, err)
		require.NoError(t, srv.idx.Put(ctx, home))
		homeRef, err := blob.NewRef(kp, 0, home.CID, kp.Principal(), "", []cid.Cid{home.CID}, blob.ZeroUnixTime(), blob.VisibilityPublic)
		require.NoError(t, err)
		require.NoError(t, srv.idx.Put(ctx, homeRef))

		aIRI := citIRI(kp, "/a")
		a := createCitDocOnGenesis(t, srv.idx, kp, "/a", 1, home.CID, clock,
			append([]blob.OpMap{citTitleOp(t, "A")}, citLinkOps("F6", "see discussion", aIRI+"#PB")...)...)
		createCitDocOnGenesis(t, srv.idx, kp, "/b", 1, home.CID, clock, citTitleOp(t, "B"))
		createCitDocOnGenesis(t, srv.idx, kp, "/c", 1, home.CID, clock, citTitleOp(t, "C"))

		got := refCitations(listCitationsAll(t, srv, a.iri()))
		require.Len(t, got, 1)
		require.Equal(t, a.iri(), got[0].Source)
	})
}

func TestListCitations_SharedGenesisSiblingLink(t *testing.T) {
	t.Parallel()

	srv := newTestDocsAPI(t, "alice")
	kp := srv.me.Account
	clock := newCitClock()

	a := createCitDoc(t, srv.idx, kp, "/a", 1, clock, append([]blob.OpMap{citTitleOp(t, "A")}, citBlockOps("b1", "target block")...)...)
	b := createCitDocOnGenesis(t, srv.idx, kp, "/b", 1, a.genesis, clock, citLinkOps("L1", "to A", a.iri()+"#b1")...)

	got := refCitations(listCitationsAll(t, srv, a.iri()))
	require.Len(t, got, 1)
	require.Equal(t, b.iri(), got[0].Source, "the link belongs to B, not to A which merely shares the genesis")
	require.Equal(t, b.ref.String(), got[0].SourceBlob.Cid)

	// Later versions of B head later Changes; the citation stays attributed once.
	b.edit(t, clock, citBlockOps("x", "unrelated")...)
	b.edit(t, clock, citBlockOps("y", "unrelated too")...)
	got = refCitations(listCitationsAll(t, srv, a.iri()))
	require.Len(t, got, 1)
	require.Equal(t, b.iri(), got[0].Source)
}

func TestListCitations_RepublishIsNeverASource(t *testing.T) {
	t.Parallel()

	srv := newTestDocsAPI(t, "alice")
	kp := srv.me.Account
	bob := coretest.NewTester("bob").Account
	ctx := context.Background()
	clock := newCitClock()

	aIRI := citIRI(kp, "/a")
	a := createCitDoc(t, srv.idx, kp, "/a", 1, clock,
		append([]blob.OpMap{citTitleOp(t, "A")}, citLinkOps("F6", "see discussion", aIRI+"#PB")...)...)

	// A republish carries the target's genesis but has no heads.
	mirror, err := blob.NewRefRedirect(bob, 1, a.genesis, bob.Principal(), "/mirror", blob.RedirectTarget{Space: kp.Principal(), Path: "/a", Republish: true}, clock.next())
	require.NoError(t, err)
	require.NoError(t, srv.idx.Put(ctx, mirror))
	mirror2, err := blob.NewRefRedirect(kp, 1, a.genesis, kp.Principal(), "/mirror2", blob.RedirectTarget{Space: kp.Principal(), Path: "/a", Republish: true}, clock.next())
	require.NoError(t, err)
	require.NoError(t, srv.idx.Put(ctx, mirror2))

	got := refCitations(listCitationsAll(t, srv, a.iri()))
	require.Len(t, got, 1)
	require.Equal(t, a.iri(), got[0].Source)
}

func TestListCitations_SourceMovedReportsNewPath(t *testing.T) {
	t.Parallel()

	srv := newTestDocsAPI(t, "alice")
	kp := srv.me.Account
	clock := newCitClock()

	a := createCitDoc(t, srv.idx, kp, "/a", 1, clock, append([]blob.OpMap{citTitleOp(t, "A")}, citBlockOps("b1", "target block")...)...)
	s := createCitDoc(t, srv.idx, kp, "/s", 1, clock, citLinkOps("L1", "to A", a.iri()+"#b1")...)

	s.moveTo(t, clock, "/s2")
	got := refCitations(listCitationsAll(t, srv, a.iri()))
	require.Len(t, got, 1, "the old-path and new-path Refs head the same Change and collapse into one row")
	require.Equal(t, citIRI(kp, "/s2"), got[0].Source)

	s.moveTo(t, clock, "/s3")
	got = refCitations(listCitationsAll(t, srv, a.iri()))
	require.Len(t, got, 1)
	require.Equal(t, citIRI(kp, "/s3"), got[0].Source, "multi-hop moves resolve to the final address")
}

func TestListCitations_SourceDeletedAndRecreated(t *testing.T) {
	t.Parallel()

	srv := newTestDocsAPI(t, "alice")
	kp := srv.me.Account
	clock := newCitClock()

	a := createCitDoc(t, srv.idx, kp, "/a", 1, clock,
		append([]blob.OpMap{citTitleOp(t, "A")}, append(citBlockOps("b1", "one"), citBlockOps("b2", "two")...)...)...)
	s := createCitDoc(t, srv.idx, kp, "/s", 1, clock, citLinkOps("L1", "to A", a.iri()+"#b1")...)
	require.Len(t, refCitations(listCitationsAll(t, srv, a.iri())), 1)

	s.tombstone(t, clock)
	require.Empty(t, refCitations(listCitationsAll(t, srv, a.iri())), "a deleted document does not cite")

	s2 := createCitDoc(t, srv.idx, kp, "/s", 2, clock, citLinkOps("L2", "to A again", a.iri()+"#b2")...)
	got := refCitations(listCitationsAll(t, srv, a.iri()))
	require.Len(t, got, 1, "only the re-created generation's link counts")
	require.Equal(t, "b2", got[0].TargetFragment)
	require.Equal(t, s2.iri(), got[0].Source)
	require.Equal(t, s2.ref.String(), got[0].SourceBlob.Cid)

	t.Run("Undelete", func(t *testing.T) {
		srv := newTestDocsAPI(t, "bob")
		kp := srv.me.Account
		clock := newCitClock()

		a := createCitDoc(t, srv.idx, kp, "/a", 1, clock, append([]blob.OpMap{citTitleOp(t, "A")}, citBlockOps("b1", "one")...)...)
		s := createCitDoc(t, srv.idx, kp, "/s", 1, clock, citLinkOps("L1", "to A", a.iri()+"#b1")...)

		s.tombstone(t, clock)
		require.Empty(t, refCitations(listCitationsAll(t, srv, a.iri())))

		s.publishRef(t, clock)
		got := refCitations(listCitationsAll(t, srv, a.iri()))
		require.Len(t, got, 1, "an alive Ref after the tombstone restores the citation")
		require.Equal(t, "b1", got[0].TargetFragment)
	})
}

func TestListCitations_UnheadedChangeResolvesThroughDescendant(t *testing.T) {
	t.Parallel()

	srv := newTestDocsAPI(t, "alice")
	kp := srv.me.Account
	ctx := context.Background()
	clock := newCitClock()

	a := createCitDoc(t, srv.idx, kp, "/a", 1, clock, append([]blob.OpMap{citTitleOp(t, "A")}, citBlockOps("b1", "one")...)...)

	// Change 1 carries the link, Change 2 builds on it, and only Change 2 is
	// ever headed by a Ref (the shape of a peer that synced the latest Ref only).
	ops1 := citLinkOps("L1", "to A", a.iri()+"#b1")
	ch1, err := blob.NewChange(kp, cid.Undef, nil, 0, blob.ChangeBody{OpCount: len(ops1), Ops: ops1}, clock.next())
	require.NoError(t, err)
	require.NoError(t, srv.idx.Put(ctx, ch1))
	ops2 := citBlockOps("x", "later")
	ch2, err := blob.NewChange(kp, ch1.CID, []cid.Cid{ch1.CID}, 1, blob.ChangeBody{OpCount: len(ops2), Ops: ops2}, clock.next())
	require.NoError(t, err)
	require.NoError(t, srv.idx.Put(ctx, ch2))
	ref, err := blob.NewRef(kp, 1, ch1.CID, kp.Principal(), "/s", []cid.Cid{ch2.CID}, clock.next(), blob.VisibilityPublic)
	require.NoError(t, err)
	require.NoError(t, srv.idx.Put(ctx, ref))

	got := refCitations(listCitationsAll(t, srv, a.iri()))
	require.Len(t, got, 1)
	require.Equal(t, citIRI(kp, "/s"), got[0].Source)
	require.Equal(t, ref.CID.String(), got[0].SourceBlob.Cid, "attributed through the Ref heading the descendant")

	// A Change that no local document's history contains is not a citation.
	ops3 := citLinkOps("L9", "orphan link", a.iri()+"#b1")
	orphan, err := blob.NewChange(kp, cid.Undef, nil, 0, blob.ChangeBody{OpCount: len(ops3), Ops: ops3}, clock.next())
	require.NoError(t, err)
	require.NoError(t, srv.idx.Put(ctx, orphan))

	got = refCitations(listCitationsAll(t, srv, a.iri()))
	require.Len(t, got, 1)
	require.Equal(t, "L1", got[0].SourceContext)
}

func TestListCitations_PaginatesAttributedRows(t *testing.T) {
	t.Parallel()

	srv := newTestDocsAPI(t, "alice")
	kp := srv.me.Account
	clock := newCitClock()

	a := createCitDoc(t, srv.idx, kp, "/a", 1, clock,
		append([]blob.OpMap{citTitleOp(t, "A")}, append(citBlockOps("b1", "one"), append(citBlockOps("b2", "two"), citBlockOps("b3", "three")...)...)...)...)
	var ops []blob.OpMap
	ops = append(ops, citLinkOps("L1", "one", a.iri()+"#b1")...)
	ops = append(ops, citLinkOps("L2", "two", a.iri()+"#b2")...)
	ops = append(ops, citLinkOps("L3", "three", a.iri()+"#b3")...)
	b := createCitDocOnGenesis(t, srv.idx, kp, "/b", 1, a.genesis, clock, ops...)

	seen := map[string]bool{}
	var token string
	for i := 0; i < 10; i++ {
		res, err := srv.ListCitations(context.Background(), &pb.ListCitationsRequest{Iri: a.iri(), PageSize: 1, PageToken: token})
		require.NoError(t, err)
		for _, c := range res.Citations {
			require.Equal(t, b.iri(), c.Source)
			seen[c.TargetFragment] = true
		}
		token = res.NextPageToken
		if token == "" {
			break
		}
	}
	require.Empty(t, token, "pagination must terminate")
	require.Equal(t, map[string]bool{"b1": true, "b2": true, "b3": true}, seen)
}
