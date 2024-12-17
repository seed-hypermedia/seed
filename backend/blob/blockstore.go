package blob

import (
	"context"
	"fmt"
	"seed/backend/ipfs"
	"seed/backend/util/dqb"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	blockstore "github.com/ipfs/boxo/blockstore"
	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	format "github.com/ipfs/go-ipld-format"
	"github.com/klauspost/compress/zstd"
	"github.com/multiformats/go-multicodec"
	"github.com/multiformats/go-multihash"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
)

var (
	mCallsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "seed_ipfs_blockstore_calls_total",
		Help: "The total of method calls on the IPFS' Blockstore public interface.",
	}, []string{"method"})
)

var _ blockstore.Blockstore = (*blockStore)(nil)

// blockStore is an implementation of IPFS Blockstore.
type blockStore struct {
	db      *sqlitex.Pool
	encoder *zstd.Encoder
	decoder *zstd.Decoder
}

// newBlockstore creates a new block store from a given connection pool.
// The corresponding table and columns must be created beforehand.
// Use DefaultConfig() for default table and column names.
func newBlockstore(db *sqlitex.Pool) *blockStore {
	enc, err := zstd.NewWriter(nil)
	if err != nil {
		panic(err)
	}

	dec, err := zstd.NewReader(nil)
	if err != nil {
		panic(err)
	}

	return &blockStore{
		db:      db,
		encoder: enc,
		decoder: dec,
	}
}

// Has implements blockstore.Blockstore interface.
func (b *blockStore) Has(ctx context.Context, c cid.Cid) (bool, error) {
	mCallsTotal.WithLabelValues("Has").Inc()

	eid, err := EntityIDFromCID(c)
	if err != nil {
		conn, release, err := b.db.Conn(ctx)
		if err != nil {
			return false, err
		}
		defer release()

		return b.has(conn, c)
	}
	ok, err := b.checkEntityExists(ctx, eid)
	if err != nil {
		return false, err
	}

	return ok, nil
}

func (b *blockStore) has(conn *sqlite.Conn, c cid.Cid) (bool, error) {
	res, err := dbBlobsGetSize(conn, c.Hash())
	if err != nil {
		return false, err
	}
	if res.BlobsID == 0 || res.BlobsSize < 0 {
		return false, nil
	}

	return true, nil
}

func (b *blockStore) checkEntityExists(ctx context.Context, eid string) (exists bool, err error) {
	conn, release, err := b.db.Conn(ctx)
	if err != nil {
		return false, err
	}
	defer release()

	res, err := dbResourcesLookupID(conn, eid)
	if err != nil || res.ResourcesID == 0 {
		return false, nil
	}

	var hasChanges bool
	if err := sqlitex.Exec(conn, qCheckEntityHasChanges(), func(stmt *sqlite.Stmt) error {
		hasChanges = true
		return nil
	}, eid); err != nil {
		return false, err
	}

	return hasChanges, nil
}

var qCheckEntityHasChanges = dqb.Str(`
	SELECT 1 FROM structural_blobs WHERE resource = ? AND structural_blobs.type = 'Change' LIMIT 1;
`)

// Get implements blockstore.Blockstore interface.
func (b *blockStore) Get(ctx context.Context, c cid.Cid) (blocks.Block, error) {
	mCallsTotal.WithLabelValues("Get").Inc()

	conn, release, err := b.db.Conn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	return b.get(conn, c)
}

func (b *blockStore) get(conn *sqlite.Conn, c cid.Cid) (blocks.Block, error) {
	res, err := dbBlobsGet(conn, c.Hash())
	if err != nil {
		return nil, err
	}

	if res.BlobsID == 0 {
		return nil, format.ErrNotFound{Cid: c}
	}

	// Size 0 means that data is stored inline in the CID.
	if res.BlobsSize == 0 {
		return blocks.NewBlockWithCid(nil, c)
	}

	data, err := b.decompress(res.BlobsData, int(res.BlobsSize))
	if err != nil {
		return nil, err
	}

	return blocks.NewBlockWithCid(data, c)
}

func (b *blockStore) decompress(data []byte, originalSize int) ([]byte, error) {
	var err error
	out := make([]byte, 0, originalSize)
	out, err = b.decoder.DecodeAll(data, out)
	if err != nil {
		return nil, fmt.Errorf("failed to decompress blob: %w", err)
	}
	return out, nil
}

// GetSize implements blockstore.Blockstore interface.
func (b *blockStore) GetSize(ctx context.Context, c cid.Cid) (int, error) {
	mCallsTotal.WithLabelValues("GetSize").Inc()

	conn, release, err := b.db.Conn(ctx)
	if err != nil {
		return 0, err
	}
	defer release()

	res, err := dbBlobsGetSize(conn, c.Hash())
	if err != nil {
		return 0, err
	}

	if res.BlobsID == 0 || res.BlobsSize < 0 {
		return 0, format.ErrNotFound{Cid: c}
	}

	return int(res.BlobsSize), nil
}

// Put implements blockstore.Blockstore interface.
func (b *blockStore) Put(ctx context.Context, block blocks.Block) error {
	mCallsTotal.WithLabelValues("Put").Inc()

	return b.withConn(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.WithTx(conn, func() error {
			codec, hash := ipfs.DecodeCID(block.Cid())
			_, _, err := b.putBlock(conn, 0, uint64(codec), hash, block.RawData())
			return err
		})
	})
}

