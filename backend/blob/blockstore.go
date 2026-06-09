package blob

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"seed/backend/core"
	"seed/backend/ipfs"
	"seed/backend/util/dqb"
	"seed/backend/util/sqlitegen"
	"strconv"
	"sync/atomic"

	"seed/backend/util/sqlite"
	"seed/backend/util/sqlite/sqlitex"

	"github.com/burdiyan/go-erriter"
	blockstore "github.com/ipfs/boxo/blockstore"
	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	format "github.com/ipfs/go-ipld-format"
	"github.com/klauspost/compress/zstd"
	"github.com/multiformats/go-multicodec"
	"github.com/multiformats/go-multihash"
	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/promauto"
	"go.uber.org/zap"
)

// MaxBlobSize is the maximum size of a single blob.
// It's defined as 2 MiB to stay compatible with Bitswap: https://specs.ipfs.tech/bitswap-protocol/#block-sizes.
const MaxBlobSize = 2 * 1024 * 1024

var (
	mCallsTotal = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "seed_ipfs_blockstore_calls_total",
		Help: "The total of method calls on the IPFS' Blockstore public interface.",
	}, []string{"method"})

	// mPutBlockOutcome counts putBlock invocations bucketed by what happened to
	// the incoming block: did we already have it, did we fill in a placeholder,
	// or did we insert a fresh row. The "exists" outcome quantifies "block
	// arrived from the network but local DB already had it" — the smoking gun
	// for re-fetch loops surfaced on /debug/network.
	mPutBlockOutcome = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "seed_blob_putblock_outcome_total",
		Help: "putBlock outcome counts by disposition (exists|update|new).",
	}, []string{"outcome"})

	// mPutBlockBytes is the byte count for each putBlock outcome, using the
	// incoming uncompressed blob length. Lets us compare bytes-already-stored
	// against bitswap.Stat().DataReceived to confirm/refute the re-fetch
	// hypothesis without staring at block counts.
	mPutBlockBytes = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "seed_blob_putblock_bytes_total",
		Help: "putBlock byte counts (uncompressed input) by disposition.",
	}, []string{"outcome"})

	// mPutBlockExistsByCodec breaks the `exists` outcome down by the codec of
	// the incoming CID. Tells us at a glance whether the re-fetch loop is
	// concentrated on media (raw=85, dag-pb=112) or also affects Hypermedia
	// structural blobs (dag-cbor=113). Lets us confirm or refute the
	// "media-only" hypothesis over the full session, not just sampled logs.
	mPutBlockExistsByCodec = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "seed_blob_putblock_exists_by_codec_total",
		Help: "putBlock 'exists' hits broken down by incoming CID codec.",
	}, []string{"codec"})

	// mPutBlockCodecMismatch counts every time putBlock takes the `exists`
	// branch for a multihash whose stored codec differs from the codec the
	// caller passed in. Direct evidence of "peer ships CID(codec_A, H), we
	// have CID(codec_B, H), RBSR sees them as different items, bitswap
	// fetches, blockstore drops". Labels carry both codec values so we can
	// see the actual asymmetry distribution across the network.
	mPutBlockCodecMismatch = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "seed_blob_putblock_codec_mismatch_total",
		Help: "putBlock 'exists' hits where the incoming CID's codec differs from the stored codec for the same multihash.",
	}, []string{"stored_codec", "incoming_codec"})

	// mHasInconsistent counts cases where blockStore.Has returned false but
	// the blob IS present (size>=0) when looked up without filters. This is
	// the smoking gun for "we keep asking peers for blobs we already have":
	// bitswap consults Has, gets false, broadcasts a WANT, peer ships, the
	// block lands at putBlock which then finds it under the unfiltered
	// blobs lookup and bounces it as `exists`.
	//
	// Buckets:
	//   reason="public_only_filter" — Has used IsPublicOnly(ctx)=true and the blob is private
	//   reason="entity_cid_no_change" — CID is an entity-CID; resource exists but no Change blob, yet the blob row IS in blobs
	//   reason="other"               — neither of the above; deeper bug
	mHasInconsistent = promauto.NewCounterVec(prometheus.CounterOpts{
		Name: "seed_blockstore_has_false_but_present_total",
		Help: "blockStore.Has returned false but the blob is present in the unfiltered blobs table; broken down by likely cause.",
	}, []string{"reason"})
)

