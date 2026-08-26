package blob

import (
	"crypto/rand"
	"encoding/json"
	"seed/backend/core"
	"seed/backend/core/coretest"
	"seed/backend/storage"
	"seed/backend/util/cclock"
	"seed/backend/util/must"
	"seed/backend/util/sqlite/sqlitex"
	"testing"

	"github.com/ipfs/boxo/blockstore"
	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

var _ blockstore.Blockstore = (*Index)(nil)

func TestIndexIgnoresNonScalarDocumentAttributes(t *testing.T) {
	alice := coretest.NewTester("alice").Account
	db := storage.MakeTestDB(t)
	idx, err := OpenIndex(t.Context(), db, zap.NewNop())
	require.NoError(t, err)

	clock := cclock.New()
	change, err := NewChange(alice, cid.Undef, nil, 0, ChangeBody{
		Ops: []OpMap{
			NewOpSetAttributes("", []KeyValue{
				{Key: []string{"name"}, Value: "Document with provenance"},
				{Key: []string{"provenance"}, Value: map[string]any{"source": "import"}},
			}),
			{"type": "SetKey", "key": "legacyStructured", "value": []any{"one", "two"}},
		},
	}, clock.MustNow())
	require.NoError(t, err)
	ref, err := NewRef(alice, 0, change.CID, alice.Principal(), "/structured-attributes", []cid.Cid{change.CID}, clock.MustNow(), VisibilityPublic)
	require.NoError(t, err)
	require.NoError(t, idx.PutMany(t.Context(), []blocks.Block{change, ref}))

	iri := must.Do2(NewIRI(alice.Principal(), "/structured-attributes"))
	indexed, err := sqlitex.QueryOnePool[int](t.Context(), db, `
		SELECT COUNT()
		FROM document_attributes da
		JOIN document_attribute_keys dak ON dak.id = da.key
		JOIN resources r ON r.id = da.resource
		WHERE r.iri = ? AND dak.key IN ('name', 'provenance', 'legacyStructured')
	`, iri)
	require.NoError(t, err)
	require.Equal(t, 1, indexed, "only the scalar name attribute must be indexed")
}

func TestIterChangesDoesNotLoadResolvedAttributes(t *testing.T) {
	alice := coretest.NewTester("alice").Account
	db := storage.MakeTestDB(t)
	idx, err := OpenIndex(t.Context(), db, zap.NewNop())
	require.NoError(t, err)

	clock := cclock.New()
	change, err := NewChange(alice, cid.Undef, nil, 0, ChangeBody{
		Ops: []OpMap{
			must.Do2(NewOpSetKey("title", "Title from the change")),
		},
	}, clock.MustNow())
	require.NoError(t, err)

	ref, err := NewRef(alice, 0, change.CID, alice.Principal(), "/attribute-replay", []cid.Cid{change.CID}, clock.MustNow(), VisibilityPrivate)
	require.NoError(t, err)
	require.NoError(t, idx.PutMany(t.Context(), []blocks.Block{change, ref}))

	iri := must.Do2(NewIRI(alice.Principal(), "/attribute-replay"))
	conn, release, err := db.WriteConn(t.Context())
	require.NoError(t, err)
	err = sqlitex.Exec(conn, `
		UPDATE document_attributes
		SET kind = 'invalid'
		WHERE resource = (SELECT id FROM resources WHERE iri = ?)
		AND key = (
			SELECT id
			FROM document_attribute_keys
			WHERE key = 'title'
		)
	`, nil, iri)
	release()
	require.NoError(t, err)
	corrupted, err := sqlitex.QueryOnePool[int](t.Context(), db, `
		SELECT COUNT()
		FROM document_attributes da
		JOIN resources r ON r.id = da.resource
		WHERE r.iri = ? AND da.kind = 'invalid'
	`, iri)
	require.NoError(t, err)
	require.Equal(t, 1, corrupted)

	for name, heads := range map[string][]cid.Cid{
		"latest":     nil,
		"historical": {change.CID},
	} {
		t.Run(name, func(t *testing.T) {
			changes, check := idx.IterChanges(t.Context(), iri, heads)
			var got []ChangeRecord
			for change := range changes {
				got = append(got, change)
			}
			require.NoError(t, check())
			require.Len(t, got, 1)
			require.Equal(t, change.CID, got[0].CID)
			require.Equal(t, VisibilityPrivate, got[0].Visibility)
		})
	}
}

func TestBreadcrumbs(t *testing.T) {
	tests := []struct {
		input    IRI
		expected []IRI
	}{
		{
			input:    "hm://test",
			expected: []IRI{"hm://test"},
		},
		{
			input:    "hm://test/foo",
			expected: []IRI{"hm://test", "hm://test/foo"},
		},
		{
			input:    "hm://test/foo/bar",
			expected: []IRI{"hm://test", "hm://test/foo", "hm://test/foo/bar"},
		},
		{
			input:    "hm://test/foo/bar/baz",
			expected: []IRI{"hm://test", "hm://test/foo", "hm://test/foo/bar", "hm://test/foo/bar/baz"},
		},
	}

	for _, tt := range tests {
		t.Run(string(tt.input), func(t *testing.T) {
			got := tt.input.Breadcrumbs()
			if len(got) != len(tt.expected) {
				t.Errorf("Breadcrumbs() got %d results, expected %d", len(got), len(tt.expected))
				return
			}
			for i := range got {
				if got[i] != tt.expected[i] {
					t.Errorf("Breadcrumbs()[%d] = %v, expected %v", i, got[i], tt.expected[i])
				}
			}
		})
	}
}

func TestWriterCheck_DelegatedSessionKeys(t *testing.T) {
	alice := coretest.NewTester("alice").Account
	bob := coretest.NewTester("bob").Account
	bobSession, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)

	db := storage.MakeTestDB(t)
	idx, err := OpenIndex(t.Context(), db, zap.NewNop())
	require.NoError(t, err)

	clock := cclock.New()
	aliceToBob, err := NewCapability(alice, bob.Principal(), alice.Principal(), "/delegated-session", RoleWriter, "", clock.MustNow())
	require.NoError(t, err)

	bobToSession, err := NewCapability(bob, bobSession.Principal(), bob.Principal(), "", RoleAgent, "", clock.MustNow())
	require.NoError(t, err)

	change, err := NewChange(bobSession, cid.Undef, nil, 0, ChangeBody{
		Ops: []OpMap{
			must.Do2(NewOpSetKey("title", "Session key edit")),
		},
	}, clock.MustNow())
	require.NoError(t, err)

	ref, err := NewRef(bobSession, 0, change.CID, alice.Principal(), "/delegated-session", []cid.Cid{change.CID}, clock.MustNow(), VisibilityPublic)
	require.NoError(t, err)

	subdocChange, err := NewChange(bobSession, cid.Undef, nil, 0, ChangeBody{
		Ops: []OpMap{
			must.Do2(NewOpSetKey("title", "Session key subdocument edit")),
		},
	}, clock.MustNow())
	require.NoError(t, err)

	subdocRef, err := NewRef(bobSession, 0, subdocChange.CID, alice.Principal(), "/delegated-session/subdoc", []cid.Cid{subdocChange.CID}, clock.MustNow(), VisibilityPublic)
	require.NoError(t, err)

	require.NoError(t, idx.PutMany(t.Context(), []blocks.Block{
		aliceToBob,
		bobToSession,
		change,
		ref,
		subdocChange,
		subdocRef,
	}))

	require.Equal(t, 0, countStashedBlobs(t, db), "agent key should inherit Bob's writer capability for Alice's space")

	iri := must.Do2(NewIRI(alice.Principal(), "/delegated-session"))
	changes, check := idx.iterChangesLatest(t.Context(), iri)
	var got []cid.Cid
	for c := range changes {
		got = append(got, c.CID)
	}
	require.NoError(t, check())
	require.Equal(t, []cid.Cid{change.CID}, got)

	subdocIRI := must.Do2(NewIRI(alice.Principal(), "/delegated-session/subdoc"))
	subdocChanges, subdocCheck := idx.iterChangesLatest(t.Context(), subdocIRI)
	got = got[:0]
	for c := range subdocChanges {
		got = append(got, c.CID)
	}
	require.NoError(t, subdocCheck())
	require.Equal(t, []cid.Cid{subdocChange.CID}, got)
}

