package keyline

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"fmt"
	"io"
	"iter"
)

// Closure enumerates the facts needed to replicate authority over subject from
// this transaction. It includes all delegations about positively reachable nodes,
// even ungrounded or revoked ones, and every revocation naming those delegations.
// Available earliest-known mentions of subject and referenced nodes are included.
// It never scans unrelated subjects. It does not authenticate a recipient or
// decide whether they may receive these records.
//
// Consume the iterator inside tx's lifetime. Ordering is unspecified. An error
// or an early break leaves an incomplete closure, which must not be treated as
// a complete authorization view. Collect can buffer a successful stream for one
// atomic Apply. The closure describes the sender's known set, not proof that no
// other peer has additional facts. New facts can enlarge it, so replicas must
// continue synchronizing. Blob IDs remain local to the exporting store.
func Closure(ctx context.Context, tx ReadTx, subject Node) iter.Seq2[Record, error] {
	return (Evaluator{}).Closure(ctx, tx, subject)
}

// Closure enumerates a subject's replication closure with e's optional budgets.
func (e Evaluator) Closure(ctx context.Context, tx ReadTx, subject Node) iter.Seq2[Record, error] {
	return func(yield func(Record, error) bool) {
		g, err := newGraph(tx, e)
		if err != nil {
			yield(nil, err)
			return
		}

		if err := ctx.Err(); err != nil {
			yield(nil, err)
			return
		}

		if subject == "" {
			return
		}

		positive, err := g.search(ctx, []Node{subject}, nil, nil, nil)
		if err != nil {
			yield(nil, err)
			return
		}

		subjects := positive[subject]
		// Discovery caches grounded edges; export also needs ungrounded edges.
		// Release those caches before streaming from the subject indexes.
		g.outgoing, g.delegations = nil, nil
		nodes := map[Node]bool{subject: true}
		for scope := range subjects {
			targets := make(map[ID]bool)
			for d, err := range tx.DelegationsBySubject(ctx, scope) {
				if err == nil {
					err = g.record(ctx, d)
				}

				if err != nil {
					yield(nil, err)
					return
				}

				if targets[d.ID] {
					continue
				}

				targets[d.ID] = true

				nodes[d.Issuer], nodes[d.Audience], nodes[d.Subject] = true, true, true
				if !yield(d, nil) {
					return
				}
			}

			// Finish the delegation cursor before opening a revocation cursor on
			// the same transaction. Only IDs, not whole records, are buffered.
			for target := range targets {
				seen := make(map[ID]bool)
				for r, err := range tx.Revocations(ctx, target) {
					if err == nil {
						err = g.record(ctx, r)
					}

					if err != nil {
						yield(nil, err)
						return
					}

					if seen[r.ID] {
						continue
					}

					seen[r.ID] = true

					nodes[r.Issuer] = true
					if !yield(r, nil) {
						return
					}
				}
			}
		}

		for node := range nodes {
			n, found, err := tx.Node(ctx, node)
			if err == nil && found {
				err = g.record(ctx, n)
			}

			if err != nil {
				yield(nil, err)
				return
			}

			if found && !yield(n, nil) {
				return
			}
		}

		if err := ctx.Err(); err != nil {
			yield(nil, err)
		}
	}
}

// Collect buffers a record stream as an ingestible batch. On any error it
// discards the partial result. To transfer between databases, callers must
// resolve or replace local BlobIDs before applying the batch to the receiver.
func Collect(records iter.Seq2[Record, error]) (Batch, error) {
	var batch Batch

	for record, err := range records {
		if err != nil {
			return Batch{}, err
		}

		switch r := record.(type) {
		case NodeRecord:
			batch.Nodes = append(batch.Nodes, r)
		case Delegation:
			batch.Delegations = append(batch.Delegations, r)
		case Revocation:
			batch.Revocations = append(batch.Revocations, r)
		default:
			return Batch{}, fmt.Errorf("keyline: unexpected record type %T", record)
		}
	}

	return batch, nil
}

// Digest fingerprints the delegation/revocation set, independent of insertion
// order, BlobIDs, and optional node metadata. Unlike upstream's
// content-addressed IDs, our IDs are opaque, so the digest covers both identity
// and semantic fields. This is a comparison fingerprint, not a wire encoding,
// authorization proof, or proof that the replica has every relevant revocation.
func Digest(ctx context.Context, tx ReadTx) ([sha256.Size]byte, error) {
	return (Evaluator{}).Digest(ctx, tx)
}

// Digest fingerprints the fact set with e's optional resource budgets.
func (e Evaluator) Digest(ctx context.Context, tx ReadTx) ([sha256.Size]byte, error) {
	g, err := newGraph(tx, e)
	if err != nil {
		return [sha256.Size]byte{}, err
	}

	h := sha256.New()
	_, _ = io.WriteString(h, "keyline-authority-set-v1\x00")
	write := func(fields ...string) {
		var size [binary.MaxVarintLen64]byte

		for _, field := range fields {
			n := binary.PutUvarint(size[:], uint64(len(field)))
			_, _ = h.Write(size[:n])
			_, _ = io.WriteString(h, field)
		}
	}
	// Records provides canonical ordering without materializing a database's
	// complete fact set. Length framing preserves arbitrary identifier bytes.
	for record, err := range tx.Records(ctx) {
		if err == nil {
			err = g.record(ctx, record)
		}

		if err != nil {
			return [sha256.Size]byte{}, err
		}

		switch r := record.(type) {
		case Delegation:
			_, _ = h.Write([]byte{1, byte(r.Power)})
			write(string(r.ID), string(r.Issuer), string(r.Audience), string(r.Subject))
		case Revocation:
			_, _ = h.Write([]byte{2})
			write(string(r.ID), string(r.Issuer), string(r.Target))
		}
	}

	if err := ctx.Err(); err != nil {
		return [sha256.Size]byte{}, err
	}

	return [sha256.Size]byte(h.Sum(nil)), nil
}

func (g *graph) record(ctx context.Context, record Record) error {
	switch r := record.(type) {
	case NodeRecord:
		return g.fact(ctx, string(r.ID), r.BlobKey)
	case Delegation:
		return g.fact(ctx, string(r.ID), string(r.Issuer), string(r.Audience), string(r.Subject))
	case Revocation:
		return g.fact(ctx, string(r.ID), string(r.Issuer), string(r.Target))
	default:
		return fmt.Errorf("keyline: unexpected record type %T", record)
	}
}
