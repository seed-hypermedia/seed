package blob

import (
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"math/rand/v2"
	"slices"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"seed/backend/core"
	"seed/backend/core/coretest"
	"seed/backend/ipfs"
	"seed/backend/storage"
	"seed/backend/util/cclock"
	"seed/backend/util/must"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"
	"seed/backend/util/syncperf"

	"github.com/RoaringBitmap/roaring/v2/roaring64"
	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
	"go.uber.org/zap/zaptest/observer"
)

// Indexing must produce the same derived state however blobs are batched and
// ordered: one at a time in causal order, all in one batch, in shuffled chunks,
// in reverse, or by a full reindex. Batches defer aggregate work to their
// flush, and this checks that deferring changes nothing observable.
func TestIndexingIsIndependentOfBatching(t *testing.T) {
	t.Parallel()

	// A document the model can't replay at its current heads loses its derived
	// Cards and Collection shape, whether it was indexed live or by a reindex.
	var failures atomic.Int64

	failing := func(iri IRI, changes []ChangeRecord) (DerivedDocFields, error) {
		if len(changes)%3 == 0 {
			failures.Add(1)
			return DerivedDocFields{}, errors.New("cannot replay")
		}

		return fakeDeriveDocFields(iri, changes)
	}
	t.Run("deriving", func(t *testing.T) {
		testIndexingIsIndependentOfBatching(t, fakeDeriveDocFields)
	})
	t.Run("failing to derive", func(t *testing.T) {
		testIndexingIsIndependentOfBatching(t, failing)
		require.Positive(t, failures.Load(), "the corpus has documents the deriver fails on")
	})
}

func testIndexingIsIndependentOfBatching(t *testing.T, derive DeriveDocFields) {
	corpus := buildIndexingCorpus(t)

	open := func(t *testing.T) (*sqlitex.Pool, *Index) {
		db := storage.MakeTestDB(t)
		idx := must.Do2(OpenIndex(t.Context(), db, zap.NewNop()))
		idx.SetDeriveDocFields(derive)
		return db, idx
	}

	// The reference: every blob on its own, in causal order.
	refDB, refIdx := open(t)
	for _, blk := range corpus {
		require.NoError(t, refIdx.Put(t.Context(), blk))
	}

	want := dumpDerivedIndex(t, refDB)

	// Sanity checks that the corpus exercises what it's meant to.
	require.NotEmpty(t, want["document_generations"])
	require.NotEmpty(t, want["comments_live"])
	require.NotEmpty(t, want["document_comment_stats"])
	stashed := strings.Join(want["stashed_blobs"], "\n")
	require.Contains(t, stashed, "BadData", "the corpus has invalid blobs")
	require.Contains(t, stashed, "PermissionDenied", "the corpus has unauthorized blobs")
	require.Contains(t, stashed, errCommentNoVersion.Error(), "a comment without a version is bad data")
	require.Contains(t, stashed, "is not a Change of genesis", "foreign history is bad data")
	derived := strings.Join(want["document_attributes"], "\n")
	require.Contains(t, derived, IsCollectionAttr, "document fields are derived")

	requireSameIndex := func(t *testing.T, got map[string][]string) {
		t.Helper()
		for _, table := range slices.Sorted(maps.Keys(want)) {
			missing, extra := diffRows(want[table], got[table])
			require.True(t, len(missing) == 0 && len(extra) == 0, "table %s differs\nmissing:\n%s\nextra:\n%s",
				table, strings.Join(missing, "\n"), strings.Join(extra, "\n"))
		}
	}

	t.Run("reindex", func(t *testing.T) {
		db := storage.MakeTestDB(t)
		core, logs := observer.New(zap.InfoLevel)
		idx := must.Do2(OpenIndex(t.Context(), db, zap.New(core)))
		idx.SetDeriveDocFields(derive)
		require.NoError(t, idx.PutMany(t.Context(), corpus))
		require.NoError(t, idx.Reindex(t.Context()))
		requireSameIndex(t, dumpDerivedIndex(t, db))

		// One batch applies every generation of a document together, so a
		// later generation that builds on an earlier one starts from it.
		finished := logs.FilterMessage("ReindexingFinished").All()
		require.NotEmpty(t, finished)
		fields := finished[len(finished)-1].ContextMap()
		require.Positive(t, fields["generationsSeeded"], "a generation starts from the previous one")
		require.Positive(t, fields["generationsDerived"], "document fields are derived")
	})

	t.Run("one batch", func(t *testing.T) {
		db, idx := open(t)
		require.NoError(t, idx.PutMany(t.Context(), corpus))
		requireSameIndex(t, dumpDerivedIndex(t, db))
	})

	t.Run("reverse", func(t *testing.T) {
		db, idx := open(t)
		for _, blk := range slices.Backward(corpus) {
			require.NoError(t, idx.Put(t.Context(), blk))
		}

		requireSameIndex(t, withoutOrderDependentTables(dumpDerivedIndex(t, db), want))
	})

	for seed := range uint64(8) {
		t.Run("shuffled chunks "+strconv.FormatUint(seed, 10), func(t *testing.T) {
			rng := rand.New(rand.NewPCG(seed, seed))
			shuffled := slices.Clone(corpus)
			rng.Shuffle(len(shuffled), func(i, j int) { shuffled[i], shuffled[j] = shuffled[j], shuffled[i] })

			db, idx := open(t)
			for len(shuffled) > 0 {
				n := min(len(shuffled), 1+rng.IntN(12))
				require.NoError(t, idx.PutMany(t.Context(), shuffled[:n]))
				shuffled = shuffled[n:]
			}

			requireSameIndex(t, withoutOrderDependentTables(dumpDerivedIndex(t, db), want))

			// Reindexing what arrived out of order lands on the same state too.
			require.NoError(t, idx.Reindex(t.Context()))
			requireSameIndex(t, withoutOrderDependentTables(dumpDerivedIndex(t, db), want))
		})
	}
}

