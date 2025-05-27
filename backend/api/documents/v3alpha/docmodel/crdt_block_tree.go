package docmodel

import (
	"fmt"
	"iter"
	"math"
	"seed/backend/core"
	"seed/backend/util/btree"
	"strings"
)

type moveEffect byte

const (
	moveEffectNone    moveEffect = 0
	moveEffectCreated moveEffect = 1
	moveEffectMoved   moveEffect = 2
)

const TrashNodeID = "◊"

type moveRecord struct {
	OpID   opID
	Parent string
	Block  string
	Ref    opID
}

type treeOpSet struct {
	// Moved operations sorted by their opIDs.
	log *btree.Map[opID, moveRecord]

	// Parent block -> list of children blocks.
	sublists *btree.Map[string, *rgaList[string]]

	detachedBlocks *btree.Map[string, blockLatestMove] // Blocks that were detached from the tree.
}

type blockLatestMove struct {
	opID     opID
	detached bool
}

func newTreeOpSet() *treeOpSet {
	opset := &treeOpSet{
		log:            btree.New[opID, moveRecord](8, opID.Compare),
		sublists:       btree.New[string, *rgaList[string]](8, strings.Compare),
		detachedBlocks: btree.New[string, blockLatestMove](8, strings.Compare),
	}

	// Create initial lists for root and trash subtrees.
	opset.sublists.Set("", newRGAList[string]())
	opset.sublists.Set(TrashNodeID, newRGAList[string]())

	return opset
}

func (opset *treeOpSet) Copy() *treeOpSet {
	cpy := &treeOpSet{
		log:            opset.log.Copy(),
		sublists:       opset.sublists.Copy(),
		detachedBlocks: opset.detachedBlocks.Copy(),
	}

	// TODO(burdiyan): improve on this somehow.
	// Make sure the original sublists are not modified during mutations.
	for k, v := range cpy.sublists.Items() {
		cpy.sublists.Set(k, v.Copy())
	}

	return cpy
}

func (opset *treeOpSet) Integrate(opID opID, parent, block string, refID opID) error {
	if _, ok := opset.log.Get(opID); ok {
		return fmt.Errorf("duplicate move op ID: %v", opID)
	}

	subtree, ok := opset.sublists.Get(parent)
	if !ok {
		return fmt.Errorf("parent '%s' not found in tree", parent)
	}

	if err := subtree.Integrate(opID, refID, block); err != nil {
		return fmt.Errorf("failed to integrate move operation (block=%s parent=%s ref=%v): %w", block, parent, refID, err)
	}

	// We need to create a subtree for every block.
	if _, ok := opset.sublists.Get(block); !ok {
		if opset.sublists.Set(block, newRGAList[string]()) {
			panic("BUG: duplicate subtree for block " + block)
		}
	}

	move := moveRecord{
		OpID:   opID,
		Block:  block,
		Parent: parent,
		Ref:    refID,
	}

	if opset.log.Set(opID, move) {
		panic(fmt.Errorf("BUG: duplicate move op ID: %v", opID))
	}

	opset.detachedBlocks.Set(block, blockLatestMove{opID: opID})

	return nil
}

func (opset *treeOpSet) State() *blockTreeState {
	state := &blockTreeState{
		blocks:         btree.New[string, blockState](8, strings.Compare),
		opSet:          opset.Copy(),
		invisibleMoves: btree.New[opID, struct{}](8, opID.Compare),
	}

	for opid, move := range opset.log.Items() {
		if state.isAncestor(move.Block, move.Parent) {
			state.invisibleMoves.Set(opid, struct{}{})
			continue
		}

		prev, replaced := state.blocks.Swap(move.Block, blockState{Parent: move.Parent, Position: move.OpID})
		if replaced {
			state.invisibleMoves.Set(prev.Position, struct{}{})
		}
	}

	return state
}

type blockState struct {
	Parent   string
	Position opID
}

type blockTreeState struct {
	// Copy of the original opset.
	opSet          *treeOpSet
	blocks         *btree.Map[string, blockState]
	invisibleMoves *btree.Map[opID, struct{}]
}

func (state *blockTreeState) Copy() *blockTreeState {
	return &blockTreeState{
		opSet:          state.opSet.Copy(),
		blocks:         state.blocks.Copy(),
		invisibleMoves: state.invisibleMoves.Copy(),
	}
}

