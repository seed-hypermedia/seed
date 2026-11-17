package blob_test

import (
	"context"
	"encoding/json"
	"math/rand/v2"
	"seed/backend/api/documents/v3alpha/docmodel"
	"seed/backend/blob"
	"seed/backend/core/coretest"
	"seed/backend/storage"
	"seed/backend/util/cclock"
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

// Attribute writes reach the index in separate Changes and Refs, in whatever
// order sync delivers them, and each blob is indexed in its own transaction.
// Whatever that order, document_attributes must end up exactly where
// docmodel's full replay of the same changes ends up.
func TestDocumentAttributesIndexOrderMatchesDocmodel(t *testing.T) {
	t.Parallel()

	keys := []string{"a", "a.b", "a.b.c", "a.d", "ab", "theme", "theme.Color", "theme.Font"}
	values := []any{"x", "y", nil}
	rng := rand.New(rand.NewPCG(5, 6))

	for set := range 40 {
		alice := coretest.NewTester("alice")
		base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC).Add(time.Duration(set) * time.Hour)

		genesis := must.Do2(blob.NewChange(alice.Account, cid.Undef, nil, 0, blob.ChangeBody{
			Ops: []blob.OpMap{must.Do2(blob.NewOpSetKey("title", "Doc"))},
		}, base))

		// Concurrent attribute writes, each in its own Change and Ref.
		n := 2 + rng.IntN(5)
		changes := []blob.Encoded[*blob.Change]{genesis}
		var writes [][]blocks.Block

		tsOrder := rng.Perm(n)
		for i := range n {
			at := base.Add(time.Duration(1+tsOrder[i]) * time.Millisecond)
			ch := must.Do2(blob.NewChange(alice.Account, genesis.CID, []cid.Cid{genesis.CID}, 1, blob.ChangeBody{
				Ops: []blob.OpMap{blob.NewOpSetAttributes("", []blob.KeyValue{{
					Key:   strings.Split(keys[rng.IntN(len(keys))], "."),
					Value: values[rng.IntN(len(values))],
				}})},
			}, at))
			ref := must.Do2(blob.NewRef(alice.Account, 0, genesis.CID, alice.Account.Principal(), "/doc", []cid.Cid{ch.CID}, base.Add(time.Hour).Add(time.Duration(i)*time.Second), blob.VisibilityPublic))
			changes = append(changes, ch)
			writes = append(writes, []blocks.Block{ch, ref})
		}

		want := docmodelMetadata(t, alice, changes)

		for range 3 {
			order := make([][]blocks.Block, len(writes))
			copy(order, writes)
			rng.Shuffle(len(order), func(i, j int) { order[i], order[j] = order[j], order[i] })

			db := storage.MakeTestDB(t)
			idx := must.Do2(blob.OpenIndex(t.Context(), db, zap.NewNop()))
			genesisRef := must.Do2(blob.NewRef(alice.Account, 0, genesis.CID, alice.Account.Principal(), "/doc", []cid.Cid{genesis.CID}, base.Add(time.Minute), blob.VisibilityPublic))
			require.NoError(t, idx.Put(t.Context(), genesis))
			require.NoError(t, idx.Put(t.Context(), genesisRef))
			for _, pair := range order {
				for _, b := range pair {
					require.NoError(t, idx.Put(t.Context(), b)) // One transaction per blob.
				}
			}

			require.Equal(t, want, indexedMetadata(t, db, "hm://"+alice.Account.Principal().String()+"/doc"), "set %d", set)
		}
	}
}

// docmodelMetadata is the full replay: every change applied in time order.
func docmodelMetadata(t *testing.T, signer coretest.Tester, changes []blob.Encoded[*blob.Change]) map[string]any {
	t.Helper()
	sorted := make([]blob.Encoded[*blob.Change], len(changes))
	copy(sorted, changes)
	for i := 1; i < len(sorted); i++ {
		for j := i; j > 0 && sorted[j].Decoded.Ts.Before(sorted[j-1].Decoded.Ts); j-- {
			sorted[j], sorted[j-1] = sorted[j-1], sorted[j]
		}
	}

	doc := must.Do2(docmodel.New(blob.IRI("hm://"+signer.Account.Principal().String()+"/doc"), cclock.New()))
	for _, ch := range sorted {
		require.NoError(t, doc.ApplyChange(ch.CID, ch.Decoded))
	}

	pb := must.Do2(doc.Hydrate(context.Background()))
	out := pb.Metadata.AsMap()
	return out
}

// indexedMetadata reads document_attributes the way the API does.
func indexedMetadata(t *testing.T, db *sqlitex.Pool, iri string) map[string]any {
	t.Helper()
	raw, err := sqlitex.QueryOnePool[string](t.Context(), db, `
		SELECT COALESCE(json_group_object(dak.key, json_object('key', dak.key, 'v', da.value, 't', da.timestamp, 'o', da.operation, 'a', da.actor, 'k', da.kind)), '{}')
		FROM document_attributes da
		JOIN document_attribute_keys dak ON dak.id = da.key
		WHERE da.resource = (SELECT id FROM resources WHERE iri = :iri)
	`, iri)
	require.NoError(t, err)

	var attrs blob.DocIndexedAttrs

	require.NoError(t, json.Unmarshal([]byte(raw), &attrs))
	return attrs.PublicMap()
}
