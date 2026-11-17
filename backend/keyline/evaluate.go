package keyline

import (
	"context"
	"encoding/binary"
	"fmt"
	"maps"
	"math/bits"
	"slices"
)

// The strata adapt Keyline's memory evaluator (Apache-2.0, revision in
// keyline.go). Discovery is subject-scoped. Every cache lives within one query;
// no answer can outlive its transaction. Worklist joins replace repeated
// all-root searches while preserving the same least fixed point.
type graph struct {
	tx          ReadTx
	budget      Limits
	parent      func(Node) (Node, bool)
	subset      map[ID]bool // Nil selects the complete transaction's fact set.
	loaded      map[Node]bool
	outgoing    map[[2]Node][]Delegation
	delegations map[ID]Delegation
}

type exclusion struct {
	nodes map[Node]bool
	edges []Delegation
	roots []Node
}

func newGraph(tx ReadTx, e Evaluator) (*graph, error) {
	limits := e.Limits
	for _, remaining := range []*int{&limits.MaxFacts, &limits.MaxBytes, &limits.MaxRelations, &limits.MaxWork} {
		if *remaining < 0 {
			return nil, fmt.Errorf("keyline: negative evaluation limit")
		}

		if *remaining == 0 {
			// Keep unlimited distinct from a finite budget exhausted to zero.
			*remaining = -1
		}
	}

	return &graph{
		tx: tx, budget: limits, parent: e.Parent, loaded: make(map[Node]bool),
		outgoing: make(map[[2]Node][]Delegation), delegations: make(map[ID]Delegation),
	}, nil
}