var _ blockstore.Blockstore = (*blockStore)(nil)

// blockStore is an implementation of IPFS Blockstore.
type blockStore struct {
	db      *sqlitex.Pool
	encoder *zstd.Encoder
	decoder *zstd.Decoder
	log     *zap.Logger

	// existsSampleCount caps how many `exists` putBlock outcomes get logged
	// at info level with the CID + multihash. Lets a session capture ~30
	// concrete examples of redundant fetches; after that, the counter
	// stays beyond the limit and the cheap atomic read short-circuits.
	existsSampleCount atomic.Int64
}

const existsSampleLimit int64 = 30

// newBlockstore creates a new block store from a given connection pool.
// The corresponding table and columns must be created beforehand.
// Use DefaultConfig() for default table and column names.
func newBlockstore(db *sqlitex.Pool, log *zap.Logger) *blockStore {
	enc, err := zstd.NewWriter(nil)
	if err != nil {
		panic(err)
	}

	dec, err := zstd.NewReader(nil)
	if err != nil {
		panic(err)
	}

	if log == nil {
		log = zap.NewNop()
	}

	return &blockStore{
		db:      db,
		encoder: enc,
		decoder: dec,
		log:     log,
	}
}

// Has implements blockstore.Blockstore interface.
//
// On a "false" return, this also runs an unfiltered lookup against `blobs`
// and increments mHasInconsistent if the row is actually present. Lets
// /debug/network distinguish "we genuinely don't have it" from "we have it
// but Has lied" (the symptom that drives bitswap re-fetch loops).
func (b *blockStore) Has(ctx context.Context, c cid.Cid) (bool, error) {
	mCallsTotal.WithLabelValues("Has").Inc()

	publicOnly := IsPublicOnly(ctx)

	eid, err := EntityIDFromCID(c)
	if err != nil {
		conn, release, err := b.db.ReadConn(ctx)
		if err != nil {
			return false, err
		}
		defer release()

		ok, err := b.has(ctx, conn, c, publicOnly)
		if err == nil && !ok {
			// Cross-check: is the row actually present without filters?
			// If yes, Has lied — the next step is bitswap will fetch it
			// from peers and putBlock will bounce it as "exists".
			res, perr := dbBlobsGetSize(conn, c.Hash(), false)
			if perr == nil && res.BlobsID != 0 && res.BlobsSize >= 0 {
				if publicOnly {
					mHasInconsistent.WithLabelValues("public_only_filter").Inc()
				} else {
					mHasInconsistent.WithLabelValues("other").Inc()
				}
			}
		}
		return ok, err
	}

	ok, err := b.checkEntityExists(ctx, eid)
	if err != nil {
		return false, err
	}
	if !ok {
		// Cross-check: entity-CID branch said "no Change blob exists for this
		// entity", yet maybe the entity-CID's own blob row IS in `blobs`. If
		// so, putBlock will see it and bounce as "exists" — that's the loop.
		conn, release, cerr := b.db.ReadConn(ctx)
		if cerr == nil {
			res, perr := dbBlobsGetSize(conn, c.Hash(), false)
			release()
			if perr == nil && res.BlobsID != 0 && res.BlobsSize >= 0 {
				mHasInconsistent.WithLabelValues("entity_cid_no_change").Inc()
			}
		}
	}

	return ok, nil
}

func (b *blockStore) has(ctx context.Context, conn *sqlite.Conn, c cid.Cid, publicOnly bool) (bool, error) {
	res, err := b.getSize(ctx, conn, c, publicOnly)
	if err != nil {
		return false, err
	}
	if res.BlobsID == 0 || res.BlobsSize < 0 {
		return false, nil
	}

	return true, nil
}