func TestWriterCheck_OwnersSessionKey(t *testing.T) {
	alice := coretest.NewTester("alice").Account
	aliceSession, err := core.GenerateKeyPair(core.Ed25519, rand.Reader)
	require.NoError(t, err)

	db := storage.MakeTestDB(t)
	idx, err := OpenIndex(t.Context(), db, zap.NewNop())
	require.NoError(t, err)

	clock := cclock.New()
	aliceToSession, err := NewCapability(alice, aliceSession.Principal(), alice.Principal(), "", RoleAgent, "", clock.MustNow())
	require.NoError(t, err)

	change, err := NewChange(aliceSession, cid.Undef, nil, 0, ChangeBody{
		Ops: []OpMap{
			must.Do2(NewOpSetKey("title", "Owner session key edit")),
		},
	}, clock.MustNow())
	require.NoError(t, err)

	ref, err := NewRef(aliceSession, 0, change.CID, alice.Principal(), "/owner-session", []cid.Cid{change.CID}, clock.MustNow(), VisibilityPublic)
	require.NoError(t, err)

	require.NoError(t, idx.PutMany(t.Context(), []blocks.Block{
		aliceToSession,
		change,
		ref,
	}))

	require.Equal(t, 0, countStashedBlobs(t, db), "owner agent key should be allowed to write the owner's space")

	iri := must.Do2(NewIRI(alice.Principal(), "/owner-session"))
	changes, check := idx.iterChangesLatest(t.Context(), iri)
	var got []cid.Cid
	for c := range changes {
		got = append(got, c.CID)
	}
	require.NoError(t, check())
	require.Equal(t, []cid.Cid{change.CID}, got)
}