// isAncestor returns checks if a is an ancestor of b.
func (state *blockTreeState) isAncestor(a, b string) bool {
	n, ok := state.blocks.Get(b)
	for {
		if !ok || n.Parent == "" || n.Parent == TrashNodeID {
			return false
		}

		if n.Parent == a {
			return true
		}

		n, ok = state.blocks.Get(n.Parent)
	}
}

type blockPair struct {
	Parent string
	Child  string
}

// DFT does depth-first traversal of the block tree starting from the root.
// It returns a sequence of (parent, block) pairs.
func (state *blockTreeState) DFT(startBlockID string) iter.Seq[blockPair] {
	return func(yield func(blockPair) bool) {
		state.walk(startBlockID, yield)
	}
}

func (state *blockTreeState) walk(parent string, yield func(blockPair) bool) bool {
	children := state.opSet.sublists.GetMaybe(parent)
	if children == nil || children.items.Len() == 0 {
		return true
	}

	for _, slot := range children.items.Items() {
		if _, ok := state.invisibleMoves.Get(slot.ID); ok || slot.IsDeleted {
			continue
		}

		if !yield(blockPair{Parent: parent, Child: slot.Value}) {
			break
		}

		if !state.walk(slot.Value, yield) {
			return false
		}
	}

	return true
}

func (state *blockTreeState) Mutate() *blockTreeMutation {
	return &blockTreeMutation{
		initial: state,
		dirty:   state.Copy(),
	}
}

type blockTreeMutation struct {
	initial *blockTreeState
	dirty   *blockTreeState
	counter int
	done    bool
}

func (mut *blockTreeMutation) Move(parent, block, left string) (moveEffect, error) {
	if mut.done {
		panic("BUG: nil mutation")
	}

	if block == "" {
		return moveEffectNone, fmt.Errorf("block must not be empty")
	}

	if block == left {
		return moveEffectNone, fmt.Errorf("block and left must not be the same")
	}

	if left == TrashNodeID {
		panic("BUG: trash can't be left")
	}

	if parent != "" && left != "" && parent == left {
		return moveEffectNone, fmt.Errorf("parent and left must not be the same")
	}

	// Check if parent is in the tree.
	if _, ok := mut.dirty.opSet.sublists.Get(parent); !ok {
		return moveEffectNone, fmt.Errorf("desired parent block %s is not in the tree", parent)
	}

	// Preventing cycles.
	if mut.dirty.isAncestor(block, parent) {
		return moveEffectNone, fmt.Errorf("cycle detected: block %s is ancestor of %s", block, parent)
	}

	leftState, ok := mut.dirty.blocks.Get(left)
	if !ok {
		if left == "" {
			leftState = blockState{Parent: parent}
		} else {
			return moveEffectNone, fmt.Errorf("left block '%s' not found in tree", left)
		}
	}

	if leftState.Parent != parent {
		return moveEffectNone, fmt.Errorf("left block '%s' is not a child of parent '%s'", left, parent)
	}

	me := moveEffectCreated
	curState, ok := mut.dirty.blocks.Get(block)
	newState := blockState{
		Parent:   parent,
		Position: newOpID(math.MaxInt64, math.MaxUint64, mut.counter),
	}
	if ok {
		me = moveEffectMoved

		siblings := mut.dirty.opSet.sublists.GetMaybe(curState.Parent)
		fracdex, ok := siblings.applied.Get(curState.Position)
		if !ok {
			panic("BUG: existing block is not found among supposed parent's children")
		}

		// We need to check whether the block is already in the desired position,
		// i.e. it already has the same parent, and the block to the left of it is the desired left.
		if curState.Parent == parent {
			// We check the items to the left of the current position of our block,
			// to see if it's already the desired left block.
			for k, v := range siblings.items.SeekReverse(fracdex) {
				if k == fracdex {
					continue
				}
				if v.IsDeleted {
					continue
				}
				if _, ok := mut.dirty.invisibleMoves.Get(v.ID); ok {
					continue
				}
				if v.Value == left {
					return moveEffectNone, nil
				}
				// No need to iterate further than the first non-deleted left sibling.
				break
			}
		}

		// Mark the previous position of the block as deleted.
		// TODO: If it was created by our own transaction – just delete it.
		curListItem := siblings.items.GetMaybe(fracdex)
		curListItem.IsDeleted = true
		siblings.items.Set(fracdex, curListItem)
	}

	mut.dirty.blocks.Set(block, newState)

	mut.counter++

	if err := mut.dirty.opSet.Integrate(newState.Position, parent, block, leftState.Position); err != nil {
		return moveEffectNone, err
	}

	return me, nil
}

