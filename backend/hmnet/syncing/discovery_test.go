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
			dkeyWith("Profile"):        {},
			dkeyWith( /* no types */ ): {},
		}
		require.Nil(t, effectiveBlobTypeFilter(dkeys))
	})

	t.Run("union across dkeys", func(t *testing.T) {
		dkeys := map[DiscoveryKey]struct{}{
			{IRI: blob.IRI("hm://a"), BlobTypes: BlobTypesString([]string{"Profile"})}:       {},
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

// TestFillTables_PathScope exercises how fillTables populates rbsr_iris based
// on the Recursive vs DepthOne flags on a DiscoveryKey. Seeds a small subtree
// of resources at depths 0/1/1/2 below alice and verifies which IRIs end up in
// rbsr_iris for each scoping mode.
func TestFillTables_PathScope(t *testing.T) {
	t.Parallel()

	db := storage.MakeTestDB(t)

	alice := coretest.NewTester("alice").Account.Principal()
	root := blob.IRI("hm://" + alice.String())
	notes := root + "/notes"        // depth 1
	misc := root + "/misc"          // depth 1
	notesFoo := notes + "/foo"      // depth 2 under /notes
	notesFooX := notesFoo + "/deep" // depth 3 under /notes

	require.NoError(t, db.WithSave(context.Background(), func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn,
			`INSERT INTO public_keys (id, principal) VALUES (1, ?)`, nil, []byte(alice)); err != nil {
			return err
		}
		for id, iri := range map[int]blob.IRI{100: root, 101: notes, 102: misc, 103: notesFoo, 104: notesFooX} {
			if err := sqlitex.Exec(conn, `INSERT INTO resources (id, iri) VALUES (?, ?)`, nil, id, string(iri)); err != nil {
				return err
			}
		}
		return nil
	}))

	collectIRIs := func(t *testing.T, dkey DiscoveryKey) []string {
		t.Helper()
		var got []string
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
			return sqlitex.Exec(conn, `SELECT iri FROM resources WHERE id IN rbsr_iris ORDER BY iri`, func(stmt *sqlite.Stmt) error {
				got = append(got, stmt.ColumnText(0))
				return nil
			})
		}))
		return got
	}

	t.Run("exact match selects only the IRI itself", func(t *testing.T) {
		got := collectIRIs(t, DiscoveryKey{IRI: notes})
		require.Equal(t, []string{string(notes)}, got)
	})

	t.Run("recursive selects everything at and below the IRI", func(t *testing.T) {
		got := collectIRIs(t, DiscoveryKey{IRI: notes, Recursive: true})
		require.Equal(t, []string{string(notes), string(notesFoo), string(notesFooX)}, got)
	})

	t.Run("depth-one selects only direct children, excluding the base", func(t *testing.T) {
		got := collectIRIs(t, DiscoveryKey{IRI: notes, DepthOne: true})
		require.Equal(t, []string{string(notes), string(notesFoo)}, got,
			"depth-one must include base + direct children, but exclude grandchildren")
	})

	t.Run("recursive at root selects the entire account tree", func(t *testing.T) {
		got := collectIRIs(t, DiscoveryKey{IRI: root, Recursive: true})
		require.Equal(t, []string{string(root), string(misc), string(notes), string(notesFoo), string(notesFooX)}, got)
	})

	t.Run("depth-one at root selects only top-level children", func(t *testing.T) {
		got := collectIRIs(t, DiscoveryKey{IRI: root, DepthOne: true})
		require.Equal(t, []string{string(root), string(misc), string(notes)}, got,
			"depth-one at root must include account root + direct children only")
	})
}

