package blob

import (
	"maps"
	"seed/backend/keyline"
	"seed/backend/util/sqlite"
	"slices"

	"go.uber.org/zap"
)

// indexBatch is state shared by every blob indexed in one write transaction:
// one PutMany chunk (a Put is a chunk of one blob), or a whole reindex, plus the
// unstash cascades they trigger. The transaction runs single-threaded over a
// consistent snapshot, so the batch needs no locking and never sees another
// connection's uncommitted state. A batch never outlives its transaction.
//
// Indexing a blob does right away the work that decides whether the blob is
// valid, and that later blobs can depend on: the blob's own rows and links,
// its Keyline facts, and its comment settlement. Work that aggregates many
// blobs into one result is recorded here as effects, and done once per batch
// when it flushes: applying Refs to their document generations and deriving
// document fields from the final heads, recounting comment stats, and
// propagating visibility. Indexing then costs the same whatever order blobs
// arrive in, and a reindex is the same flow as sync with one large batch.
//
// The batch also memoizes isValidWriter results and collects the delegates
// that new capabilities named. Indexing a capability updates Keyline's stored
// edges at once; flushAuthority later drops the memoized writer results and
// retries blobs that were denied before the grants arrived.
//
// Callers must flush before relying on the index and before committing.
type indexBatch struct {
	writers map[string]bool

	// authorityDelegates are key nodes that received a grant. Blobs they, or
	// keys acting for them, signed may now be authorized.
	authorityDelegates map[keyline.Node]bool

	// refs are the effects of the Refs indexed since the last flush.
	refs []refEffect

	// indexed are the blobs indexed since the last flush, whose visibility
	// propagates when the batch flushes.
	indexed []int64

	// commentDocs and commentSpaces are the documents, by genesis, and the
	// spaces whose comment stats are stale.
	commentDocs   map[string]bool
	commentSpaces map[string]bool

	// changes memoizes the change metadata that applying Refs reads. It's
	// filled only while flushing, outside any blob's savepoint, from changes
	// that are indexed for the rest of the transaction, so entries stay valid
	// for the batch's lifetime.
	changes map[int64]changeMetadata

	// genesises memoizes genesis blob IDs by CID, like changes.
	genesises map[string]int64

	// deriveDocFields derives the fields of documents whose heads changed.
	// May be nil, which skips derivation.
	deriveDocFields DeriveDocFields

	// stats counts the work of applying Refs over the batch's lifetime.
	stats refStats
}

func newIndexBatch(derive DeriveDocFields) *indexBatch {
	return &indexBatch{
		writers:            make(map[string]bool),
		authorityDelegates: make(map[keyline.Node]bool),
		commentDocs:        make(map[string]bool),
		commentSpaces:      make(map[string]bool),
		changes:            make(map[int64]changeMetadata),
		genesises:          make(map[string]int64),
		deriveDocFields:    derive,
	}
}

// batchMark is a position in a batch's effects, so the effects recorded after
// it can be dropped. See indexBatch.rollback.
type batchMark struct {
	refs    int
	indexed int
}

func (b *indexBatch) mark() batchMark {
	return batchMark{refs: len(b.refs), indexed: len(b.indexed)}
}

// rollback undoes what a stashed blob, and the blobs its cascade indexed, left
// in the batch, as its savepoint rolls back their rows.
//
// Every write a blob makes to the batch is one of three kinds, and each has an
// exact undo, so the batch needs no snapshot of itself:
//   - Effects are appended to lists, so a mark of their lengths taken before
//     the blob undoes them by truncating.
//   - The comment and authority sets only name results to recompute, and
//     recomputing a result nothing changed is a no-op, so they keep entries.
//   - Memoized write checks may have been answered from Keyline edges the
//     rollback just removed, so they're dropped and recomputed on demand.
//
// The caches of change metadata and genesis IDs are filled only while flushing,
// outside any blob's savepoint, so no rollback can invalidate them.
func (b *indexBatch) rollback(m batchMark) {
	b.refs = b.refs[:m.refs]
	b.indexed = b.indexed[:m.indexed]
	clear(b.writers)
}

// markCommentStats records the documents and spaces whose comment stats a
// comment's live version change made stale.
func (b *indexBatch) markCommentStats(affected commentLiveChange) {
	for _, genesis := range affected.genesises {
		b.commentDocs[genesis] = true
	}

	for _, space := range affected.spaces {
		b.commentSpaces[space] = true
	}
}

// flush finishes the batch's deferred work. Stages run in dependency order:
// the authority refresh first, because blobs it retries record more effects,
// then the effects, none of which can make a stashed blob indexable.
func (b *indexBatch) flush(opts indexOpts, conn *sqlite.Conn, bs *blockStore, log *zap.Logger, hookIDs *[]int64) error {
	if err := b.flushAuthority(opts, conn, bs, log, hookIDs); err != nil {
		return err
	}

	if err := b.applyRefs(conn, bs, log); err != nil {
		return err
	}

	for _, genesis := range slices.Sorted(maps.Keys(b.commentDocs)) {
		if err := updateDocumentCommentStats(conn, genesis); err != nil {
			return err
		}
	}

	clear(b.commentDocs)

	for _, space := range slices.Sorted(maps.Keys(b.commentSpaces)) {
		if err := updateSpaceCommentStats(conn, space); err != nil {
			return err
		}
	}

	clear(b.commentSpaces)

	indexed := b.indexed
	b.indexed = nil

	return propagateVisibilityBatch(conn, indexed)
}

// changeMetadata returns the metadata of an indexed change, or a zero value if
// the change isn't indexed.
func (b *indexBatch) changeMetadata(conn *sqlite.Conn, id int64) (changeMetadata, error) {
	if cm, ok := b.changes[id]; ok {
		return cm, nil
	}

	var cm changeMetadata

	if err := cm.load(conn, id); err != nil {
		return cm, err
	}

	if cm.ID != 0 {
		b.changes[id] = cm
	}

	return cm, nil
}
