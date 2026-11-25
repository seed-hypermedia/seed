// Package keyline evaluates authority from an unordered set of delegations and
// revocations. Identities are opaque graph nodes; authentication, wire formats,
// resource naming, and mapping application actions to powers belong to callers.
//
// Each node has Admin over itself. A resource need not have a key: its trusted
// creation record can establish a root delegation from the resource node to its
// owner. Callers must authenticate those root facts just like other delegations.
// Membership composes: authority over a node conveys that node's authority over
// other subjects, attenuated by both powers.
//
// This is a Go adaptation of Ink & Switch's Keyline evaluation program at
// https://github.com/inkandswitch/keyhive, at the commit pinned in UPSTREAM,
// licensed under Apache-2.0. It uses abstract facts in place of the original
// certificates, signatures, and cryptographic identifiers, and evaluates them
// through a ReadTx that can wrap a caller-owned transaction.
package keyline

import (
	"context"
	"errors"
	"fmt"
	"iter"
	"maps"
)

// Node identifies a principal, resource, or role in one shared graph namespace.
// Nodes are compared exactly and have no required encoding or cryptographic form.
type Node string

// NodeRecord identifies an authenticated mention of a node. Stores retain the
// minimum (Timestamp, BlobKey) among known mentions, using bytewise BlobKey order.
// Callers authenticate this metadata before ingestion. References in authority
// facts alone do not create a record, and evaluation does not require records.
type NodeRecord struct {
	ID Node
	// BlobID is a positive, opaque local blob ID, not authority or an ordering key.
	BlobID int64
	// Timestamp is caller-provided and comparable across mentions. Zero and
	// negative values are valid; Seed uses signed Unix milliseconds.
	Timestamp int64
	// BlobKey is a nonempty, opaque stable blob identity, independent of BlobID.
	BlobKey string
}

// Validate checks a node record at ingestion.
func (n NodeRecord) Validate() error {
	if n.ID == "" || n.BlobID <= 0 || n.BlobKey == "" {
		return fmt.Errorf("keyline: node requires an ID, positive blob ID, and nonempty blob key")
	}

	return nil
}

// ID identifies an immutable delegation or revocation. Callers assign IDs;
// reissuing a revoked delegation requires a new ID.
type ID string

// ErrConflict indicates reuse of an immutable record ID with different contents,
// including provenance, or reuse of a fact ID across delegation and revocation.
// It also reports inconsistent timestamp or local blob ID for a node's selected
// BlobKey. Metadata for unselected mentions is not retained or checked for reuse.
var ErrConflict = errors.New("keyline: conflicting record")

// Batch is an atomic collection of authenticated records. Exact duplicates are
// idempotent; earlier node mentions improve provenance, and later ones are ignored.
// Conflicts reject the whole batch. Node IDs have their own namespace;
// delegations and revocations share a fact-ID namespace. Missing references are
// retained, so arrival order does not affect authority.
type Batch struct {
	Nodes       []NodeRecord
	Delegations []Delegation
	Revocations []Revocation
}

// Record is a NodeRecord, Delegation, or Revocation value returned by graph
// enumeration. Blob IDs identify local provenance, not transferable identities.
// Records have no prescribed wire encoding; callers authenticate and annotate
// received records before Apply.
type Record interface {
	keylineRecord()
}

func (NodeRecord) keylineRecord() {}
func (Delegation) keylineRecord() {}
func (Revocation) keylineRecord() {}

// Power is a totally ordered authority level. Each level implies lower levels,
// and the numbers order them, so powers compare as integers. The numbers are
// stored, as in keyline_edges, so they never change.
type Power uint8

// Powers follow the authority ladder Sync < Read < Write < Admin.
const (
	// None (0) represents no derivation, not a delegated power or requirement.
	None Power = 0
	// Sync (1) is the lowest level of standing.
	Sync Power = 1
	// Read (2) includes Sync authority.
	Read Power = 2
	// Write (3) includes Read authority.
	Write Power = 3
	// Admin (4) includes Write authority and grants revocation reach over the subject.
	Admin Power = 4
)

