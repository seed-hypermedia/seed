package docmodel

import (
	"cmp"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"iter"
	"math"
	"seed/backend/blob"
	"seed/backend/core"
	"seed/backend/util/attrkey"
	"seed/backend/util/btree"
	"seed/backend/util/cclock"
	"slices"
	"sort"
	"strings"
	"time"

	"github.com/ipfs/go-cid"
	"github.com/multiformats/go-multibase"
	"golang.org/x/exp/maps"
)

type opID struct {
	Ts    int64
	Idx   int64
	Actor core.ActorID
}

func (o opID) isZero() bool {
	return o.Ts == 0 && o.Idx == 0 && o.Actor == 0
}

func encodeOpID(o opID) []uint64 {
	if o.isZero() {
		return nil
	}

	if o.Actor == math.MaxUint64 && o.Ts == 0 {
		return []uint64{uint64(o.Idx)} //nolint:gosec // We know this should not overflow.
	}

	return []uint64{
		uint64(o.Ts),    //nolint:gosec // We know this should not overflow.
		uint64(o.Idx),   //nolint:gosec // We know this should not overflow.
		uint64(o.Actor), //nolint:gosec // We know this should not overflow.
	}
}

func decodeOpID(s []uint64) (opID, error) {
	if len(s) == 0 {
		return opID{}, nil
	}

	if len(s) == 1 {
		if s[0] > maxIdx {
			return opID{}, fmt.Errorf("invalid opID: index %d overflows the maximum %d", s[0], maxIdx)
		}
		return opID{Ts: 0, Actor: math.MaxUint64, Idx: int64(s[0])}, nil //nolint:gosec // Bounds-checked above.
	}

	if len(s) != 3 {
		return opID{}, fmt.Errorf("invalid opID: %v", s)
	}

	if s[0] > maxTs {
		return opID{}, fmt.Errorf("invalid opID: timestamp %d overflows the maximum %d", s[0], maxTs)
	}

	if s[1] > maxIdx {
		return opID{}, fmt.Errorf("invalid opID: index %d overflows the maximum %d", s[1], maxIdx)
	}

	return opID{
		Ts:    int64(s[0]), //nolint:gosec // Bounds-checked above.
		Idx:   int64(s[1]), //nolint:gosec // Bounds-checked above.
		Actor: core.ActorID(s[2]),
	}, nil
}

const (
	maxTs = 1<<48 - 1

	// maxIdx is a policy bound, not a representation one: op IDs used to be
	// packed into a fixed 15-byte encoding with a 24-bit index (removed in
	// 2024's Breaking Change), but today the index is a plain int64 in memory
	// and a full uint64 on the wire. The apply loop advances the index
	// quadratically within multi-block ops, so the old 2^24 cap was reached by
	// a single move op of only ~5.8k blocks — real imported documents exceed
	// that. 2^31 allows ~65k blocks in one move op while still bounding the
	// work a hostile change can ask for.
	maxIdx = 1<<31 - 1
)

func newOpID(ts int64, actor core.ActorID, idx int) opID {
	if idx < 0 {
		panic("BUG: negative idx")
	}

	// We use max int64 for some work arounds.
	if ts != math.MaxInt64 && ts >= maxTs {
		panic(fmt.Errorf("BUG: ts %d too big", ts))
	}

	if idx > maxIdx {
		panic("BUG: idx too big")
	}

	return opID{
		Ts:    ts,
		Idx:   int64(idx),
		Actor: actor,
	}
}

func (o opID) Compare(oo opID) int {
	if o.Ts < oo.Ts {
		return -1
	}

	if o.Ts > oo.Ts {
		return +1
	}

	if o.Idx < oo.Idx {
		return -1
	}

	if o.Idx > oo.Idx {
		return +1
	}

	return cmp.Compare(o.Actor, oo.Actor)
}

