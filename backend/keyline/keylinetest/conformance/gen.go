//nolint:govet // Facts are dense positional tables, as in _test.go files.
package conformance

import (
	"encoding/binary"
	"fmt"
	"slices"
	"strconv"
	"strings"
	"testing"

	"seed/backend/keyline"

	"github.com/stretchr/testify/require"
)

// pool is the number of identities a generated set may mention, as in upstream's gen.rs.
const pool = 8

// node names pool identity n, for n in 1..pool.
func node(n int) keyline.Node { return keyline.Node(strconv.Itoa(n)) }

// poolNodes returns every identity a generated set may mention.
func poolNodes() []keyline.Node {
	nodes := make([]keyline.Node, pool)
	for i := range nodes {
		nodes[i] = node(i + 1)
	}

	return nodes
}

// unstructured draws choices from fuzz input bytes, after arbitrary's
// Unstructured. Exhausted input yields the lowest choice, so every byte
// string decodes to a set and fuzzing never spends time on rejected input.
type unstructured struct{ data []byte }

func (u *unstructured) next() byte {
	if len(u.data) == 0 {
		return 0
	}

	b := u.data[0]
	u.data = u.data[1:]
	return b
}

func (u *unstructured) intInRange(lo, hi int) int { return lo + int(u.next())%(hi-lo+1) }

func (u *unstructured) bool() bool { return u.next()&1 == 1 }

func (u *unstructured) chooseIndex(n int) int { return u.intInRange(0, n-1) }

func (u *unstructured) ratio(numerator, denominator int) bool {
	return u.intInRange(1, denominator) <= numerator
}

func (u *unstructured) uint64() uint64 {
	var b [8]byte

	for i := range b {
		b[i] = u.next()
	}

	return binary.LittleEndian.Uint64(b[:])
}

// certSet is a generated set of facts in generation order, as upstream's
// CertSet. Fact IDs are derived from content, like upstream's certificate
// digests, so generating the same fact twice yields a duplicate.
type certSet []keyline.Record

// delegation derives a content ID, standing in for a certificate digest.
func delegation(issuer, audience, subject keyline.Node, power keyline.Power) keyline.Delegation {
	return keyline.Delegation{keyline.ID(fmt.Sprintf("d:%s>%s/%s:%s", issuer, audience, subject, power)), issuer, audience, subject, power, 1}
}

func revocation(issuer keyline.Node, target keyline.ID) keyline.Revocation {
	return keyline.Revocation{keyline.ID(fmt.Sprintf("r:%s!%s", issuer, target)), issuer, target, 1}
}

// reissue gives d a fresh ID that cites the revocation it heals, as upstream's
// citation does.
func reissue(d keyline.Delegation, citation keyline.ID) keyline.Delegation {
	d.ID += keyline.ID("~" + citation)
	return d
}

func (c certSet) delegations() []keyline.Delegation {
	var out []keyline.Delegation

	for _, r := range c {
		if d, ok := r.(keyline.Delegation); ok {
			out = append(out, d)
		}
	}

	return out
}

func (c certSet) revocations() []keyline.Revocation {
	var out []keyline.Revocation

	for _, r := range c {
		if r, ok := r.(keyline.Revocation); ok {
			out = append(out, r)
		}
	}

	return out
}

func (c certSet) facts() testFacts { return testFacts{c.delegations(), c.revocations()} }

func (c certSet) batch() keyline.Batch {
	return keyline.Batch{Delegations: c.delegations(), Revocations: c.revocations()}
}

func (c certSet) withoutRevocations() certSet {
	var out certSet

	for _, d := range c.delegations() {
		out = append(out, d)
	}

	return out
}

func (c certSet) without(i int) certSet { return slices.Delete(slices.Clone(c), i, i+1) }

func (c certSet) reversed() certSet {
	out := slices.Clone(c)
	slices.Reverse(out)
	return out
}

// shuffled ports gen.rs shuffled: a Fisher–Yates shuffle over a SplitMix64
// stream, an unbiased order for the seed.
func (c certSet) shuffled(seed uint64) certSet {
	state := seed
	next := func() uint64 {
		state += 0x9e3779b97f4a7c15
		z := state
		z = (z ^ (z >> 30)) * 0xbf58476d1ce4e5b9
		z = (z ^ (z >> 27)) * 0x94d049bb133111eb
		return z ^ (z >> 31)
	}
	out := slices.Clone(c)
	for i := len(out) - 1; i > 0; i-- {
		j := int(next() % uint64(i+1)) //nolint:gosec // j <= i.
		out[i], out[j] = out[j], out[i]
	}

	return out
}