// Valid reports whether p is a delegable power: Sync, Read, Write, or Admin.
func (p Power) Valid() bool {
	return p >= Sync && p <= Admin
}

// String returns the power's name, such as "write".
func (p Power) String() string {
	switch p {
	case None:
		return "none"
	case Sync:
		return "sync"
	case Read:
		return "read"
	case Write:
		return "write"
	case Admin:
		return "admin"
	default:
		return fmt.Sprintf("Power(%d)", uint8(p))
	}
}

// Delegation grants Audience at most Power over Subject through Issuer's
// authority. An issuer needs standing, not necessarily Admin. Delegations with
// missing standing are stored and may become live when other facts arrive.
//
// A delegation with a zero BlobID is implied: the caller derives it from its
// own rules, such as how nodes are named, rather than from a signed blob.
// Evaluation treats it like any other delegation. Callers that transfer
// records by their blobs skip implied ones, which each replica derives itself.
type Delegation struct {
	ID       ID
	Issuer   Node
	Audience Node
	Subject  Node
	Power    Power
	BlobID   int64 // The opaque ID of the defining blob, or zero if implied.
}

// Implied reports whether no blob defines d.
func (d Delegation) Implied() bool {
	return d.BlobID == 0
}

// Validate checks required fields and the power at an ingestion boundary.
// It does not authenticate the fact or require the issuer to have standing.
func (d Delegation) Validate() error {
	if d.ID == "" || d.Issuer == "" || d.Audience == "" || d.Subject == "" {
		return fmt.Errorf("keyline: delegation %q requires an ID, issuer, audience, and subject", d.ID)
	}

	if !d.Power.Valid() {
		return fmt.Errorf("keyline: delegation %q has invalid power %d", d.ID, d.Power)
	}

	if d.BlobID < 0 {
		return fmt.Errorf("keyline: delegation %q has a negative blob ID", d.ID)
	}

	return nil
}

// Revocation removes authority conveyed by a delegation. Issuer and audience
// revocations are total; other revocations exclude the revoker's positive-graph
// Admin reach from the target's grounding derivations. Arrival order is irrelevant.
// Only delegation targets have an effect; naming a revocation never undoes it.
type Revocation struct {
	ID     ID
	Issuer Node
	Target ID
	BlobID int64 // The positive, opaque ID of the defining blob.
}

// Validate checks required fields at an ingestion boundary. It does not
// authenticate the revoker or require the target to exist.
func (r Revocation) Validate() error {
	if r.ID == "" || r.Issuer == "" || r.Target == "" {
		return fmt.Errorf("keyline: revocation %q requires an ID, issuer, and target", r.ID)
	}

	if r.BlobID <= 0 {
		return fmt.Errorf("keyline: revocation %q requires a positive blob ID", r.ID)
	}

	return nil
}

// Store opens consistent read transactions. View calls fn synchronously and
// releases its resources before returning, including on error or panic. It must
// propagate callback and storage errors. The ReadTx must not escape the callback.
// Implementations may use a database transaction or hold a read lock; they need
// not copy facts. Callers authenticate records before ingestion.
type Store interface {
	View(ctx context.Context, fn func(ReadTx) error) error
	// Apply merges a batch atomically, reporting new facts or improved node provenance.
	// Errors leave the store unchanged. Cancellation covers lock acquisition too.
	Apply(ctx context.Context, batch Batch) (changed bool, err error)
}