// withoutOrderDependentTables replaces the tables that legitimately depend on
// arrival order with their reference copies. A block that only moved records
// the text of its latest indexed version, which is the latest to arrive.
func withoutOrderDependentTables(got, want map[string][]string) map[string][]string {
	for _, table := range []string{"fts_index"} {
		got[table] = want[table]
	}

	return got
}

// diffRows returns the rows of want missing from got, and the rows of got
// that want lacks, counting duplicates.
func diffRows(want, got []string) (missing, extra []string) {
	counts := make(map[string]int)
	for _, r := range want {
		counts[r]++
	}

	for _, r := range got {
		counts[r]--
	}

	for _, r := range slices.Sorted(maps.Keys(counts)) {
		for n := counts[r]; n > 0; n-- {
			missing = append(missing, r)
		}

		for n := counts[r]; n < 0; n++ {
			extra = append(extra, r)
		}
	}

	return missing, extra
}

// fakeDeriveDocFields derives values that depend on the exact set of changes,
// so a derivation from anything but the final heads shows up as a difference.
func fakeDeriveDocFields(iri IRI, changes []ChangeRecord) (DerivedDocFields, error) {
	cids := make([]string, 0, len(changes))
	for _, ch := range changes {
		cids = append(cids, ch.CID.String())
	}

	slices.Sort(cids)

	return DerivedDocFields{
		FirstImage:      "ipfs://" + strings.Join(cids, ","),
		IsCollection:    len(changes)%2 == 0,
		NavigationCards: []string{string(iri) + "#" + strconv.Itoa(len(changes))},
	}, nil
}

