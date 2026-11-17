// Package keylinemem implements in-memory storage for Keyline records.
package keylinemem

import (
	"context"
	"fmt"
	"iter"
	"math"
	"slices"
	"sync"

	"seed/backend/keyline"

	"golang.org/x/sync/semaphore"
)

// Store is a concurrency-safe keyline.Store. Its zero value is empty.
// It retains ungrounded delegations and revocations of unknown targets so that
// replicas receiving the same facts in different orders make the same decisions.
// A View holds a read lock: writers wait until its callback returns, so calling
// Apply from inside a View callback deadlocks.
// A Store must not be copied after first use.
type Store struct {
	once  sync.Once
	mu    *semaphore.Weighted
	facts factSet
}

// acquire uses one token per reader and all tokens per writer. Weighted queues
// waiters without spawning goroutines and prevents readers starving a writer.
func (m *Store) acquire(ctx context.Context, weight int64) error {
	m.once.Do(func() { m.mu = semaphore.NewWeighted(math.MaxInt64) })
	return m.mu.Acquire(ctx, weight)
}

// Apply validates and merges an authenticated batch atomically. It reports new
// facts or improved node provenance, not whether the batch changes authority.
// Cancellation is checked through validation and before the indivisible commit.
func (m *Store) Apply(ctx context.Context, batch keyline.Batch) (bool, error) {
	if err := m.acquire(ctx, math.MaxInt64); err != nil {
		return false, err
	}

	defer m.mu.Release(math.MaxInt64)

	return m.applyLocked(ctx, batch)
}

func (m *Store) applyLocked(ctx context.Context, batch keyline.Batch) (bool, error) {
	// Stage only changed records, not a copy of the store. Nothing is published until
	// every record has passed validation and both existing and batch-local checks.
	pending := factSet{
		nodes:       make(map[keyline.Node]keyline.NodeRecord, len(batch.Nodes)),
		delegations: make(map[keyline.ID]keyline.Delegation, len(batch.Delegations)),
		revocations: make(map[keyline.ID]keyline.Revocation, len(batch.Revocations)),
	}
	for _, n := range batch.Nodes {
		if err := ctx.Err(); err != nil {
			return false, err
		}

		if err := n.Validate(); err != nil {
			return false, err
		}

		existing, ok := pending.nodes[n.ID]
		if !ok {
			existing, ok = m.facts.nodes[n.ID]
		}

		if ok {
			if existing.BlobKey == n.BlobKey && existing != n {
				return false, fmt.Errorf("%w: node %q", keyline.ErrConflict, n.ID)
			}

			if n.Timestamp > existing.Timestamp || (n.Timestamp == existing.Timestamp && n.BlobKey >= existing.BlobKey) {
				continue
			}
		}

		pending.nodes[n.ID] = n
	}

	for _, d := range batch.Delegations {
		if err := ctx.Err(); err != nil {
			return false, err
		}

		if err := d.Validate(); err != nil {
			return false, err
		}

		if _, ok := m.facts.revocations[d.ID]; ok {
			return false, fmt.Errorf("%w: ID %q already identifies a revocation", keyline.ErrConflict, d.ID)
		}

		existing, ok := m.facts.delegations[d.ID]
		if !ok {
			existing, ok = pending.delegations[d.ID]
		}

		if ok {
			if existing != d {
				return false, fmt.Errorf("%w: delegation %q", keyline.ErrConflict, d.ID)
			}

			continue
		}

		pending.delegations[d.ID] = d
	}

	for _, r := range batch.Revocations {
		if err := ctx.Err(); err != nil {
			return false, err
		}

		if err := r.Validate(); err != nil {
			return false, err
		}

		if _, ok := m.facts.delegations[r.ID]; ok {
			return false, fmt.Errorf("%w: ID %q already identifies a delegation", keyline.ErrConflict, r.ID)
		}

		if _, ok := pending.delegations[r.ID]; ok {
			return false, fmt.Errorf("%w: ID %q also identifies a delegation in this batch", keyline.ErrConflict, r.ID)
		}

		existing, ok := m.facts.revocations[r.ID]
		if !ok {
			existing, ok = pending.revocations[r.ID]
		}

		if ok {
			if existing != r {
				return false, fmt.Errorf("%w: revocation %q", keyline.ErrConflict, r.ID)
			}

			continue
		}

		pending.revocations[r.ID] = r
	}

	if err := ctx.Err(); err != nil {
		return false, err
	}

	if len(pending.nodes) == 0 && len(pending.delegations) == 0 && len(pending.revocations) == 0 {
		return false, nil
	}

	// Commit under the exclusive lock. There are no fallible operations or
	// cancellation checks after this point: a published batch returns success.
	if len(pending.nodes) != 0 && m.facts.nodes == nil {
		m.facts.nodes = make(map[keyline.Node]keyline.NodeRecord)
	}

	if len(pending.delegations) != 0 && m.facts.delegations == nil {
		m.facts.delegations = make(map[keyline.ID]keyline.Delegation)
		m.facts.outgoing = make(map[[2]keyline.Node][]keyline.Delegation)
		m.facts.bySubject = make(map[keyline.Node][]keyline.Delegation)
		m.facts.toAudience = make(map[[2]keyline.Node][]keyline.Delegation)
	}

	if len(pending.revocations) != 0 && m.facts.revocations == nil {
		m.facts.revocations = make(map[keyline.ID]keyline.Revocation)
		m.facts.revocationsOf = make(map[keyline.ID][]keyline.Revocation)
	}

	for id, n := range pending.nodes {
		m.facts.nodes[id] = n
	}

	for id, d := range pending.delegations {
		m.facts.delegations[id] = d
		key := [2]keyline.Node{d.Subject, d.Issuer}
		m.facts.outgoing[key] = append(m.facts.outgoing[key], d)
		m.facts.bySubject[d.Subject] = append(m.facts.bySubject[d.Subject], d)
		key = [2]keyline.Node{d.Subject, d.Audience}
		m.facts.toAudience[key] = append(m.facts.toAudience[key], d)
	}

	for id, r := range pending.revocations {
		m.facts.revocations[id] = r
		m.facts.revocationsOf[r.Target] = append(m.facts.revocationsOf[r.Target], r)
	}

	return true, nil
}