// ReadTx provides indexed access to authenticated facts in a consistent storage
// snapshot. A database adapter can wrap an existing transaction, including the
// transaction that will perform an authorized write. The caller owns its lifetime.
// Queries must complete before that transaction is released or modified.
//
// Implementations enforce valid facts, immutable fact IDs, and earliest-known
// node mentions at ingestion.
// Reads include revoked and ungrounded delegations, and revocations whose targets
// are missing. Filtering to live facts would change revocation semantics.
// Evaluation is order-independent; enumerations are unordered unless specified.
// Iterators are lazy, single-use, and must be
// consumed within the transaction. Finish or break an iterator before starting
// another operation on the same transaction. An error is yielded once with a
// zero fact, then iteration ends. Early termination releases resources immediately.
// Storage errors must never become partial success.
// Implementations must honor ctx; no concurrent use of a ReadTx is required.
type ReadTx interface {
	// Node returns the earliest-known mention, excluding reference-only nodes.
	Node(ctx context.Context, id Node) (NodeRecord, bool, error)
	// Delegation looks up an ID. A missing delegation returns found=false, err=nil.
	Delegation(ctx context.Context, id ID) (d Delegation, found bool, err error)
	// Revocation looks up a revocation, including one whose target is absent.
	Revocation(ctx context.Context, id ID) (Revocation, bool, error)
	// Delegations enumerates facts matching both Subject and Issuer, using an index.
	Delegations(ctx context.Context, subject, issuer Node) iter.Seq2[Delegation, error]
	// Revocations enumerates every revocation naming target, using an index.
	Revocations(ctx context.Context, target ID) iter.Seq2[Revocation, error]
	// DelegationsBySubject enumerates all delegations about subject, regardless
	// of issuer standing. It must use a subject index, not scan unrelated facts.
	DelegationsBySubject(ctx context.Context, subject Node) iter.Seq2[Delegation, error]
	// DelegationsTo enumerates all grants to audience over subject, live or not.
	DelegationsTo(ctx context.Context, subject, audience Node) iter.Seq2[Delegation, error]
	// Subjects enumerates distinct delegation subjects in bytewise ascending order.
	Subjects(ctx context.Context) iter.Seq2[Node, error]
	// Records enumerates the complete stored set: node records, then delegations,
	// then revocations, each group in bytewise ascending ID order. It includes
	// ungrounded facts and unknown targets, but excludes reference-only nodes.
	// Unlike Closure, this is a global scan.
	Records(ctx context.Context) iter.Seq2[Record, error]
}

// EffectivePower returns audience's greatest authority over subject, or None if
// no grounded derivation exists. A nonempty node always has Admin over itself,
// including nodes absent from storage. Errors return None, never a partial answer.
func EffectivePower(ctx context.Context, tx ReadTx, subject, audience Node) (Power, error) {
	if err := ctx.Err(); err != nil {
		return None, err
	}

	g := newGraph(tx)

	if subject == "" || audience == "" {
		return None, nil
	}

	if subject == audience {
		return Admin, nil
	}

	levels, _, err := g.evaluate(ctx, []Node{subject})
	if err != nil {
		return None, err
	}

	return levels[subject][audience], nil
}

// Allows reports whether audience holds at least required over subject.
// Invalid requirements, including None, are denied. Errors return false and must
// be handled as failed authorization, not as an answer from a partial graph.
func Allows(ctx context.Context, tx ReadTx, subject, audience Node, required Power) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}

	if !required.Valid() || subject == "" || audience == "" {
		return false, nil
	}

	if subject == audience {
		return true, nil
	}

	power, err := EffectivePower(ctx, tx, subject, audience)
	return err == nil && power >= required, err
}

// Members returns the effective powers of all nodes with standing over subject,
// excluding subject itself. The caller owns the map. Errors return a nil map.
func Members(ctx context.Context, tx ReadTx, subject Node) (map[Node]Power, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	g := newGraph(tx)

	if subject == "" {
		return map[Node]Power{}, nil
	}

	levels, _, err := g.evaluate(ctx, []Node{subject})
	if err != nil {
		return nil, err
	}

	delete(levels[subject], subject)
	return levels[subject], nil
}

// MembersOf returns Members for each distinct nonempty subject, from one
// evaluation of the facts they share. Each result equals a separate Members
// call. The caller owns the maps. Errors return a nil map.
func MembersOf(ctx context.Context, tx ReadTx, subjects []Node) (map[Node]map[Node]Power, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	g := newGraph(tx)

	roots := distinctNodes(subjects)

	out := make(map[Node]map[Node]Power, len(roots))
	if len(roots) == 0 {
		return out, nil
	}

	levels, _, err := g.evaluate(ctx, roots)
	if err != nil {
		return nil, err
	}

	for _, s := range roots {
		members := maps.Clone(levels[s])
		delete(members, s)
		out[s] = members
	}

	return out, nil
}