// buildIndexingCorpus returns blobs in causal order covering what indexing
// defers to batch flushes: Refs advancing, merging, deleting and redirecting
// documents across generations, capabilities authorizing writers and agents,
// comments with replies, edits and deletions, and invalid blobs of each kind.
func buildIndexingCorpus(t *testing.T) []blocks.Block {
	t.Helper()

	alice := coretest.NewTester("alice")
	bob := coretest.NewTester("bob")
	carol := coretest.NewTester("carol")
	clock := cclock.New()
	space := alice.Account.Principal()

	var out []blocks.Block

	add := func(blks ...blocks.Block) {
		out = append(out, blks...)
	}

	setKey := func(k string, v any) OpMap {
		return must.Do2(NewOpSetKey(k, v))
	}
	block := func(id, text string) OpMap {
		return NewOpReplaceBlock(Block{ID_Good: id, Type: "paragraph", Text: text})
	}
	change := func(kp *core.KeyPair, genesis cid.Cid, deps []cid.Cid, depth int, ops ...OpMap) Encoded[*Change] {
		slices.SortFunc(deps, func(a, b cid.Cid) int { return strings.Compare(a.KeyString(), b.KeyString()) })
		return must.Do2(NewChange(kp, genesis, deps, depth, ChangeBody{Ops: ops}, clock.MustNow()))
	}
	ref := func(kp *core.KeyPair, generation int64, genesis cid.Cid, path string, visibility Visibility, heads ...cid.Cid) Encoded[*Ref] {
		return must.Do2(NewRef(kp, generation, genesis, space, path, heads, clock.MustNow(), visibility))
	}
	comment := func(kp *core.KeyPair, id TSID, path string, version []cid.Cid, root, parent cid.Cid, text string) Encoded[*Comment] {
		var body []CommentBlock

		if text != "" {
			body = []CommentBlock{{Block: Block{ID_Good: "c1", Type: "paragraph", Text: text}}}
		}

		return must.Do2(NewComment(kp, id, space, space, path, version, root, parent, body, VisibilityPublic, clock.MustNow()))
	}

	// Authority: bob writes under /shared, alice's device acts for alice.
	add(
		must.Do2(NewCapability(alice.Account, bob.Account.Principal(), space, "/shared", RoleWriter, "", clock.MustNow())),
		must.Do2(NewCapability(alice.Account, alice.Device.Principal(), space, "", RoleAgent, "", clock.MustNow())),
	)

	// A document with concurrent branches merged by later Refs.
	c1 := change(alice.Account, cid.Undef, nil, 0, setKey("title", "Doc"), block("b1", "hello"), NewOpMoveBlocks("", []string{"b1"}, nil))
	add(c1, ref(alice.Account, 0, c1.CID, "/doc", VisibilityPublic, c1.CID))
	c2 := change(alice.Account, c1.CID, []cid.Cid{c1.CID}, 1, block("b2", "world"), NewOpMoveBlocks("", []string{"b2"}, nil), setKey("cover", ""))
	c3 := change(alice.Account, c1.CID, []cid.Cid{c1.CID}, 1, setKey("title", "Doc, renamed"), NewOpMoveBlocks("", []string{"b1"}, nil))
	add(c2, c3, ref(alice.Account, 0, c1.CID, "/doc", VisibilityPublic, c2.CID), ref(alice.Account, 0, c1.CID, "/doc", VisibilityPublic, c3.CID))
	c4 := change(alice.Account, c1.CID, []cid.Cid{c2.CID, c3.CID}, 2, NewOpDeleteBlocks([]string{"b2"}), NewOpSetAttributes("", []KeyValue{{Key: []string{"nested", "key"}, Value: "v"}}))
	add(c4, ref(alice.Account, 0, c1.CID, "/doc", VisibilityPublic, c4.CID))

	// Deleted, then recreated as a later generation that builds on the old
	// heads, then as one that branches off an older change.
	add(ref(alice.Account, 0, c1.CID, "/doc", VisibilityPublic))
	c5 := change(alice.Account, c1.CID, []cid.Cid{c4.CID}, 3, block("b3", "again"))
	add(c5, ref(alice.Account, 1, c1.CID, "/doc", VisibilityPublic, c5.CID))
	c6 := change(alice.Account, c1.CID, []cid.Cid{c2.CID}, 2, setKey("title", "Branch"))
	add(c6, ref(alice.Account, 2, c1.CID, "/doc", VisibilityPublic, c6.CID))
	c7 := change(alice.Account, c1.CID, []cid.Cid{c5.CID, c6.CID}, 4, block("b1", "merged"))
	add(c7, ref(alice.Account, 2, c1.CID, "/doc", VisibilityPublic, c7.CID))

	// Deleted again and republished as a new generation with the same heads,
	// which adds no changes to the previous generation.
	add(ref(alice.Account, 2, c1.CID, "/doc", VisibilityPublic))
	add(ref(alice.Account, 3, c1.CID, "/doc", VisibilityPublic, c7.CID))

	// A document whose fallback image was derived before a cover was set.
	i1 := change(alice.Account, cid.Undef, nil, 0, setKey("title", "Pictures"), block("i1", "picture"))
	add(i1, ref(alice.Account, 0, i1.CID, "/pictures", VisibilityPublic, i1.CID))
	i2 := change(alice.Account, i1.CID, []cid.Cid{i1.CID}, 1, setKey("cover", "ipfs://bafkreigh2akiscaildcqabsyg3dfr6chu3fgpregiymsck7e7aqa4s52zy"))
	add(i2, ref(alice.Account, 0, i1.CID, "/pictures", VisibilityPublic, i2.CID))

	// A redirect from an old path, and a private document.
	o1 := change(alice.Account, cid.Undef, nil, 0, setKey("title", "Old"))
	add(o1, ref(alice.Account, 0, o1.CID, "/old", VisibilityPublic, o1.CID))
	add(must.Do2(NewRefRedirect(alice.Account, 0, o1.CID, space, "/old", RedirectTarget{Path: "/doc"}, clock.MustNow())))
	p1 := change(alice.Account, cid.Undef, nil, 0, setKey("title", "Secret"), block("s1", "hidden"))
	add(p1, ref(alice.Account, 0, p1.CID, "/private", VisibilityPrivate, p1.CID))

	// A writer's document, and Refs from a key without permission.
	s1 := change(bob.Account, cid.Undef, nil, 0, setKey("title", "Shared"), block("n1", "note"))
	s2 := change(bob.Account, s1.CID, []cid.Cid{s1.CID}, 1, block("n2", "more"))
	add(s1, s2, ref(bob.Account, 0, s1.CID, "/shared/note", VisibilityPublic, s1.CID), ref(bob.Account, 0, s1.CID, "/shared/note", VisibilityPublic, s2.CID))
	add(ref(carol.Account, 0, s1.CID, "/shared/note", VisibilityPublic, s2.CID))

	// Comments: a thread with edits and deletions, and one signed by an agent.
	root := comment(alice.Account, "", "/doc", []cid.Cid{c1.CID}, cid.Undef, cid.Undef, "first")
	reply := comment(bob.Account, "", "/doc", []cid.Cid{c4.CID}, root.CID, cid.Undef, "reply")
	add(root, reply)
	add(comment(alice.Account, root.TSID(), "/doc", []cid.Cid{c2.CID, c3.CID}, cid.Undef, cid.Undef, "first, edited"))
	add(comment(bob.Account, reply.TSID(), "/doc", []cid.Cid{c4.CID}, root.CID, cid.Undef, ""))
	add(comment(alice.Device, "", "/shared/note", []cid.Cid{s2.CID}, cid.Undef, cid.Undef, "from a device"))
	add(comment(alice.Account, "", "/old", []cid.Cid{o1.CID}, cid.Undef, cid.Undef, "on the old path"))

	// Invalid blobs: a comment without a version, a Change depending on
	// another document, and a Ref whose head belongs to another document.
	unversioned := &Comment{
		BaseBlob: BaseBlob{Type: TypeComment, Signer: alice.Account.Principal(), Ts: clock.MustNow()},
		Path:     "/doc",
		Body:     []CommentBlock{{Block: Block{ID_Good: "c1", Type: "paragraph", Text: "no version"}}},
	}
	require.NoError(t, Sign(alice.Account, unversioned, &unversioned.Sig))
	add(must.Do2(encodeBlob(unversioned)))
	add(change(alice.Account, c1.CID, []cid.Cid{o1.CID}, 1, block("x", "foreign")))
	add(ref(alice.Account, 0, c1.CID, "/doc", VisibilityPublic, o1.CID))

	return out
}