type docCRDT struct {
	id       blob.IRI
	cids     []cid.Cid
	changes  []*blob.Change
	deps     [][]int // deps for each change.
	rdeps    [][]int // reverse deps for each change.
	applied  map[cid.Cid]int
	heads    map[cid.Cid]struct{}
	getActor func(core.Principal) (core.ActorID, bool) // TODO(burdiyan): ugly workaround.

	tree *treeOpSet

	stateMetadata *btree.Map[[]string, *mvReg[metadataValue]]
	stateBlocks   map[string]*mvReg[blob.Block] // blockID -> opid -> block state.

	clock        *cclock.Clock
	actorsIntern map[core.PrincipalUnsafeString]core.PrincipalUnsafeString
	vectorClock  map[core.PrincipalUnsafeString]time.Time
}

type metadataValue struct {
	Key   []string
	Value any
}

func newCRDT(id blob.IRI, clock *cclock.Clock) *docCRDT {
	e := &docCRDT{
		id:            id,
		applied:       make(map[cid.Cid]int),
		heads:         make(map[cid.Cid]struct{}),
		tree:          newTreeOpSet(),
		stateMetadata: btree.New[[]string, *mvReg[metadataValue]](8, slices.Compare),
		stateBlocks:   make(map[string]*mvReg[blob.Block]),
		clock:         cclock.New(),
		actorsIntern:  make(map[core.PrincipalUnsafeString]core.PrincipalUnsafeString),
		vectorClock:   make(map[core.PrincipalUnsafeString]time.Time),
	}
	e.clock = clock
	return e
}

func (e *docCRDT) GetMetadata() map[string]any {
	out := make(map[string]any, e.stateMetadata.Len())

	type attribute struct {
		ID    opID
		Key   []string
		Value any
	}
	var attributes []attribute
	for _, v := range e.stateMetadata.Items() {
		id, vv, ok := v.GetLatestWithID()
		if !ok || vv.Value == nil {
			continue
		}
		attributes = append(attributes, attribute{ID: id, Key: vv.Key, Value: vv.Value})
	}

	slices.SortFunc(attributes, func(a, b attribute) int {
		return a.ID.Compare(b.ID)
	})
	for _, attribute := range attributes {
		attrkey.Set(out, attribute.Key, attribute.Value)
	}

	return out
}

func (e *docCRDT) setMetadata(id opID, key []string, value any) {
	exactKey := slices.Clone(key)
	if reg := e.stateMetadata.GetMaybe(exactKey); reg != nil {
		currentID, _, ok := reg.GetLatestWithID()
		if ok && currentID.Compare(id) >= 0 {
			return
		}
	}

	// Ancestor and descendant paths are mutually exclusive registers. Resolve
	// them with the same total order as exact-key updates so replay order cannot
	// resurrect a value that a later structural replacement removed.
	var remove [][]string
	for otherKey, reg := range e.stateMetadata.Items() {
		if slices.Equal(otherKey, exactKey) {
			continue
		}

		otherIsAncestor := len(otherKey) < len(exactKey) && slices.Equal(otherKey, exactKey[:len(otherKey)])
		otherIsDescendant := len(exactKey) < len(otherKey) && slices.Equal(exactKey, otherKey[:len(exactKey)])
		if !otherIsAncestor && !otherIsDescendant {
			continue
		}

		otherID, _, ok := reg.GetLatestWithID()
		if !ok {
			continue
		}

		order := otherID.Compare(id)
		if order > 0 || order == 0 && otherIsDescendant {
			return
		}
		remove = append(remove, otherKey)
	}

	for _, otherKey := range remove {
		e.stateMetadata.Delete(otherKey)
	}

	reg := e.stateMetadata.GetMaybe(exactKey)
	if reg == nil {
		reg = newMVReg[metadataValue]()
		e.stateMetadata.Set(exactKey, reg)
	}
	reg.Set(id, metadataValue{Key: slices.Clone(key), Value: value})
}

