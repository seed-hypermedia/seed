package docmodel

import (
	"context"
	"encoding/json"
	"fmt"
	"iter"
	"maps"
	"net/url"
	"reflect"
	"seed/backend/blob"
	"seed/backend/core"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/util/cclock"
	"slices"
	"sort"
	"strings"

	"github.com/ipfs/boxo/blockstore"
	blocks "github.com/ipfs/go-block-format"
	"github.com/ipfs/go-cid"
	"github.com/multiformats/go-multibase"
	"google.golang.org/protobuf/encoding/protojson"
	"google.golang.org/protobuf/types/known/timestamppb"
)

// WARNING! There's some very ugly type-unsafe code in here.
// Can do better, but no time for that now.

// Document is a mutable document.
type Document struct {
	crdt    *docCRDT
	tree    *treeCRDT
	origins map[string]cid.Cid // map of abbreviated origin hashes to actual cids; workaround, should not be necessary.

	// Bellow goes the data for the ongoing dirty mutation.
	// Document can only be mutated once, and then must be thrown away.

	dirty         bool
	mut           *treeMutation
	movesReplayed bool
	done          bool
	// Index for blocks that we've created in this change.
	createdBlocks map[string]struct{}
	// Blocks that we've deleted in this change.
	deletedBlocks map[string]struct{}

	dirtyBlocks   map[string]map[string]any // BlockID => BlockState.
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

func New(id blob.IRI, clock *cclock.Clock) (*Document, error) {
	crdt := newCRDT(id, clock)
	return newDoc(crdt)
}

// newDoc creates a new mutable document.
func newDoc(crdt *docCRDT) (*Document, error) {
	dm := &Document{
		crdt:          crdt,
		tree:          newTreeCRDT(),
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
	return dm.crdt.applyChange(c, ch)
}

func (dm *Document) replayMoves() error {
	dm.dirty = true
	if dm.movesReplayed {
		panic("BUG: moves replaed twice")
	}

	dm.movesReplayed = true

	var idx int
	for opid, move := range dm.crdt.moveLog.Iter() {
		block := move["block"].(string)
		parent := move["parent"].(string)
		leftShadow := move["leftOrigin"].(string)
		left, leftOrigin, _ := strings.Cut(leftShadow, "@")
		if left != "" && leftOrigin == "" {
			leftOrigin = opid.Origin
		}

		if err := dm.tree.integrate(opid, block, parent, left, leftOrigin); err != nil {
			return fmt.Errorf("failed move %v: %w", move, err)
		}

		idx++
	}

	return nil
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

	me, err := mut.move(block, TrashNodeID, "")
	if err != nil {
		return err
	}

	if me == moveEffectMoved {
		dm.deletedBlocks[block] = struct{}{}
	}

	return nil
}

// ReplaceBlock replaces a block.
func (dm *Document) ReplaceBlock(blk *documents.Block) error {
	dm.dirty = true
	if blk.Id == "" {
		return fmt.Errorf("blocks must have ID")
	}

	if dm.dirtyBlocks == nil {
		dm.dirtyBlocks = make(map[string]map[string]any)
	}

	blockMap, err := blockToMap(blk)
	if err != nil {
		return err
	}

	// Check if CRDT state already has the same value for block.
	// If so, we do nothing, and remove any dirty state for this block.
	if reg := dm.crdt.stateBlocks[blk.Id]; reg != nil {
		oldValue, ok := reg.GetLatestOK()
		if ok && reflect.DeepEqual(oldValue, blockMap) {
			delete(dm.dirtyBlocks, blk.Id)
			return nil
		}
	}

	dm.dirtyBlocks[blk.Id] = blockMap

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

	me, err := mut.move(block, parent, left)
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

func (dm *Document) ensureTreeMutation() (*treeMutation, error) {
	dm.dirty = true
	if dm.mut == nil {
		if err := dm.replayMoves(); err != nil {
			return nil, err
		}
		dm.mut = dm.tree.mutate()
	}

	return dm.mut, nil
}

// Change creates a change.
// After this the Document instance must be discarded. The change must be applied to a different state.
func (dm *Document) Change(kp core.KeyPair) (hb blob.Encoded[*blob.Change], err error) {
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

// Commit commits a change.
func (dm *Document) Commit(ctx context.Context, kp core.KeyPair, bs blockstore.Blockstore) (ebc blob.Encoded[*blob.Change], err error) {
	ebc, err = dm.Change(kp)
	if err != nil {
		return ebc, err
	}

	ebr, err := dm.Ref(kp)
	if err != nil {
		return ebc, err
	}

	if err := bs.PutMany(ctx, []blocks.Block{ebc, ebr}); err != nil {
		return ebc, err
	}

	return ebc, nil
}

func (dm *Document) cleanupPatch() []blob.Op {
	if !dm.dirty {
		return nil
	}

	var ops []blob.Op

	metaKeys := slices.Collect(maps.Keys(dm.dirtyMetadata))
	slices.Sort(metaKeys)

	for _, key := range metaKeys {
		ops = append(ops, blob.NewOpSetMetadata(key, dm.dirtyMetadata[key]))
	}

	if dm.mut != nil {
		dm.mut.forEachMove(func(block, parent, left, leftOrigin string) bool {
			var l string
			if left != "" {
				l = left + "@" + leftOrigin
			}

			ops = append(ops, blob.NewOpMoveBlock(block, parent, l))

			return true
		})
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
		ops = append(ops, blob.NewOpReplaceBlock(dm.dirtyBlocks[bid]))
	}

	return ops
}

func (dm *Document) NumChanges() int {
	return len(dm.crdt.cids)
}

func (dm *Document) BFTDeps(start []cid.Cid) (iter.Seq2[int, blob.ChangeRecord], error) {
	return dm.crdt.BFTDeps(start)
}

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

	if !dm.movesReplayed {
		if err := dm.replayMoves(); err != nil {
			return nil, err
		}
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
		Metadata:   e.GetMetadata(),
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

	dm.tree.mutate().walkDFT(func(m *move) bool {
		// TODO(burdiyan): block revision would change only if block itself was changed.
		// If block is only moved it's revision won't change. Need to check if that's what we want.

		// If we got some moves but no block state
		// we just skip them, we don't want to blow up here.

		opset := dm.crdt.stateBlocks[m.Block]
		if opset == nil {
			return true
		}

		opid, rawBlock, ok := opset.GetLatestWithID()
		if !ok {
			return true
		}

		oo := dm.origins[opid.Origin]

		var blk *documents.Block
		blk, err = blockFromMap(m.Block, oo.String(), rawBlock)
		if err != nil {
			return false
		}

		child := &documents.BlockNode{Block: blk}
		appendChild(m.Parent, child)
		blockMap[m.Block] = child

		return true
	})
	if err != nil {
		return nil, err
	}

	return docpb, nil
}

func blockToMap(blk *documents.Block) (map[string]any, error) {
	// This is a very bad way to convert something into a map,
	// but mapstructure package could have problems here,
	// because protobuf have peculiar encoding of oneof fields into JSON,
	// which mapstructure doesn't know about. Although in fact we don't have
	// any oneof fields in this structure, but just in case.
	data, err := protojson.Marshal(blk)
	if err != nil {
		return nil, err
	}

	var v map[string]any
	if err := json.Unmarshal(data, &v); err != nil {
		return nil, err
	}

	// We don't want those fields, because they can be inferred.
	delete(v, "revision")

	return v, nil
}

func blockFromMap(id, revision string, v map[string]any) (*documents.Block, error) {
	data, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}

	pb := &documents.Block{}
	if err := protojson.Unmarshal(data, pb); err != nil {
		return nil, err
	}
	pb.Id = id
	pb.Revision = revision

	return pb, nil
}