// dumpDerivedIndex renders the derived tables that indexing maintains with
// database IDs replaced by what they identify, so databases that indexed the
// same blobs in different orders compare equal. Rows are sorted.
func dumpDerivedIndex(t *testing.T, db *sqlitex.Pool) map[string][]string {
	t.Helper()

	conn, release, err := db.ReadConn(t.Context())
	require.NoError(t, err)
	defer release()

	out := make(map[string][]string)
	for table, q := range derivedIndexQueries() {
		rows := []string{}
		require.NoError(t, sqlitex.Exec(conn, q, func(stmt *sqlite.Stmt) error {
			rows = append(rows, dumpRow(stmt))
			return nil
		}), "table %s", table)
		slices.Sort(rows)
		out[table] = rows
	}

	out["document_generations"] = dumpGenerations(t, conn)

	return out
}

// dumpRow renders a result row as text.
func dumpRow(stmt *sqlite.Stmt) string {
	cols := make([]string, stmt.ColumnCount())
	for i := range cols {
		cols[i] = stmt.ColumnText(i)
	}

	return strings.Join(cols, " | ")
}

// derivedIndexQueries returns, per derived table, a query that renders its
// rows with database IDs replaced by what they identify.
func derivedIndexQueries() map[string]string {
	const (
		blob     = "(SELECT hex(multihash) FROM blobs WHERE id = %s)"
		key      = "(SELECT hex(principal) FROM public_keys WHERE id = %s)"
		resource = "(SELECT iri FROM resources WHERE id = %s)"
		node     = "(SELECT name FROM keyline_nodes WHERE id = %s)"
	)

	f := fmt.Sprintf

	return map[string]string{
		// Capabilities name their delegate, comments and contacts their
		// account, contacts their subject, and profiles their alias, by
		// public key ID. A contact can have both an account and a subject.
		"structural_blobs": f(`SELECT %s, type, %s, %s, %s, ts,
			CASE
				WHEN type = 'Contact' AND extra_attrs->>'subject' IS NOT NULL THEN json_set(a, '$.subject', %s)
				ELSE a
			END
			FROM (SELECT *, CASE
				WHEN extra_attrs->>'account' IS NOT NULL THEN json_set(extra_attrs, '$.account', %s)
				WHEN type = 'Capability' THEN json_set(extra_attrs, '$.del', %s)
				WHEN type = 'Profile' AND extra_attrs->>'alias' IS NOT NULL THEN json_set(extra_attrs, '$.alias', %s)
				ELSE extra_attrs
			END AS a FROM structural_blobs) sb`,
			f(blob, "sb.id"), f(key, "author"), f(blob, "genesis_blob"), f(resource, "resource"),
			f(key, "extra_attrs->>'subject'"), f(key, "extra_attrs->>'account'"), f(key, "extra_attrs->>'del'"), f(key, "extra_attrs->>'alias'")),
		"blob_links":     f(`SELECT %s, type, %s FROM blob_links`, f(blob, "source"), f(blob, "target")),
		"resource_links": f(`SELECT %s, %s, type, is_pinned, json(extra_attrs) FROM resource_links`, f(blob, "source"), f(resource, "target")),
		"resources":      f(`SELECT iri, %s, %s, create_time FROM resources`, f(key, "owner"), f(blob, "genesis_blob")),
		"document_attributes": f(`SELECT %s, (SELECT key FROM document_attribute_keys WHERE id = da.key), kind, quote(value), timestamp, operation, actor
			FROM document_attributes da`, f(resource, "resource")),
		"comments_live":          f(`SELECT %s, tsid, %s, genesis, %s, ts, hash FROM comments_live`, f(key, "authority"), f(blob, "blob_id"), f(resource, "resource")),
		"document_comment_stats": f(`SELECT genesis, comment_count, %s, last_comment_time FROM document_comment_stats`, f(blob, "last_comment")),
		"spaces":                 f(`SELECT id, %s, last_comment_time, comment_count, last_change_time FROM spaces`, f(blob, "last_comment")),
		"stashed_blobs":          f(`SELECT %s, reason, extra_attrs FROM stashed_blobs s`, f(blob, "s.id")),
		"blob_visibility":        f(`SELECT %s, %s FROM blob_visibility bv`, f(blob, "bv.id"), f(key, "space")),
		"keyline_delegations": f(`SELECT id, %s, %s, %s, power, %s FROM keyline_delegations`,
			f(node, "issuer"), f(node, "audience"), f(node, "subject"), f(blob, "blob_id")),
		"keyline_edges": f(`SELECT %s, %s, power FROM keyline_edges`, f(node, "subject"), f(node, "audience")),
		"fts_index": f(`SELECT (SELECT raw_content FROM fts WHERE rowid = text), %s, version, block_id, type, ts, %s FROM fts_index`,
			f(blob, "blob_id"), f(blob, "genesis_blob")),
	}
}

