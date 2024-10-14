package docmodel

import (
	"cmp"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"iter"
	"seed/backend/blob"
	"seed/backend/core"
	"seed/backend/util/cclock"
	"sort"
	"strings"
	"time"

	"github.com/ipfs/go-cid"
	"github.com/multiformats/go-multibase"
	"golang.org/x/exp/maps"
	"golang.org/x/exp/slices"
)

type opID struct {
	Ts     int64
	Origin string
	Idx    int
}

func (o opID) String() string {
	var out []byte
	out = binary.BigEndian.AppendUint64(out, uint64(o.Ts))
	out = binary.BigEndian.AppendUint32(out, uint32(o.Idx))
	out = append(out, o.Origin...)

	return hex.EncodeToString(out)
}

func decodeOpID(s string) (opID, error) {
	in, err := hex.DecodeString(s)
	if err != nil {
		return opID{}, err
	}

	var out opID
	out.Ts = int64(binary.BigEndian.Uint64(in[:8]))
	out.Idx = int(binary.BigEndian.Uint32(in[8:12]))
	out.Origin = string(in[12:])

	return out, nil
}

func newOpID(ts int64, origin string, idx int) opID {
	return opID{
		Ts:     ts,
		Origin: origin,
		Idx:    idx,
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

	return cmp.Compare(o.Origin, oo.Origin)
}

func (op opID) Encode() EncodedOpID {
	const (
		maxTimestamp = 1<<48 - 1
		maxIdx       = 1<<24 - 1
	)

	if op.Ts >= maxTimestamp {
		panic("BUG: operation timestamp is too large")
	}

	if op.Idx >= maxIdx {
		panic("BUG: operation index is too large")
	}

	var e EncodedOpID

	e[0] = byte(op.Ts >> 40)
	e[1] = byte(op.Ts >> 32)
	e[2] = byte(op.Ts >> 24)
	e[3] = byte(op.Ts >> 16)
	e[4] = byte(op.Ts >> 8)
	e[5] = byte(op.Ts)

	e[6] = byte(op.Idx >> 16)
	e[7] = byte(op.Idx >> 8)
	e[8] = byte(op.Idx)

	copy(e[9:], op.Origin)
	return e
}

// EncodedOpID is a CRDT Op ID that is compactly encoded in the following way:
// - 6 bytes (48 bits): timestamp. Enough precision to track Unix millisecond timestamps for thousands for years.
// - 3 bytes (24 bits): index/offset of the operation within the same Change/Transaction.
// - 6 bytes (48 bits): origin/replica/actor. Random 48-bit value of a replica that generated the operation.
// The timestamp and index are big-endian, to support lexicographic ordering of the IDs.
// This has some limitations:
// 1. Maximum number of operations in a single change is 16777215.
// 2. Same actor must not generate Changes/Transactions within the same millisecond.
// 3. The clocks on the devices generating the operations must be roughly syncronized to avoid inter-device conflicts in timestamps.
type EncodedOpID [15]byte

type docCRDT struct {
	id      blob.IRI
	cids    []cid.Cid
	changes []*blob.Change
	deps    [][]int // deps for each change.
	rdeps   [][]int // reverse deps for each change.
	applied map[cid.Cid]int
	heads   map[cid.Cid]struct{}

	tree *treeOpSet

	stateMetadata map[string]*mvReg[string]
	stateBlocks   map[string]*mvReg[blob.Block] // blockID -> opid -> block state.

	clock        *cclock.Clock
	actorsIntern map[string]string
	vectorClock  map[string]time.Time
}

func newCRDT(id blob.IRI, clock *cclock.Clock) *docCRDT {
	e := &docCRDT{
		id:            id,
		applied:       make(map[cid.Cid]int),
		heads:         make(map[cid.Cid]struct{}),
		tree:          newTreeOpSet(),
		stateMetadata: make(map[string]*mvReg[string]),
		stateBlocks:   make(map[string]*mvReg[blob.Block]),
		clock:         cclock.New(),
		actorsIntern:  make(map[string]string),
		vectorClock:   make(map[string]time.Time),
	}
	e.clock = clock
	return e
}

func (e *docCRDT) GetMetadata() map[string]string {
	out := make(map[string]string, len(e.stateMetadata))

	for k, v := range e.stateMetadata {
		vv, ok := v.GetLatestOK()
		if ok {
			out[k] = vv
		}
	}

	return out
}

// Heads returns the map of head changes.
// This must be read only. Not safe for concurrency.
func (e *docCRDT) Heads() map[cid.Cid]struct{} {
	return e.heads
}

// Checkout returns an entity with the state filtered up to the given heads.
// If no heads are given it returns the same instance of the Entity.
// If heads given are the same as the current heads, the same instance is returned as well.
func (e *docCRDT) Checkout(heads []cid.Cid) (*docCRDT, error) {
	if len(heads) == 0 {
		return e, nil
	}

	{
		curVer := NewVersion(maps.Keys(e.heads)...)
		wantVer := NewVersion(heads...)

		if curVer == wantVer {
			return e, nil
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
		for _, dep := range e.deps[c] {
			queue = append(queue, dep)
		}
	}
	slices.Reverse(chain)

	clock := cclock.New()
	entity := newCRDT(e.id, clock)

	for _, c := range chain {
		if err := entity.ApplyChange(e.cids[c], e.changes[c]); err != nil {
			return nil, err
		}
	}

	return entity, nil
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
func (e *docCRDT) BFTDeps(start []cid.Cid) (iter.Seq2[int, blob.ChangeRecord], error) {
	visited := make(map[int]struct{}, len(e.cids))
	queue := make([]int, 0, len(e.cids))
	var scratch []int

	enqueueNodes := func(nodes []int) {
		scratch = append(scratch[:0], nodes...)
		slices.SortFunc(scratch, func(i, j int) int {
			if e.changes[i].Ts == e.changes[j].Ts {
				return cmp.Compare(e.cids[i].KeyString(), e.cids[j].KeyString())
			}
			return cmp.Compare(e.changes[i].Ts.UnixNano(), e.changes[j].Ts.UnixNano())
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

	return func(yield func(int, blob.ChangeRecord) bool) {
		var i int
		for len(queue) > 0 {
			c := queue[0]
			queue = queue[1:]
			if _, ok := visited[c]; ok {
				continue
			}
			visited[c] = struct{}{}

			enqueueNodes(e.deps[c])
			if !yield(i, blob.ChangeRecord{
				CID:  e.cids[c],
				Data: e.changes[c],
			}) {
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

	var actor string
	{
		au := ch.Author.UnsafeString()
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

		deps[i] = depIdx
	}

	if err := e.clock.Track(ch.Ts); err != nil {
		return err
	}

	ts := ch.Ts.UnixMicro()
	origin := originFromCID(c)

	for idx, op := range ch.Ops {
		opid := newOpID(ts, origin, idx)
		switch op.Op {
		case blob.OpSetMetadata:
			for k, v := range op.Data {
				reg := e.stateMetadata[k]
				if reg == nil {
					reg = newMVReg[string]()
					e.stateMetadata[k] = reg
				}
				reg.Set(opid, v.(string))
			}
		case blob.OpReplaceBlock:
			var blk blob.Block
			blob.MapToCBOR(op.Data, &blk)

			reg := e.stateBlocks[blk.ID]
			if reg == nil {
				reg = newMVReg[blob.Block]()
				e.stateBlocks[blk.ID] = reg
			}
			reg.Set(opid, blk)
		case blob.OpMoveBlock:
			block, ok := op.Data["block"].(string)
			if !ok || block == "" {
				return fmt.Errorf("missing block in move op")
			}

			parent, _ := op.Data["parent"].(string)

			leftOriginRaw, _ := op.Data["leftOrigin"].(string)
			refID, err := decodeOpID(leftOriginRaw)
			if err != nil {
				return fmt.Errorf("failed to decode move left origin op id: %w", err)
			}
			// TODO(burdiyan): Get rid of this self trick.
			if refID.Ts == 0 && refID.Origin == "self" {
				refID.Ts = ts
				refID.Origin = origin
			}

			if err := e.tree.Integrate(opid, parent, block, refID); err != nil {
				return err
			}
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
func (e *docCRDT) prepareChange(ts time.Time, signer core.KeyPair, ops []blob.Op) (hb blob.Encoded[*blob.Change], err error) {
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

	hb, err = blob.NewChange(signer, genesis, deps, depth, ops, ts)
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