// IsLive reports whether a delegation has a grounded, unrevoked derivation in
// its own subject's graph. A role's roster can stay live after the role loses
// access to a different subject. Unknown IDs and errors return false.
func IsLive(ctx context.Context, tx ReadTx, id ID) (bool, error) {
	power, err := Conveyed(ctx, tx, id)
	return err == nil && power != None, err
}

// Conveyed returns the power one delegation contributes to its audience over its
// subject, or None if the delegation is absent or not live. This is bounded by
// the issuer's effective power and the delegation's revocation-adjusted cap,
// which is its requested power when uncovered. It is not the audience's total
// power, which may include independent routes. Errors return None.
// Use it before removal when preserving an individual grant's contribution.
func Conveyed(ctx context.Context, tx ReadTx, id ID) (Power, error) {
	if err := ctx.Err(); err != nil {
		return None, err
	}

	g := newGraph(tx)

	d, found, err := tx.Delegation(ctx, id)
	if err != nil {
		return None, fmt.Errorf("keyline: read delegation %q: %w", id, err)
	}

	if !found {
		return None, ctx.Err()
	}

	_, conveyed, err := g.evaluate(ctx, []Node{d.Subject})
	if err != nil {
		return None, err
	}

	return conveyed[id], nil
}

// PositivePower returns authority with all revocations ignored. It is useful
// for replication scope and historical reach, never for granting current access.
func PositivePower(ctx context.Context, tx ReadTx, subject, audience Node) (Power, error) {
	if err := ctx.Err(); err != nil {
		return None, err
	}

	g := newGraph(tx)

	if subject == "" || audience == "" {
		return None, nil
	}

	if subject == audience {
		return Admin, nil
	}

	levels, err := g.search(ctx, []Node{subject}, nil, nil, nil)
	if err != nil {
		return None, err
	}

	return levels[subject][audience], nil
}

// PositiveMembers returns historical standing with revocations ignored,
// excluding subject itself. Use it for rotation analysis, not authorization.
func PositiveMembers(ctx context.Context, tx ReadTx, subject Node) (map[Node]Power, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	g := newGraph(tx)

	if subject == "" {
		return map[Node]Power{}, nil
	}

	levels, err := g.search(ctx, []Node{subject}, nil, nil, nil)
	if err != nil {
		return nil, err
	}

	delete(levels[subject], subject)
	return levels[subject], nil
}

// MembersForSubset evaluates only the delegation/revocation IDs selected by ids.
// Unknown IDs are ignored, matching upstream. Callers requiring every cited fact
// must establish its presence first: an incomplete subset can grant access that
// a fuller set revokes. Neither the selection nor its result proves completeness.
// Node metadata has no effect. An empty selection has no members.
func MembersForSubset(ctx context.Context, tx ReadTx, subject Node, ids []ID) (map[Node]Power, error) {
	if err := ctx.Err(); err != nil {
		return nil, err
	}

	g := newGraph(tx)

	if subject == "" || len(ids) == 0 {
		return map[Node]Power{}, nil
	}

	g.subset = make(map[ID]bool)
	for _, id := range ids {
		g.subset[id] = true
	}

	levels, _, err := g.evaluate(ctx, []Node{subject})
	if err != nil {
		return nil, err
	}

	delete(levels[subject], subject)
	return levels[subject], nil
}

// distinctNodes returns the distinct nonempty nodes in order of first mention.
func distinctNodes(nodes []Node) []Node {
	out := make([]Node, 0, len(nodes))
	seen := make(map[Node]bool, len(nodes))
	for _, n := range nodes {
		if n != "" && !seen[n] {
			seen[n] = true
			out = append(out, n)
		}
	}

	return out
}
