package entities

import (
	"context"
	"strings"
	"testing"
	"time"

	"seed/backend/blob"
	"seed/backend/core"
	"seed/backend/core/coretest"
	entpb "seed/backend/genproto/entities/v1alpha"

	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
)

// These tests pin how a full-text hit is attributed to a document. A title or
// body row lives on a Change blob, and the document that published it is the
// one whose Ref lists that Change as a head. Resolving by genesis instead lets
// documents that share a genesis (republish, takeover, or the older agent
// releases that put whole batches on the account's home genesis) claim each
// other's hits, or lose them when the resource's recorded genesis went stale.

// testDoc is a document built from raw Change and Ref blobs, so tests control
// genesis, deps and generations exactly.
type testDoc struct {
	svc        testServices
	kp         *core.KeyPair
	path       string
	genesis    cid.Cid
	head       cid.Cid
	depth      int
	generation int64
}

// testClock hands out strictly increasing timestamps at the blob clock precision.
type testClock struct{ now time.Time }

func newTestClock() *testClock {
	return &testClock{now: time.Now().UTC().Add(-time.Hour).Round(blob.ClockPrecision)}
}

func (c *testClock) next() time.Time {
	c.now = c.now.Add(time.Second)
	return c.now
}

func titleOp(t *testing.T, title string) blob.OpMap {
	t.Helper()
	op, err := blob.NewOpSetKey("title", title)
	require.NoError(t, err)
	return op
}

func blockOps(id, text string) []blob.OpMap {
	return []blob.OpMap{
		blob.NewOpMoveBlocks("", []string{id}, nil),
		blob.NewOpReplaceBlock(blob.Block{ID_Good: id, Type: "paragraph", Text: text}),
	}
}

func replaceOp(id, text string) blob.OpMap {
	return blob.NewOpReplaceBlock(blob.Block{ID_Good: id, Type: "paragraph", Text: text})
}

// createDoc publishes a new document whose first Change is its own genesis
// (what the CLI and the fixed agents API do).
func createDoc(t *testing.T, svc testServices, kp *core.KeyPair, path string, generation int64, clock *testClock, ops ...blob.OpMap) *testDoc {
	t.Helper()
	return createDocOnGenesis(t, svc, kp, path, generation, cid.Undef, clock, ops...)
}

// createDocOnGenesis publishes a new document whose first Change builds on an
// existing genesis, the shape the pre-#1126 agents API produced for every
// document it created (all of them on the account's home genesis).
func createDocOnGenesis(t *testing.T, svc testServices, kp *core.KeyPair, path string, generation int64, genesis cid.Cid, clock *testClock, ops ...blob.OpMap) *testDoc {
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
	require.NoError(t, svc.idx.Put(ctx, ch))

	if !genesis.Defined() {
		genesis = ch.CID
	}

	d := &testDoc{svc: svc, kp: kp, path: path, genesis: genesis, head: ch.CID, depth: depth, generation: generation}
	d.publishRef(t, clock)
	return d
}

func (d *testDoc) publishRef(t *testing.T, clock *testClock) {
	t.Helper()
	ref, err := blob.NewRef(d.kp, d.generation, d.genesis, d.kp.Principal(), d.path, []cid.Cid{d.head}, clock.next(), blob.VisibilityPublic)
	require.NoError(t, err)
	require.NoError(t, d.svc.idx.Put(context.Background(), ref))
}

// edit publishes a new version on top of the current head.
func (d *testDoc) edit(t *testing.T, clock *testClock, ops ...blob.OpMap) {
	t.Helper()
	ch, err := blob.NewChange(d.kp, d.genesis, []cid.Cid{d.head}, d.depth+1, blob.ChangeBody{OpCount: len(ops), Ops: ops}, clock.next())
	require.NoError(t, err)
	require.NoError(t, d.svc.idx.Put(context.Background(), ch))
	d.head = ch.CID
	d.depth++
	d.publishRef(t, clock)
}

func (d *testDoc) iri() string {
	return "hm://" + d.kp.Principal().String() + d.path
}

func searchAll(t *testing.T, svc testServices, query string) []*entpb.Entity {
	t.Helper()
	res, err := svc.entities.SearchEntities(context.Background(), &entpb.SearchEntitiesRequest{
		Query:       query,
		IncludeBody: true,
	})
	require.NoError(t, err)
	return res.Entities
}