// Heads returns the map of head changes.
// This must be read only. Not safe for concurrency.
func (e *docCRDT) Heads() map[cid.Cid]struct{} {
	return e.heads
}

type Version string

func NewVersion(cids ...cid.Cid) Version {
	if len(cids) == 0 {
		return ""
	}

	out := make([]string, 0, len(cids))
	for _, k := range cids {
		out = append(out, k.String())
	}
	sort.Strings(out)

	return Version(strings.Join(out, "."))
}

func (v Version) String() string { return string(v) }

func (v Version) Parse() ([]cid.Cid, error) {
	if v == "" {
		return nil, nil
	}

	parts := strings.Split(string(v), ".")
	out := make([]cid.Cid, len(parts))

	for i, p := range parts {
		c, err := cid.Decode(p)
		if err != nil {
			return nil, fmt.Errorf("failed to parse version: %w", err)
		}
		out[i] = c
	}

	return out, nil
}

func (e *docCRDT) Version() Version {
	if len(e.heads) == 0 {
		return ""
	}

	return NewVersion(maps.Keys(e.heads)...)
}

// BFTDeps returns a single-use iterator that does breadth-first traversal of the Change DAG deps.
func (e *docCRDT) BFTDeps(start []cid.Cid) (iter.Seq2[cid.Cid, *blob.Change], error) {
	visited := make(map[int]struct{}, len(e.cids))
	queue := make([]int, 0, len(e.cids))
	var scratch []int

	enqueueNodes := func(nodes []int) {
		scratch = append(scratch[:0], nodes...)
		slices.SortFunc(scratch, func(i, j int) int {
			a, b := e.changes[i], e.changes[j]

			if a.Ts.Before(b.Ts) {
				return -1
			}

			if a.Ts.After(b.Ts) {
				return +1
			}

			if a.Depth < b.Depth {
				return -1
			}

			if a.Depth > b.Depth {
				return +1
			}

			return cmp.Compare(e.cids[i].KeyString(), e.cids[j].KeyString())
		})
		queue = append(queue, scratch...)
	}

	for _, h := range start {
		hh, ok := e.applied[h]
		if !ok {
			return nil, fmt.Errorf("start node '%s' not found", h)
		}
		scratch = append(scratch, hh)
	}
	enqueueNodes(scratch)

	return func(yield func(cid.Cid, *blob.Change) bool) {
		var i int
		for len(queue) > 0 {
			c := queue[0]
			queue = queue[1:]
			if _, ok := visited[c]; ok {
				continue
			}
			visited[c] = struct{}{}

			enqueueNodes(e.deps[c])
			if !yield(e.cids[c], e.changes[c]) {
				break
			}

			i++
		}
	}, nil
}

