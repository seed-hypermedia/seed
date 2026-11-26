package entities

import (
	"bytes"
	"context"
	"encoding/json"
	"strings"
	"testing"
	"time"

	"seed/backend/blob"
	"seed/backend/core"
	"seed/backend/core/coretest"
	documents "seed/backend/genproto/documents/v3alpha"
	entpb "seed/backend/genproto/entities/v1alpha"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	blocks "github.com/ipfs/go-block-format"
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

func TestCommentDeletionTieBreak(t *testing.T) {
	t.Parallel()
	svc := newTestServices(t, "alice")
	ctx := t.Context()
	account := svc.me.Account
	ts := time.Now().UTC().Add(-time.Minute).Round(blob.ClockPrecision)
	body := []blob.CommentBlock{{Block: blob.Block{ID_Good: "body", Type: "paragraph", Text: "comment"}}}
	target, err := blob.NewChange(account, cid.Undef, nil, 0, blob.ChangeBody{}, ts.Add(-2*time.Second))
	require.NoError(t, err)
	require.NoError(t, svc.idx.Put(ctx, target))
	version := []cid.Cid{target.CID}
	seed, err := blob.NewComment(account, "", account.Principal(), account.Principal(), "/target", version, cid.Undef, cid.Undef, body, blob.VisibilityPublic, ts.Add(-time.Second))
	require.NoError(t, err)
	live, err := blob.NewComment(account, seed.TSID(), account.Principal(), account.Principal(), "/target", version, cid.Undef, cid.Undef, body, blob.VisibilityPublic, ts)
	require.NoError(t, err)
	deleted, err := blob.NewComment(account, seed.TSID(), account.Principal(), account.Principal(), "/target", version, cid.Undef, cid.Undef, nil, blob.VisibilityPublic, ts)
	require.NoError(t, err)
	winner, loser := blocks.Block(live), blocks.Block(deleted)
	wantDeleted := false

	if bytes.Compare(deleted.CID.Hash(), live.CID.Hash()) > 0 {
		winner, loser = deleted, live
		wantDeleted = true
	}

	// Insert the CID winner first so an insertion-order tie-break selects the loser.
	require.NoError(t, svc.idx.PutMany(ctx, []blocks.Block{winner, loser}))

	authorID, err := sqlitex.QueryOnePool[int64](ctx, svc.entities.db, `SELECT id FROM public_keys WHERE principal = ?`, account.Principal())
	require.NoError(t, err)
	got, err := sqlitex.QueryOnePool[int](ctx, svc.entities.db, qIsDeletedComment(), authorID, string(seed.TSID()))
	require.NoError(t, err)
	require.Equal(t, wantDeleted, got != 0)

	batch, err := json.Marshal([]map[string]any{{"author_id": authorID, "tsid": string(seed.TSID())}})
	require.NoError(t, err)
	conn, release, err := svc.entities.db.ReadConn(ctx)
	require.NoError(t, err)
	defer release()
	rows := 0
	require.NoError(t, sqlitex.Exec(conn, qBatchDeletedComments(), func(stmt *sqlite.Stmt) error {
		rows++
		require.Equal(t, authorID, stmt.ColumnInt64(0))
		require.Equal(t, string(seed.TSID()), stmt.ColumnText(1))
		require.Equal(t, wantDeleted, stmt.ColumnInt64(2) != 0)
		return nil
	}, string(batch)))
	require.Equal(t, 1, rows)
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

// The version a hit links to is decided per hit from the history of its
// genesis, and a search reads that history once per genesis. These two tests
// pin the outcomes for hits without a block ID (titles) and for several hits
// that share one genesis.
func TestSearchEntitiesTitleVersions(t *testing.T) {
	t.Parallel()

	svc := newTestServices(t, "alice")
	kp := svc.me.Account
	clock := newTestClock()

	// The title is never written again; only the body changes.
	kept := createDoc(t, svc, kp, "/lantern", 1, clock, append([]blob.OpMap{titleOp(t, "Amber lantern")}, blockOps("b1", "first body")...)...)
	kept.edit(t, clock, replaceOp("b1", "second body"))

	// The title is rewritten after it was first indexed.
	renamed := createDoc(t, svc, kp, "/harbor", 1, clock, titleOp(t, "Cobalt harbor"))
	renamed.edit(t, clock, titleOp(t, "Cobalt harbor at dusk"))

	got := searchAll(t, svc, "Amber lantern")
	require.Len(t, got, 1)
	require.Equal(t, kept.iri(), entityDoc(got[0].Id))
	require.True(t, isLatest(got[0].Id), "a title untouched by later body edits must link to the latest version")

	got = searchAll(t, svc, "Cobalt harbor")
	byContent := map[string]*entpb.Entity{}
	for _, e := range got {
		t.Logf("hit %q -> %s", e.Content, e.Id)
		require.Equal(t, renamed.iri(), entityDoc(e.Id))
		byContent[e.Content] = e
	}

	require.Contains(t, byContent, "Cobalt harbor")
	require.Contains(t, byContent, "Cobalt harbor at dusk")
	require.False(t, isLatest(byContent["Cobalt harbor"].Id), "the superseded title must link to its old version")
	require.True(t, isLatest(byContent["Cobalt harbor at dusk"].Id), "the current title must link to the latest version")
}

func TestSearchEntitiesSharedGenesisVersions(t *testing.T) {
	t.Parallel()

	svc := newTestServices(t, "alice")
	kp := svc.me.Account
	clock := newTestClock()

	// Three documents on one genesis, so every hit below reads the same history.
	a := createDoc(t, svc, kp, "/a", 1, clock, append(blockOps("a1", "walrus stays here"), blockOps("a2", "filler one")...)...)
	b := createDocOnGenesis(t, svc, kp, "/b", 1, a.genesis, clock, append(blockOps("b1", "walrus was here"), blockOps("b2", "filler two")...)...)
	c := createDocOnGenesis(t, svc, kp, "/c", 1, a.genesis, clock, blockOps("c1", "walrus is newest")...)

	a.edit(t, clock, replaceOp("a2", "filler one edited"))
	b.edit(t, clock, replaceOp("b1", "walrus moved on"))
	c.edit(t, clock, blockOps("c2", "filler three")...)

	got := searchAll(t, svc, "walrus")
	byContent := map[string]*entpb.Entity{}
	for _, e := range got {
		t.Logf("hit %q -> %s", e.Content, e.Id)
		byContent[e.Content] = e
	}

	require.Len(t, byContent, 4)

	require.Equal(t, a.iri(), entityDoc(byContent["walrus stays here"].Id))
	require.True(t, isLatest(byContent["walrus stays here"].Id), "an untouched block must link to its document's latest version")

	require.Equal(t, b.iri(), entityDoc(byContent["walrus was here"].Id))
	require.False(t, isLatest(byContent["walrus was here"].Id), "a rewritten block must keep linking to the version that had the text")
	require.Equal(t, b.iri(), entityDoc(byContent["walrus moved on"].Id))
	require.True(t, isLatest(byContent["walrus moved on"].Id))

	require.Equal(t, c.iri(), entityDoc(byContent["walrus is newest"].Id))
	require.True(t, isLatest(byContent["walrus is newest"].Id), "an untouched block must link to its document's latest version")
}

// A block whose text around the match changes gives one result per distinct
// text: the older one keeps linking to the version that had it, the newer one
// to the latest version. A block moved without a text change stays one result
// on the latest version. Later edits to other blocks, in this document or in
// one sharing its genesis, add no results.
func TestSearchEntitiesEditedAndMovedBlocks(t *testing.T) {
	t.Parallel()

	svc := newTestServices(t, "alice")
	kp := svc.me.Account
	clock := newTestClock()

	ops := []blob.OpMap{titleOp(t, "Pelican notes")}
	ops = append(ops, blockOps("edited", "the pelican eats fish")...)
	ops = append(ops, blockOps("moved", "a pelican that moves")...)
	ops = append(ops, blockOps("still", "one pelican stays put")...)
	ops = append(ops, blockOps("other", "unrelated filler")...)
	doc := createDoc(t, svc, kp, "/pelican", 1, clock, ops...)
	sibling := createDocOnGenesis(t, svc, kp, "/sibling", 1, doc.genesis, clock, blockOps("s1", "sibling filler")...)

	doc.edit(t, clock, replaceOp("edited", "the pelican eats only fresh fish"))
	doc.edit(t, clock, blob.NewOpMoveBlocks("", []string{"moved"}, nil))
	doc.edit(t, clock, replaceOp("other", "unrelated filler edited"))
	sibling.edit(t, clock, replaceOp("s1", "sibling filler edited"))

	type result struct {
		content string
		block   string
		latest  bool
	}

	var got []result

	for _, e := range searchAll(t, svc, "pelican") {
		t.Logf("hit %s %q -> %s", e.Type, e.Content, e.Id)
		require.Equal(t, doc.iri(), entityDoc(e.Id))

		block := ""
		if i := strings.Index(e.Id, "#"); i >= 0 {
			block = e.Id[i+1:]
		}

		got = append(got, result{content: e.Content, block: block, latest: isLatest(e.Id)})
	}

	require.ElementsMatch(t, []result{
		{content: "Pelican notes", latest: true},
		{content: "the pelican eats fish", block: "edited", latest: false},
		{content: "the pelican eats only fresh fish", block: "edited", latest: true},
		{content: "a pelican that moves", block: "moved", latest: true},
		{content: "one pelican stays put", block: "still", latest: true},
	}, got)
}

func TestSearchEntitiesAccountNameListedOnce(t *testing.T) {
	t.Parallel()

	svc := newTestServices(t, "alice")
	kp := svc.me.Account
	ctx := context.Background()
	clock := newTestClock()
	account := kp.Principal().String()

	// The account's name lives in two places: the Profile blob and the home
	// document's title. Both must collapse into one search result.
	_, err := svc.documents.UpdateProfile(ctx, &documents.UpdateProfileRequest{
		Account:        account,
		SigningKeyName: "main",
		Profile:        &documents.Profile{Name: "Lunaticoin"},
	})
	require.NoError(t, err)

	genesis, err := blob.NewChange(kp, cid.Undef, nil, 0, blob.ChangeBody{}, blob.ZeroUnixTime())
	require.NoError(t, err)
	home, err := blob.NewChange(kp, genesis.CID, []cid.Cid{genesis.CID}, 1, blob.ChangeBody{OpCount: 1, Ops: []blob.OpMap{titleOp(t, "Lunaticoin")}}, clock.next())
	require.NoError(t, err)
	homeRef, err := blob.NewRef(kp, 1, genesis.CID, kp.Principal(), "", []cid.Cid{home.CID}, clock.next(), blob.VisibilityPublic)
	require.NoError(t, err)
	for _, b := range []blocks.Block{genesis, home, homeRef} {
		require.NoError(t, svc.idx.Put(ctx, b))
	}

	res, err := svc.entities.SearchEntities(ctx, &entpb.SearchEntitiesRequest{
		Query:             "Lunaticoin",
		ContentTypeFilter: []entpb.ContentTypeFilter{entpb.ContentTypeFilter_CONTENT_TYPE_TITLE},
	})
	require.NoError(t, err)
	require.Len(t, res.Entities, 1, "the account must be listed once, not once per place its name is indexed")
	require.Equal(t, "profile", res.Entities[0].Type)
	require.Equal(t, "hm://"+account, res.Entities[0].Id)
	require.Equal(t, "Lunaticoin", res.Entities[0].Content)
}

func TestSearchDelegatedCommentAuthority(t *testing.T) {
	t.Parallel()
	svc := newTestServices(t, "alice")
	bob := coretest.NewTester("bob")
	clock := newTestClock()
	doc := createDoc(t, svc, svc.me.Account, "/comments", 1, clock, titleOp(t, "Comments"))
	capability, err := blob.NewCapability(bob.Account, bob.Device.Principal(), bob.Account.Principal(), "", blob.RoleAgent, "", clock.next())
	require.NoError(t, err)
	require.NoError(t, svc.idx.Put(t.Context(), capability))
	comment, err := blob.NewComment(bob.Device, "", bob.Account.Principal(), svc.me.Account.Principal(), doc.path, []cid.Cid{doc.head}, cid.Undef, cid.Undef,
		[]blob.CommentBlock{{Block: blob.Block{ID_Good: "b1", Type: "paragraph", Text: "Delegatedsearchneedle"}}}, blob.VisibilityPublic, clock.next())
	require.NoError(t, err)
	require.NoError(t, svc.idx.Put(t.Context(), comment))
	expected := blob.RecordID{Authority: bob.Account.Principal(), TSID: comment.TSID()}.IRI().String()
	results := searchAll(t, svc, "Delegatedsearchneedle")
	require.Len(t, results, 1)
	require.Equal(t, expected, results[0].Id)
}

func TestCommentAuthorAuthoritySelfCitation(t *testing.T) {
	for _, delegated := range []bool{false, true} {
		name := "direct"
		if delegated {
			name = "delegated"
		}

		t.Run(name, func(t *testing.T) {
			svc := newTestServices(t, "alice")
			clock := newTestClock()
			doc := createDoc(t, svc, svc.me.Account, "/citations", 1, clock, titleOp(t, "Citations"))
			iris, err := json.Marshal([]string{doc.iri()})
			require.NoError(t, err)
			// Self-citation must leave the score at zero; a subsequent citation
			// from a different account must increase it to one.
			for i, author := range []coretest.Tester{svc.me, coretest.NewTester("bob")} {
				signer := author.Account
				if delegated {
					signer = author.Device
					capability, err := blob.NewCapability(author.Account, signer.Principal(), author.Account.Principal(), "", blob.RoleAgent, "", clock.next())
					require.NoError(t, err)
					require.NoError(t, svc.idx.Put(t.Context(), capability))
				}

				comment, err := blob.NewComment(signer, "", author.Account.Principal(), svc.me.Account.Principal(), doc.path, []cid.Cid{doc.head}, cid.Undef, cid.Undef,
					[]blob.CommentBlock{{Block: blob.Block{ID_Good: "b1", Type: "paragraph", Text: "Citation"}}}, blob.VisibilityPublic, clock.next())
				require.NoError(t, err)
				require.NoError(t, svc.idx.Put(t.Context(), comment))
				var score int

				require.NoError(t, svc.entities.db.WithSave(t.Context(), func(conn *sqlite.Conn) error {
					return sqlitex.Exec(conn, qAuthorAuthority(), func(stmt *sqlite.Stmt) error {
						require.Equal(t, doc.iri(), stmt.ColumnText(0))
						score = stmt.ColumnInt(1)
						return nil
					}, string(iris), string(iris))
				}))
				require.Equal(t, i, score)
			}
		})
	}
}