func (b *blockStore) checkEntityExists(ctx context.Context, eid string) (exists bool, err error) {
	conn, release, err := b.db.ReadConn(ctx)
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

	conn, release, err := b.db.ReadConn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	publicOnly := IsPublicOnly(ctx)
	return b.get(ctx, conn, c, publicOnly)
}

// GetMany is a batch request to get many blocks from the blockstore.
func (b *blockStore) GetMany(ctx context.Context, cc []cid.Cid) ([]blocks.Block, error) {
	mCallsTotal.WithLabelValues("GetMany").Inc()

	conn, release, err := b.db.ReadConn(ctx)
	if err != nil {
		return nil, err
	}
	defer release()

	publicOnly := IsPublicOnly(ctx)
	out := make([]blocks.Block, len(cc))

	for i, c := range cc {
		blk, err := b.get(ctx, conn, c, publicOnly)
		if err != nil {
			return nil, err
		}
		out[i] = blk
	}

	return out, nil
}

// IterMany is the same as GetMany, but returns an iterator over the blocks.
// The database transaction may be open for the duration of the iteration,
// so callers should be careful not to hold the connection for too long,
func (b *blockStore) IterMany(ctx context.Context, cc []cid.Cid) erriter.Seq[blocks.Block] {
	mCallsTotal.WithLabelValues("IterMany").Inc()

	publicOnly := IsPublicOnly(ctx)

	return erriter.Make(func(yield func(blocks.Block) bool) error {
		return b.db.WithSave(ctx, func(conn *sqlite.Conn) error {
			for _, c := range cc {
				blk, err := b.get(ctx, conn, c, publicOnly)
				if err != nil {
					return err
				}

				if !yield(blk) {
					break
				}
			}
			return nil
		})
	})
}

func (b *blockStore) get(ctx context.Context, conn *sqlite.Conn, c cid.Cid, publicOnly bool) (blocks.Block, error) {
	res, err := dbBlobsGet(conn, c.Hash(), publicOnly)
	if err != nil {
		return nil, err
	}

	if res.ID == 0 {
		if publicOnly {
			privateRes, err := dbBlobsGet(conn, c.Hash(), false)
			if err != nil {
				return nil, err
			}
			if privateRes.ID != 0 && !privateRes.IsPublic {
				if caller, ok := GetAuthenticatedCaller(ctx); ok {
					allowed, err := dbBlobCanCallerAccess(conn, privateRes.ID, caller)
					if err != nil {
						return nil, err
					}
					if allowed {
						res = privateRes
						goto found
					}
				}
				return nil, PublicOnlyDeniedError{CID: c}
			}
		}
		return nil, format.ErrNotFound{Cid: c}
	}

found:
	// Size 0 means that data is stored inline in the CID.
	if res.Size == 0 {
		return blocks.NewBlockWithCid(nil, c)
	}

	data, err := b.decompress(res.Data, int(res.Size))
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

	conn, release, err := b.db.ReadConn(ctx)
	if err != nil {
		return 0, err
	}
	defer release()

	publicOnly := IsPublicOnly(ctx)
	res, err := b.getSize(ctx, conn, c, publicOnly)
	if err != nil {
		return 0, err
	}

	if res.BlobsID == 0 || res.BlobsSize < 0 {
		return 0, format.ErrNotFound{Cid: c}
	}

	return int(res.BlobsSize), nil
}

