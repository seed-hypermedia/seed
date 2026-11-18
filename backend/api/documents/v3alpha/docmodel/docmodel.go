package docmodel

import (
	"context"
	"errors"
	"fmt"
	"iter"
	"maps"
	"math"
	"net/url"
	"seed/backend/blob"
	"seed/backend/core"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/btree"
	"seed/backend/util/cclock"
	"seed/backend/util/maybe"
	"slices"
	"sort"
	"strings"
	"time"
	"unique"

	"github.com/ipfs/go-cid"
	"github.com/multiformats/go-multibase"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// WARNING! There's some very ugly type-unsafe code in here.
// Can do better, but no time for that now.

// Document is a mutable document.
type Document struct {
	crdt      *docCRDT
	actors    map[unique.Handle[core.PrincipalUnsafeString]]core.ActorID
	opsToCids map[[2]uint64]cid.Cid

	// Below goes the data for the ongoing dirty mutation.
	// Document can only be mutated once, and then must be thrown away.

	dirty bool
	mut   *blockTreeMutation
	done  bool
	// Index for blocks that we've created in this change.
	createdBlocks map[string]struct{}
	// Blocks that we've deleted in this change.
	deletedBlocks map[string]struct{}

	dirtyBlocks   map[string]blob.Block
	dirtyMetadata *btree.Map[[]string, metadataValue]

	Generation maybe.Value[int64]

	visibility blob.Visibility
}

// originFromCID creates a CRDT origin from the last 8 chars of the hash.
// Most of the time it's not needed, because HLC is very unlikely to collide.
func originFromCID(c cid.Cid) string {
	if !c.Defined() {
		return ""
	}

	str, err := c.StringOfBase(multibase.Base58BTC)
	if err != nil {
		panic(err)
	}
	return str[len(str)-9:]
}

// New creates a new Document model.
func New(id blob.IRI, clock *cclock.Clock) (*Document, error) {
	crdt := newCRDT(id, clock)
	doc, err := newDoc(crdt)
	if err != nil {
		return nil, err
	}

	crdt.getActor = func(in core.Principal) (core.ActorID, bool) {
		akey := unique.Make(in.UnsafeString())
		out, ok := doc.actors[akey]
		return out, ok
	}

	return doc, nil
}

// newDoc creates a new mutable document.
func newDoc(crdt *docCRDT) (*Document, error) {
	dm := &Document{
		crdt:          crdt,
		actors:        make(map[unique.Handle[core.PrincipalUnsafeString]]core.ActorID),
		opsToCids:     make(map[[2]uint64]cid.Cid),
		createdBlocks: make(map[string]struct{}),
		deletedBlocks: make(map[string]struct{}),
	}

	return dm, nil
}

// Checkout a historical version of the Document.
func (dm *Document) Checkout(heads []cid.Cid) (*Document, error) {
	if dm.done {
		panic("BUG: document is done")
	}

	e := dm.crdt

	if len(heads) == 0 {
		return dm, nil
	}

	{
		curVer := NewVersion(slices.Collect(maps.Keys(e.heads))...)
		wantVer := NewVersion(heads...)

		if curVer == wantVer {
			return dm, nil
		}
	}

	// We walk the DAG of changes backwards starting from the heads.
	// And then we apply those changes to the cloned entity.

	visited := make(map[int]struct{}, len(e.cids))
	queue := make([]int, 0, len(e.cids))
	chain := make([]int, 0, len(e.cids))

	for _, h := range heads {
		hh, ok := e.applied[h]
		if !ok {
			return nil, fmt.Errorf("head '%s' not found", h)
		}

		queue = append(queue, hh)
	}

	for len(queue) > 0 {
		c := queue[0]
		queue = queue[1:]
		if _, ok := visited[c]; ok {
			continue
		}
		visited[c] = struct{}{}
		chain = append(chain, c)
		queue = append(queue, e.deps[c]...)
	}
	slices.Reverse(chain)

	clock := cclock.New()
	doc, err := New(e.id, clock)
	if err != nil {
		return nil, err
	}

	for _, c := range chain {
		if err := doc.ApplyChange(e.cids[c], e.changes[c]); err != nil {
			return nil, err
		}
	}

	return doc, nil
}

// Genesis returns the CID of the genesis blob.
func (dm *Document) Genesis() cid.Cid {
	return dm.crdt.cids[0]
}

// SetVisibility should not exist, but because this document model
// doesn't know anything about Refs we set the visibility from the outside.
func (dm *Document) SetVisibility(bv blob.Visibility) {
	dm.visibility = bv
}

// Visibility returns the visibility of the document.
func (dm *Document) Visibility() blob.Visibility {
	return dm.visibility
}

// ApplyChange to the state. Can only do that before any mutations were made.
func (dm *Document) ApplyChange(c cid.Cid, ch *blob.Change) error {
	if dm.dirty {
		return fmt.Errorf("cannot apply change to dirty state")
	}

	return dm.applyChangeUnsafe(c, ch)
}

func (dm *Document) applyChangeUnsafe(c cid.Cid, ch *blob.Change) error {
	akey := unique.Make(ch.Signer.UnsafeString())
	actor, ok := dm.actors[akey]
	if !ok {
		actor = ch.Signer.ActorID()
		dm.actors[akey] = actor
	}

	dm.opsToCids[[2]uint64{uint64(actor), uint64(ch.Ts.UnixMilli())}] = c //nolint:gosec // We know this should not overflow.

	return dm.crdt.ApplyChange(c, ch)
}

// SetMetadata sets the title of the document.
func (dm *Document) SetMetadata(key, newValue string) error {
	return dm.SetAttribute("", []string{key}, newValue)
}

// SetAttribute on a given block.
// Empty block ID means the document metadata.
func (dm *Document) SetAttribute(block string, keyPath []string, newValue any) error {
	if block != "" {
		return fmt.Errorf("TODO: setting attributes for non-root blocks")
	}

	if len(keyPath) == 0 {
		return fmt.Errorf("must specify key path to set value for")
	}

	for _, k := range keyPath {
		if strings.Contains(k, ".") {
			return fmt.Errorf("key segments must not contain dots, got: %s", k)
		}
	}

	dm.dirty = true
	if dm.dirtyMetadata == nil {
		dm.dirtyMetadata = btree.New[[]string, metadataValue](8, slices.Compare)
	}

	exactKey := slices.Clone(keyPath)
	// Writes of the same mutation apply in the order they are made, and a write to a key
	// replaces everything below it. So the pending writes below this key are superseded,
	// no matter whether this write ends up being stored or not.
	var (
		superseded       [][]string
		hasPendingParent bool
	)

	for k := range dm.dirtyMetadata.Keys() {
		switch {
		case isMetadataAncestor(exactKey, k):
			superseded = append(superseded, k)
		case isMetadataAncestor(k, exactKey):
			hasPendingParent = true
		}
	}

	for _, k := range superseded {
		dm.dirtyMetadata.Delete(k)
	}

	if reg := dm.crdt.stateMetadata.GetMaybe(exactKey); reg != nil {
		latest := reg.GetLatest()

		// If metadata key already has the same value in the committed CRDT state,
		// we do nothing, and just in case clear the dirty metadata value if any.
		//
		// Unless there's a pending write above this key: it removes the committed value,
		// so this one is not redundant (see pendingAttributes for how those are reduced).
		// Also, a tombstone left above newer child attributes compares equal to a
		// deletion, but the deletion still has to replace those children.
		if !hasPendingParent && attrValuesEqual(newValue, latest.Value) && slices.Equal(keyPath, latest.Key) && !dm.crdt.hasLiveMetadataDescendant(exactKey) {
			dm.dirtyMetadata.Delete(exactKey)
			return nil
		}
	}

	dm.dirtyMetadata.Set(exactKey, metadataValue{Key: slices.Clone(keyPath), Value: newValue})

	return nil
}

// pendingAttributes returns the attribute writes to store for the current mutation.
//
// Stored writes apply in the order of their keys, parents before children,
// and each of them removes whatever is stored above and below its key.
// So a pending write with other pending writes below it ("clear the map, then set its entries")
// is only there to remove what the committed state has around: its own value never survives.
// Writing all of that is correct, but most of the time there's a smaller way to say the same,
// especially when the entries being set are those the map already has:
// leave alone the committed entries that are set to the same value,
// and clear only those that are not mentioned.
// We store whichever is smaller.
func (dm *Document) pendingAttributes() []blob.KeyValue {
	if dm.dirtyMetadata.Len() == 0 {
		return nil
	}

	pending := make([]blob.KeyValue, 0, dm.dirtyMetadata.Len())
	for _, v := range dm.dirtyMetadata.Items() {
		pending = append(pending, blob.KeyValue{Key: v.Key, Value: v.Value})
	}

	// Keys are sorted, so the writes below a key directly follow it.
	for i := 0; i < len(pending); i++ {
		parent := pending[i].Key

		end := i + 1
		for end < len(pending) && isMetadataAncestor(parent, pending[end].Key) {
			end++
		}

		below := pending[i+1 : end]
		if len(below) == 0 {
			continue
		}

		// A stored write above the parent removes everything the committed state has below it.
		// So there's nothing left for the parent write to remove, and the writes below it
		// repeat nothing: they all stay, and only the parent write goes.
		// Writes above the parent were already looked at, so those still pending are stored.
		if slices.ContainsFunc(pending[:i], func(other blob.KeyValue) bool { return isMetadataAncestor(other.Key, parent) }) {
			pending = slices.Delete(pending, i, i+1)
			i--

			continue
		}

		// Writes below the parent that only repeat what's committed are not needed if the parent write is gone.
		// Only those directly exposed to the committed state count:
		// writes having other pending writes above or below them are left as is.
		redundant := make([]bool, len(below))
		var nRedundant int

		for j, kv := range below {
			if j+1 < len(below) && isMetadataAncestor(kv.Key, below[j+1].Key) {
				continue
			}

			if slices.ContainsFunc(below[:j], func(other blob.KeyValue) bool { return isMetadataAncestor(other.Key, kv.Key) }) {
				continue
			}

			reg := dm.crdt.stateMetadata.GetMaybe(kv.Key)
			if reg == nil {
				continue
			}

			// A tombstone left above newer child attributes compares equal to a deletion,
			// but the deletion still has to replace those children.
			if latest, ok := reg.GetLatestOK(); ok && attrValuesEqual(kv.Value, latest.Value) && !dm.crdt.hasLiveMetadataDescendant(kv.Key) {
				redundant[j] = true
				nRedundant++
			}
		}

		// Committed values below the parent that no pending write replaces have to be cleared one by one.
		var cleared []blob.KeyValue

		for k, reg := range dm.crdt.stateMetadata.Items() {
			if !isMetadataAncestor(parent, k) {
				continue
			}

			if latest, ok := reg.GetLatestOK(); !ok || latest.Value == nil {
				continue
			}

			replaced := slices.ContainsFunc(below, func(kv blob.KeyValue) bool {
				return slices.Equal(kv.Key, k) || isMetadataAncestor(kv.Key, k) || isMetadataAncestor(k, kv.Key)
			})
			if !replaced {
				cleared = append(cleared, blob.KeyValue{Key: slices.Clone(k), Value: nil})
			}
		}

		// Whatever the committed state has at the parent key itself, or above it, is removed
		// by any of the writes below, and there's always at least one of those left:
		// they can't be redundant when there's a committed value above them.
		if len(cleared)+len(below)-nRedundant >= 1+len(below) {
			continue
		}

		reduced := make([]blob.KeyValue, 0, len(pending)-1-nRedundant+len(cleared))
		reduced = append(reduced, pending[:i]...)
		for j, kv := range below {
			if !redundant[j] {
				reduced = append(reduced, kv)
			}
		}

		reduced = append(reduced, cleared...)
		slices.SortFunc(reduced[i:], func(a, b blob.KeyValue) int { return slices.Compare(a.Key, b.Key) })
		reduced = append(reduced, pending[end:]...)

		pending = reduced
		// The write that took the place of the parent may have its own writes below.
		i--
	}

	return pending
}

// DeleteBlock deletes a block.
func (dm *Document) DeleteBlock(block string) error {
	dm.dirty = true
	mut, err := dm.ensureTreeMutation()
	if err != nil {
		return err
	}

	me, err := mut.Move(TrashNodeID, block, "")
	if err != nil {
		return err
	}

	if me == moveEffectMoved {
		dm.deletedBlocks[block] = struct{}{}
	}

	return nil
}

// ReplaceBlock replaces a block.
func (dm *Document) ReplaceBlock(blkpb *documents.Block) error {
	dm.dirty = true
	if blkpb.Id == "" {
		return fmt.Errorf("blocks must have ID")
	}

	if dm.dirtyBlocks == nil {
		dm.dirtyBlocks = make(map[string]blob.Block)
	}

	blk, err := BlockFromProto(blkpb)
	if err != nil {
		return err
	}

	// Check if CRDT state already has the same value for block.
	// If so, we do nothing, and remove any dirty state for this block.
	if reg := dm.crdt.stateBlocks[blkpb.Id]; reg != nil {
		oldValue, ok := reg.GetLatestOK()
		if ok && blocksEqual(oldValue, blk) {
			delete(dm.dirtyBlocks, blkpb.Id)
			return nil
		}
	}

	dm.dirtyBlocks[blk.ID()] = blk

	if _, ok := dm.crdt.tree.sublists.Get(blk.ID()); !ok {
		dm.crdt.tree.sublists.Set(blk.ID(), newRGAList[string]())
		dm.crdt.tree.detachedBlocks.Set(blk.ID(), blockLatestMove{detached: true})
	}

	// The ongoing tree mutation works on its own copy of the tree, taken at the first move.
	// A block written after that has to be known there too, to be a valid parent for the next moves.
	if dm.mut != nil {
		dm.mut.registerBlock(blk.ID())
	}

	return nil
}

// MoveBlock moves a block.
func (dm *Document) MoveBlock(block, parent, left string) error {
	dm.dirty = true
	if parent == TrashNodeID {
		panic("BUG: use DeleteBlock to delete a block")
	}

	mut, err := dm.ensureTreeMutation()
	if err != nil {
		return err
	}

	// TODO(burdiyan): make the order of parent/block parameters consistent.
	me, err := mut.Move(parent, block, left)
	if err != nil {
		return err
	}

	switch me {
	case moveEffectCreated:
		dm.createdBlocks[block] = struct{}{}
	case moveEffectMoved:
		// We might move a block out of trash.
		delete(dm.deletedBlocks, block)
	}

	return nil
}

func (dm *Document) ensureTreeMutation() (*blockTreeMutation, error) {
	dm.dirty = true
	if dm.mut == nil {
		dm.mut = dm.crdt.tree.State().Mutate()
	}

	return dm.mut, nil
}

// SignChange creates a change.
// After this the Document instance must be discarded. The change must be applied to a different state.
func (dm *Document) SignChange(kp *core.KeyPair) (hb blob.Encoded[*blob.Change], err error) {
	return dm.SignChangeAt(kp, dm.crdt.clock.MustNow())
}

// SignChangeAt creates a change at the given timestamp, ignoring the internal clock.
// The timestamp must still satisfy the causality rules, i.e. be strictly greater than any previously observed timestamp.
func (dm *Document) SignChangeAt(kp *core.KeyPair, at time.Time) (hb blob.Encoded[*blob.Change], err error) {
	return dm.CreateChange(kp, at)
}

// CreateChange creates a Change blob with the given signer and principal.
// This allows using NopSigner for client-side signing scenarios where the signer doesn't actually sign.
// After this the Document instance must be discarded.
func (dm *Document) CreateChange(signer core.Signer, at time.Time) (hb blob.Encoded[*blob.Change], err error) {
	if dm.done {
		return hb, fmt.Errorf("using already committed mutation")
	}

	dm.done = true

	ops, err := dm.cleanupPatch()
	if err != nil {
		return hb, err
	}

	at = at.Round(dm.crdt.clock.Precision)

	hb, err = dm.crdt.prepareChange(at, signer, ops)
	if err != nil {
		return hb, err
	}

	if err := dm.applyChangeUnsafe(hb.CID, hb.Decoded); err != nil {
		return hb, err
	}

	return hb, nil
}

// Ref creates a Ref blob for the current heads.
func (dm *Document) Ref(kp *core.KeyPair, visibility blob.Visibility) (ref blob.Encoded[*blob.Ref], err error) {
	// TODO(hm24): make genesis detection more reliable.
	genesis := dm.crdt.cids[0]

	if len(dm.crdt.heads) != 1 {
		return ref, fmt.Errorf("TODO: creating refs for multiple heads is not supported yet")
	}

	headCID := dm.crdt.cids[len(dm.crdt.cids)-1]
	head := dm.crdt.changes[len(dm.crdt.cids)-1]

	space, path, err := dm.crdt.id.SpacePath()
	if err != nil {
		return ref, err
	}

	// If we haven't set a generation yet, we use the timestamp of the new change as the generation.
	if !dm.Generation.IsSet() {
		dm.Generation = maybe.New(head.Ts.UnixMilli())
	}

	return blob.NewRef(kp, dm.Generation.Value(), genesis, space, path, []cid.Cid{headCID}, head.Ts, visibility)
}

func (dm *Document) cleanupPatch() (out blob.ChangeBody, err error) {
	if !dm.dirty {
		return out, nil
	}

	addOp := func(op blob.OpMap, size int) {
		out.Ops = append(out.Ops, op)
		out.OpCount += size
	}

	// TODO(burdiyan): It's important for moves to go first,
	// because I was stupid enough to implement the block tree CRDT in isolation,
	// so it's not aware of any other possible operations.
	// Will fix this at some point.
	if dm.mut != nil {
		// There's a bit of complexity here implementing "compression",
		// i.e. contiguous moves are batched to avoid repeating redundant OpIDs.
		//
		// Ops are stored in the order the moves are committed. Deletes normally come after all the moves,
		// but blocks moved under a deleted block follow its delete: such a block may have been
		// an ancestor of the deleted one, in which case moving it first would be a cycle,
		// and those who apply the change would ignore the move.
		var (
			deletedBlocks []string
			seenDeletes   = map[string]struct{}{}

			// Batching contiguos moves.
			curParent     string
			lastOpID      opID
			ref           opID
			blockSequence []string
		)

		flushMoves := func() {
			if len(blockSequence) > 0 {
				addOp(blob.NewOpMoveBlocks(curParent, blockSequence, encodeOpID(ref)), len(blockSequence))
				blockSequence = nil
			}
		}

		flushDeletes := func() {
			if len(deletedBlocks) > 0 {
				addOp(blob.NewOpDeleteBlocks(deletedBlocks), len(deletedBlocks))
				deletedBlocks = nil
			}
		}

		for move := range dm.mut.Commit(0, math.MaxUint64) {
			if move.Parent == TrashNodeID {
				if _, seen := seenDeletes[move.Block]; seen {
					panic("BUG: delete block operation seen multiple times")
				}
				flushMoves()
				deletedBlocks = append(deletedBlocks, move.Block)
				seenDeletes[move.Block] = struct{}{}
				continue
			}

			flushDeletes()

			// If we continue the same sequence, just append move to the batch.
			if len(blockSequence) > 0 &&
				move.Parent == curParent &&
				move.OpID.Actor == lastOpID.Actor &&
				move.OpID.Ts == lastOpID.Ts &&
				move.OpID.Idx == lastOpID.Idx+1 &&
				move.Ref == lastOpID {
				blockSequence = append(blockSequence, move.Block)
				lastOpID = move.OpID
				continue
			}

			// If we are here we need to close the batch if any, and start a new one.
			flushMoves()
			curParent = move.Parent
			lastOpID = move.OpID
			ref = move.Ref
			blockSequence = []string{move.Block}
		}

		flushMoves()
		flushDeletes()
	}

	if attrs := dm.pendingAttributes(); len(attrs) > 0 {
		addOp(blob.NewOpSetAttributes("", attrs), len(attrs))
	}

	// Remove state of those blocks that we created and deleted in the same change.
	for blk := range dm.deletedBlocks {
		if _, mustIgnore := dm.createdBlocks[blk]; mustIgnore {
			delete(dm.dirtyBlocks, blk)
			continue
		}
	}

	dirtyBlockIDs := slices.Collect(maps.Keys(dm.dirtyBlocks))
	slices.Sort(dirtyBlockIDs)
	for _, bid := range dirtyBlockIDs {
		blk, ok := dm.dirtyBlocks[bid]
		if !ok {
			panic("BUG: dirty block not found")
		}
		addOp(blob.NewOpReplaceBlock(blk), 1)
	}

	return out, nil
}

// NumChanges returns the number of changes in the current state of the document.
func (dm *Document) NumChanges() int {
	return len(dm.crdt.cids)
}

// BFTDeps returns a breadth-first traversal iterator for the document change DAG.
func (dm *Document) BFTDeps(start []cid.Cid) (iter.Seq2[cid.Cid, *blob.Change], error) {
	return dm.crdt.BFTDeps(start)
}

// Heads returns the current leaf/head changes in the document history.
// I.e. it's the current version of the document.
func (dm *Document) Heads() map[cid.Cid]struct{} {
	return dm.crdt.Heads()
}

// Version returns the content-addressed version (canonical sorted heads) of
// the document in its current state. It is deterministic and immutable for a
// given set of applied changes, which makes it a safe key for caching the
// hydrated result.
func (dm *Document) Version() Version {
	return dm.crdt.Version()
}

// Hydrate hydrates a document.
func (dm *Document) Hydrate(ctx context.Context) (*documents.Document, error) {
	if len(dm.crdt.changes) == 0 {
		return nil, fmt.Errorf("no changes in the entity")
	}

	if dm.mut != nil {
		panic("BUG: can't hydrate a document with uncommitted changes")
	}

	e := dm.crdt

	first := e.changes[0]
	last := e.changes[len(e.changes)-1]

	// TODO(burdiyan): this is ugly and needs to be refactored.
	u, err := url.Parse(string(e.id))
	if err != nil {
		return nil, err
	}

	space := u.Host
	path := u.Path

	metastruct, err := structpb.NewStruct(e.GetMetadata())
	if err != nil {
		return nil, err
	}

	docpb := &documents.Document{
		Account:    space,
		Path:       path,
		Metadata:   metastruct,
		CreateTime: timestamppb.New(first.Ts),
		Genesis:    e.cids[0].String(),
		Version:    e.Version().String(),
		GenerationInfo: &documents.GenerationInfo{
			Genesis:    e.cids[0].String(),
			Generation: dm.Generation.Value(),
		},
		Visibility:      VisibilityToProto(dm.visibility),
		NavigationCards: &documents.NavigationCards{Targets: dm.NavigationCards()},
	}

	docpb.UpdateTime = timestamppb.New(last.Ts)

	// Loading editors is a bit cumbersome because we need to go over key delegations.
	{
		for k := range e.actorsIntern {
			docpb.Authors = append(docpb.Authors, core.Principal(k).String())
		}

		sort.Strings(docpb.Authors)
	}

	blockMap := map[string]*documents.BlockNode{}
	appendChild := func(parent string, child *documents.BlockNode) error {
		if parent == "" {
			docpb.Content = append(docpb.Content, child)
			return nil
		}
		blk, ok := blockMap[parent]
		if !ok {
			return fmt.Errorf("BUG: no parent %s for child %s", parent, child.Block.Id)
		}
		blk.Children = append(blk.Children, child)
		return nil
	}

	treeState := dm.crdt.tree.State()

	blockToProto := func(id string) (*documents.Block, error) {
		bs := dm.crdt.stateBlocks[id]
		if bs == nil {
			return nil, nil
		}

		opid, blk, ok := bs.GetLatestWithID()
		if !ok {
			return nil, nil
		}

		c, ok := dm.opsToCids[[2]uint64{uint64(opid.Actor), uint64(opid.Ts)}] //nolint:gosec // We know this should not overflow.
		if !ok {
			panic(fmt.Errorf("BUG: failed to find CID for block op ID: %d:%d", opid.Actor, opid.Ts))
		}

		blkpb, err := BlockToProto(blk, c)
		if err != nil {
			return nil, err
		}
		return blkpb, nil
	}

	processSubtree := func(startBlock string) error {
		for pair := range treeState.DFT(startBlock) {
			blkpb, err := blockToProto(pair.Child)
			if err != nil {
				return err
			}

			// If we got some moves but no block state
			// we keep a dummy block to preserve the tree shape
			// and make the corruption visible to clients.
			if blkpb == nil {
				blkpb = &documents.Block{Id: pair.Child}
			}

			child := &documents.BlockNode{Block: blkpb}
			if err := appendChild(pair.Parent, child); err != nil {
				return err
			}
			blockMap[pair.Child] = child
		}
		return nil
	}

	if err := processSubtree(""); err != nil {
		return nil, err
	}

	for blk := range dm.crdt.stateBlocks {
		// Blocks that are in the tree state are not detached.
		if _, ok := treeState.blocks[blk]; ok {
			continue
		}

		blkpb, err := blockToProto(blk)
		if err != nil {
			return nil, err
		}

		if blkpb == nil {
			continue
		}

		blockMap[blk] = &documents.BlockNode{Block: blkpb}
		if err := processSubtree(blk); err != nil {
			return nil, err
		}

		if docpb.DetachedBlocks == nil {
			docpb.DetachedBlocks = make(map[string]*documents.BlockNode)
		}

		docpb.DetachedBlocks[blk] = blockMap[blk]
	}

	return docpb, nil
}

// FirstContentImage returns the link of the first image block in document
// reading order, or an empty string if the document contains no image block.
//
// It walks the same block tree that Hydrate materializes, but stops at the
// first image and skips proto materialization entirely. This lets us derive a
// fallback cover image at index time without paying for a full Hydrate. The
// "Image" type string and the non-empty-link requirement mirror the client's
// fallback logic (frontend/packages/shared/src/content.ts getDocumentImage).
func (dm *Document) FirstContentImage() string {
	if dm.mut != nil {
		// A document with uncommitted changes has no stable committed state.
		return ""
	}

	treeState := dm.crdt.tree.State()
	for pair := range treeState.DFT("") {
		bs := dm.crdt.stateBlocks[pair.Child]
		if bs == nil {
			continue
		}

		_, blk, ok := bs.GetLatestWithID()
		if !ok {
			continue
		}

		if blk.Type == "Image" && blk.Link != "" {
			return blk.Link
		}
	}

	return ""
}

// NavigationCards returns the documents this document links as Card embeds, in
// reading order, once each, as hm:// IRIs of the whole document without version
// or fragment. Nested blocks count. Only Cards that follow the latest version
// count: a link with no version, or with a version and the latest flag. A Card
// pinned to a version is not navigation. The sidebar is built from these.
func (dm *Document) NavigationCards() []string {
	if dm.mut != nil {
		// A document with uncommitted changes has no stable committed state.
		return nil
	}

	var out []string

	seen := make(map[string]bool)
	for pair := range dm.crdt.tree.State().DFT("") {
		bs := dm.crdt.stateBlocks[pair.Child]
		if bs == nil {
			continue
		}

		_, blk, ok := bs.GetLatestWithID()
		if !ok || blk.Type != "Embed" || blk.Attributes()["view"] != "Card" {
			continue
		}

		target, ok := navigationTarget(blk.Link)
		if ok && !seen[target] {
			seen[target] = true
			out = append(out, target)
		}
	}

	return out
}

// navigationTarget returns the document a latest-following hm:// link points to.
func navigationTarget(link string) (string, bool) {
	u, err := url.Parse(link)
	if err != nil || u.Scheme != "hm" || u.Host == "" || u.Host == "c" {
		return "", false
	}

	q := u.Query()
	if q.Get("v") != "" && !q.Has("l") {
		return "", false
	}

	// Document paths have no escaping layer: the client splits hm:// links as raw
	// text and never percent-decodes them, so take the link as written rather than
	// rebuilding it from url.URL's decoded Path.
	target, _, _ := strings.Cut(link, "#")
	target, _, _ = strings.Cut(target, "?")
	return strings.TrimSuffix(target, "/"), true
}

// BlockFromProto converts a protobuf block into our internal representation.
// It's largely the same, but we need a separate type for CBOR encoding which we use in the permanent data.
func BlockFromProto(b *documents.Block) (blob.Block, error) {
	if b.Id == "" {
		return blob.Block{}, errors.New("block ID is required")
	}

	remaining := ProtoStructAsMap(b.Attributes)

	return blob.Block{
		ID_Good:           b.Id,
		Type:              b.Type,
		Text:              b.Text,
		Link:              b.Link,
		InlineAttributes_: remaining,
		Annotations:       annotationsFromProto(b.Annotations),
	}, nil
}

// ProtoStructAsMap is the same as structpb.Struct.AsMap,
// but it uses int64 instead of float64 when numbers are integers.
func ProtoStructAsMap(pb *structpb.Struct) map[string]any {
	f := pb.GetFields()
	if f == nil {
		return nil
	}
	vs := make(map[string]any, len(f))
	for k, v := range f {
		vs[k] = valueAsInterface(v)
	}
	return vs
}

func valueAsInterface(x *structpb.Value) any {
	switch v := x.GetKind().(type) {
	case *structpb.Value_NumberValue:
		if v != nil {
			switch {
			case math.IsNaN(v.NumberValue):
				return "NaN"
			case math.IsInf(v.NumberValue, +1):
				return "Infinity"
			case math.IsInf(v.NumberValue, -1):
				return "-Infinity"
			default:
				// If numeric value is a whole number we want to return it as int64 instead of float64.
				n := int64(v.NumberValue)
				if float64(n) == v.NumberValue {
					return n
				}

				return v.NumberValue
			}
		}
	case *structpb.Value_StringValue:
		if v != nil {
			return v.StringValue
		}
	case *structpb.Value_BoolValue:
		if v != nil {
			return v.BoolValue
		}
	case *structpb.Value_StructValue:
		if v != nil {
			return v.StructValue.AsMap()
		}
	case *structpb.Value_ListValue:
		if v != nil {
			return v.ListValue.AsSlice()
		}
	}
	return nil
}

func annotationsFromProto(in []*documents.Annotation) []blob.Annotation {
	if in == nil {
		return nil
	}

	out := make([]blob.Annotation, len(in))
	for i, a := range in {
		var attrs map[string]any
		if a.Attributes != nil {
			attrs = ProtoStructAsMap(a.Attributes)
		}

		out[i] = blob.Annotation{
			Type:              a.Type,
			Link:              a.Link,
			InlineAttributes_: attrs,
			Starts:            a.Starts,
			Ends:              a.Ends,
		}
	}

	return out
}

// BlockToProto converts our internal block representation into a protobuf block.
// It's largely the same, but we use CBOR in our permanent data, and we use protobuf in our API.
func BlockToProto(b blob.Block, revision cid.Cid) (*documents.Block, error) {
	attrspb, err := annotationsToProto(b.Annotations)
	if err != nil {
		return nil, err
	}

	bpb := &documents.Block{
		Id:          b.ID(),
		Type:        b.Type,
		Text:        b.Text,
		Link:        b.Link,
		Attributes:  nil,
		Annotations: attrspb,
		Revision:    revision.String(),
	}
	if aa := b.Attributes(); len(aa) > 0 {
		attrs, err := structpb.NewStruct(aa)
		if err != nil {
			return nil, err
		}
		bpb.Attributes = attrs
	}

	return bpb, nil
}

func annotationsToProto(in []blob.Annotation) ([]*documents.Annotation, error) {
	if in == nil {
		return nil, nil
	}

	out := make([]*documents.Annotation, len(in))
	for i, a := range in {
		attrpb, err := structpb.NewStruct(a.Attributes())
		if err != nil {
			return nil, fmt.Errorf("failed to convert annotation attributes to proto: %w", err)
		}

		out[i] = &documents.Annotation{
			Type:       a.Type,
			Link:       a.Link,
			Attributes: attrpb,
			Starts:     a.Starts,
			Ends:       a.Ends,
		}
	}

	return out, nil
}

// VisibilityToProto converts our internal visibility representation into a protobuf visibility.
// It's largely the same, but we use CBOR in our permanent data, and we use protobuf in our API.
func VisibilityToProto(bv blob.Visibility) documents.ResourceVisibility {
	switch bv {
	case blob.VisibilityPublic:
		return documents.ResourceVisibility_RESOURCE_VISIBILITY_PUBLIC
	case blob.VisibilityPrivate:
		return documents.ResourceVisibility_RESOURCE_VISIBILITY_PRIVATE
	default:
		panic(fmt.Errorf("BUG: unknown visibility %v", bv))
	}
}

// IsCollection reports whether this document has exactly one top-level Query block
// whose includes are absent, empty, or contain exactly one empty or self target.
// Query-block children and presentation style do not affect the result.
func (dm *Document) IsCollection() bool {
	if dm.mut != nil {
		// A document with uncommitted changes has no stable committed state.
		return false
	}

	space, path, err := dm.crdt.id.SpacePath()
	if err != nil {
		return false
	}

	// DFT yields every visible (parent, child) pair depth-first. Only pairs rooted
	// at "" count toward the top-level shape; descendants are intentionally ignored.
	var root string
	var roots int
	for pair := range dm.crdt.tree.State().DFT("") {
		if pair.Parent == "" {
			roots++
			if roots > 1 {
				return false
			}
			root = pair.Child
			continue
		}
	}
	if roots != 1 {
		return false
	}

	bs := dm.crdt.stateBlocks[root]
	if bs == nil {
		return false
	}

	_, blk, ok := bs.GetLatestWithID()
	if !ok || blk.Type != "Query" {
		return false
	}

	return queryTargetsDocumentOrIsEmpty(blk, space.String(), path)
}

func queryTargetsDocumentOrIsEmpty(blk blob.Block, space, path string) bool {
	query, ok := blk.Attributes()["query"].(map[string]any)
	if !ok {
		return true
	}

	rawIncludes, exists := query["includes"]
	if !exists || rawIncludes == nil {
		return true
	}
	includes, ok := rawIncludes.([]any)
	if !ok {
		return false
	}
	if len(includes) == 0 {
		return true
	}
	if len(includes) != 1 {
		return false
	}
	inc, ok := includes[0].(map[string]any)
	if !ok {
		return false
	}
	incSpace, _ := inc["space"].(string)
	incPath, _ := inc["path"].(string)
	if incSpace == "" && incPath == "" {
		return true
	}
	return incSpace == space && strings.Trim(incPath, "/") == strings.Trim(path, "/")
}
