package syncing

import (
	"context"
	"testing"

	"seed/backend/storage"
	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/ipfs/go-cid"
	"github.com/multiformats/go-multihash"
	"github.com/stretchr/testify/require"
)

// TestClassifyMediaTiers locks the render-priority bucketing of media blobs by
// their incoming blob_link type: chrome (covers/icons/avatars) = 2, inline
// content images = 3, everything else (bulk file payloads, unlinked) = 4, with
// a blob taking the highest-priority (lowest) tier among its links.
func TestClassifyMediaTiers(t *testing.T) {
	t.Parallel()

	const (
		codecDagCBOR = 0x71 // structural
		codecRaw     = 0x55 // media chunk / small image
		codecDagPB   = 0x70 // media manifest
	)

	mkCID := func(seed string, codec uint64) cid.Cid {
		mh, err := multihash.Sum([]byte(seed), multihash.SHA2_256, -1)
		require.NoError(t, err)
		return cid.NewCidV1(codec, mh)
	}

	type tcase struct {
		cid       cid.Cid
		linkTypes []string
		wantTier  int
	}
	cases := map[string]tcase{
		"cover":            {mkCID("cover", codecRaw), []string{"metadata/cover"}, 2},
		"icon":             {mkCID("icon", codecRaw), []string{"metadata/icon"}, 2},
		"logo":             {mkCID("logo", codecRaw), []string{"metadata/seedExperimentalLogo"}, 2},
		"profile icon":     {mkCID("pfp", codecRaw), []string{"profile/icon"}, 2},
		"doc image":        {mkCID("docimg", codecRaw), []string{"doc/Image"}, 3},
		"comment image":    {mkCID("cmtimg", codecRaw), []string{"comment/Image"}, 3},
		"dagpb chunk":      {mkCID("chunk", codecRaw), []string{"dagpb/chunk"}, 4},
		"doc video":        {mkCID("video", codecDagPB), []string{"doc/Video"}, 4},
		"orphan (no link)": {mkCID("orphan", codecRaw), nil, 4},
		"cover wins image": {mkCID("dual", codecRaw), []string{"doc/Image", "metadata/cover"}, 2},
	}

	db := storage.MakeTestDB(t)
	ctx := context.Background()

	// One structural source blob; every media blob links from it.
	srcCID := mkCID("source-change", codecDagCBOR)

	require.NoError(t, db.WithTx(ctx, func(conn *sqlite.Conn) error {
		insertBlob := func(id int64, c cid.Cid) error {
			return sqlitex.Exec(conn,
				`INSERT INTO blobs (id, multihash, codec, size) VALUES (?, ?, ?, 1)`,
				nil, id, []byte(c.Hash()), int64(c.Type()))
		}

		var nextID int64 = 1
		srcID := nextID
		nextID++
		if err := insertBlob(srcID, srcCID); err != nil {
			return err
		}
		for _, tc := range cases {
			id := nextID
			nextID++
			if err := insertBlob(id, tc.cid); err != nil {
				return err
			}
			for _, lt := range tc.linkTypes {
				if err := sqlitex.Exec(conn,
					`INSERT INTO blob_links (source, type, target) VALUES (?, ?, ?)`,
					nil, srcID, lt, id); err != nil {
					return err
				}
			}
		}
		return nil
	}))

	s := &Service{db: db}

	cids := make([]cid.Cid, 0, len(cases))
	for _, tc := range cases {
		cids = append(cids, tc.cid)
	}

	got, err := s.classifyMediaTiers(ctx, cids)
	require.NoError(t, err)
	for name, tc := range cases {
		require.Equalf(t, tc.wantTier, got[tc.cid], "tier for %q (%s)", name, tc.cid)
	}

	// Empty input returns an empty map, not nil/error.
	empty, err := s.classifyMediaTiers(ctx, nil)
	require.NoError(t, err)
	require.Empty(t, empty)
}