// PutMany implements blockstore.Blockstore interface.
func (b *blockStore) PutMany(ctx context.Context, blocks []blocks.Block) error {
	mCallsTotal.WithLabelValues("PutMany").Inc()

	return b.withConn(ctx, func(conn *sqlite.Conn) error {
		return sqlitex.WithTx(conn, func() error {
			for _, blk := range blocks {
				codec, hash := ipfs.DecodeCID(blk.Cid())
				if _, _, err := b.putBlock(conn, 0, uint64(codec), hash, blk.RawData()); err != nil {
					return err
				}
			}
			return nil
		})
	})
}

func (b *blockStore) putBlock(conn *sqlite.Conn, inID int64, codec uint64, hash multihash.Multihash, data []byte) (id int64, exists bool, err error) {
	size, err := dbBlobsGetSize(conn, hash)
	if err != nil {
		return 0, false, err
	}

	var update bool

	switch {
	// We have this blob already. Size can be 0 if data is inlined in the CID.
	case size.BlobsID != 0 && size.BlobsSize >= 0:
		return size.BlobsID, true, nil
	// We know about the blob, but we don't have it.
	case size.BlobsID != 0 && size.BlobsSize < 0:
		update = true
	// We don't have nor know anything about the blob.
	case size.BlobsID == 0 && size.BlobsSize == 0:
	default:
		panic("BUG: unhandled blob insert case")
	}

	var compressed []byte
	// We store IPFS blocks compressed in the database. But for inline CIDs, there's no data (because it's inline),
	// hence nothing to compress. It could be that compression doesn't actually bring much benefit, we'd have to
	// measure at some point whether or not it's useful. As we're storing a lot of text, I assume storage-wise
	// it should make a difference, but the performance hit needs to be measured.
	//
	// TODO(burdiyan): don't compress if original data is <= compressed data.
	if len(data) > 0 {
		compressed = make([]byte, 0, len(data))
		compressed = b.encoder.EncodeAll(data, compressed)
	}

	if update {
		newID, err := allocateBlobID(conn)
		if err != nil {
			return 0, false, err
		}
		return newID, false, blobsUpdateMissingData(conn, compressed, int64(len(data)), newID, size.BlobsID)
	}

	ins, err := dbBlobsInsert(conn, inID, hash, int64(codec), compressed, int64(len(data)))
	return ins, false, err
}

func allocateBlobID(conn *sqlite.Conn) (int64, error) {
	var id int64
	if err := sqlitex.Exec(conn, qAllocateBlobID(), func(stmt *sqlite.Stmt) error {
		id = stmt.ColumnInt64(0)
		return nil
	}); err != nil {
		return 0, err
	}

	if id == 0 {
		return 0, fmt.Errorf("BUG: couldn't allocate blob ID for some reason")
	}

	return id, nil
}

var qAllocateBlobID = dqb.Str(`
	UPDATE sqlite_sequence
	SET seq = seq + 1
	WHERE name = 'blobs'
	RETURNING seq;
`)

// blobsUpdateMissingData updates a blob.
func blobsUpdateMissingData(conn *sqlite.Conn, blobsData []byte, blobsSize int64, newID, blobsID int64) error {
	return sqlitex.Exec(conn, qBlobsUpdateMissingData(), nil, blobsData, blobsSize, newID, blobsID)
}

var qBlobsUpdateMissingData = dqb.Str(`
	UPDATE blobs
	SET data = :blobsData,
		size = :blobsSize,
		id = :newID
	WHERE id = :oldID;
`)

// DeleteBlock implements blockstore.Blockstore interface.
func (b *blockStore) DeleteBlock(ctx context.Context, c cid.Cid) error {
	mCallsTotal.WithLabelValues("DeleteBlock").Inc()

	conn, release, err := b.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	_, err = b.deleteBlock(conn, c)
	return err
}

func (b *blockStore) deleteBlock(conn *sqlite.Conn, c cid.Cid) (oldid int64, err error) {
	ret, err := dbBlobsDelete(conn, c.Hash())
	return ret, err
}

// AllKeysChan implements. blockstore.Blockstore interface.
func (b *blockStore) AllKeysChan(ctx context.Context) (<-chan cid.Cid, error) {
	mCallsTotal.WithLabelValues("AllKeysChan").Inc()

	c := make(chan cid.Cid, 10) // The buffer is arbitrary.

	conn, release, err := b.db.Conn(ctx)
	if err != nil {
		return nil, err
	}

	list, err := dbBlobsListKnown(conn)
	if err != nil {
		return nil, err
	}

	release()

	go func() {
		defer close(c)

		for _, l := range list {
			select {
			case <-ctx.Done():
				return
			case c <- cid.NewCidV1(uint64(l.BlobsCodec), l.BlobsMultihash):
				// Written successfully.
			}
		}
	}()

	return c, nil
}

// HashOnRead satisfies blockstore.Blockstore interface, but is not actually implemented.
func (b *blockStore) HashOnRead(bool) {
	panic("hash on read is not implemented for sqlite blockstore")
}

func (b *blockStore) withConn(ctx context.Context, fn func(*sqlite.Conn) error) error {
	conn, release, err := b.db.Conn(ctx)
	if err != nil {
		return err
	}
	defer release()

	return fn(conn)
}

func EntityIDFromCID(c cid.Cid) (string, error) {
	codec, hash := ipfs.DecodeCID(c)

	if multicodec.Code(codec) != multicodec.Raw {
		return "", fmt.Errorf("failed to convert CID %s into entity ID: unsupported codec %s", c, multicodec.Code(codec))
	}

	mh, err := multihash.Decode(hash)
	if err != nil {
		return "", fmt.Errorf("failed to decode multihash from CID %q: %w", c, err)
	}

	if multicodec.Code(mh.Code) != multicodec.Identity {
		return "", fmt.Errorf("failed to convert CID %s into entity ID: unsupported hash %s", c, multicodec.Code(mh.Code))
	}

	return string(mh.Digest), nil
}