// evaluate returns the revocation-aware standing rows of roots and of every
// node reached from them. Rows are independent least fixed points, so adding
// roots never changes another root's row.
func (g *graph) evaluate(ctx context.Context, roots []Node) (map[Node]map[Node]Power, map[ID]Power, error) {
	// Never prune using revocations: former admins still supply coverage.
	positive, err := g.search(ctx, roots, nil, nil, nil)
	if err != nil {
		return nil, nil, err
	}

	adminReach := make(map[Node][]Node)
	for n, row := range positive {
		for k, p := range row {
			if err := g.work(ctx, 1); err != nil {
				return nil, nil, err
			}

			if p == Admin {
				if err := consume(&g.budget.MaxRelations, 1, "relations"); err != nil {
					return nil, nil, err
				}

				adminReach[k] = append(adminReach[k], n)
			}
		}
	}

	var contexts []exclusion

	byExclusion := make(map[string]int)
	usable := make(map[ID]bool)
	pruned := false
	for _, d := range g.delegations {
		if err := g.work(ctx, 1); err != nil {
			return nil, nil, err
		}

		if positive[d.Subject][d.Issuer] == None {
			// Loaded with its subject but never traversable: its issuer has no
			// standing even with every revocation ignored.
			continue
		}

		var excluded map[Node]bool

		total := false
		onRoute := false
		for r, err := range g.tx.Revocations(ctx, d.ID) {
			if err != nil {
				return nil, nil, fmt.Errorf("keyline: read revocations of %q: %w", d.ID, err)
			}

			if err := g.fact(ctx, string(r.ID), string(r.Issuer), string(r.Target)); err != nil {
				return nil, nil, err
			}

			if g.subset != nil && !g.subset[r.ID] {
				continue
			}

			if r.Issuer == d.Issuer || r.Issuer == d.Audience {
				total = true
			}

			// Drain even total revocations: a later storage error cannot become
			// an apparently successful answer about a partially read graph.
			for _, n := range adminReach[r.Issuer] {
				if err := g.work(ctx, 1); err != nil {
					return nil, nil, err
				}

				if excluded[n] {
					continue
				}

				if err := consume(&g.budget.MaxRelations, 1, "relations"); err != nil {
					return nil, nil, err
				}

				if excluded == nil {
					excluded = make(map[Node]bool)
				}

				excluded[n] = true
				onRoute = onRoute || positive[d.Subject][n] != None
			}
		}

		if total {
			pruned = true
			continue
		}

		if !onRoute {
			// Uncovered edges are usable immediately. Search only traverses
			// them from grounded issuers, so cycles still cannot self-certify.
			usable[d.ID] = true
			continue
		}

		if excluded[d.Subject] || excluded[d.Issuer] {
			pruned = true
			continue
		}

		// Group the union of revokers' coverage. Length framing preserves
		// opaque node boundaries, including invalid UTF-8 and delimiters.
		if err := g.work(ctx, len(excluded)*bits.Len(uint(len(excluded)))); err != nil {
			return nil, nil, err
		}

		var key []byte

		for _, n := range slices.Sorted(maps.Keys(excluded)) {
			if err := consume(&g.budget.MaxBytes, len(n)+binary.MaxVarintLen64, "bytes"); err != nil {
				return nil, nil, err
			}

			key = binary.AppendUvarint(key, uint64(len(n)))
			key = append(key, n...)
		}

		c, ok := byExclusion[string(key)]
		if !ok {
			c = len(contexts)
			byExclusion[string(key)] = c
			contexts = append(contexts, exclusion{nodes: excluded})
		}

		contexts[c].edges = append(contexts[c].edges, d)
	}

	for i := range contexts {
		roots := make(map[Node]bool)
		for _, d := range contexts[i].edges {
			if err := g.work(ctx, 1); err != nil {
				return nil, nil, err
			}

			roots[d.Subject] = true
		}

		contexts[i].roots = slices.Collect(maps.Keys(roots))
	}

	// Only covered edges need liveness iteration. Uncovered chains propagate
	// in one search rather than requiring one complete search per link.
	for {
		changed := false
		for _, c := range contexts {
			pending := false
			for _, d := range c.edges {
				if err := g.work(ctx, 1); err != nil {
					return nil, nil, err
				}

				pending = pending || !usable[d.ID]
			}

			if !pending {
				continue
			}

			levels, err := g.search(ctx, c.roots, c.nodes, usable, nil)
			if err != nil {
				return nil, nil, err
			}

			for _, d := range c.edges {
				if err := g.work(ctx, 1); err != nil {
					return nil, nil, err
				}

				if !usable[d.ID] && levels[d.Subject][d.Issuer] != None {
					usable[d.ID] = true
					changed = true
				}
			}
		}

		if !changed {
			break
		}
	}

	// Only covered caps rise from Sync. Uncovered caps are their requested
	// power, attenuated at traversal by the issuer's actual standing.
	caps := make(map[ID]Power)
	for _, c := range contexts {
		for _, d := range c.edges {
			if err := g.work(ctx, 1); err != nil {
				return nil, nil, err
			}

			if usable[d.ID] {
				caps[d.ID] = Sync
			}
		}
	}

	for len(caps) > 0 {
		changed := false
		for _, c := range contexts {
			levels, err := g.search(ctx, c.roots, c.nodes, usable, caps)
			if err != nil {
				return nil, nil, err
			}

			for _, d := range c.edges {
				if err := g.work(ctx, 1); err != nil {
					return nil, nil, err
				}

				if !usable[d.ID] {
					continue
				}

				p := d.Power.min(levels[d.Subject][d.Issuer])
				if p.Compare(caps[d.ID]) > 0 {
					caps[d.ID] = p
					changed = true
				}
			}
		}

		if !changed {
			break
		}
	}

	// Without revocations on any route, the final search would traverse
	// exactly the positive graph again.
	levels := positive
	if pruned || len(contexts) > 0 {
		levels, err = g.search(ctx, roots, nil, usable, caps)
		if err != nil {
			return nil, nil, err
		}
	}

	// A usable uncovered edge can lose its issuer's standing through a
	// revoked predecessor. A live edge contributes its issuer's actual power,
	// bounded by its requested power or revocation-adjusted cap.
	conveyed := make(map[ID]Power, len(usable))
	for id := range usable {
		if err := g.work(ctx, 1); err != nil {
			return nil, nil, err
		}

		d := g.delegations[id]

		power := levels[d.Subject][d.Issuer]
		if power == None {
			continue
		}

		ceiling, covered := caps[id]
		if !covered {
			ceiling = d.Power
		}

		conveyed[id] = power.min(ceiling)
	}

	return levels, conveyed, ctx.Err()
}

