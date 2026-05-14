package blob

import (
	"crypto/rand"
	"seed/backend/core"
	"seed/backend/core/coretest"
	"seed/backend/storage"
	"seed/backend/util/cclock"
	"seed/backend/util/must"
	"testing"

	"github.com/ipfs/boxo/blockstore"
	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

var _ blockstore.Blockstore = (*Index)(nil)

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
	}, clock.MustNow(), "")
	require.NoError(t, err)

	ref, err := NewRef(bobSession, 0, change.CID, alice.Principal(), "/delegated-session", []cid.Cid{change.CID}, clock.MustNow(), VisibilityPublic)
	require.NoError(t, err)

	require.NoError(t, idx.PutMany(t.Context(), []blocks.Block{
		aliceToBob,
		bobToSession,
		change,
		ref,
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
	}, clock.MustNow(), "")
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