// dumpGenerations renders document_generations, whose heads, changes and
// authors hold IDs inside JSON and bitmaps.
func dumpGenerations(t *testing.T, conn *sqlite.Conn) []string {
	t.Helper()

	cache := make(map[string]string)
	lookup := func(q string, id int64) string {
		k := q + strconv.FormatInt(id, 10)
		if v, ok := cache[k]; ok {
			return v
		}

		v, err := sqlitex.QueryOne[string](conn, q, id)
		require.NoError(t, err)
		cache[k] = v
		return v
	}
	blobs := func(ids []int64) string {
		out := make([]string, 0, len(ids))
		for _, id := range ids {
			out = append(out, lookup("SELECT hex(multihash) FROM blobs WHERE id = ?", id))
		}

		slices.Sort(out)
		return strings.Join(out, ",")
	}

	type row struct {
		iri, rest string
		heads     []int64
		changes   []byte
		authors   []int64
	}

	var rows []row

	require.NoError(t, sqlitex.Exec(conn, `
		SELECT r.iri, dg.generation || ' ' || dg.genesis || ' ' || dg.change_count || ' ' || dg.genesis_change_time || ' ' ||
			dg.last_change_time || ' ' || dg.last_tombstone_ref_time || ' ' || dg.last_alive_ref_time || ' ' ||
			dg.visibility || ' ' || dg.visibility_timestamp,
			dg.heads, dg.changes, dg.authors
		FROM document_generations dg JOIN resources r ON r.id = dg.resource`, func(stmt *sqlite.Stmt) error {
		var r row

		r.iri = stmt.ColumnText(0)

		r.rest = stmt.ColumnText(1)
		if err := json.Unmarshal([]byte(stmt.ColumnText(2)), &r.heads); err != nil {
			return err
		}

		r.changes = slices.Clone(stmt.ColumnBytes(3))
		if err := json.Unmarshal([]byte(stmt.ColumnText(4)), &r.authors); err != nil {
			return err
		}

		rows = append(rows, r)
		return nil
	}))

	out := make([]string, 0, len(rows))
	for _, r := range rows {
		bm := roaring64.New()
		if len(r.changes) > 0 {
			_, err := bm.FromUnsafeBytes(r.changes)
			require.NoError(t, err)
		}

		var changes []int64

		for it := bm.Iterator(); it.HasNext(); {
			changes = append(changes, int64(it.Next())) //nolint:gosec
		}

		authors := make([]string, 0, len(r.authors))
		for _, id := range r.authors {
			authors = append(authors, lookup("SELECT hex(principal) FROM public_keys WHERE id = ?", id))
		}

		slices.Sort(authors)

		out = append(out, strings.Join([]string{r.iri, r.rest, "heads=" + blobs(r.heads), "changes=" + blobs(changes), "authors=" + strings.Join(authors, ",")}, " | "))
	}

	slices.Sort(out)

	return out
}

