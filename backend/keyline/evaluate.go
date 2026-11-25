package keyline

import (
	"context"
	"encoding/binary"
	"fmt"
	"maps"
	"slices"
)

// The strata adapt Keyline's memory evaluator (Apache-2.0, revision in
// keyline.go). Discovery is subject-scoped. Every cache lives within one query;
// no answer can outlive its transaction. Worklist joins replace repeated
// all-root searches while preserving the same least fixed point.
type graph struct {
	tx          ReadTx
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

func newGraph(tx ReadTx) *graph {
	return &graph{
		tx: tx, loaded: make(map[Node]bool),
		outgoing: make(map[[2]Node][]Delegation), delegations: make(map[ID]Delegation),
	}
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
			if err := ctx.Err(); err != nil {
				return nil, nil, err
			}

			if p == Admin {
				adminReach[k] = append(adminReach[k], n)
			}
		}
	}

	var contexts []exclusion

	byExclusion := make(map[string]int)
	usable := make(map[ID]bool)
	pruned := false
	for _, d := range g.delegations {
		if err := ctx.Err(); err != nil {
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

			if g.subset != nil && !g.subset[r.ID] {
				continue
			}

			if r.Issuer == d.Issuer || r.Issuer == d.Audience {
				total = true
			}

			// Drain even total revocations: a later storage error cannot become
			// an apparently successful answer about a partially read graph.
			for _, n := range adminReach[r.Issuer] {
				if err := ctx.Err(); err != nil {
					return nil, nil, err
				}

				if excluded[n] {
					continue
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
		if err := ctx.Err(); err != nil {
			return nil, nil, err
		}

		var key []byte

		for _, n := range slices.Sorted(maps.Keys(excluded)) {
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
			if err := ctx.Err(); err != nil {
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
				if err := ctx.Err(); err != nil {
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
				if err := ctx.Err(); err != nil {
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
			if err := ctx.Err(); err != nil {
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
				if err := ctx.Err(); err != nil {
					return nil, nil, err
				}

				if !usable[d.ID] {
					continue
				}

				p := min(d.Power, levels[d.Subject][d.Issuer])
				if p > caps[d.ID] {
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
		if err := ctx.Err(); err != nil {
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

		conveyed[id] = min(power, ceiling)
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
		if err := ctx.Err(); err != nil {
			return err
		}

		if excluded[root] || excluded[node] || power <= levels[root][node] {
			return nil
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
		if err := ctx.Err(); err != nil {
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

		if !g.loaded[q.root] && usable == nil {
			if err := g.load(ctx, q.root); err != nil {
				return nil, err
			}
		}

		edges := g.outgoing[[2]Node{q.root, q.node}]
		for _, d := range edges {
			if err := ctx.Err(); err != nil {
				return nil, err
			}

			if usable != nil && !usable[d.ID] {
				continue
			}

			power := d.Power
			if ceiling, ok := caps[d.ID]; ok {
				power = ceiling
			}

			if err := add(q.root, d.Audience, min(q.power, power)); err != nil {
				return nil, err
			}
		}

		if q.node == q.root {
			continue // Composing self-standing adds no information.
		}

		for member, power := range levels[q.node] {
			if err := add(q.root, member, min(q.power, power)); err != nil {
				return nil, err
			}
		}

		for outer, power := range parents[q.root] {
			if err := add(outer, q.node, min(power, q.power)); err != nil {
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
