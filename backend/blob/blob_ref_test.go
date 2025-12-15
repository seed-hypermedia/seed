package blob

import (
	"encoding/json"
	"seed/backend/core/coretest"
	"seed/backend/storage"
	"seed/backend/util/cclock"
	"seed/backend/util/colx"
	"seed/backend/util/must"
	"seed/backend/util/sqlite/sqlitex"
	"strings"
	"testing"
	"time"

	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/stretchr/testify/require"
	"go.uber.org/zap"
)

func TestRefCausality(t *testing.T) {
	alice := coretest.NewTester("alice")
	bob := coretest.NewTester("bob")
	clock := cclock.New()

	// Create first change c1
	c1, err := NewChange(alice.Account, cid.Undef, nil, 0, ChangeBody{
		Ops: []OpMap{
			must.Do2(NewOpSetKey("title", "Initial Document")),
		},
	}, clock.MustNow())
	require.NoError(t, err)

	time.Sleep(time.Millisecond)

	// Create second change c2 that depends on c1
	c2, err := NewChange(bob.Account, c1.CID, []cid.Cid{c1.CID}, 1, ChangeBody{
		Ops: []OpMap{
			must.Do2(NewOpSetKey("content", "Updated content")),
		},
	}, clock.MustNow())
	require.NoError(t, err)

	time.Sleep(time.Millisecond)

	// Create a Ref pointing to c2.
	ref, err := NewRef(alice.Account, 0, c1.CID, alice.Account.Principal(), "/test-doc", []cid.Cid{c2.CID}, clock.MustNow(), VisibilityPublic)
	require.NoError(t, err)

	blobs := colx.SlicePermutations([]struct {
		Name string
		Blob blocks.Block
	}{
		{"c1", c1},
		{"c2", c2},
		{"ref", ref},
	})

	for _, test := range blobs {
		order := make([]string, len(test))
		for i, b := range test {
			order[i] = b.Name
		}
		testID := strings.Join(order, "+")
		t.Run(testID, func(t *testing.T) {
			db := storage.MakeTestDB(t)
			idx, err := OpenIndex(t.Context(), db, zap.NewNop(), nil)
			require.NoError(t, err)

			for _, blob := range test {
				require.NoError(t, idx.Put(t.Context(), blob.Blob))
			}

			if countStashedBlobs(t, db) != 0 {
				t.Fatal("must have no stashed blobs")
			}

			iri := must.Do2(NewIRI(alice.Account.Principal(), "/test-doc"))

			changes, check := idx.iterChangesLatest(t.Context(), iri)
			var i int
			for c := range changes {
				if i == 0 {
					require.Equal(t, c1.CID, c.CID, "first change must be c1")
				}

				if i == 1 {
					require.Equal(t, c2.CID, c.CID, "second change must be c2")
				}

				i++
			}
			require.NoError(t, check())
			require.Equal(t, 2, i, "should have two changes")

			count, err := sqlitex.QueryOnePool[int](t.Context(), db, "SELECT COUNT() FROM document_generations WHERE resource = (SELECT id FROM resources WHERE iri = :iri)", iri)
			require.NoError(t, err)
			require.Equal(t, 1, count, "must have one generation for the document indexed")
		})
	}
}

func TestBug_MetadataCRDT(t *testing.T) {
	// Data extracted from real document that was causing problems.
	data := []byte(`{"cover":{"v":"","t":1741180379407},"icon":{"v":"ipfs://bafkreid63qduvw3p4bldx4mjxnb6tskhgabvhe4zfsf62hmfrp5xbe6uku","t":1729778316028},"layout":{"v":"","t":1761781408059},"name":{"v":"Eric Vicenti","t":1729606183282},"seedExperimentalLogo":{"v":"","t":1761781408059},"showOutline":{"v":false,"t":1761781408059},"siteUrl":{"v":"https://ev.hyper.media","t":1743635919824},"theme":{"v":"[object Object]","t":1739260812124},"theme.headerLayout":{"v":"","t":1761781408059},"thumbnail":{"v":"ipfs://bafkreid63qduvw3p4bldx4mjxnb6tskhgabvhe4zfsf62hmfrp5xbe6uku","t":1729606183282}}`)

	for range 150 {
		var attrs DocIndexedAttrs
		require.NoError(t, json.Unmarshal(data, &attrs))

		require.IsType(t, map[string]any{}, attrs.PublicMap()["theme"])
	}
}
