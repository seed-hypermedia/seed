package docmodel

import (
	"context"
	"errors"
	"fmt"
	"iter"
	"maps"
	"math"
	"net/url"
	"reflect"
	"seed/backend/blob"
	"seed/backend/core"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/btree"
	"seed/backend/util/cclock"
	"seed/backend/util/maybe"
	"slices"
	"sort"
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
	actors    map[unique.Handle[string]]core.ActorID
	opsToCids map[[2]uint64]cid.Cid

	// Bellow goes the data for the ongoing dirty mutation.
	// Document can only be mutated once, and then must be thrown away.

	dirty bool
	mut   *blockTreeMutation
	done  bool
	// Index for blocks that we've created in this change.
	createdBlocks map[string]struct{}
	// Blocks that we've deleted in this change.
	deletedBlocks map[string]struct{}

	dirtyBlocks   map[string]mvRegValue[blob.Block]
	dirtyMetadata *btree.Map[[]string, mvRegValue[any]]

	Generation maybe.Value[int64]
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
		actors:        make(map[unique.Handle[string]]core.ActorID),
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

	dm.dirty = true
	if dm.dirtyMetadata == nil {
		dm.dirtyMetadata = btree.New[[]string, mvRegValue[any]](8, slices.Compare)
	}

	var preds []opID
	if reg := dm.crdt.stateMetadata.GetMaybe(keyPath); reg != nil {
		if reflect.DeepEqual(newValue, reg.GetLatest()) {
			// If metadata key already has the same value in the committed CRDT state,
			// we do nothing, and just in case clear the dirty metadata value if any.
			dm.dirtyMetadata.Delete(keyPath)
			return nil
		}
		preds = slices.Collect(reg.state.Keys())
	}

	dm.dirtyMetadata.Set(keyPath, mvRegValue[any]{Value: newValue, Preds: preds})

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
		dm.dirtyBlocks = make(map[string]mvRegValue[blob.Block])
	}

	blk, err := BlockFromProto(blkpb)
	if err != nil {
		return err
	}

	// Check if CRDT state already has the same value for block.
	// If so, we do nothing, and remove any dirty state for this block.
	var preds []opID
	if reg := dm.crdt.stateBlocks[blkpb.Id]; reg != nil {
		oldValue, ok := reg.GetLatestOK()
		if ok && reflect.DeepEqual(oldValue, blk) {
			delete(dm.dirtyBlocks, blkpb.Id)
			return nil
		}
		preds = slices.Collect(reg.state.Keys())
	}

	dm.dirtyBlocks[blk.ID] = mvRegValue[blob.Block]{Value: blk, Preds: preds}

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
	return dm.SignChangeAt(kp, dm.crdt.clock.MustNow())
}

// SignChangeAt creates a change at the given timestamp, ignoring the internal clock.
// The timestamp must still satisfy the causality rules, i.e. be strictly greater than any previously observed timestamp.
func (dm *Document) SignChangeAt(kp core.KeyPair, at time.Time) (hb blob.Encoded[*blob.Change], err error) {
	// TODO(burdiyan): we should make them reusable.
	if dm.done {
		return hb, fmt.Errorf("using already committed mutation")
	}

	dm.done = true

	ops, err := dm.cleanupPatch()
	if err != nil {
		return hb, err
	}

	at = at.Round(dm.crdt.clock.Precision)

	hb, err = dm.crdt.prepareChange(at, kp, ops)
	if err != nil {
		return hb, err
	}

	if err := dm.applyChangeUnsafe(hb.CID, hb.Decoded); err != nil {
		return hb, err
	}

	return hb, nil
}

// Ref creates a Ref blob for the current heads.
func (dm *Document) Ref(kp core.KeyPair, cap cid.Cid) (ref blob.Encoded[*blob.Ref], err error) {
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

	return blob.NewRef(kp, dm.Generation.Value(), genesis, space, path, []cid.Cid{headCID}, cap, head.Ts)
}