// TestCollectBlobs_InboundContacts verifies that recursive discovery of an
// account at its root also includes "inbound" Contact blobs — contacts created
// by other accounts that have the discovered account as their subject. This is
// required so that members/followers of an account are synced when the account
// is discovered.
func TestCollectBlobs_InboundContacts(t *testing.T) {
	t.Parallel()

	db := storage.MakeTestDB(t)

	alice := coretest.NewTester("alice").Account.Principal()
	bob := coretest.NewTester("bob").Account.Principal()
	aliceIRI := blob.IRI("hm://" + alice.String())
	bobIRI := blob.IRI("hm://" + bob.String())

	// Seed: two accounts, each with a home resource. Bob has a Contact blob
	// whose subject is Alice (simulating "bob follows alice").
	require.NoError(t, db.WithSave(context.Background(), func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn,
			`INSERT INTO public_keys (id, principal) VALUES (1, ?)`, nil, []byte(alice)); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn,
			`INSERT INTO public_keys (id, principal) VALUES (2, ?)`, nil, []byte(bob)); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn,
			`INSERT INTO resources (id, iri) VALUES (100, ?)`, nil, string(aliceIRI)); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn,
			`INSERT INTO resources (id, iri) VALUES (200, ?)`, nil, string(bobIRI)); err != nil {
			return err
		}

		for _, q := range []string{
			// Alice's own Ref blob (anchored to alice's resource).
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (10, X'10', 113, 1)`,
			`INSERT INTO structural_blobs (id, type, author, resource) VALUES (10, 'Ref', 1, 100)`,

			// Bob's Contact blob pointing to Alice (anchored to bob's resource).
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (20, X'20', 113, 1)`,
			`INSERT INTO structural_blobs (id, type, author, resource, extra_attrs) VALUES (20, 'Contact', 2, 200, '{"subject":1}')`,
		} {
			if err := sqlitex.Exec(conn, q, nil); err != nil {
				return err
			}
		}
		return nil
	}))

	collectBlobTypes := func(t *testing.T, dkeys map[DiscoveryKey]struct{}) map[string][]int {
		t.Helper()
		got := map[string][]int{}
		require.NoError(t, db.WithSave(context.Background(), func(conn *sqlite.Conn) error {
			if err := collectBlobs(conn, dkeys, false); err != nil {
				return err
			}
			return sqlitex.Exec(conn,
				`SELECT sb.type, rb.id FROM rbsr_blobs rb JOIN structural_blobs sb ON sb.id = rb.id ORDER BY sb.type, rb.id`,
				func(stmt *sqlite.Stmt) error {
					got[stmt.ColumnText(0)] = append(got[stmt.ColumnText(0)], stmt.ColumnInt(1))
					return nil
				})
		}))
		return got
	}

	t.Run("recursive root discovery includes inbound contacts", func(t *testing.T) {
		got := collectBlobTypes(t, map[DiscoveryKey]struct{}{
			{IRI: aliceIRI, Recursive: true}: {},
		})
		require.Contains(t, got, "Ref", "Alice's own Ref must be present")
		require.Contains(t, got, "Contact", "Bob's inbound Contact pointing to Alice must be present")
		require.Equal(t, []int{20}, got["Contact"], "only the inbound contact (blob 20) should be present")
	})

	t.Run("non-recursive discovery does not include inbound contacts", func(t *testing.T) {
		got := collectBlobTypes(t, map[DiscoveryKey]struct{}{
			{IRI: aliceIRI, Recursive: false}: {},
		})
		require.Contains(t, got, "Ref", "Alice's own Ref must be present")
		require.NotContains(t, got, "Contact", "inbound contacts should NOT appear without recursive flag")
	})

	t.Run("recursive sub-path discovery does not include inbound contacts", func(t *testing.T) {
		got := collectBlobTypes(t, map[DiscoveryKey]struct{}{
			{IRI: aliceIRI + "/notes", Recursive: true}: {},
		})
		require.NotContains(t, got, "Contact",
			"inbound contacts should NOT appear when path is non-empty")
	})

	t.Run("type filter excluding Contact skips inbound contacts", func(t *testing.T) {
		got := collectBlobTypes(t, map[DiscoveryKey]struct{}{
			{IRI: aliceIRI, Recursive: true, BlobTypes: BlobTypesString([]string{"Ref"})}: {},
		})
		require.NotContains(t, got, "Contact",
			"inbound contacts should NOT appear when Contact is filtered out")
	})
}

// TestCollectBlobs_IncludeAuthorProfiles verifies that pushing a non-root
// document also includes the author's Profile blob from the account root.
func TestCollectBlobs_IncludeAuthorProfiles(t *testing.T) {
	t.Parallel()

	db := storage.MakeTestDB(t)

	alice := coretest.NewTester("alice").Account.Principal()
	aliceRoot := blob.IRI("hm://" + alice.String())
	aliceDoc := aliceRoot + "/docs/published"

	require.NoError(t, db.WithSave(context.Background(), func(conn *sqlite.Conn) error {
		if err := sqlitex.Exec(conn,
			`INSERT INTO public_keys (id, principal) VALUES (1, ?)`, nil, []byte(alice)); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn,
			`INSERT INTO resources (id, iri) VALUES (100, ?)`, nil, string(aliceRoot)); err != nil {
			return err
		}
		if err := sqlitex.Exec(conn,
			`INSERT INTO resources (id, iri) VALUES (101, ?)`, nil, string(aliceDoc)); err != nil {
			return err
		}

		for _, q := range []string{
			// Alice's Profile is anchored to the account root.
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (10, X'10', 113, 1)`,
			`INSERT INTO structural_blobs (id, type, author, resource) VALUES (10, 'Profile', 1, 100)`,

			// Alice's published document is a child resource.
			`INSERT INTO blobs (id, multihash, codec, size) VALUES (20, X'20', 113, 1)`,
			`INSERT INTO structural_blobs (id, type, author, resource) VALUES (20, 'Ref', 1, 101)`,
		} {
			if err := sqlitex.Exec(conn, q, nil); err != nil {
				return err
			}
		}
		return nil
	}))

	got := map[string][]int{}
	require.NoError(t, db.WithSave(context.Background(), func(conn *sqlite.Conn) error {
		if err := collectBlobs(conn, map[DiscoveryKey]struct{}{
			{IRI: aliceDoc}: {},
		}, true); err != nil {
			return err
		}
		return sqlitex.Exec(conn,
			`SELECT sb.type, rb.id FROM rbsr_blobs rb JOIN structural_blobs sb ON sb.id = rb.id ORDER BY sb.type, rb.id`,
			func(stmt *sqlite.Stmt) error {
				got[stmt.ColumnText(0)] = append(got[stmt.ColumnText(0)], stmt.ColumnInt(1))
				return nil
			})
	}))

	require.Equal(t, []int{20}, got["Ref"], "document Ref must be selected")
	require.Equal(t, []int{10}, got["Profile"], "author Profile must be selected")
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