// View opens an indexed read transaction without copying the store. The callback
// must use only its keyline.ReadTx, not reenter View or write to this Store.
func (m *Store) View(ctx context.Context, fn func(keyline.ReadTx) error) error {
	if err := m.acquire(ctx, 1); err != nil {
		return err
	}

	defer m.mu.Release(1)

	if err := ctx.Err(); err != nil {
		return err
	}

	if err := fn(memoryReadTx{&m.facts}); err != nil {
		return err
	}

	return ctx.Err()
}

type memoryReadTx struct{ facts *factSet }

func (tx memoryReadTx) Node(ctx context.Context, id keyline.Node) (keyline.NodeRecord, bool, error) {
	if err := ctx.Err(); err != nil {
		return keyline.NodeRecord{}, false, err
	}

	n, ok := tx.facts.nodes[id]
	return n, ok, nil
}

func (tx memoryReadTx) Delegation(ctx context.Context, id keyline.ID) (keyline.Delegation, bool, error) {
	if err := ctx.Err(); err != nil {
		return keyline.Delegation{}, false, err
	}

	d, ok := tx.facts.delegations[id]
	return d, ok, nil
}

func (tx memoryReadTx) Revocation(ctx context.Context, id keyline.ID) (keyline.Revocation, bool, error) {
	if err := ctx.Err(); err != nil {
		return keyline.Revocation{}, false, err
	}

	r, ok := tx.facts.revocations[id]
	return r, ok, nil
}

func (tx memoryReadTx) Delegations(ctx context.Context, subject, issuer keyline.Node) iter.Seq2[keyline.Delegation, error] {
	return memoryRows(ctx, tx.facts.outgoing[[2]keyline.Node{subject, issuer}])
}

func (tx memoryReadTx) Revocations(ctx context.Context, target keyline.ID) iter.Seq2[keyline.Revocation, error] {
	return memoryRows(ctx, tx.facts.revocationsOf[target])
}

func (tx memoryReadTx) DelegationsBySubject(ctx context.Context, subject keyline.Node) iter.Seq2[keyline.Delegation, error] {
	return memoryRows(ctx, tx.facts.bySubject[subject])
}

func (tx memoryReadTx) DelegationsTo(ctx context.Context, subject, audience keyline.Node) iter.Seq2[keyline.Delegation, error] {
	return memoryRows(ctx, tx.facts.toAudience[[2]keyline.Node{subject, audience}])
}

func (tx memoryReadTx) Subjects(ctx context.Context) iter.Seq2[keyline.Node, error] {
	return memoryKeys(ctx, tx.facts.bySubject)
}

func (tx memoryReadTx) Records(ctx context.Context) iter.Seq2[keyline.Record, error] {
	return func(yield func(keyline.Record, error) bool) {
		for id, err := range memoryKeys(ctx, tx.facts.nodes) {
			if err != nil {
				yield(nil, err)
				return
			}

			if !yield(tx.facts.nodes[id], nil) {
				return
			}
		}

		for id, err := range memoryKeys(ctx, tx.facts.delegations) {
			if err != nil {
				yield(nil, err)
				return
			}

			if !yield(tx.facts.delegations[id], nil) {
				return
			}
		}

		for id, err := range memoryKeys(ctx, tx.facts.revocations) {
			if err != nil {
				yield(nil, err)
				return
			}

			if !yield(tx.facts.revocations[id], nil) {
				return
			}
		}
	}
}

func memoryRows[T any](ctx context.Context, values []T) iter.Seq2[T, error] {
	return func(yield func(T, error) bool) {
		var zero T

		for _, value := range values {
			if err := ctx.Err(); err != nil {
				yield(zero, err)
				return
			}

			if !yield(value, nil) {
				return
			}
		}

		if err := ctx.Err(); err != nil {
			yield(zero, err)
		}
	}
}

// memoryKeys sorts only the requested enumeration's keys, when consumed. Scoped
// delegation reads use their indexes directly and never collect global keys.
func memoryKeys[K ~string, V any](ctx context.Context, values map[K]V) iter.Seq2[K, error] {
	return func(yield func(K, error) bool) {
		if err := ctx.Err(); err != nil {
			yield("", err)
			return
		}

		keys := make([]K, 0, len(values))
		for key := range values {
			if err := ctx.Err(); err != nil {
				yield("", err)
				return
			}

			keys = append(keys, key)
		}

		slices.Sort(keys)
		memoryRows(ctx, keys)(yield)
	}
}

// factSet holds node mentions, immutable facts, and read indexes.
type factSet struct {
	nodes         map[keyline.Node]keyline.NodeRecord
	delegations   map[keyline.ID]keyline.Delegation
	revocations   map[keyline.ID]keyline.Revocation
	outgoing      map[[2]keyline.Node][]keyline.Delegation
	bySubject     map[keyline.Node][]keyline.Delegation
	toAudience    map[[2]keyline.Node][]keyline.Delegation
	revocationsOf map[keyline.ID][]keyline.Revocation
}
