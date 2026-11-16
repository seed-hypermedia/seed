package docmodel

import (
	"cmp"
	"fmt"
	"iter"
	"maps"
	"math"
	"seed/backend/core"
	"seed/backend/util/btree"
	"slices"
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
		blocks:         make(map[string]blockState),
		opSet:          opset.Copy(),
		invisibleMoves: btree.New[opID, struct{}](8, opID.Compare),
	}

	for opid, move := range opset.log.Items() {
		// A block can never be its own parent. Such a move would make the block
		// its own ancestor (a cycle); mark it invisible. isAncestor can't catch
		// this case on its own because it inspects the pre-move state, where the
		// block is not yet self-referential — so historically a self-parent move
		// slipped through and made the block graph cyclic.
		if move.Block == move.Parent || state.isAncestor(move.Block, move.Parent) {
			state.invisibleMoves.Set(opid, struct{}{})
			continue
		}

		prev, replaced := state.blocks[move.Block]
		state.blocks[move.Block] = blockState{Parent: move.Parent, Position: move.OpID}
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
	blocks         map[string]blockState
	invisibleMoves *btree.Map[opID, struct{}]
}

func (state *blockTreeState) Copy() *blockTreeState {
	return &blockTreeState{
		opSet:          state.opSet.Copy(),
		blocks:         maps.Clone(state.blocks),
		invisibleMoves: state.invisibleMoves.Copy(),
	}
}

// isAncestor reports whether a is an ancestor of b by walking up b's parent
// chain.
//
// The walk is bounded by the number of blocks: a valid ancestor chain visits
// each block at most once, so if we take more steps than there are blocks the
// graph must contain a cycle. We treat that as "not an ancestor" and stop,
// instead of looping forever. This keeps hydration finite even when the block
// graph is corrupt — e.g. a block whose parent is itself, which historically
// existed in some documents and would otherwise spin a CPU core indefinitely
// (see TestSelfParentDoesNotHang).
func (state *blockTreeState) isAncestor(a, b string) bool {
	n, ok := state.blocks[b]
	for steps := len(state.blocks); ok && steps >= 0; steps-- {
		if n.Parent == "" || n.Parent == TrashNodeID {
			return false
		}
		if n.Parent == a {
			return true
		}
		n, ok = state.blocks[n.Parent]
	}
	return false
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
			return false
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
	if block == parent {
		return moveEffectNone, fmt.Errorf("block %s cannot be its own parent", block)
	}
	if mut.dirty.isAncestor(block, parent) {
		return moveEffectNone, fmt.Errorf("cycle detected: block %s is ancestor of %s", block, parent)
	}

	leftState, ok := mut.dirty.blocks[left]
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
	curState, ok := mut.dirty.blocks[block]
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
		// A block with no visible left sibling is in the desired position when no left is wanted:
		// moving the first block to the start changes nothing.
		// Blocks in the trash have no meaningful position, so deleting a deleted block is not a move either.
		if curState.Parent == parent {
			if parent == TrashNodeID {
				return moveEffectNone, nil
			}

			if lp, ok := mut.dirty.findLogicalPosition(block); ok && lp.Left == left {
				return moveEffectNone, nil
			}
		}

		// Mark the previous position of the block as deleted.
		// TODO: If it was created by our own transaction – just delete it.
		curListItem := siblings.items.GetMaybe(fracdex)
		curListItem.IsDeleted = true
		siblings.items.Set(fracdex, curListItem)
	}

	mut.dirty.blocks[block] = newState

	mut.counter++

	if err := mut.dirty.opSet.Integrate(newState.Position, parent, block, leftState.Position); err != nil {
		return moveEffectNone, err
	}

	return me, nil
}