func (dm *Document) cleanupPatch() (out blob.ChangeBody, err error) {
	if !dm.dirty {
		return out, nil
	}

	addOp := func(op blob.OpMap, size int) {
		out.Ops = append(out.Ops, op)
		out.OpCount += size
	}

	// TODO(burdiyan): It's important to moves go first,
	// because I was stupid enough to implement the block tree CRDT in isolation,
	// so it's not aware of any other possible operations.
	// Will fix this at some point.
	if dm.mut != nil {
		var (
			deletedBlocks []string
			seenDeletes   = map[string]struct{}{}

			// Batching contiguos moves.
			curParent     string
			lastOpID      opID
			ref           opID
			blockSequence []string
		)
		for move := range dm.mut.Commit(0, math.MaxUint64) {
			if move.Parent == TrashNodeID {
				if _, seen := seenDeletes[move.Block]; seen {
					panic("BUG: delete block operation seen multiple times")
				}
				deletedBlocks = append(deletedBlocks, move.Block)
				seenDeletes[move.Block] = struct{}{}
				continue
			}

			// Start new batch of moves.
			if len(blockSequence) == 0 {
				curParent = move.Parent
				lastOpID = move.OpID
				ref = move.Ref
				blockSequence = append(blockSequence, move.Block)
				continue
			}

			// If we continue the same sequence, just append move to the batch.
			if move.Parent == curParent && move.OpID.Actor == lastOpID.Actor && move.OpID.Ts == lastOpID.Ts && move.OpID.Idx == lastOpID.Idx+1 {
				blockSequence = append(blockSequence, move.Block)
				lastOpID = move.OpID
				continue
			}

			// If we are here we need to close the batch, and start a new one.
			addOp(blob.NewOpMoveBlocks(curParent, blockSequence, encodeOpID(ref)), len(blockSequence))

			// Start new batch.
			curParent = move.Parent
			lastOpID = move.OpID
			ref = move.Ref
			blockSequence = append([]string{}, move.Block)
			continue
		}

		// If we haven't sent the last batch, we need to send it now.
		if len(blockSequence) > 0 {
			addOp(blob.NewOpMoveBlocks(curParent, blockSequence, encodeOpID(ref)), len(blockSequence))
		}

		// Now process the deletes.
		if len(deletedBlocks) > 0 {
			addOp(blob.NewOpDeleteBlocks(deletedBlocks), len(deletedBlocks))
		}
	}

	nDirtyAttrs := dm.dirtyMetadata.Len()
	if nDirtyAttrs > 0 {
		attrs := make([]blob.KeyValue, 0, nDirtyAttrs)
		for k, v := range dm.dirtyMetadata.Items() {
			attrs = append(attrs, blob.KeyValue{
				Key:   k,
				Value: v.Value,
			})
		}
		op := blob.NewOpSetAttributes("", attrs)
		addOp(op, len(attrs))
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
		addOp(blob.NewOpReplaceBlock(blk.Value), 1)
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

		c, ok := dm.opsToCids[[2]uint64{uint64(opid.Actor), uint64(opid.Ts)}] //nolint:gosec // We know this should not overflow.
		if !ok {
			panic(fmt.Errorf("BUG: failed to find CID for block op ID: %d:%d", opid.Actor, opid.Ts))
		}

		blkpb, err := BlockToProto(blk, c)
		if err != nil {
			return nil, err
		}

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

	remaining := ProtoStructAsMap(b.Attributes)

	return blob.Block{
		ID:          b.Id,
		Type:        b.Type,
		Text:        b.Text,
		Link:        b.Link,
		Attributes:  remaining,
		Annotations: annotationsFromProto(b.Annotations),
	}, nil
}

// ProtoStructAsMap is the same as structpb.Struct.AsMap,
// but it uses int64 instead of float64 when numbers are integers.
func ProtoStructAsMap(pb *structpb.Struct) map[string]any {
	f := pb.GetFields()
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
			Type:       a.Type,
			Link:       a.Link,
			Attributes: attrs,
			Starts:     a.Starts,
			Ends:       a.Ends,
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
		Id:          b.ID,
		Type:        b.Type,
		Text:        b.Text,
		Link:        b.Link,
		Attributes:  nil,
		Annotations: attrspb,
		Revision:    revision.String(),
	}
	if len(b.Attributes) > 0 {
		attrs, err := structpb.NewStruct(b.Attributes)
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
		attrpb, err := structpb.NewStruct(a.Attributes)
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
