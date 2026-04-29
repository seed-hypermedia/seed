package syncing

import (
	"context"
	"strings"
	"testing"

	"seed/backend/blob"
	"seed/backend/core/coretest"
	"seed/backend/storage"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/stretchr/testify/require"
)

func TestBlobTypesString(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name string
		in   []string
		want string
	}{
		{"nil is empty", nil, ""},
		{"empty slice is empty", []string{}, ""},
		{"empty strings dropped", []string{"", ""}, ""},
		{"single", []string{"Profile"}, "Profile"},
		{"sorted", []string{"Ref", "Change", "Profile"}, "Change,Profile,Ref"},
		{"deduped", []string{"Profile", "Profile", "Ref"}, "Profile,Ref"},
		{"mixed empty and dupes", []string{"", "Profile", "", "Profile"}, "Profile"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, BlobTypesString(tc.in))
		})
	}
}

func TestEffectiveBlobTypeFilter(t *testing.T) {
	t.Parallel()

	dkeyWith := func(types ...string) DiscoveryKey {
		return DiscoveryKey{IRI: blob.IRI("hm://x"), BlobTypes: BlobTypesString(types)}
	}

	t.Run("empty dkeys returns nil", func(t *testing.T) {
		require.Nil(t, effectiveBlobTypeFilter(map[DiscoveryKey]struct{}{}))
	})

	t.Run("any unfiltered dkey disables filter", func(t *testing.T) {
		dkeys := map[DiscoveryKey]struct{}{
			dkeyWith("Profile"):       {},
			dkeyWith( /* no types */ ): {},
		}
		require.Nil(t, effectiveBlobTypeFilter(dkeys))
	})

	t.Run("union across dkeys", func(t *testing.T) {
		dkeys := map[DiscoveryKey]struct{}{
			{IRI: blob.IRI("hm://a"), BlobTypes: BlobTypesString([]string{"Profile"})}: {},
			{IRI: blob.IRI("hm://b"), BlobTypes: BlobTypesString([]string{"Ref", "Change"})}: {},
		}
		got := effectiveBlobTypeFilter(dkeys)
		require.Equal(t, []string{"Change", "Profile", "Ref"}, got)
	})
}

func TestHasType(t *testing.T) {
	t.Parallel()

	require.True(t, hasType(nil, "Profile"), "nil allowlist must allow all types")
	require.True(t, hasType([]string{}, "Profile"), "empty allowlist must allow all types")
	require.True(t, hasType([]string{"Profile", "Ref"}, "Profile"))
	require.False(t, hasType([]string{"Profile", "Ref"}, "Comment"))
}

