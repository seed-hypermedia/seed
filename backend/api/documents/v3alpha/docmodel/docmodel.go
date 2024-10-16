package docmodel

import (
	"context"
	"errors"
	"fmt"
	"iter"
	"maps"
	"net/url"
	"reflect"
	"seed/backend/blob"
	"seed/backend/core"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/cclock"
	"seed/backend/util/must"
	"slices"
	"sort"

	"github.com/ipfs/go-cid"
	"github.com/multiformats/go-multibase"
	"google.golang.org/protobuf/types/known/structpb"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// WARNING! There's some very ugly type-unsafe code in here.
// Can do better, but no time for that now.

// Document is a mutable document.
type Document struct {
	crdt    *docCRDT
	origins map[string]cid.Cid // map of abbreviated origin hashes to actual cids; workaround, should not be necessary.

	// Bellow goes the data for the ongoing dirty mutation.
	// Document can only be mutated once, and then must be thrown away.

	dirty bool
	mut   *blockTreeMutation
	done  bool
	// Index for blocks that we've created in this change.
	createdBlocks map[string]struct{}
	// Blocks that we've deleted in this change.
	deletedBlocks map[string]struct{}

	dirtyBlocks   map[string]blob.Block // BlockID => BlockState.
	dirtyMetadata map[string]any
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
	return newDoc(crdt)
}

// newDoc creates a new mutable document.
func newDoc(crdt *docCRDT) (*Document, error) {
	dm := &Document{
		crdt:          crdt,
		origins:       make(map[string]cid.Cid),
		createdBlocks: make(map[string]struct{}),
		deletedBlocks: make(map[string]struct{}),
	}

	for _, c := range crdt.cids {
		o := originFromCID(c)
		dm.origins[o] = c
	}

	return dm, nil
}

// Checkout a historical version of the Document.
func (dm *Document) Checkout(heads []cid.Cid) (*Document, error) {
	if dm.done {
		panic("BUG: document is done")
	}

	crdt2, err := dm.crdt.Checkout(heads)
	if err != nil {
		return nil, err
	}

	dm2, err := newDoc(crdt2)
	if err != nil {
		return nil, err
	}

	return dm2, nil
}

// ApplyChange to the state. Can only do that before any mutations were made.
func (dm *Document) ApplyChange(c cid.Cid, ch *blob.Change) error {
	if dm.dirty {
		return fmt.Errorf("cannot apply change to dirty state")
	}

	return dm.applyChangeUnsafe(c, ch)
}

func (dm *Document) applyChangeUnsafe(c cid.Cid, ch *blob.Change) error {
	o := originFromCID(c)
	dm.origins[o] = c
	return dm.crdt.ApplyChange(c, ch)
}

// SetMetadata sets the title of the document.
func (dm *Document) SetMetadata(key, newValue string) error {
	dm.dirty = true
	if dm.dirtyMetadata == nil {
		dm.dirtyMetadata = make(map[string]any)
	}

	if reg := dm.crdt.stateMetadata[key]; reg != nil {
		if newValue == reg.GetLatest() {
			// If metadata key already has the same value in the committed CRDT state,
			// we do nothing, and just in case clear the dirty metadata value if any.
			delete(dm.dirtyMetadata, key)
			return nil
		}
	}

	dm.dirtyMetadata[key] = newValue

	return nil
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
		if ok && reflect.DeepEqual(oldValue, blk) {
			delete(dm.dirtyBlocks, blkpb.Id)
			return nil
		}
	}

	dm.dirtyBlocks[blk.ID] = blk

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
func (dm *Document) SignChange(kp core.KeyPair) (hb blob.Encoded[*blob.Change], err error) {
	// TODO(burdiyan): we should make them reusable.
	if dm.done {
		return hb, fmt.Errorf("using already committed mutation")
	}

	dm.done = true

	ops := dm.cleanupPatch()

	hb, err = dm.crdt.prepareChange(dm.crdt.clock.MustNow(), kp, ops)
	if err != nil {
		return hb, err
	}

	if err := dm.applyChangeUnsafe(hb.CID, hb.Decoded); err != nil {
		return hb, err
	}

	return hb, nil
}

// Ref creates a Ref blob for the current heads.
func (dm *Document) Ref(kp core.KeyPair) (ref blob.Encoded[*blob.Ref], err error) {
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

	return blob.NewRef(kp, genesis, space, path, []cid.Cid{headCID}, head.Ts)
}

func (dm *Document) cleanupPatch() []blob.Op {
	if !dm.dirty {
		return nil
	}

	var ops []blob.Op

	// TODO(burdiyan): It's important to moves go first,
	// because I was stupid enough to implement the block tree CRDT in isolation,
	// so it's not aware of any other possible operations.
	// Will fix this at some point.
	if dm.mut != nil {
		for move := range dm.mut.Commit(0, "self") {
			ops = append(ops, blob.NewOpMoveBlock(move.Block, move.Parent, move.Ref.String()))
		}
	}

	metaKeys := slices.Collect(maps.Keys(dm.dirtyMetadata))
	slices.Sort(metaKeys)

	for _, key := range metaKeys {
		ops = append(ops, blob.NewOpSetMetadata(key, dm.dirtyMetadata[key]))
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

		ops = append(ops, blob.NewOpReplaceBlock(blk))
	}

	return ops
}

// NumChanges returns the number of changes in the current state of the document.
func (dm *Document) NumChanges() int {
	return len(dm.crdt.cids)
}

// BFTDeps returns a breadth-first traversal iterator for the document change DAG.
func (dm *Document) BFTDeps(start []cid.Cid) (iter.Seq2[int, blob.ChangeRecord], error) {
	return dm.crdt.BFTDeps(start)
}

// Heads returns the current leaf/head changes in the document history.
// I.e. it's the current version of the document.
func (dm *Document) Heads() map[cid.Cid]struct{} {
	return dm.crdt.Heads()
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

	docpb := &documents.Document{
		Account:    space,
		Path:       path,
		Metadata:   must.Do2(structpb.NewStruct(e.GetMetadata())),
		CreateTime: timestamppb.New(first.Ts),
		Version:    e.Version().String(),
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
	appendChild := func(parent string, child *documents.BlockNode) {
		if parent == "" {
			docpb.Content = append(docpb.Content, child)
			return
		}
		blk, ok := blockMap[parent]
		if !ok {
			panic("BUG: no parent " + parent + " for child " + child.Block.Id)
		}
		blk.Children = append(blk.Children, child)
	}

	for pair := range dm.crdt.tree.State().DFT() {
		// TODO(burdiyan): block revision would change only if block itself was changed.
		// If block is only moved it's revision won't change. Need to check if that's what we want.

		// If we got some moves but no block state
		// we just skip them, we don't want to blow up here.

		bs := dm.crdt.stateBlocks[pair.Child]
		if bs == nil {
			continue
		}

		opid, blk, ok := bs.GetLatestWithID()
		if !ok {
			continue
		}

		oo := dm.origins[opid.Origin]
		blkpb := BlockToProto(blk, oo)

		child := &documents.BlockNode{Block: blkpb}
		appendChild(pair.Parent, child)
		blockMap[pair.Child] = child
	}

	return docpb, nil
}

// BlockFromProto converts a protobuf block into our internal representation.
// It's largely the same, but we need a separate type for CBOR encoding which we use in the permanent data.
func BlockFromProto(b *documents.Block) (blob.Block, error) {
	if b.Id == "" {
		return blob.Block{}, errors.New("block ID is required")
	}

	if len(b.Attributes) == 0 {
		b.Attributes = nil
	}

	return blob.Block{
		ID:          b.Id,
		Type:        b.Type,
		Text:        b.Text,
		Link:        b.Link,
		Attributes:  b.Attributes,
		Annotations: annotationsFromProto(b.Annotations),
	}, nil
}

func annotationsFromProto(in []*documents.Annotation) []blob.Annotation {
	if in == nil {
		return nil
	}

	out := make([]blob.Annotation, len(in))
	for i, a := range in {
		out[i] = blob.Annotation{
			Type:       a.Type,
			Link:       a.Link,
			Attributes: a.Attributes,
			Starts:     a.Starts,
			Ends:       a.Ends,
		}
	}

	return out
}

// BlockToProto converts our internal block representation into a protobuf block.
// It's largely the same, but we use CBOR in our permanent data, and we use protobuf in our API.
func BlockToProto(b blob.Block, revision cid.Cid) *documents.Block {
	return &documents.Block{
		Id:          b.ID,
		Type:        b.Type,
		Text:        b.Text,
		Link:        b.Link,
		Attributes:  b.Attributes,
		Annotations: annotationsToProto(b.Annotations),
		Revision:    revision.String(),
	}
}

func annotationsToProto(in []blob.Annotation) []*documents.Annotation {
	if in == nil {
		return nil
	}

	out := make([]*documents.Annotation, len(in))
	for i, a := range in {
		out[i] = &documents.Annotation{
			Type:       a.Type,
			Link:       a.Link,
			Attributes: a.Attributes,
			Starts:     a.Starts,
			Ends:       a.Ends,
		}
	}

	return out
}