// entityDoc strips version and fragment from an entity ID.
func entityDoc(id string) string {
	if i := strings.Index(id, "?"); i >= 0 {
		return id[:i]
	}
	return id
}

// isLatest reports whether the entity ID carries the latest-version marker,
// which sits between the version and the block fragment: ?v=<version>&l#<block>.
func isLatest(id string) bool {
	if i := strings.Index(id, "#"); i >= 0 {
		id = id[:i]
	}
	return strings.HasSuffix(id, "&l")
}

func TestSearchEntitiesSharedGenesisAttribution(t *testing.T) {
	t.Parallel()

	svc := newTestServices(t, "alice")
	kp := svc.me.Account
	clock := newTestClock()

	a := createDoc(t, svc, kp, "/quantum", 1, clock, titleOp(t, "Quantum kettle"))
	// Second document on the first one's genesis, published later so a
	// genesis-based tie-break would hand it the first document's hits too.
	b := createDocOnGenesis(t, svc, kp, "/velvet", 1, a.genesis, clock, titleOp(t, "Velvet compass"))

	got := searchAll(t, svc, "Quantum kettle")
	require.Len(t, got, 1)
	require.Equal(t, a.iri(), entityDoc(got[0].Id), "the first document's title must resolve to the first document")

	got = searchAll(t, svc, "Velvet compass")
	require.Len(t, got, 1)
	require.Equal(t, b.iri(), entityDoc(got[0].Id), "the second document's title must resolve to the second document")

	// Updating the first document last flips the tie-break the other way.
	a.edit(t, clock, blockOps("b1", "Kettle body text")...)

	got = searchAll(t, svc, "Velvet compass")
	require.Len(t, got, 1)
	require.Equal(t, b.iri(), entityDoc(got[0].Id), "the second document's title must still resolve to the second document")

	got = searchAll(t, svc, "Kettle body")
	require.Len(t, got, 1)
	require.Equal(t, a.iri(), entityDoc(got[0].Id))
}

func TestSearchEntitiesRecreatedPathStaleGenesis(t *testing.T) {
	t.Parallel()

	svc := newTestServices(t, "alice")
	kp := svc.me.Account
	ctx := context.Background()
	clock := newTestClock()

	// Generation 1: a document at /lighthouse, then its tombstone.
	old, err := blob.NewChange(kp, cid.Undef, nil, 0, blob.ChangeBody{OpCount: 1, Ops: []blob.OpMap{titleOp(t, "Old lighthouse")}}, clock.next())
	require.NoError(t, err)
	oldRef, err := blob.NewRef(kp, 1, old.CID, kp.Principal(), "/lighthouse", []cid.Cid{old.CID}, clock.next(), blob.VisibilityPublic)
	require.NoError(t, err)
	tombstone, err := blob.NewRef(kp, 1, old.CID, kp.Principal(), "/lighthouse", nil, clock.next(), blob.VisibilityPublic)
	require.NoError(t, err)

	// Generation 2: a new document at the same path with its own genesis.
	fresh, err := blob.NewChange(kp, cid.Undef, nil, 0, blob.ChangeBody{OpCount: 1, Ops: []blob.OpMap{titleOp(t, "New lighthouse")}}, clock.next())
	require.NoError(t, err)
	freshRef, err := blob.NewRef(kp, 2, fresh.CID, kp.Principal(), "/lighthouse", []cid.Cid{fresh.CID}, clock.next(), blob.VisibilityPublic)
	require.NoError(t, err)

	// Index the old generation's Refs last, the order a sync can deliver them
	// in, so the resource's recorded genesis is the old one while its current
	// generation is the new document.
	for _, b := range []blob.Encoded[*blob.Change]{old, fresh} {
		require.NoError(t, svc.idx.Put(ctx, b))
	}
	for _, b := range []blob.Encoded[*blob.Ref]{freshRef, oldRef, tombstone} {
		require.NoError(t, svc.idx.Put(ctx, b))
	}

	iri := "hm://" + kp.Principal().String() + "/lighthouse"

	got := searchAll(t, svc, "New lighthouse")
	require.Len(t, got, 1, "the current document at the path must be found")
	require.Equal(t, iri, entityDoc(got[0].Id))
	require.True(t, isLatest(got[0].Id))

	got = searchAll(t, svc, "Old lighthouse")
	require.Empty(t, got, "the deleted generation's content must not be attributed to the new document")
}

