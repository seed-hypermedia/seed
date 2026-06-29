package syncing

import (
	"context"
	"testing"

	"seed/backend/hmnet/syncing/rbsr"
	"seed/backend/storage"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/multiformats/go-multicodec"
	"github.com/stretchr/testify/require"
)

func TestCanonicalCodecFor(t *testing.T) {
	t.Parallel()
	require.Equal(t, int64(multicodec.Raw), canonicalCodecFor(int64(multicodec.DagPb)), "dag-pb collapses to raw")
	require.Equal(t, int64(multicodec.Raw), canonicalCodecFor(int64(multicodec.Raw)), "raw stays raw")
	require.Equal(t, int64(multicodec.DagCbor), canonicalCodecFor(int64(multicodec.DagCbor)), "dag-cbor untouched")
}

func TestCodecForProtocol(t *testing.T) {
	t.Parallel()
	// Legacy: identity, no canonicalization.
	require.Equal(t, int64(multicodec.DagPb), codecForProtocol(int64(multicodec.DagPb), ProtocolVersionLegacy))
	// Canonical: dag-pb rewritten to raw; others unchanged.
	require.Equal(t, int64(multicodec.Raw), codecForProtocol(int64(multicodec.DagPb), ProtocolVersionCanonical))
	require.Equal(t, int64(multicodec.DagCbor), codecForProtocol(int64(multicodec.DagCbor), ProtocolVersionCanonical))
}

// TestCanonicalization_MakesCodecsAgreeAcrossPeers proves the point of /0.9.3.
// blobs.multihash is UNIQUE, so a single peer never holds the same content
// under two codecs — the divergence is cross-peer: one peer stores a multihash
// as raw, another as dag-pb, and their legacy fingerprints differ for identical
// content. Under the canonical protocol both advertise raw, so the fingerprints
// agree.
func TestCanonicalization_MakesCodecsAgreeAcrossPeers(t *testing.T) {
	t.Parallel()
	ctx := context.Background()

	buildFingerprint := func(storedCodec int64, protocolVersion string) rbsr.Fingerprint {
		db := storage.MakeTestDB(t)
		require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
			if err := sqlitex.Exec(conn, `INSERT INTO rbsr_scope (id, iri, kind, materialized) VALUES (1, 'hm://x', 2, 1)`, nil); err != nil {
				return err
			}
			if err := sqlitex.Exec(conn, `INSERT INTO blobs (id, multihash, codec, size) VALUES (80, X'AA', ?, 1)`, nil, storedCodec); err != nil {
				return err
			}
			return sqlitex.Exec(conn, `INSERT INTO rbsr_item (scope, blob) VALUES (1, 80)`, nil)
		}))
		store := newAuthorizedTreeStore()
		require.NoError(t, db.WithSave(ctx, func(conn *sqlite.Conn) error {
			return buildStoreFromScopes(conn, []int64{1}, protocolVersion, store)
		}))
		require.NoError(t, store.Seal())
		return fingerprintOf(t, store)
	}

	rawLegacy := buildFingerprint(int64(multicodec.Raw), ProtocolVersionLegacy)
	dagpbLegacy := buildFingerprint(int64(multicodec.DagPb), ProtocolVersionLegacy)
	dagpbCanonical := buildFingerprint(int64(multicodec.DagPb), ProtocolVersionCanonical)

	require.NotEqual(t, rawLegacy, dagpbLegacy, "without canonicalization, raw vs dag-pb diverge for identical content")
	require.Equal(t, rawLegacy, dagpbCanonical, "canonical makes a dag-pb blob advertise identically to raw")
}
