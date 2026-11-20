//nolint:govet // Facts are dense positional tables, as in _test.go files.
package conformance

import (
	"maps"
	"slices"

	"seed/backend/keyline"
)

// thresholdEvaluation adapts Keyline's independent threshold-form oracle
// (conformance/oracle/threshold.rs, Apache-2.0, revision in keyline.go).
// It derives boolean threshold facts jointly across exclusion contexts, with no
// numeric caps, separate live-edge iteration, or production graph helpers.
func thresholdEvaluation(s testFacts) (map[[2]keyline.Node]keyline.Power, map[keyline.ID]bool, map[keyline.ID]keyline.Power) {
	type fact struct {
		context           keyline.ID
		power             keyline.Power
		subject, audience keyline.Node
	}

	nodes := map[keyline.Node]bool{}
	for _, d := range s.Delegations {
		nodes[d.Issuer], nodes[d.Audience], nodes[d.Subject] = true, true, true
	}

	for _, r := range s.Revocations {
		nodes[r.Issuer] = true
	}

	positive := map[fact]bool{}
	for n := range nodes {
		for _, p := range powerOrder[1:] {
			positive[fact{"", p, n, n}] = true
		}
	}

	for {
		before := len(positive)
		for _, d := range s.Delegations {
			for _, p := range powerOrder[1 : slices.Index(powerOrder, d.Power)+1] {
				for root := range nodes {
					if positive[fact{"", p, root, d.Subject}] && positive[fact{"", p, d.Subject, d.Issuer}] {
						positive[fact{"", p, root, d.Audience}] = true
					}
				}
			}
		}

		if len(positive) == before {
			break
		}
	}

	total := map[keyline.ID]bool{}
	excluded := map[keyline.ID]map[keyline.Node]bool{"": {}}
	for _, r := range s.Revocations {
		for _, d := range s.Delegations {
			if r.Target != d.ID {
				continue
			}

			if r.Issuer == d.Issuer || r.Issuer == d.Audience {
				total[d.ID] = true
				continue
			}

			if excluded[d.ID] == nil {
				excluded[d.ID] = map[keyline.Node]bool{}
			}

			for n := range nodes {
				if positive[fact{"", keyline.Admin, n, r.Issuer}] {
					excluded[d.ID][n] = true
				}
			}
		}
	}

	live := map[fact]bool{}
	for c, ex := range excluded {
		for n := range nodes {
			if !ex[n] {
				for _, p := range powerOrder[1:] {
					live[fact{c, p, n, n}] = true
				}
			}
		}
	}

	for {
		before := len(live)
		for _, d := range s.Delegations {
			if total[d.ID] {
				continue
			}

			var own keyline.ID

			if _, ok := excluded[d.ID]; ok {
				own = d.ID
			}

			for _, p := range powerOrder[1 : slices.Index(powerOrder, d.Power)+1] {
				for c, ex := range excluded {
					if ex[d.Issuer] || ex[d.Audience] || excluded[own][d.Issuer] {
						continue
					}

					for root := range nodes {
						if live[fact{c, p, root, d.Subject}] &&
							live[fact{c, p, d.Subject, d.Issuer}] &&
							live[fact{own, p, d.Subject, d.Issuer}] {
							live[fact{c, p, root, d.Audience}] = true
						}
					}
				}
			}
		}

		if len(live) == before {
			break
		}
	}

	powers := map[[2]keyline.Node]keyline.Power{}
	for f := range live {
		if f.context == "" {
			q := [2]keyline.Node{f.subject, f.audience}
			if slices.Index(powerOrder, f.power) > slices.Index(powerOrder, powers[q]) {
				powers[q] = f.power
			}
		}
	}

	liveEdges := map[keyline.ID]bool{}
	conveyed := map[keyline.ID]keyline.Power{}
	for _, d := range s.Delegations {
		var own keyline.ID

		if _, ok := excluded[d.ID]; ok {
			own = d.ID
		}

		liveEdges[d.ID] = !total[d.ID] && live[fact{own, keyline.Sync, d.Subject, d.Issuer}]

		conveyed[d.ID] = keyline.None
		if total[d.ID] {
			continue
		}

		// An edge contributes a requested threshold only when its issuer
		// reaches it both without exclusions and in the edge's own context.
		// Ascending thresholds select the greatest such fact without caps.
		for _, p := range powerOrder[1 : slices.Index(powerOrder, d.Power)+1] {
			if live[fact{"", p, d.Subject, d.Issuer}] && live[fact{own, p, d.Subject, d.Issuer}] {
				conveyed[d.ID] = p
			}
		}
	}

	return powers, liveEdges, conveyed
}

// levels maps (subject, node) to a level, as upstream's oracle Levels.
type levels = map[[2]keyline.Node]keyline.Power

// rank orders powers for oracles and laws without relying on Power.Compare.
func rank(p keyline.Power) int { return slices.Index(powerOrder, p) }

func minPower(a, b keyline.Power) keyline.Power {
	if rank(a) <= rank(b) {
		return a
	}

	return b
}

// naiveFacts holds what the naive oracle reads from a set: every node, each
// distinct delegation, and the issuer and target of each revocation.
type naiveFacts struct {
	nodes       []keyline.Node
	delegations map[keyline.ID]keyline.Delegation
	revocations []keyline.Revocation
}