// TestWriterCheck_DirectWriter covers the fast path of the split writer check: a
// non-owner with a direct WRITER capability from the owner writing into the
// owner's space. This is the common case isValidWriter optimizes (it must match
// on qIsValidWriterDirect alone, never reaching the agent-chain branch).
func TestWriterCheck_DirectWriter(t *testing.T) {
	alice := coretest.NewTester("alice").Account
	bob := coretest.NewTester("bob").Account

	db := storage.MakeTestDB(t)
	idx, err := OpenIndex(t.Context(), db, zap.NewNop())
	require.NoError(t, err)

	clock := cclock.New()
	aliceToBob, err := NewCapability(alice, bob.Principal(), alice.Principal(), "/shared", RoleWriter, "", clock.MustNow())
	require.NoError(t, err)

	change, err := NewChange(bob, cid.Undef, nil, 0, ChangeBody{
		Ops: []OpMap{
			must.Do2(NewOpSetKey("title", "Direct writer edit")),
		},
	}, clock.MustNow())
	require.NoError(t, err)

	ref, err := NewRef(bob, 0, change.CID, alice.Principal(), "/shared", []cid.Cid{change.CID}, clock.MustNow(), VisibilityPublic)
	require.NoError(t, err)

	require.NoError(t, idx.PutMany(t.Context(), []blocks.Block{
		aliceToBob,
		change,
		ref,
	}))

	require.Equal(t, 0, countStashedBlobs(t, db), "direct WRITER delegate should be allowed to write the owner's space")

	iri := must.Do2(NewIRI(alice.Principal(), "/shared"))
	changes, check := idx.iterChangesLatest(t.Context(), iri)
	var got []cid.Cid
	for c := range changes {
		got = append(got, c.CID)
	}
	require.NoError(t, check())
	require.Equal(t, []cid.Cid{change.CID}, got)
}

// TestWriterValidityCache covers the in-memory cache primitive used by
// isValidWriter: nil-safety and get/put/clear semantics.
func TestWriterValidityCache(t *testing.T) {
	// A nil cache is a no-op: never panics, always misses.
	var nilc *writerValidityCache
	_, ok := nilc.get("k")
	require.False(t, ok)
	nilc.put("k", true)
	nilc.clear()
	_, ok = nilc.get("k")
	require.False(t, ok)

	c := newWriterValidityCache()
	_, ok = c.get("k")
	require.False(t, ok, "empty cache misses")

	c.put("k", true)
	v, ok := c.get("k")
	require.True(t, ok)
	require.True(t, v)

	c.put("k2", false)
	v, ok = c.get("k2")
	require.True(t, ok)
	require.False(t, v, "negative results are cached too")

	c.clear()
	_, ok = c.get("k")
	require.False(t, ok, "clear drops all entries")
	_, ok = c.get("k2")
	require.False(t, ok)
}