// count reports how many times the record at i occurs in the set.
func (c certSet) count(i int) int {
	return len(slices.DeleteFunc(slices.Clone(c), func(r keyline.Record) bool { return r != c[i] }))
}

func recordID(r keyline.Record) keyline.ID {
	switch r := r.(type) {
	case keyline.Delegation:
		return r.ID
	case keyline.Revocation:
		return r.ID
	}

	panic(fmt.Sprintf("unexpected record %T", r))
}

// stores builds the stores one input's laws query. Builds of the same records
// in the same order are shared, so laws must not modify a built store; a law
// that writes starts from fresh.
type stores struct {
	parent   testing.TB
	newStore NewStore
	built    map[string]keyline.Store
}

// fresh returns a new, empty store.
func (s *stores) fresh(t *testing.T) keyline.Store { return s.newStore(t) }

// build ports conformance.rs build: a store with each record inserted in
// order, checking that Apply reports exactly the new ones.
func (s *stores) build(t *testing.T, records certSet) keyline.Store {
	t.Helper()
	var key strings.Builder

	for _, r := range records {
		key.WriteString(string(recordID(r)))
		key.WriteByte(0)
	}

	if store, ok := s.built[key.String()]; ok {
		return store
	}

	// The parent owns shared stores, so they outlive the law that built them.
	store := s.newStore(s.parent)
	seen := map[keyline.ID]bool{}
	for _, r := range records {
		changed, err := store.Apply(t.Context(), certSet{r}.batch())
		require.NoError(t, err)
		require.Equal(t, !seen[recordID(r)], changed, "Apply reports whether %s is new", recordID(r))
		seen[recordID(r)] = true
	}

	s.built[key.String()] = store
	return store
}

// distinct ports gen.rs distinct: n distinct pool identities, none in not.
// A collision would collapse a planted shape into something else.
func distinct(u *unstructured, n int, not ...int) []keyline.Node {
	var rest []int

	for i := 1; i <= pool; i++ {
		if !slices.Contains(not, i) {
			rest = append(rest, i)
		}
	}

	out := make([]keyline.Node, n)
	for k := range out {
		i := u.chooseIndex(len(rest))
		out[k] = node(rest[i])
		rest[i] = rest[len(rest)-1]
		rest = rest[:len(rest)-1]
	}

	return out
}

func pickNode(u *unstructured) keyline.Node { return node(u.intInRange(1, pool)) }

func pickPower(u *unstructured) keyline.Power { return powerOrder[1+u.chooseIndex(4)] }

