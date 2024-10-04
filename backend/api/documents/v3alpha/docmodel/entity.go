package docmodel

import (
	"cmp"
	"crypto/rand"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"iter"
	"seed/backend/blob"
	"seed/backend/core"
	"seed/backend/crdt2"
	"seed/backend/hlc"
	"sort"
	"strings"

	"github.com/ipfs/go-cid"
	"github.com/multiformats/go-multibase"
	"golang.org/x/exp/maps"
	"golang.org/x/exp/slices"
)

// Entity is our CRDT mutable object.
type Entity struct {
	id           blob.IRI
	cids         []cid.Cid
	changes      []*blob.Change
	deps         [][]int // deps for each change.
	rdeps        [][]int // reverse deps for each change.
	applied      map[cid.Cid]int
	heads        map[cid.Cid]struct{}
	state        *crdt2.Map
	maxClock     *hlc.Clock
	actorsIntern map[string]string
	vectorClock  map[string]int64
}

// NewEntity creates a new entity with a given ID.
func NewEntity(id blob.IRI) *Entity {
	return &Entity{
		id:           id,
		applied:      make(map[cid.Cid]int),
		heads:        make(map[cid.Cid]struct{}),
		state:        crdt2.NewMap(),
		maxClock:     hlc.NewClock(),
		actorsIntern: make(map[string]string),
		vectorClock:  make(map[string]int64),
	}
}

// NewEntityWithClock creates a new entity with a provided clock.
func NewEntityWithClock(id blob.IRI, clock *hlc.Clock) *Entity {
	e := NewEntity(id)
	e.maxClock = clock
	return e
}

// ID returns the ID of the entity.
func (e *Entity) ID() blob.IRI { return e.id }

// Get a property under a given path.
func (e *Entity) Get(path ...string) (value any, ok bool) {
	return e.state.Get(path...)
}

// LastChangeTime is max time tracked in the HLC.
func (e *Entity) LastChangeTime() hlc.Timestamp {
	return e.maxClock.Max()
}

func (e *Entity) State() *crdt2.Map {
	return e.state
}

// Heads returns the map of head changes.
// This must be read only. Not safe for concurrency.
func (e *Entity) Heads() map[cid.Cid]struct{} {
	return e.heads
}

// NumChanges returns the number of changes applied to the entity.
func (e *Entity) NumChanges() int {
	return len(e.cids)
}

// Checkout returns an entity with the state filtered up to the given heads.
// If no heads are given it returns the same instance of the Entity.
// If heads given are the same as the current heads, the same instance is returned as well.
func (e *Entity) Checkout(heads []cid.Cid) (*Entity, error) {
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

	clock := hlc.NewClock()
	entity := NewEntityWithClock(e.id, clock)

	for _, c := range chain {
		if err := entity.ApplyChange(blob.ChangeRecord{
			CID:  e.cids[c],
			Data: e.changes[c],
		}); err != nil {
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

func (e *Entity) Version() Version {
	if len(e.heads) == 0 {
		return ""
	}

	return NewVersion(maps.Keys(e.heads)...)
}

// BFTDeps returns a single-use iterator that does breadth-first traversal of the Change DAG deps.
func (e *Entity) BFTDeps(start []cid.Cid) (iter.Seq2[int, blob.ChangeRecord], error) {
	visited := make(map[int]struct{}, len(e.cids))
	queue := make([]int, 0, len(e.cids))
	var scratch []int

	enqueueNodes := func(nodes []int) {
		scratch = append(scratch[:0], nodes...)
		slices.SortFunc(scratch, func(i, j int) int {
			if e.changes[i].Ts == e.changes[j].Ts {
				return cmp.Compare(e.cids[i].KeyString(), e.cids[j].KeyString())
			}
			return cmp.Compare(e.changes[i].Ts, e.changes[j].Ts)
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

// ApplyChange to the internal state.
func (e *Entity) ApplyChange(rec blob.ChangeRecord) error {
	if _, ok := e.applied[rec.CID]; ok {
		return nil
	}

	var actor string
	{
		au := rec.Data.Author.UnsafeString()
		a, ok := e.actorsIntern[au]
		if !ok {
			e.actorsIntern[au] = au
			a = au
		}
		actor = a
	}

	if rec.Data.Ts < e.vectorClock[actor] {
		return fmt.Errorf("applying change '%s' violates causal order", rec.CID)
	}

	e.vectorClock[actor] = rec.Data.Ts

	// TODO(hm24): is this check necessary?
	// if ch.Ts < int64(e.maxClock.Max()) {
	// 	return fmt.Errorf("applying change '%s' out of causal order", c)
	// }

	deps := make([]int, len(rec.Data.Deps))

	for i, dep := range rec.Data.Deps {
		depIdx, ok := e.applied[dep]
		if !ok {
			return fmt.Errorf("missing dependency %s of change %s", dep, rec.CID)
		}

		deps[i] = depIdx
	}

	if err := e.maxClock.Track(hlc.Timestamp(rec.Data.Ts)); err != nil {
		return err
	}

	e.state.ApplyPatch(int64(rec.Data.Ts), OriginFromCID(rec.CID), rec.Data.Payload)

	e.cids = append(e.cids, rec.CID)
	e.changes = append(e.changes, rec.Data)

	e.deps = append(e.deps, nil)
	e.rdeps = append(e.rdeps, nil)
	e.heads[rec.CID] = struct{}{}
	curIdx := len(e.changes) - 1
	e.applied[rec.CID] = curIdx

	// One more pass through the deps to update the internal DAG structure,
	// and update the heads of the current version.
	// To avoid corrupting the entity state we shouldn't do this in the first loop we did.
	for i, dep := range rec.Data.Deps {
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
func (e *Entity) Deps() []cid.Cid {
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

// OriginFromCID creates a CRDT origin from the last 8 chars of the hash.
// Most of the time it's not needed, because HLC is very unlikely to collide.
func OriginFromCID(c cid.Cid) string {
	if !c.Defined() {
		return ""
	}

	str, err := c.StringOfBase(multibase.Base58BTC)
	if err != nil {
		panic(err)
	}
	return str[len(str)-9:]
}

// NextTimestamp returns the next timestamp from the HLC.
func (e *Entity) NextTimestamp() hlc.Timestamp {
	return e.maxClock.MustNow()
}

// CreateChange entity creating a change blob, and applying it to the internal state.
func (e *Entity) CreateChange(action string, ts hlc.Timestamp, signer core.KeyPair, payload map[string]any) (hb blob.Encoded[*blob.Change], err error) {
	hb, err = blob.NewChange(signer, maps.Keys(e.heads), action, payload, int64(ts))
	if err != nil {
		return hb, err
	}

	rec := blob.ChangeRecord{
		CID:  hb.CID,
		Data: hb.Decoded,
	}

	if err := e.ApplyChange(rec); err != nil {
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

func verifyUnforgeableID(id blob.IRI, prefix int, owner core.Principal, nonce []byte, ts int64) error {
	id2, _ := NewUnforgeableID(string(id[:prefix]), owner, nonce, ts)
	if id2 != string(id) {
		return fmt.Errorf("failed to verify unforgeable ID want=%q got=%q", id, id2)
	}

	return nil
}