// TestWriterCheck_CacheConsultedAndInvalidated verifies the isValidWriter cache
// (a) never changes the computed result, (b) is actually consulted on a hit, and
// (c) is dropped by clear() — the invalidation indexCapability performs whenever
// a capability changes, which is what keeps the cache correct under a future
// capability revocation.
func TestWriterCheck_CacheConsultedAndInvalidated(t *testing.T) {
	alice := coretest.NewTester("alice").Account
	bob := coretest.NewTester("bob").Account

	db := storage.MakeTestDB(t)
	idx, err := OpenIndex(t.Context(), db, zap.NewNop())
	require.NoError(t, err)

	clock := cclock.New()
	aliceToBob, err := NewCapability(alice, bob.Principal(), alice.Principal(), "/shared", RoleWriter, "", clock.MustNow())
	require.NoError(t, err)
	require.NoError(t, idx.PutMany(t.Context(), []blocks.Block{aliceToBob}))

	conn, release, err := idx.db.ReadConn(t.Context())
	require.NoError(t, err)
	defer release()

	aliceID, err := DbPublicKeysLookupID(conn, alice.Principal())
	require.NoError(t, err)
	bobID, err := DbPublicKeysLookupID(conn, bob.Principal())
	require.NoError(t, err)

	shared := must.Do2(NewIRI(alice.Principal(), "/shared")) // bob is a WRITER here
	other := must.Do2(NewIRI(alice.Principal(), "/other"))   // bob has no capability here

	// (a) Correct results with a live cache.
	cache := newWriterValidityCache()
	got, err := isValidWriter(conn, bobID, shared, cache)
	require.NoError(t, err)
	require.True(t, got, "bob holds a WRITER capability on /shared")
	got, err = isValidWriter(conn, bobID, other, cache)
	require.NoError(t, err)
	require.False(t, got, "bob holds no capability on /other")

	// (b) The cache is actually consulted: poison the /other entry and observe the
	// stale value served without touching the DB.
	otherKey := writerCacheKey(aliceID, bobID, string(must.Do2(json.Marshal(other.Breadcrumbs()))))
	cache.put(otherKey, true)
	got, err = isValidWriter(conn, bobID, other, cache)
	require.NoError(t, err)
	require.True(t, got, "poisoned cache entry is served (proves the cache is read)")

	// (c) clear() restores correctness — this is what indexCapability does on any
	// capability change, including a future revocation.
	cache.clear()
	got, err = isValidWriter(conn, bobID, other, cache)
	require.NoError(t, err)
	require.False(t, got, "after clear the result is recomputed from the DB")

	// A nil cache disables memoization and yields identical results.
	got, err = isValidWriter(conn, bobID, shared, nil)
	require.NoError(t, err)
	require.True(t, got)
	got, err = isValidWriter(conn, bobID, other, nil)
	require.NoError(t, err)
	require.False(t, got)
}

func TestNewIRIRejectsForbiddenCharacters(t *testing.T) {
	acc := coretest.NewTester("alice").Account.Principal()

	// Normal paths remain valid.
	for _, path := range []string{"", "/doc", "/nested/path", "/with-dash_and.dot"} {
		_, err := NewIRI(acc, path)
		require.NoError(t, err, "path %q should be valid", path)
	}

	// Quote and control characters are rejected: IRIs embed the path and are used to build SQL and
	// JSON downstream, so these must never enter the system.
	for _, path := range []string{"/x'--", "/x\"y", "/x\\y", "/x\ny", "/x\ry", "/x\ty", "/x\x00y"} {
		_, err := NewIRI(acc, path)
		require.Error(t, err, "path %q should be rejected", path)
	}
}