// search joins changes in standing with outgoing facts and both sides of role
// membership. Each (subject, audience) pair rises at most four times. Newly
// reached nodes get their own self-rooted row; unrelated subjects are never read.
// Nil usable means positive discovery; nil/absent caps mean requested power.
func (g *graph) search(ctx context.Context, roots []Node, excluded map[Node]bool, usable map[ID]bool, caps map[ID]Power) (map[Node]map[Node]Power, error) {
	type change struct {
		root, node Node
		power      Power
	}

	levels := make(map[Node]map[Node]Power)
	parents := make(map[Node]map[Node]Power)
	var queue []change

	add := func(root, node Node, power Power) error {
		if err := g.work(ctx, 1); err != nil {
			return err
		}

		if excluded[root] || excluded[node] || power.Compare(levels[root][node]) <= 0 {
			return nil
		}

		if levels[root][node] == None {
			if err := consume(&g.budget.MaxRelations, 1, "relations"); err != nil {
				return err
			}
		}

		if levels[root] == nil {
			levels[root] = make(map[Node]Power)
		}

		if parents[node] == nil {
			parents[node] = make(map[Node]Power)
		}

		levels[root][node] = power
		parents[node][root] = power
		queue = append(queue, change{root, node, power})
		return nil
	}

	for _, root := range roots {
		if err := add(root, root, Admin); err != nil {
			return nil, err
		}
	}

	for head := 0; head < len(queue); head++ {
		if err := g.work(ctx, 1); err != nil {
			return nil, err
		}

		q := queue[head]
		if levels[q.root][q.node] != q.power {
			continue
		}

		if levels[q.node] == nil {
			if err := add(q.node, q.node, Admin); err != nil {
				return nil, err
			}
		}

		if q.node == q.root && g.parent != nil {
			// A computed parent edge behaves as a stored, unrevoked Admin
			// delegation from the node to its parent.
			if parent, ok := g.parent(q.root); ok && parent != q.root {
				if err := add(q.root, parent, Admin); err != nil {
					return nil, err
				}
			}
		}

		if !g.loaded[q.root] && usable == nil {
			if err := g.load(ctx, q.root); err != nil {
				return nil, err
			}
		}

		edges := g.outgoing[[2]Node{q.root, q.node}]
		for _, d := range edges {
			if err := g.work(ctx, 1); err != nil {
				return nil, err
			}

			if usable != nil && !usable[d.ID] {
				continue
			}

			power := d.Power
			if ceiling, ok := caps[d.ID]; ok {
				power = ceiling
			}

			if err := add(q.root, d.Audience, q.power.min(power)); err != nil {
				return nil, err
			}
		}

		if q.node == q.root {
			continue // Composing self-standing adds no information.
		}

		for member, power := range levels[q.node] {
			if err := add(q.root, member, q.power.min(power)); err != nil {
				return nil, err
			}
		}

		for outer, power := range parents[q.root] {
			if err := add(outer, q.node, power.min(q.power)); err != nil {
				return nil, err
			}
		}
	}

	return levels, ctx.Err()
}

// load reads every delegation about subject once, grouped by issuer, instead
// of one indexed read per (subject, issuer) pair reached by the search.
func (g *graph) load(ctx context.Context, subject Node) error {
	g.loaded[subject] = true
	for d, err := range g.tx.DelegationsBySubject(ctx, subject) {
		if err != nil {
			return fmt.Errorf("keyline: read delegations for subject %q: %w", subject, err)
		}

		if err := g.fact(ctx, string(d.ID), string(d.Issuer), string(d.Audience), string(d.Subject)); err != nil {
			return err
		}

		if g.subset != nil && !g.subset[d.ID] {
			continue
		}

		if _, seen := g.delegations[d.ID]; !seen {
			key := [2]Node{subject, d.Issuer}
			g.outgoing[key] = append(g.outgoing[key], d)
			g.delegations[d.ID] = d
		}
	}

	return nil
}

func (g *graph) work(ctx context.Context, n int) error {
	if err := ctx.Err(); err != nil {
		return err
	}

	return consume(&g.budget.MaxWork, n, "work")
}

func (g *graph) fact(ctx context.Context, identifiers ...string) error {
	if err := g.work(ctx, 1); err != nil {
		return err
	}

	if err := consume(&g.budget.MaxFacts, 1, "facts"); err != nil {
		return err
	}

	for _, id := range identifiers {
		if err := consume(&g.budget.MaxBytes, len(id), "bytes"); err != nil {
			return err
		}
	}

	return nil
}

func consume(remaining *int, n int, resource string) error {
	if n < 0 || (*remaining >= 0 && n > *remaining) {
		return fmt.Errorf("%w: %s", ErrLimit, resource)
	}

	if *remaining >= 0 {
		*remaining -= n
	}

	return nil
}