// A stashed blob's savepoint also undoes the blobs its unstash cascade indexed,
// and the batch must forget them too: their effects, hook entries, write
// samples, and write checks answered while they were in place.
func TestStashedBlobLeavesNothingInBatch(t *testing.T) {
	t.Parallel()

	alice := coretest.NewTester("alice")
	clock := cclock.New()
	space := alice.Account.Principal()
	body := []CommentBlock{{Block: Block{ID_Good: "c1", Type: "paragraph", Text: "hi"}}}

	missing := must.Do2(NewChange(alice.Account, cid.Undef, nil, 0, ChangeBody{Ops: []OpMap{must.Do2(NewOpSetKey("title", "Missing"))}}, clock.MustNow()))
	present := must.Do2(NewChange(alice.Account, cid.Undef, nil, 0, ChangeBody{Ops: []OpMap{must.Do2(NewOpSetKey("title", "Present"))}}, clock.MustNow()))
	root := must.Do2(NewComment(alice.Account, "", space, space, "/doc", []cid.Cid{missing.CID}, cid.Undef, cid.Undef, body, VisibilityPublic, clock.MustNow()))
	reply := must.Do2(NewComment(alice.Account, "", space, space, "/other", []cid.Cid{present.CID}, root.CID, cid.Undef, body, VisibilityPublic, clock.MustNow()))

	db := storage.MakeTestDB(t)
	idx := must.Do2(OpenIndex(t.Context(), db, zap.NewNop()))

	// The reply waits for its root.
	require.NoError(t, idx.PutMany(t.Context(), []blocks.Block{present, reply}))

	conn, release, err := db.WriteConn(t.Context())
	require.NoError(t, err)
	b := newIndexBatch(nil)
	b.writers["memoized"] = true
	var hookIDs []int64
	var kinds []syncperf.KindSample

	opts := indexOpts{FromNetwork: true, Kinds: &kinds}
	require.NoError(t, sqlitex.WithTx(conn, func() error {
		codec, hash := ipfs.DecodeCID(root.CID)

		id, _, err := idx.bs.putBlock(conn, 0, uint64(codec), hash, root.RawData())
		if err != nil {
			return err
		}

		// The root indexes the reply in its cascade, then waits for the change
		// it pins, which rolls both back.
		if err := indexBlob(opts, conn, id, root.CID, root.RawData(), idx.bs, idx.log, b, &hookIDs); err != nil {
			return err
		}

		require.Empty(t, b.indexed, "no blob was indexed")
		require.Empty(t, b.refs)
		require.Empty(t, hookIDs, "no blob reaches the indexed hook")
		require.Empty(t, kinds, "no blob counts as written")
		require.Empty(t, b.writers, "write checks may have depended on what rolled back")

		return b.flush(opts, conn, idx.bs, idx.log, &hookIDs)
	}))
	release()

	stashed, err := sqlitex.QueryOnePool[int](t.Context(), db, "SELECT count(*) FROM stashed_blobs WHERE reason = 'FailedPrecondition'")
	require.NoError(t, err)
	require.Equal(t, 2, stashed, "the root waits for its change, and the reply for its root again")
	live, err := sqlitex.QueryOnePool[int](t.Context(), db, "SELECT count(*) FROM comments_live")
	require.NoError(t, err)
	require.Zero(t, live)

	// Once the change arrives, both index.
	require.NoError(t, idx.Put(t.Context(), missing))
	live, err = sqlitex.QueryOnePool[int](t.Context(), db, "SELECT count(*) FROM comments_live")
	require.NoError(t, err)
	require.Equal(t, 2, live)
}