func (b *blockStore) getSize(ctx context.Context, conn *sqlite.Conn, c cid.Cid, publicOnly bool) (blobsGetSizeResult, error) {
	res, err := dbBlobsGetSize(conn, c.Hash(), publicOnly)
	if err != nil {
		return blobsGetSizeResult{}, err
	}
	if res.BlobsID != 0 || !publicOnly {
		return res, nil
	}

	caller, ok := GetAuthenticatedCaller(ctx)
	if !ok {
		return res, nil
	}

	privateRes, err := dbBlobsGetSize(conn, c.Hash(), false)
	if err != nil {
		return blobsGetSizeResult{}, err
	}
	if privateRes.BlobsID == 0 || privateRes.BlobsSize < 0 {
		return res, nil
	}

	allowed, err := dbBlobCanCallerAccess(conn, privateRes.BlobsID, caller)
	if err != nil {
		return blobsGetSizeResult{}, err
	}
	if !allowed {
		return res, nil
	}

	return privateRes, nil
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
				if blk == nil {
					continue
				}
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
	if len(data) > MaxBlobSize {
		return 0, false, fmt.Errorf("block %s is too large: %d > %d", cid.NewCidV1(codec, hash).String(), len(data), MaxBlobSize)
	}

	size, err := dbBlobsGetSize(conn, hash, false)
	if err != nil {
		return 0, false, err
	}

	var update bool

	switch {
	// We have this blob already. Size can be 0 if data is inlined in the CID.
	case size.BlobsID != 0 && size.BlobsSize >= 0:
		mPutBlockOutcome.WithLabelValues("exists").Inc()
		mPutBlockBytes.WithLabelValues("exists").Add(float64(len(data)))
		mPutBlockExistsByCodec.WithLabelValues(strconv.FormatUint(codec, 10)).Inc()

		// Cheap second lookup for the stored codec so we can detect the
		// codec-mismatch pattern: same multihash, different codec on the
		// wire vs in our DB. Only runs on the cold path (we already have
		// the blob), so the cost is bounded by the re-fetch rate itself.
		var storedCodec int64
		_ = sqlitex.Exec(conn, `SELECT codec FROM blobs INDEXED BY blobs_metadata_by_hash WHERE multihash = ? LIMIT 1`,
			func(stmt *sqlite.Stmt) error { storedCodec = stmt.ColumnInt64(0); return nil },
			[]byte(hash),
		)
		if storedCodec > 0 && uint64(storedCodec) != codec {
			mPutBlockCodecMismatch.WithLabelValues(
				strconv.FormatInt(storedCodec, 10),
				strconv.FormatUint(codec, 10),
			).Inc()
		}

		// Sample-log the first existsSampleLimit redundant deliveries with
		// CID + multihash + codec, so we can pattern-match the actual
		// CIDs that bitswap is fetching for content we already have.
		if n := b.existsSampleCount.Add(1); n <= existsSampleLimit {
			b.log.Info("PutBlockExistsSample",
				zap.Int64("sample", n),
				zap.Int64("blobsID", size.BlobsID),
				zap.Uint64("codec", codec),
				zap.Int64("storedCodec", storedCodec),
				zap.String("multihash_hex", hex.EncodeToString(hash)),
				zap.Int("dataLen", len(data)),
			)
		}
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
		mPutBlockOutcome.WithLabelValues("update").Inc()
		mPutBlockBytes.WithLabelValues("update").Add(float64(len(data)))
		return newID, false, blobsUpdateMissingData(conn, compressed, int64(len(data)), newID, size.BlobsID)
	}

	ins, err := dbBlobsInsert(conn, inID, hash, int64(codec), compressed, int64(len(data)))
	if err == nil {
		mPutBlockOutcome.WithLabelValues("new").Inc()
		mPutBlockBytes.WithLabelValues("new").Add(float64(len(data)))
	}
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

	conn, release, err := b.db.WriteConn(ctx)
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

	conn, release, err := b.db.ReadConn(ctx)
	if err != nil {
		return nil, err
	}

	publicOnly := IsPublicOnly(ctx)
	list, err := dbBlobsListKnown(conn, publicOnly)
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
	conn, release, err := b.db.WriteConn(ctx)
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

type dbBlob struct {
	ID        int64
	Multihash []byte
	Codec     int64
	Data      []byte
	Size      int64
	IsPublic  bool
}

func dbBlobsGet(conn *sqlite.Conn, blobsMultihash []byte, publicOnly bool) (dbBlob, error) {
	var out dbBlob

	before := func(stmt *sqlite.Stmt) {
		stmt.SetBytes(":blobsMultihash", blobsMultihash)
		stmt.SetBool(":publicOnly", publicOnly)
	}

	onStep := func(i int, stmt *sqlite.Stmt) error {
		if i > 1 {
			return errors.New("BlobsGet: more than one result return for a single-kind query")
		}

		out.ID = stmt.ColumnInt64(0)
		out.Multihash = stmt.ColumnBytes(1)
		out.Codec = stmt.ColumnInt64(2)
		out.Data = stmt.ColumnBytes(3)
		out.Size = stmt.ColumnInt64(4)
		out.IsPublic = stmt.ColumnInt(5) == 1
		return nil
	}

	err := sqlitegen.ExecStmt(conn, qBlobsGet(), before, onStep)
	if err != nil {
		err = fmt.Errorf("failed query: BlobsGet: %w", err)
	}

	return out, err
}

func dbBlobCanCallerAccess(conn *sqlite.Conn, blobID int64, caller core.Principal) (bool, error) {
	var allowed bool
	err := sqlitex.Exec(conn, qBlobCanCallerAccess(), func(*sqlite.Stmt) error {
		allowed = true
		return nil
	}, blobID, blobID, []byte(caller))
	return allowed, err
}

var qBlobCanCallerAccess = dqb.Str(`
	SELECT 1
	FROM blob_visibility bv
	WHERE bv.id = ?1
	AND bv.space = 0
	UNION ALL
	SELECT 1
	FROM blob_visibility bv
	WHERE bv.id = ?2
	AND bv.space != 0
	AND ` + SQLCanWriteRootByOwnerID("bv.space") + `
	LIMIT 1
`)

var qBlobsGet = dqb.Str(`
	SELECT
		blobs.id,
		blobs.multihash,
		blobs.codec,
		blobs.data,
		blobs.size,
		public_blobs.id IS NOT NULL AS is_public
	FROM blobs
	LEFT JOIN public_blobs ON blobs.id = public_blobs.id
	WHERE blobs.multihash = :blobsMultihash AND blobs.size >= 0
	AND is_public >= :publicOnly
`)

func dbBlobsDelete(conn *sqlite.Conn, blobsMultihash []byte) (int64, error) {
	var out int64

	before := func(stmt *sqlite.Stmt) {
		stmt.SetBytes(":blobsMultihash", blobsMultihash)
	}

	onStep := func(i int, stmt *sqlite.Stmt) error {
		if i > 1 {
			return errors.New("BlobsDelete: more than one result return for a single-kind query")
		}

		out = stmt.ColumnInt64(0)
		return nil
	}

	err := sqlitegen.ExecStmt(conn, qBlobsDelete(), before, onStep)
	if err != nil {
		err = fmt.Errorf("failed query: BlobsDelete: %w", err)
	}

	return out, err
}

var qBlobsDelete = dqb.Str(`
	DELETE FROM blobs
	WHERE blobs.multihash = :blobsMultihash
	RETURNING blobs.id
`)

type blobsListKnownResult struct {
	BlobsID        int64
	BlobsMultihash []byte
	BlobsCodec     int64
	IsPublic       bool
}

func dbBlobsListKnown(conn *sqlite.Conn, publicOnly bool) ([]blobsListKnownResult, error) {
	var out []blobsListKnownResult

	before := func(stmt *sqlite.Stmt) {
		stmt.SetBool(":publicOnly", publicOnly)
	}

	onStep := func(_ int, stmt *sqlite.Stmt) error {
		out = append(out, blobsListKnownResult{
			BlobsID:        stmt.ColumnInt64(0),
			BlobsMultihash: stmt.ColumnBytes(1),
			BlobsCodec:     stmt.ColumnInt64(2),
			IsPublic:       stmt.ColumnInt64(3) == 1,
		})

		return nil
	}

	err := sqlitegen.ExecStmt(conn, qBlobsListKnown(), before, onStep)
	if err != nil {
		err = fmt.Errorf("failed query: BlobsListKnown: %w", err)
	}

	return out, err
}

var qBlobsListKnown = dqb.Str(`
	SELECT
		blobs.id,
		blobs.multihash,
		blobs.codec,
		public_blobs.id IS NOT NULL AS is_public
	FROM blobs INDEXED BY blobs_metadata
	LEFT JOIN public_blobs ON blobs.id = public_blobs.id
	WHERE blobs.size >= 0
	AND is_public >= :publicOnly
	ORDER BY blobs.id
`)