func (e *docCRDT) ApplyChange(c cid.Cid, ch *blob.Change) error {
	if _, ok := e.applied[c]; ok {
		return nil
	}

	if len(e.applied) == 0 {
		if ch.Genesis.Defined() || ch.Depth != 0 || len(ch.Deps) != 0 {
			return fmt.Errorf("first change must be a valid genesis")
		}
	} else {
		genesis := e.cids[0]
		if !genesis.Equals(ch.Genesis) {
			return fmt.Errorf("change '%s' has a different genesis: expected=%s actual=%s", c, genesis, ch.Genesis)
		}
	}

	var actor core.PrincipalUnsafeString
	{
		au := ch.Signer.UnsafeString()
		a, ok := e.actorsIntern[au]
		if !ok {
			e.actorsIntern[au] = au
			a = au
		}
		actor = a
	}

	if tracked := e.vectorClock[actor]; ch.Ts.Before(tracked) {
		return fmt.Errorf("applying change '%s' violates causal order: incoming=%s tracked=%s", c, ch.Ts, tracked)
	}

	e.vectorClock[actor] = ch.Ts

	// TODO(hm24): is this check necessary?
	// if ch.Ts < int64(e.maxClock.Max()) {
	// 	return fmt.Errorf("applying change '%s' out of causal order", c)
	// }

	deps := make([]int, len(ch.Deps))

	for i, dep := range ch.Deps {
		depIdx, ok := e.applied[dep]
		if !ok {
			return fmt.Errorf("missing dependency %s of change %s", dep, c)
		}

		if !ch.Ts.After(e.changes[depIdx].Ts) {
			return fmt.Errorf("ts of change %s must be greater than ts of its dependency %s", c, dep)
		}

		if ch.Depth <= e.changes[depIdx].Depth {
			return fmt.Errorf("depth of change %s must be greater than depth of its dependency %s", c, dep)
		}

		deps[i] = depIdx
	}

	if err := e.clock.Track(ch.Ts); err != nil {
		return err
	}

	ts := ch.Ts.UnixMilli()

	actorID, ok := e.getActor(ch.Signer)
	if !ok {
		panic("BUG: actor wasn't derived when applying change")
	}

	if ts != math.MaxInt64 && ts >= maxTs {
		return fmt.Errorf("change %s: timestamp %d overflows the maximum op ID timestamp %d", c, ts, maxTs)
	}

	// A change carrying enough ops can push the op ID index past maxIdx (the
	// index advances quadratically within multi-block ops — see below). newOpID
	// panics on such values because today's write path can never produce them,
	// but changes arriving from the network can — huge imported documents from
	// older writers exist in the wild — and applying those must fail with an
	// error instead of crashing the process.
	checkedOpID := func(i int) (opID, error) {
		if i > maxIdx {
			return opID{}, fmt.Errorf("change %s: op ID index %d overflows the maximum %d", c, i, maxIdx)
		}
		return newOpID(ts, actorID, i), nil
	}

	// The multi-block ops below advance idx by i, not by 1, so a single op
	// carrying n blocks consumes about n²/2 index values. That is wire-visible
	// behaviour, not an off-by-one: refs in existing changes encode the indexes
	// this numbering produced, so switching to idx++ would renumber every op ID
	// in existence and make historical refs fail to resolve ("causality
	// violation: ref op ... is not found") on documents that load today.
	// Changing it needs a versioned migration, not a one-line fix. The quadratic
	// growth is also why maxIdx is where it is — see its comment.
	idx := -1
	for op, err := range ch.Ops() {
		idx++
		if err != nil {
			return err
		}

		switch op := op.(type) {
		case blob.OpSetKey:
			key := []string{op.Key}
			opid, err := checkedOpID(idx)
			if err != nil {
				return err
			}
			e.setMetadata(opid, key, op.Value)
		case blob.OpReplaceBlock:
			blk := op.Block
			reg := e.stateBlocks[blk.ID()]
			if reg == nil {
				reg = newMVReg[blob.Block]()
				e.stateBlocks[blk.ID()] = reg
			}
			opid, err := checkedOpID(idx)
			if err != nil {
				return err
			}
			reg.Set(opid, blk)

			// We now support having detached blocks, so we need to make sure they exist in the tree.
			// TODO(burdiyan): This is very hard to reason about and all of this stuff needs to be refactored.
			if _, ok := e.tree.sublists.Get(blk.ID()); !ok {
				e.tree.sublists.Set(blk.ID(), newRGAList[string]())
				e.tree.detachedBlocks.Set(blk.ID(), blockLatestMove{detached: true})
			}
		case blob.OpMoveBlocks:
			if len(op.Blocks) == 0 {
				return fmt.Errorf("missing blocks in move op")
			}

			refID, err := decodeOpID(op.Ref)
			if err != nil {
				return fmt.Errorf("failed to decode move left origin op id: %w", err)
			}
			// TODO(burdiyan): Get rid of this self trick.
			if refID.Ts == 0 && refID.Actor == math.MaxUint64 {
				refID.Ts = ts
				refID.Actor = actorID
			}

			// Because we support detached blocks, we allow moves to refer to parents that are not previously mentioned anywhere.
			// So here we want to make sure parents mentioned in the move operation have their sublists created, to avoid "missing parent" errors.
			// This is a bit of a hack, but other than that should be harmless.
			if _, ok := e.tree.sublists.Get(op.Parent); !ok {
				e.tree.sublists.Set(op.Parent, newRGAList[string]())
				e.tree.detachedBlocks.Set(op.Parent, blockLatestMove{detached: true})
			}

			var lastOp opID
			for i, blk := range op.Blocks {
				idx += i
				opid, err := checkedOpID(idx)
				if err != nil {
					return err
				}
				if i > 0 {
					refID = lastOp
				}
				if err := e.tree.Integrate(opid, op.Parent, blk, refID); err != nil {
					return err
				}
				lastOp = opid
			}
		case blob.OpDeleteBlocks:
			for i, blk := range op.Blocks {
				idx += i
				opid, err := checkedOpID(idx)
				if err != nil {
					return err
				}
				if err := e.tree.Integrate(opid, TrashNodeID, blk, opID{}); err != nil {
					return err
				}
			}
		case blob.OpSetAttributes:
			if op.Block != "" {
				return fmt.Errorf("TODO: SetAttributes can only be used for document (empty block ID)")
			}

			for i, kv := range op.Attrs {
				idx += i
				opid, err := checkedOpID(idx)
				if err != nil {
					return err
				}
				e.setMetadata(opid, kv.Key, kv.Value)
			}
		default:
			return fmt.Errorf("BUG?: unhandled op type: %T", op)
		}
	}

	e.cids = append(e.cids, c)
	e.changes = append(e.changes, ch)

	e.deps = append(e.deps, nil)
	e.rdeps = append(e.rdeps, nil)
	e.heads[c] = struct{}{}
	curIdx := len(e.changes) - 1
	e.applied[c] = curIdx

	// One more pass through the deps to update the internal DAG structure,
	// and update the heads of the current version.
	// To avoid corrupting the entity state we shouldn't do this in the first loop we did.
	for i, dep := range ch.Deps {
		// If any of the deps was a head, then it's no longer the case.
		delete(e.heads, dep)

		// Keeping the DAG edges between deps in both directions.
		e.deps[curIdx] = addUnique(e.deps[curIdx], deps[i])
		e.rdeps[deps[i]] = addUnique(e.rdeps[deps[i]], curIdx)
	}

	return nil
}

