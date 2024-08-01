package docmodel

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"reflect"
	"seed/backend/core"
	documents "seed/backend/genproto/documents/v3alpha"
	"seed/backend/hlc"
	"seed/backend/index"
	"seed/backend/util/colx"
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
	parent  *Document
	e       *Entity
	tree    *treeCRDT
	mut     *treeMutation
	patch   map[string]any
	done    bool
	nextHLC hlc.Timestamp
	origins map[string]cid.Cid // map of abbreviated origin hashes to actual cids; workaround, should not be necessary.
	// Index for blocks that we've created in this change.
	createdBlocks map[string]struct{}
	// Blocks that we've deleted in this change.
	deletedBlocks map[string]struct{}
}

func (doc *Document) Parent() *Document {
	return doc.parent
}

func (doc *Document) SetParent(parent *Document) {
	if doc.parent != nil {
		panic("BUG: parent doc is already set")
	}
	doc.parent = parent
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

// New creates a new mutable document.
func New(e *Entity, nextHLC hlc.Timestamp) (*Document, error) {
	dm := &Document{
		e:             e,
		tree:          newTreeCRDT(),
		patch:         map[string]any{},
		origins:       make(map[string]cid.Cid),
		createdBlocks: make(map[string]struct{}),
		deletedBlocks: make(map[string]struct{}),
		nextHLC:       nextHLC,
	}

	for _, c := range e.cids {
		o := originFromCID(c)
		dm.origins[o] = c
	}

	if err := dm.replayMoves(); err != nil {
		return nil, err
	}

	return dm, nil
}

func (dm *Document) replayMoves() (err error) {
	dm.e.State().ForEachListChunk([]string{"moves"}, func(time int64, origin string, items []any) bool {
		for idx, move := range items {
			mm := move.(map[string]any)
			block := mm["b"].(string)
			parent := mm["p"].(string)
			leftShadow := mm["l"].(string)
			left, leftOrigin, _ := strings.Cut(leftShadow, "@")
			if left != "" && leftOrigin == "" {
				leftOrigin = origin
			}

			if err = dm.tree.integrate(newOpID(origin, time, idx), block, parent, left, leftOrigin); err != nil {
				err = fmt.Errorf("failed move %v: %w", move, err)
				return false
			}
		}
		return true
	})
	if err != nil {
		return fmt.Errorf("failed to replay previous moves: %w", err)
	}

	return nil
}

// SetMetadata sets the title of the document.
func (dm *Document) SetMetadata(key, value string) error {
	v, ok := dm.e.Get("metadata", key)
	if ok && v.(string) == value {
		return nil
	}

	colx.ObjectSet(dm.patch, []string{"metadata", key}, value)

	return nil
}

// DeleteBlock deletes a block.
func (dm *Document) DeleteBlock(block string) error {
	mut := dm.ensureMutation()
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
	if blk.Id == "" {
		return fmt.Errorf("blocks must have ID")
	}

	blockMap, err := blockToMap(blk)
	if err != nil {
		return err
	}

	oldBlock, ok := dm.e.Get("blocks", blk.Id)
	if ok && reflect.DeepEqual(oldBlock, blockMap) {
		return nil
	}

	colx.ObjectSet(dm.patch, []string{"blocks", blk.Id, "#map"}, blockMap)

	return nil
}

// MoveBlock moves a block.
func (dm *Document) MoveBlock(block, parent, left string) error {
	if parent == TrashNodeID {
		panic("BUG: use DeleteBlock to delete a block")
	}

	mut := dm.ensureMutation()

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

func (dm *Document) ensureMutation() *treeMutation {
	if dm.mut == nil {
		dm.mut = dm.tree.mutate()
	}

	return dm.mut
}

// Change creates a change.
func (dm *Document) Change(kp core.KeyPair) (hb index.EncodedBlob[*index.Change], err error) {
	// TODO(burdiyan): we should make them reusable.
	if dm.done {
		return hb, fmt.Errorf("using already committed mutation")
	}

	if dm.nextHLC == 0 {
		panic("BUG: next HLC time is zero")
	}

	dm.done = true

	dm.cleanupPatch()

	action := "Update"

	if len(dm.patch) == 0 {
		dm.patch["isDraft"] = true
	}

	// Make sure to remove the dummy field created in the initial draft change.
	if len(dm.patch) > 1 {
		delete(dm.patch, "isDraft")
	}

	return dm.e.CreateChange(action, dm.nextHLC, kp, dm.patch)
}

// Ref creates a Ref blob for the current heads.
func (dm *Document) Ref(kp core.KeyPair) (ref index.EncodedBlob[*index.Ref], err error) {
	// TODO(hm24): make genesis detection more reliable.
	genesis := dm.e.cids[0]

	if len(dm.e.heads) != 1 {
		return ref, fmt.Errorf("TODO: creating refs for multiple heads is not supported yet")
	}

	headCID := dm.e.cids[len(dm.e.cids)-1]
	head := dm.e.changes[len(dm.e.cids)-1]

	return index.NewRef(kp, genesis, dm.e.id, []cid.Cid{headCID}, head.Ts)
}

// Commit commits a change.
func (dm *Document) Commit(ctx context.Context, kp core.KeyPair, bs blockstore.Blockstore) (ebc index.EncodedBlob[*index.Change], err error) {
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

func (dm *Document) cleanupPatch() {
	if dm.mut == nil {
		return
	}

	var moves []any
	dm.mut.forEachMove(func(block, parent, left, leftOrigin string) bool {
		var l string
		if left != "" {
			l = left + "@" + leftOrigin
		}
		moves = append(moves, map[string]any{
			"b": block,
			"p": parent,
			"l": l,
		})

		return true
	})

	// If we have some moves after cleaning up, add them to the patch.
	if moves != nil {
		dm.patch["moves"] = map[string]any{
			"#list": map[string]any{
				"#ins": moves,
			},
		}
	}

	// Remove state of those blocks that we created and deleted in the same change.
	for blk := range dm.deletedBlocks {
		if _, mustIgnore := dm.createdBlocks[blk]; mustIgnore {
			colx.ObjectDelete(dm.patch, []string{"blocks", blk})
			continue
		}
	}

	// Remove the blocks key from the patch if we end up with no blocks after cleanup.
	if blocks, ok := dm.patch["blocks"].(map[string]any); ok {
		if len(blocks) == 0 {
			delete(dm.patch, "blocks")
		}
	}
}

// Entity returns the underlying entity.
func (dm *Document) Entity() *Entity {
	return dm.e
}

// Hydrate hydrates a document.
func (dm *Document) Hydrate(ctx context.Context) (*documents.Document, error) {
	if len(dm.e.changes) == 0 {
		return nil, fmt.Errorf("no changes in the entity")
	}

	if dm.mut != nil {
		panic("BUG: can't hydrate a document with uncommitted changes")
	}

	e := dm.e

	first := e.changes[0]
	last := e.changes[len(e.changes)-1]

	// TODO(burdiyan): this is ugly and needs to be refactored.
	u, err := url.Parse(string(e.ID()))
	if err != nil {
		return nil, err
	}

	account := u.Host
	path := u.Path

	docpb := &documents.Document{
		Account:         account,
		Path:            path,
		Metadata:        make(map[string]string),
		CreateTime:      timestamppb.New(hlc.Timestamp(first.Ts).Time()),
		Version:         e.Version().String(),
		PreviousVersion: NewVersion(e.Deps()...).String(),
	}

	docpb.UpdateTime = timestamppb.New(hlc.Timestamp(last.Ts).Time())

	for _, key := range e.state.Keys("metadata") {
		v, ok := e.state.GetAny("metadata", key).(string)
		if ok && v != "" {
			docpb.Metadata[key] = v
		}
	}

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
			panic("BUG: no parent " + parent + " was found yet while iterating")
		}
		blk.Children = append(blk.Children, child)
	}

	dm.tree.mutate().walkDFT(func(m *move) bool {
		// TODO(burdiyan): block revision would change only if block itself was changed.
		// If block is only moved it's revision won't change. Need to check if that's what we want.
		mm, origin, ok := dm.e.State().GetWithOrigin("blocks", m.Block)
		if !ok {
			// If we got some moves but no block state
			// we just skip them, we don't want to blow up here.
			return true
		}

		oo := dm.origins[origin]
		// if !oo.Defined() {
		// 	oo = dm.oldDraft
		// }

		var blk *documents.Block
		blk, err = blockFromMap(m.Block, oo.String(), mm.(map[string]any))
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
	delete(v, "id")

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