func TestSearchEntitiesRepublishResolvesTarget(t *testing.T) {
	t.Parallel()

	svc := newTestServices(t, "alice")
	alice := svc.me.Account
	bob := coretest.NewTester("bob").Account
	ctx := context.Background()
	clock := newTestClock()

	guide := createDoc(t, svc, alice, "/guide", 1, clock, append([]blob.OpMap{titleOp(t, "Harbor almanac")}, blockOps("b1", "Tides and moorings")...)...)

	// Bob republishes alice's guide: a redirect Ref on alice's genesis, no heads.
	republish, err := blob.NewRefRedirect(bob, 1, guide.genesis, bob.Principal(), "/mirror", blob.RedirectTarget{
		Space:     alice.Principal(),
		Path:      "/guide",
		Republish: true,
	}, clock.next())
	require.NoError(t, err)
	require.NoError(t, svc.idx.Put(ctx, republish))

	for _, q := range []string{"Harbor almanac", "Tides and moorings"} {
		got := searchAll(t, svc, q)
		require.Len(t, got, 1, "query %q", q)
		require.Equal(t, guide.iri(), entityDoc(got[0].Id), "query %q must resolve to alice's document, not the republish", q)
	}

	// Bob takes the republish over: his Change builds on alice's DAG and a new
	// generation at /mirror heads it. Alice's rows stay hers; bob's are his.
	takeover, err := blob.NewChange(bob, guide.genesis, []cid.Cid{guide.head}, guide.depth+1, blob.ChangeBody{OpCount: 2, Ops: blockOps("b2", "Sardine ledger")}, clock.next())
	require.NoError(t, err)
	require.NoError(t, svc.idx.Put(ctx, takeover))
	takeoverRef, err := blob.NewRef(bob, 2, guide.genesis, bob.Principal(), "/mirror", []cid.Cid{takeover.CID}, clock.next(), blob.VisibilityPublic)
	require.NoError(t, err)
	require.NoError(t, svc.idx.Put(ctx, takeoverRef))

	mirror := "hm://" + bob.Principal().String() + "/mirror"

	got := searchAll(t, svc, "Sardine ledger")
	require.Len(t, got, 1)
	require.Equal(t, mirror, entityDoc(got[0].Id))

	got = searchAll(t, svc, "Harbor almanac")
	require.Len(t, got, 1)
	require.Equal(t, guide.iri(), entityDoc(got[0].Id), "alice's title must still resolve to alice's document after the takeover")
}

func TestSearchEntitiesFoodVersions(t *testing.T) {
	t.Parallel()

	svc := newTestServices(t, "alice")
	kp := svc.me.Account
	clock := newTestClock()

	// v1: two blocks. v2 rewrites the first. v3 and v4 touch only the second.
	doc := createDoc(t, svc, kp, "/meals", 1, clock, append(append([]blob.OpMap{titleOp(t, "Meals")}, blockOps("b1", "I love food")...), blockOps("b2", "second block")...)...)
	doc.edit(t, clock, replaceOp("b1", "I hate food"))
	doc.edit(t, clock, replaceOp("b2", "second block edited"))
	doc.edit(t, clock, replaceOp("b2", "second block edited again"))

	got := searchAll(t, svc, "food")
	for _, e := range got {
		t.Logf("hit %q -> %s", e.Content, e.Id)
	}
	require.Len(t, got, 2, "each version of the block with a different context is its own result, and unrelated edits add none")

	byContent := map[string]*entpb.Entity{}
	for _, e := range got {
		require.Equal(t, doc.iri(), entityDoc(e.Id))
		byContent[e.Content] = e
	}
	require.Contains(t, byContent, "I love food")
	require.Contains(t, byContent, "I hate food")
	require.False(t, isLatest(byContent["I love food"].Id), "the superseded text must link to its old version")
	require.True(t, isLatest(byContent["I hate food"].Id), "unrelated later edits carry the current text forward to the latest version")
}
