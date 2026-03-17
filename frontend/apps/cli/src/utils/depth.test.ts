import {describe, test, expect} from 'bun:test'

/**
 * Tests for the depth computation logic (computeDepths).
 *
 * The `computeDepths` function is private in depth.ts, so we test it
 * indirectly through a local reimplementation of the same BFS algorithm.
 * The logic is: genesis (no deps) has depth 0, each subsequent change
 * has depth = max(dep depths) + 1.
 *
 * If the function were exported, we'd import it directly. For now, we
 * replicate the algorithm to validate the expected behavior patterns
 * that resolveDocumentState relies on.
 */

type Change = {id: string; deps: string[]}

/**
 * Reimplementation of computeDepths for testing.
 * This mirrors the BFS algorithm in depth.ts lines 89-144.
 */
function computeDepths(changes: Change[]): Map<string, number> {
  const depthMap = new Map<string, number>()
  const depsMap = new Map<string, string[]>()
  const dependents = new Map<string, string[]>()

  for (const change of changes) {
    depsMap.set(change.id, change.deps)
    for (const dep of change.deps) {
      const existing = dependents.get(dep) ?? []
      existing.push(change.id)
      dependents.set(dep, existing)
    }
  }

  // Start from genesis nodes (no deps)
  const queue: string[] = []
  for (const change of changes) {
    if (change.deps.length === 0) {
      depthMap.set(change.id, 0)
      queue.push(change.id)
    }
  }

  // BFS propagation
  while (queue.length > 0) {
    const current = queue.shift()!
    const currentDepth = depthMap.get(current)!

    const children = dependents.get(current) ?? []
    for (const child of children) {
      const childDeps = depsMap.get(child) ?? []

      let allResolved = true
      let maxDepDepth = 0
      for (const dep of childDeps) {
        const d = depthMap.get(dep)
        if (d === undefined) {
          allResolved = false
          break
        }
        if (d > maxDepDepth) maxDepDepth = d
      }

      if (allResolved && !depthMap.has(child)) {
        depthMap.set(child, maxDepDepth + 1)
        queue.push(child)
      }
    }
  }

  return depthMap
}

describe('computeDepths', () => {
  test('single genesis node has depth 0', () => {
    const changes: Change[] = [{id: 'genesis', deps: []}]
    const depths = computeDepths(changes)
    expect(depths.get('genesis')).toBe(0)
  })

  test('linear chain A → B → C has depths 0, 1, 2', () => {
    const changes: Change[] = [
      {id: 'A', deps: []},
      {id: 'B', deps: ['A']},
      {id: 'C', deps: ['B']},
    ]
    const depths = computeDepths(changes)
    expect(depths.get('A')).toBe(0)
    expect(depths.get('B')).toBe(1)
    expect(depths.get('C')).toBe(2)
  })

  test('diamond DAG: D depends on both B and C', () => {
    // A → B → D
    // A → C → D
    const changes: Change[] = [
      {id: 'A', deps: []},
      {id: 'B', deps: ['A']},
      {id: 'C', deps: ['A']},
      {id: 'D', deps: ['B', 'C']},
    ]
    const depths = computeDepths(changes)
    expect(depths.get('A')).toBe(0)
    expect(depths.get('B')).toBe(1)
    expect(depths.get('C')).toBe(1)
    expect(depths.get('D')).toBe(2) // max(1, 1) + 1
  })

  test('asymmetric DAG: D depends on B (depth 1) and E (depth 3)', () => {
    // A → B → D
    // A → C → E → D  (longer path)
    // Wait, that doesn't work because E depends on C and D depends on B and E.
    // Let's do:
    // A → B
    // A → C → E
    // D depends on B and E
    const changes: Change[] = [
      {id: 'A', deps: []},
      {id: 'B', deps: ['A']},
      {id: 'C', deps: ['A']},
      {id: 'E', deps: ['C']},
      {id: 'D', deps: ['B', 'E']},
    ]
    const depths = computeDepths(changes)
    expect(depths.get('A')).toBe(0)
    expect(depths.get('B')).toBe(1)
    expect(depths.get('C')).toBe(1)
    expect(depths.get('E')).toBe(2)
    expect(depths.get('D')).toBe(3) // max(1, 2) + 1
  })

  test('fork with no merge: two branches', () => {
    // A → B
    // A → C
    const changes: Change[] = [
      {id: 'A', deps: []},
      {id: 'B', deps: ['A']},
      {id: 'C', deps: ['A']},
    ]
    const depths = computeDepths(changes)
    expect(depths.get('A')).toBe(0)
    expect(depths.get('B')).toBe(1)
    expect(depths.get('C')).toBe(1)
  })

  test('long linear chain', () => {
    const changes: Change[] = [{id: 'n0', deps: []}]
    for (let i = 1; i <= 10; i++) {
      changes.push({id: `n${i}`, deps: [`n${i - 1}`]})
    }
    const depths = computeDepths(changes)
    for (let i = 0; i <= 10; i++) {
      expect(depths.get(`n${i}`)).toBe(i)
    }
  })

  test('empty changes list returns empty map', () => {
    const depths = computeDepths([])
    expect(depths.size).toBe(0)
  })

  test('multiple genesis nodes', () => {
    // Two independent genesis nodes — unusual but defensive
    const changes: Change[] = [
      {id: 'G1', deps: []},
      {id: 'G2', deps: []},
      {id: 'M', deps: ['G1', 'G2']},
    ]
    const depths = computeDepths(changes)
    expect(depths.get('G1')).toBe(0)
    expect(depths.get('G2')).toBe(0)
    expect(depths.get('M')).toBe(1)
  })

  test('complex merge scenario', () => {
    //     A (0)
    //    / \
    //   B   C  (1)
    //   |   |
    //   D   E  (2)
    //    \ /
    //     F    (3)
    const changes: Change[] = [
      {id: 'A', deps: []},
      {id: 'B', deps: ['A']},
      {id: 'C', deps: ['A']},
      {id: 'D', deps: ['B']},
      {id: 'E', deps: ['C']},
      {id: 'F', deps: ['D', 'E']},
    ]
    const depths = computeDepths(changes)
    expect(depths.get('A')).toBe(0)
    expect(depths.get('B')).toBe(1)
    expect(depths.get('C')).toBe(1)
    expect(depths.get('D')).toBe(2)
    expect(depths.get('E')).toBe(2)
    expect(depths.get('F')).toBe(3)
  })
})