func (mut *blockTreeMutation) Commit(ts int64, actor core.ActorID) iter.Seq[moveRecord] {
	// We iterate the state of the block tree in a breadth-first order,
	// and we clean up all the moves we've made, such that redundant moves are not included.

	// TODO(burdian): improve detecting operations created by our mutation.
	isOurs := func(opID opID) bool {
		return opID.Ts == math.MaxInt64 && opID.Actor == math.MaxUint64
	}

	type queueItem struct {
		Block    string
		Children *rgaList[string]
	}

	return func(yield func(moveRecord) bool) {
		defer func() {
			// Make sure after the commit the mutation is not used anymore.
			// We want any further usage to panic.
			mut.done = true
		}()

		var (
			queue   = []queueItem{{Block: "", Children: mut.dirty.opSet.sublists.GetMaybe("")}}
			counter int
		)

		processQueue := func() {
			for len(queue) > 0 {
				sublist := queue[0]
				queue = queue[1:]
				var last rgaItem[string]

				for _, block := range sublist.Children.items.Items() {
					if children, ok := mut.dirty.opSet.sublists.Get(block.Value); ok && children.items.Len() > 0 {
						queue = append(queue, queueItem{Block: block.Value, Children: children})
					}

					if !isOurs(block.ID) {
						last = block
						continue
					}

					if block.IsDeleted {
						continue
					}

					mr := moveRecord{
						OpID:   newOpID(ts, actor, counter),
						Parent: sublist.Block,
						Block:  block.Value,
					}

					if isOurs(last.ID) {
						mr.Ref = newOpID(ts, actor, counter-1)
					} else {
						mr.Ref = last.ID
					}

					// Check if the current position of the block is the same as initial.
					initialPos, ok := mut.initial.findLogicalPosition(block.Value)
					if ok {
						dirtyPos, ok := mut.dirty.findLogicalPosition(block.Value)
						if ok && initialPos.Parent == dirtyPos.Parent && initialPos.Left == dirtyPos.Left {
							continue
						}

					}

					if !yield(mr) {
						break
					}

					last = block
					counter++
				}
			}
		}

		processQueue()

		deleted, ok := mut.dirty.opSet.sublists.Get(TrashNodeID)
		if !ok {
			panic("BUG: no trash sublist")
		}

		for _, block := range deleted.items.Items() {
			if !isOurs(block.ID) || block.IsDeleted {
				continue
			}

			// If currently deleted block wasn't in the initial state,
			// then we can safely ignore it, because it was created by our own transaction.
			if _, ok := mut.initial.blocks.Get(block.Value); !ok {
				continue
			}

			mr := moveRecord{
				OpID:   newOpID(ts, actor, counter),
				Parent: TrashNodeID,
				Block:  block.Value,
				Ref:    opID{},
			}
			if !yield(mr) {
				break
			}
			counter++
		}

		// Now let's handle detached blocks and their children.
		for blk, state := range mut.dirty.opSet.detachedBlocks.Items() {
			if !state.detached {
				continue
			}

			queue = append(queue, queueItem{
				Block:    blk,
				Children: mut.dirty.opSet.sublists.GetMaybe(blk),
			})
		}

		processQueue()
	}
}

type logicalPosition struct {
	Parent string
	Left   string
}

func (state *blockTreeState) findLogicalPosition(block string) (lp logicalPosition, ok bool) {
	bs, ok := state.blocks.Get(block)
	if !ok {
		return lp, false
	}

	siblings, ok := state.opSet.sublists.Get(bs.Parent)
	if !ok {
		return lp, false
	}

	fracdex, ok := siblings.applied.Get(bs.Position)
	if !ok {
		return lp, false
	}

	lp.Parent = bs.Parent

	for k, v := range siblings.items.SeekReverse(fracdex) {
		if k == fracdex {
			continue
		}
		if v.IsDeleted {
			continue
		}
		if _, ok := state.invisibleMoves.Get(v.ID); ok {
			continue
		}

		lp.Left = v.Value

		// No need to iterate further than the first non-deleted left sibling.
		break
	}

	return lp, true
}