// arbitraryCertSet ports gen.rs's Arbitrary for CertSet, choice by choice:
// grounded roots, free-form wiring, at most one planted shape, an occasional
// absent target, revocations by parties and strangers, and re-issues. Upstream
// retention watermarks are not ported, so their choices are not drawn.
func arbitraryCertSet(u *unstructured) certSet {
	var certs certSet

	// Root edges: each subject grounds itself to some node, at Admin or, so
	// that nobody holds Admin over the subject, at Write.
	subjects := u.intInRange(1, 3)
	var rootAudience []int

	for s := 1; s <= subjects; s++ {
		audience := u.intInRange(1, pool)
		rootAudience = append(rootAudience, audience)

		rooting := keyline.Write
		if u.bool() {
			rooting = keyline.Admin
		}

		certs = append(certs, delegation(node(s), node(audience), node(s), rooting))
	}

	// Planted shapes avoid their subject and its root audience, whose
	// independent standing would otherwise mask what the shape tests.
	clearOf := func(s int) []int { return []int{s, rootAudience[s-1]} }

	// Free-form delegations over any pool subject, so some land on roles and
	// some are ungrounded.
	for range u.intInRange(0, 10) {
		certs = append(certs, delegation(pickNode(u), pickNode(u), pickNode(u), pickPower(u)))
	}

	switch u.intInRange(0, 4) {
	case 1:
		// Clamping: gating alone would retain the role level for f.
		sN := u.intInRange(1, subjects)
		s := node(sN)
		n := distinct(u, 4, clearOf(sN)...)
		m, k, e, f := n[0], n[1], n[2], n[3]

		viaRole := keyline.Read
		if u.bool() {
			viaRole = keyline.Write
		}

		independent := keyline.Sync
		if viaRole == keyline.Write && u.bool() {
			independent = keyline.Read
		}

		grant := delegation(e, f, s, keyline.Admin)
		certs = append(certs,
			delegation(s, m, s, viaRole), delegation(m, k, m, keyline.Admin), delegation(k, e, m, keyline.Admin),
			delegation(s, e, s, independent), grant, revocation(k, grant.ID))
	case 2:
		// Two chained clamps, each on the other's avoiding derivation.
		sN := u.intInRange(1, subjects)
		s := node(sN)
		n := distinct(u, 5, clearOf(sN)...)
		m1, e, m2, f, g := n[0], n[1], n[2], n[3], n[4]
		h1, h2, h3 := delegation(e, f, s, keyline.Admin), delegation(f, e, s, keyline.Admin), delegation(f, g, s, keyline.Admin)
		certs = append(certs,
			delegation(s, e, s, keyline.Read), delegation(s, m1, s, keyline.Write), delegation(m1, e, m1, keyline.Admin),
			delegation(s, m2, s, keyline.Write), delegation(m2, f, m2, keyline.Admin), h1, h2, h3,
			revocation(m1, h1.ID), revocation(m2, h2.ID), revocation(m2, h3.ID))
	case 3:
		// A role chain three deep; when every hop is Admin, p revokes the root
		// edge through three compositions.
		sN := u.intInRange(1, subjects)
		s := node(sN)
		n := distinct(u, 4, clearOf(sN)...)
		r1, r2, r3, p := n[0], n[1], n[2], n[3]
		composed := u.bool()
		hop := func() keyline.Power {
			if composed {
				return keyline.Admin
			}

			return pickPower(u)
		}
		certs = append(certs, delegation(s, r1, s, hop()))
		certs = append(certs, delegation(r1, r2, r1, hop()))
		certs = append(certs, delegation(r2, r3, r2, hop()))
		certs = append(certs, delegation(r3, p, r3, hop()))

		if composed {
			certs = append(certs, revocation(p, recordID(certs[sN-1])))
		}
	case 4:
		// Shape 1 inside a role g supplied into s.
		sN := u.intInRange(1, subjects)
		s := node(sN)
		n := distinct(u, 5, clearOf(sN)...)
		g, m, k, e, f := n[0], n[1], n[2], n[3], n[4]
		grant := delegation(e, f, g, keyline.Admin)
		certs = append(certs,
			delegation(s, g, s, keyline.Write), delegation(g, m, g, keyline.Write), delegation(m, k, m, keyline.Admin),
			delegation(k, e, m, keyline.Admin), delegation(g, e, g, keyline.Read), grant, revocation(k, grant.ID))
	}

	// Occasionally, a revocation of a delegation that is not in the set.
	if u.ratio(1, 4) {
		absent := delegation(pickNode(u), pickNode(u), pickNode(u), pickPower(u))
		certs = append(certs, revocation(pickNode(u), absent.ID))
	}

	// Revocations naming delegations already present: a third by the target's
	// issuer and a third by its audience, which random issuers rarely produce.
	for range u.intInRange(0, 4) {
		dels := certs.delegations()
		target := dels[u.chooseIndex(len(dels))]

		var issuer keyline.Node

		switch u.intInRange(0, 2) {
		case 0:
			issuer = target.Issuer
		case 1:
			issuer = target.Audience
		default:
			issuer = pickNode(u)
		}

		certs = append(certs, revocation(issuer, target.ID))
	}

	// Re-issues past a revocation, so heals happen, and sometimes a revocation
	// of the re-issue.
	var reissues []keyline.Delegation

	for range u.intInRange(0, 2) {
		revs := certs.revocations()
		if len(revs) == 0 {
			break
		}

		revoked := revs[u.chooseIndex(len(revs))]

		i := slices.IndexFunc(certs.delegations(), func(d keyline.Delegation) bool { return d.ID == revoked.Target })
		if i < 0 {
			continue
		}

		d := reissue(certs.delegations()[i], revoked.ID)
		reissues = append(reissues, d)
		certs = append(certs, d)
	}

	if len(reissues) > 0 && u.bool() {
		target := reissues[u.chooseIndex(len(reissues))]
		certs = append(certs, revocation(pickNode(u), target.ID))
	}

	return certs
}