// Commit returns the moves that turn the initial state into the mutated one.
//
// The moves are derived from the resulting order of each sublist, not from the moves the mutation was asked
// to make: as many blocks as possible keep their initial positions, and the rest are moved (see keepInitialPositions).
// So a block that ends up where it initially was (e.g. moved away and back, or deleted and restored) is not moved,
// and a block is moved if its neighbors changed, even if it still follows the same block as before.
//
// Each committed move is anchored on the committed position of the block
// that precedes it in the resulting list: the initial position of a block that is not moved,
// or the move produced just before for a block that is. Anchoring on anything else
// (like the position a dropped move had inside of the mutation) places the block
// correctly in the mutated state, but somewhere else for those who apply the committed moves.
func (mut *blockTreeMutation) Commit(ts int64, actor core.ActorID) iter.Seq[moveRecord] {
	// TODO(burdian): improve detecting operations created by our mutation.
	isOurs := func(opID opID) bool {
		return opID.Ts == math.MaxInt64 && opID.Actor == math.MaxUint64
	}

	return func(yield func(moveRecord) bool) {
		defer func() {
			// Make sure after the commit the mutation is not used anymore.
			// We want any further usage to panic.
			mut.done = true
		}()

		var (
			queue   []string
			seen    = map[string]struct{}{}
			counter int
			stopped bool
		)

		enqueue := func(block string) {
			if _, ok := seen[block]; ok {
				return
			}

			seen[block] = struct{}{}
			queue = append(queue, block)
		}

		emit := func(mr moveRecord) bool {
			if stopped || !yield(mr) {
				stopped = true
				return false
			}

			counter++

			return true
		}

		processSublist := func(parent string) {
			sublist := mut.dirty.opSet.sublists.GetMaybe(parent)
			if sublist == nil || sublist.items.Len() == 0 {
				return
			}

			// Initial positions of the blocks that initially were in this sublist.
			var (
				initial = make(map[string]int)
				i       int
			)

			for _, item := range sublist.items.Items() {
				if !isOurs(item.ID) {
					if bs, ok := mut.initial.blocks[item.Value]; ok && bs.Parent == parent && bs.Position == item.ID {
						initial[item.Value] = i
					}
				}

				i++
			}

			var children []committedChild

			i = -1
			for _, item := range sublist.items.Items() {
				i++

				if item.IsDeleted {
					continue
				}

				if _, ok := mut.dirty.invisibleMoves.Get(item.ID); ok {
					continue
				}

				c := committedChild{Block: item.Value, Initial: -1}

				if initIdx, ok := initial[item.Value]; ok {
					c.Initial = initIdx
					c.Position = mut.initial.blocks[item.Value].Position
				}

				children = append(children, c)
			}

			keepInitialPositions(children)

			var ref opID

			for _, c := range children {
				// Children of this block will be processed after all the blocks on this level,
				// such that parents created by our mutation always precede their children.
				enqueue(c.Block)

				if !c.Moved {
					ref = c.Position
					continue
				}

				mr := moveRecord{
					OpID:   newOpID(ts, actor, counter),
					Parent: parent,
					Block:  c.Block,
					Ref:    ref,
				}

				if !emit(mr) {
					return
				}

				ref = mr.OpID
			}
		}

		processQueue := func() {
			for len(queue) > 0 && !stopped {
				parent := queue[0]
				queue = queue[1:]
				processSublist(parent)
			}
		}

		enqueue("")
		processQueue()

		deleted, ok := mut.dirty.opSet.sublists.Get(TrashNodeID)
		if !ok {
			panic("BUG: no trash sublist")
		}
		seen[TrashNodeID] = struct{}{}

		for _, block := range deleted.items.Items() {
			if stopped {
				return
			}

			if block.IsDeleted {
				continue
			}

			// Deleted blocks may still have children moved by our mutation.
			enqueue(block.Value)

			if !isOurs(block.ID) {
				continue
			}

			// If currently deleted block wasn't in the initial state,
			// then we can safely ignore it, because it was created by our own transaction.
			// Same if it was already deleted in the initial state.
			if bs, ok := mut.initial.blocks[block.Value]; !ok || bs.Parent == TrashNodeID {
				continue
			}

			mr := moveRecord{
				OpID:   newOpID(ts, actor, counter),
				Parent: TrashNodeID,
				Block:  block.Value,
				Ref:    opID{},
			}
			if !emit(mr) {
				return
			}
		}

		processQueue()

		// Now let's handle detached blocks and their children.
		for blk, state := range mut.dirty.opSet.detachedBlocks.Items() {
			if !state.detached {
				continue
			}

			enqueue(blk)
		}

		processQueue()

		// Whatever is left are sublists not reachable from the visible tree.
		for blk := range mut.dirty.opSet.sublists.Items() {
			enqueue(blk)
		}

		processQueue()
	}
}

// committedChild is a visible child of a sublist in the mutated state.
type committedChild struct {
	Block string
	// Position of the block in the committed state, if it initially was in this sublist.
	Position opID
	// Index of that position among all the items of the sublist, or -1 if there's none.
	Initial int
	// Whether a move has to be committed for the block.
	Moved bool
}

// keepInitialPositions decides which children of a sublist keep their initial positions, and which have to move.
//
// Children are given in their resulting order. Those that initially were in this sublist can stay where they are
// as long as their initial positions grow in the resulting order. We keep the longest such run, which leaves
// the fewest possible children to move. It doesn't matter which of them the mutation moved to get to the result:
// when the first block is moved to the end, moving that one block is what gets committed,
// even if the mutation was told to place every other block before it.
func keepInitialPositions(children []committedChild) {
	// Longest increasing subsequence of the initial positions.
	var (
		tails []int // tails[n] is the child ending the best run of length n+1.
		prev  = make([]int, len(children))
	)

	for i, c := range children {
		children[i].Moved = true

		if c.Initial < 0 {
			continue
		}

		n, _ := slices.BinarySearchFunc(tails, c.Initial, func(tail, pos int) int {
			return cmp.Compare(children[tail].Initial, pos)
		})

		prev[i] = -1
		if n > 0 {
			prev[i] = tails[n-1]
		}

		if n == len(tails) {
			tails = append(tails, i)
		} else {
			tails[n] = i
		}
	}

	if len(tails) == 0 {
		return
	}

	for i := tails[len(tails)-1]; i >= 0; i = prev[i] {
		children[i].Moved = false
	}
}

type logicalPosition struct {
	Parent string
	Left   string
}

func (state *blockTreeState) findLogicalPosition(block string) (lp logicalPosition, ok bool) {
	bs, ok := state.blocks[block]
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