// naiveFactsOf ports oracle/naive.rs facts: the pool plus every mentioned node.
func naiveFactsOf(s testFacts) naiveFacts {
	f := naiveFacts{delegations: map[keyline.ID]keyline.Delegation{}, revocations: s.Revocations}
	seen := map[keyline.Node]bool{}
	add := func(nodes ...keyline.Node) {
		for _, n := range nodes {
			if !seen[n] {
				seen[n] = true
				f.nodes = append(f.nodes, n)
			}
		}
	}

	add(poolNodes()...)
	for _, d := range s.Delegations {
		add(d.Issuer, d.Audience, d.Subject)
		f.delegations[d.ID] = d
	}

	for _, r := range s.Revocations {
		add(r.Issuer)
	}

	return f
}

// naiveLevel ports oracle/naive.rs level: rules 1-3 over usable edges weighted
// by capOf, refusing every node in exclude, as a Jacobi fixed point. With no
// exclusions, every edge usable, and capOf returning Power, this is stratum 1.
func naiveLevel(f naiveFacts, exclude map[keyline.Node]bool, usable func(keyline.ID) bool, capOf func(keyline.Delegation) keyline.Power) levels {
	m := levels{}
	for _, n := range f.nodes {
		if !exclude[n] {
			m[[2]keyline.Node{n, n}] = keyline.Admin
		}
	}

	raise := func(key [2]keyline.Node, l keyline.Power) bool {
		if current, ok := m[key]; ok && rank(current) >= rank(l) {
			return false
		}

		m[key] = l
		return true
	}
	for {
		changed := false
		snapshot := maps.Clone(m)
		for _, d := range f.delegations {
			if !usable(d.ID) || exclude[d.Audience] {
				continue
			}

			if l, ok := snapshot[[2]keyline.Node{d.Subject, d.Issuer}]; ok {
				changed = raise([2]keyline.Node{d.Subject, d.Audience}, minPower(l, capOf(d))) || changed
			}
		}

		for k1, l1 := range snapshot {
			if k1[0] == k1[1] {
				continue
			}

			for k2, l2 := range snapshot {
				if k2[0] == k1[1] {
					changed = raise([2]keyline.Node{k1[0], k2[1]}, minPower(l1, l2)) || changed
				}
			}
		}

		if !changed {
			return m
		}
	}
}

// naiveReaches ports oracle/naive.rs reaches: stratum 1 alone, blind to revocations.
func naiveReaches(s testFacts) levels {
	return naiveLevel(naiveFactsOf(s), nil, func(keyline.ID) bool { return true }, func(d keyline.Delegation) keyline.Power { return d.Power })
}

// naiveEvaluation ports oracle/naive.rs evaluate (Apache-2.0, revision in
// keyline.go): the value-form program
// of design/keyline/implementation.md. The live set and the caps are each a
// least fixed point, then the live levels follow from them. It shares no code
// with thresholdEvaluation or the evaluator.
func naiveEvaluation(s testFacts) (live map[keyline.ID]bool, caps map[keyline.ID]keyline.Power, lv levels) {
	f := naiveFactsOf(s)
	all := func(keyline.ID) bool { return true }
	requested := func(d keyline.Delegation) keyline.Power { return d.Power }

	reaches := naiveLevel(f, nil, all, requested)
	covered := map[keyline.ID]map[keyline.Node]bool{}
	for _, r := range f.revocations {
		if covered[r.Target] == nil {
			covered[r.Target] = map[keyline.Node]bool{}
		}

		// The revoker's Admin reach in the positive graph, including itself.
		covered[r.Target][r.Issuer] = true
		for _, n := range f.nodes {
			if reaches[[2]keyline.Node{n, r.Issuer}] == keyline.Admin {
				covered[r.Target][n] = true
			}
		}
	}

	revokedByAudience := func(d keyline.Delegation) bool {
		return slices.ContainsFunc(f.revocations, func(r keyline.Revocation) bool {
			return r.Target == d.ID && r.Issuer == d.Audience
		})
	}

	live = map[keyline.ID]bool{}
	usable := func(id keyline.ID) bool { return live[id] }
	for {
		var added []keyline.ID

		for id, d := range f.delegations {
			if live[id] || revokedByAudience(d) {
				continue
			}

			if _, ok := naiveLevel(f, covered[id], usable, requested)[[2]keyline.Node{d.Subject, d.Issuer}]; ok {
				added = append(added, id)
			}
		}

		if len(added) == 0 {
			break
		}

		for _, id := range added {
			live[id] = true
		}
	}

	// Caps rise from Sync: a live edge conveys at least that, and only a
	// grounded derivation can raise it further.
	caps = map[keyline.ID]keyline.Power{}
	for id := range f.delegations {
		caps[id] = keyline.Sync
	}

	for changed := true; changed; {
		changed = false
		for id, d := range f.delegations {
			if !live[id] {
				continue
			}

			current := maps.Clone(caps)

			atIssuer := naiveLevel(f, covered[id], usable, func(x keyline.Delegation) keyline.Power {
				return minPower(current[x.ID], x.Power)
			})[[2]keyline.Node{d.Subject, d.Issuer}]
			if next := minPower(d.Power, atIssuer); rank(next) > rank(caps[id]) {
				caps[id] = next
				changed = true
			}
		}
	}

	lv = naiveLevel(f, nil, usable, func(x keyline.Delegation) keyline.Power { return minPower(caps[x.ID], x.Power) })
	return live, caps, lv
}