// Deps returns the set of dependencies for the current heads.
// This is a bit more complex than just returning the deps of the head changes as is,
// because they may be redundant in some cases, when they have links between each other.
// This method returns the minimal set of deps by reducing the redundant edges.
//
// Given the following DAG (d, e) are the heads, while (c, b) are the direct deps,
// although only (c) needs to be returned, as b is already assumed by c.
//
//	a ← b ← c ← d
//	     ↖
//	       e
func (e *docCRDT) Deps() []cid.Cid {
	if len(e.heads) == 0 {
		return nil
	}

	// Special case when there's only one head,
	// because there's no need to do any reductions.
	if len(e.heads) == 1 {
		var head cid.Cid
		for head = range e.heads {
			break
		}

		return slices.Clone(e.changes[e.applied[head]].Deps)
	}

	// These two sets initially will contain all deps of the heads
	// but later the redundant deps will be removed from the reduced set.
	// We still need to keep the full deps in order to perform the reduction correctly.
	fullDeps := make(map[int]struct{})
	reducedDeps := make(map[int]struct{})

	for head := range e.heads {
		ihead, ok := e.applied[head]
		if !ok {
			panic("BUG: head change not applied")
		}

		for _, dep := range e.deps[ihead] {
			fullDeps[dep] = struct{}{}
			reducedDeps[dep] = struct{}{}
		}
	}

	// For each collected dep we want to traverse back to the leaves,
	// and if we find a node along the way that is already a collected dep,
	// then this current dep is redundant and doesn't need to be returned.
	var (
		stack   []int
		visited = make(map[int]struct{})
	)

	// Initialize the traversal stack with all the full deps.
	for dep := range fullDeps {
		stack = append(stack, dep)
	}

	// Then for each node in the stack traverse back to the leaves,
	// breaking early if any of the rdeps is already in the full deps set.
	for len(stack) > 0 {
		node := stack[len(stack)-1]
		stack = stack[:len(stack)-1]

		if _, ok := visited[node]; ok {
			continue
		}

		visited[node] = struct{}{}
		for _, rdep := range e.rdeps[node] {
			if _, ok := visited[rdep]; !ok {
				stack = append(stack, rdep)
			}

			if _, ok := fullDeps[rdep]; ok {
				delete(reducedDeps, node)
				break
			}
		}
	}

	out := make([]cid.Cid, 0, len(reducedDeps))
	for dep := range reducedDeps {
		out = append(out, e.cids[dep])
	}

	return out
}