// TestFillTables_BlobTypeFilter exercises the SQL filtering path of fillTables.
// We populate a minimal DB with one resource owning blobs of every type the
// filter cares about (Ref, Change, Profile, Comment, Capability, Contact),
// then verify that each filter selects exactly the requested types.
func TestFillTables_BlobTypeFilter(t *testing.T) {
	t.Parallel()

	db := storage.MakeTestDB(t)

	// We need a real (decodable) principal because fillTables walks
	// IRI.SpacePath() through core.DecodePrincipal. Use a fixture key
	// from coretest and build the IRI from its string form.
	alice := coretest.NewTester("alice").Account.Principal()
	aliceIRI := blob.IRI("hm://" + alice.String())

	// Seed minimal fixture: one author, one resource (alice's home doc),
	// and one blob of each interesting structural type anchored to that
	// resource. We also create a Ref-anchored Change to exercise the
	// recursive CTE traversal in fillTables.
	require.NoError(t, db.WithSave(context.Background(), func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn,
			`INSERT INTO public_keys (id, principal) VALUES (1, ?)`, nil, []byte(alice)); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn,
			`INSERT INTO resources (id, iri) VALUES (100, ?)`, nil, string(aliceIRI)); err != nil {
			return err
		}
		for _, q := range []string{
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (10, X'10', 113, 1)`,
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (11, X'11', 113, 1)`,
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (12, X'12', 113, 1)`,
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (13, X'13', 113, 1)`,
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (14, X'14', 113, 1)`,
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (15, X'15', 113, 1)`,
			`INSERT INTO structural_blobs (id, type, author, resource) VALUES (10, 'Ref',        1, 100)`,
			`INSERT INTO structural_blobs (id, type, author, resource) VALUES (11, 'Change',     1, 100)`,
			`INSERT INTO structural_blobs (id, type, author, resource) VALUES (12, 'Profile',    1, 100)`,
			`INSERT INTO structural_blobs (id, type, author, resource) VALUES (13, 'Comment',    1, 100)`,
			`INSERT INTO structural_blobs (id, type, author, resource) VALUES (14, 'Capability', 1, 100)`,
			`INSERT INTO structural_blobs (id, type, author, resource) VALUES (15, 'Contact',    1, 100)`,
			`INSERT INTO blob_links (source, type, target) VALUES (10, 'ref/head', 11)`,
		} {
			if err := sqlitex.Exec(conn, q, nil); err != nil {
				return err
			}
		}
		return nil
	}))

	collectTypes := func(t *testing.T, dkey DiscoveryKey) map[string]int {
		t.Helper()
		got := map[string]int{}
		require.NoError(t, db.WithSave(context.Background(), func(conn *sqlite.Conn) error {
			if err := ensureTempTable(conn, "rbsr_iris"); err != nil {
				return err
			}
			if err := ensureTempTable(conn, "rbsr_blobs"); err != nil {
				return err
			}
			if err := fillTables(conn, map[DiscoveryKey]struct{}{dkey: {}}, false); err != nil {
				return err
			}
			return sqlitex.Exec(conn, `SELECT sb.type, COUNT(*) FROM rbsr_blobs rb JOIN structural_blobs sb ON sb.id = rb.id GROUP BY sb.type`, func(stmt *sqlite.Stmt) error {
				got[stmt.ColumnText(0)] = stmt.ColumnInt(1)
				return nil
			})
		}))
		return got
	}

	t.Run("no filter pulls every anchored type", func(t *testing.T) {
		got := collectTypes(t, DiscoveryKey{IRI: aliceIRI})
		// Ref + Change + the bundled "Capability/Comment/Profile/Contact" set.
		for _, want := range []string{"Ref", "Change", "Profile", "Comment", "Capability", "Contact"} {
			require.GreaterOrEqual(t, got[want], 1, "missing %q in unfiltered output: %v", want, got)
		}
	})

	t.Run("Profile-only filter excludes Comment/Capability/Contact", func(t *testing.T) {
		got := collectTypes(t, DiscoveryKey{
			IRI:       aliceIRI,
			BlobTypes: BlobTypesString([]string{"Profile", "Ref", "Change"}),
		})
		require.Equal(t, 1, got["Ref"], got)
		require.Equal(t, 1, got["Change"], got)
		require.Equal(t, 1, got["Profile"], got)
		require.Zero(t, got["Comment"], "Comment must be filtered out: %v", got)
		require.Zero(t, got["Capability"], "Capability must be filtered out: %v", got)
		require.Zero(t, got["Contact"], "Contact must be filtered out: %v", got)
	})

	t.Run("Profile-only without Ref/Change skips RBSR Refs and Changes", func(t *testing.T) {
		got := collectTypes(t, DiscoveryKey{
			IRI:       aliceIRI,
			BlobTypes: BlobTypesString([]string{"Profile"}),
		})
		require.Equal(t, 1, got["Profile"], got)
		require.Zero(t, got["Ref"], "Ref must be filtered out: %v", got)
		require.Zero(t, got["Change"], "Change must be filtered out: %v", got)
		require.Zero(t, got["Comment"], got)
		require.Zero(t, got["Capability"], got)
		require.Zero(t, got["Contact"], got)
	})

	t.Run("Comment-only does not pull Ref/Change/Profile/Capability/Contact", func(t *testing.T) {
		got := collectTypes(t, DiscoveryKey{
			IRI:       aliceIRI,
			BlobTypes: BlobTypesString([]string{"Comment"}),
		})
		require.Equal(t, 1, got["Comment"], got)
		// "Ref" is intentionally not in the filter, so the recursive CTE
		// can't seed itself either.
		for _, excluded := range []string{"Ref", "Change", "Profile", "Capability", "Contact"} {
			require.Zerof(t, got[excluded], "%s must be filtered out: %v", excluded, got)
		}
	})
}

// TestDiscoveryKey_StableMapKey verifies that DiscoveryKey works as a map key
// even when BlobTypes is set (i.e. that BlobTypesString produces a canonical
// representation, so two equivalent slices map to the same key).
func TestDiscoveryKey_StableMapKey(t *testing.T) {
	t.Parallel()

	a := DiscoveryKey{IRI: blob.IRI("hm://x"), BlobTypes: BlobTypesString([]string{"Ref", "Profile", "Change"})}
	b := DiscoveryKey{IRI: blob.IRI("hm://x"), BlobTypes: BlobTypesString([]string{"Profile", "Change", "Ref"})}
	require.Equal(t, a, b, "BlobTypesString must canonicalize to the same value regardless of input order")

	// And one with a different filter must NOT collide.
	c := DiscoveryKey{IRI: blob.IRI("hm://x"), BlobTypes: BlobTypesString([]string{"Profile"})}
	require.NotEqual(t, a, c)

	// Sanity: a comma-joined string is what we expect.
	require.True(t, strings.Contains(a.BlobTypes, "Profile"))
	require.True(t, strings.Contains(a.BlobTypes, ","))
}