func addUnique(in []int, v int) []int {
	// Slice in is very small most of the time,
	// and is assumed to be sorted.
	// Our assumption here is that linear search would be faster than binary search,
	// because most changes have only a few dependencies.
	var targetIndex int
	for i, x := range in {
		if x == v {
			return in
		}

		if x > v {
			targetIndex = i
			break
		}
	}

	return slices.Insert(in, targetIndex, v)
}

// prepareChange to be applied later.
func (e *docCRDT) prepareChange(ts time.Time, signer core.Signer, body blob.ChangeBody) (hb blob.Encoded[*blob.Change], err error) {
	var genesis cid.Cid
	if len(e.cids) > 0 {
		genesis = e.cids[0]
	}

	var depth int

	deps := maps.Keys(e.heads)
	// Ensure we don't use empty non-nil slice, which would leak into the encoded format.
	if len(deps) == 0 {
		deps = nil
	} else {
		for _, dep := range deps {
			depth = max(depth, e.changes[e.applied[dep]].Depth)
		}
		depth++
	}
	slices.SortFunc(deps, func(a, b cid.Cid) int { return strings.Compare(a.KeyString(), b.KeyString()) })

	hb, err = blob.NewChange(signer, genesis, deps, depth, body, ts)
	if err != nil {
		return hb, err
	}

	return hb, nil
}

// SortCIDs sorts the multiple CIDs when determinism is needed.
// The sorting is done in place, and the same slice is returned for convenience.
func SortCIDs(cids []cid.Cid) []cid.Cid {
	slices.SortFunc(cids, func(a, b cid.Cid) int { return strings.Compare(a.KeyString(), b.KeyString()) })
	return cids
}

// NewUnforgeableID creates a new random ID that is verifiable with the author's public key.
// It return the ID and the nonce. The nonce argument can be nil in which case a new nonce will be created.
// Otherwise the same nonce will be returned.
func NewUnforgeableID(prefix string, author core.Principal, nonce []byte, ts int64) (string, []byte) {
	const hashSize = 22

	if nonce == nil {
		nonce = make([]byte, 16)
		_, err := rand.Read(nonce)
		if err != nil {
			panic(err)
		}
	}

	h := sha256.New()
	if _, err := h.Write(author); err != nil {
		panic(err)
	}
	if _, err := h.Write(nonce); err != nil {
		panic(err)
	}

	var buf [8]byte
	binary.BigEndian.PutUint64(buf[:], uint64(ts))

	if _, err := h.Write(buf[:]); err != nil {
		panic(err)
	}

	dig := h.Sum(nil)
	base, err := multibase.Encode(multibase.Base58BTC, dig)
	if err != nil {
		panic(err)
	}

	// Using last [hashSize] characters to avoid multibase prefix,
	// and reduce the size of the resulting ID.
	// We don't use full hash digest here, to make our IDs shorter.
	// But it should have enough collision resistance for our purpose.
	return prefix + base[len(base)-hashSize:], nonce
}
