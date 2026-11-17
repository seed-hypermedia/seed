/**
 * Seeded random edits of a block tree, for the tests that write a document, read it back and
 * compare. Shared by the client, CLI and agents-runtime update tests, so all three are driven
 * through the same kinds of edit.
 *
 * A tree is ids only; each caller turns it into its own input (block nodes, markdown with block
 * id comments). Every round applies one to four of these to the tree:
 *
 * - insert a new block, or a new block with children of its own (and sometimes a grandchild);
 * - delete a block with everything under it;
 * - move a block, or a run of neighbours, within its level;
 * - move a block with everything under it to another level;
 * - indent a block under the block before it, or outdent it to after its parent;
 * - swap a parent with one of its children.
 *
 * The last kind, and any other edit that puts a block under a block that was once under it,
 * leaves a parent/child inversion in the document's history. A daemon without Seed PR #1375
 * never answers a `PrepareDocumentChange` that moves or deletes blocks in such a document, and
 * keeps a CPU busy for good. The daemon binary a developer has under `plz-out/` may well be that
 * old; CI builds the daemon from the branch. So the suites that run against a real daemon ask
 * for `inversions: false`, which keeps every round answerable by either daemon, and make the one
 * inversion they want (`swap`) the last write to a document.
 */

import {appendFileSync} from 'fs'

export type Tree = Array<{id: string; children: Tree}>

export const flatTree = (...ids: string[]): Tree => ids.map((id) => ({id, children: []}))

/** The tree as nested id lists: `['a', ['b', ['c']]]` is `a`, then `b` with child `c`. */
export const treeShape = (tree: Tree): unknown[] =>
  tree.map((node) => (node.children.length ? [node.id, treeShape(node.children)] : node.id))

export const cloneTree = (tree: Tree): Tree => tree.map((node) => ({id: node.id, children: cloneTree(node.children)}))

const levelsOf = (tree: Tree): Tree[] => [tree, ...tree.flatMap((node) => levelsOf(node.children))]
const sizeOf = (tree: Tree): number => tree.reduce((sum, node) => sum + 1 + sizeOf(node.children), 0)
const holds = (tree: Tree, level: Tree): boolean => tree === level || tree.some((node) => holds(node.children, level))

export type TreeFuzzer = {
  /** A whole number from 0 up to, not including, `n`. */
  random: (n: number) => number
  /** A copy of `tree` with one to four random edits applied, and the kinds of edit that were made. */
  mutate: (tree: Tree) => {tree: Tree; edits: string[]}
  /**
   * A copy of `tree` with one parent and one of its children swapped, or null when no block has
   * children. Made whatever `inversions` says: a caller that avoids inversions writes this last.
   */
  swap: (tree: Tree) => {tree: Tree; edits: string[]} | null
}

/**
 * A fuzzer whose edits depend only on `seed`. New blocks are named `<prefix><n>`. With
 * `inversions: false`, `mutate` never puts a block under a block that was under it in any tree
 * this fuzzer has been given or has returned, so a document that only ever holds those trees
 * has no parent/child inversion in its history (see the top of this file).
 */
export function createTreeFuzzer(seed: number, {prefix = 'x', inversions = true} = {}): TreeFuzzer {
  let state = seed >>> 0
  // mulberry32
  const random = (n: number) => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) % n
  }
  let fresh = 0
  const newId = () => `${prefix}${++fresh}`
  const newSubtree = (): Tree[number] => {
    const children = Array.from({length: 1 + random(3)}, () => ({id: newId(), children: [] as Tree}))
    if (random(3) === 0) children[random(children.length)]!.children.push({id: newId(), children: []})
    return {id: newId(), children}
  }

  // `child` ids by `parent` id, for every place a block has been in the trees seen so far.
  const placed = new Map<string, Set<string>>()
  const remember = (tree: Tree) => {
    for (const node of tree) {
      for (const child of node.children) {
        const children = placed.get(node.id)
        if (children) children.add(child.id)
        else placed.set(node.id, new Set([child.id]))
      }
      remember(node.children)
    }
  }
  /** Whether `tree` puts a block under a block that is, or once was, somewhere under it. */
  const inverts = (tree: Tree): boolean => {
    const under = (id: string, target: string, seen = new Set<string>()): boolean => {
      if (seen.has(id)) return false
      seen.add(id)
      for (const child of placed.get(id) ?? []) if (child === target || under(child, target, seen)) return true
      return false
    }
    const walk = (nodes: Tree): boolean =>
      nodes.some((node) => node.children.some((child) => under(child.id, node.id)) || walk(node.children))
    return walk(tree)
  }

  const swapIn = (level: Tree): boolean => {
    const parents = level.filter((node) => node.children.length)
    if (!parents.length) return false
    const parent = parents[random(parents.length)]!
    const [child] = parent.children.splice(random(parent.children.length), 1)
    level.splice(level.indexOf(parent), 1, child!)
    child!.children.unshift(parent)
    return true
  }

  const edit = (tree: Tree): string | null => {
    // Every list of siblings, the empty ones under childless blocks included. Three times in
    // four the edit is made in a level that has blocks, so moves get their share beside inserts.
    const all = levelsOf(tree)
    const filled = all.filter((candidate) => candidate.length)
    const levels = filled.length && random(4) !== 0 ? filled : all
    const level = levels[random(levels.length)]!
    const size = sizeOf(tree)
    // A large tree is trimmed, a small one grown, so the document stays a readable size.
    const kind = size > 36 ? 2 : size < 3 ? 0 : random(13)
    if (kind === 0 || level.length === 0) {
      level.splice(random(level.length + 1), 0, {id: newId(), children: []})
      return 'insert'
    }
    if (kind === 1) {
      level.splice(random(level.length + 1), 0, newSubtree())
      return 'insert-subtree'
    }
    if (kind === 2) {
      const index = random(level.length)
      if (size - sizeOf([level[index]!]) < 1) return null
      level.splice(index, 1)
      return 'delete'
    }
    if (kind <= 4) {
      const length = 1 + random(Math.min(3, level.length))
      const run = level.splice(random(level.length - length + 1), length)
      level.splice(random(level.length + 1), 0, ...run)
      return 'move-run'
    }
    if (kind <= 6) {
      const [block] = level.splice(random(level.length), 1)
      level.splice(random(level.length + 1), 0, block!)
      return 'move'
    }
    if (kind <= 8) {
      // A block and everything under it goes to another level, never one inside itself.
      const index = random(level.length)
      const block = level[index]!
      const targets = levelsOf(tree).filter((target) => target !== level && !holds(block.children, target))
      if (!targets.length) return null
      level.splice(index, 1)
      const into = targets[random(targets.length)]!
      into.splice(random(into.length + 1), 0, block)
      return block.children.length ? 'move-subtree' : 'move-level'
    }
    if (kind === 9) {
      if (level.length < 2) return null
      const index = 1 + random(level.length - 1)
      const [block] = level.splice(index, 1)
      level[index - 1]!.children.push(block!)
      return 'indent'
    }
    if (kind === 10) {
      const parents = level.filter((node) => node.children.length)
      if (!parents.length) return null
      const parent = parents[random(parents.length)]!
      const [block] = parent.children.splice(random(parent.children.length), 1)
      level.splice(level.indexOf(parent) + 1, 0, block!)
      return 'outdent'
    }
    // A parent and one of its children swap places: the child takes the parent's position and
    // the parent becomes the child's first child. Rare, as it is in real editing.
    if (!inversions || random(3) !== 0) return null
    return swapIn(level) ? 'swap' : null
  }

  const mutate = (current: Tree) => {
    remember(current)
    let tree = cloneTree(current)
    const edits: string[] = []
    const wanted = 1 + random(4)
    for (let attempt = 0; edits.length < wanted && attempt < wanted * 4; attempt++) {
      const trial = cloneTree(tree)
      const made = edit(trial)
      if (!made || (!inversions && inverts(trial))) continue
      tree = trial
      // More than the document will hold: only the round's last tree is written.
      remember(tree)
      edits.push(made)
    }
    return {tree, edits}
  }

  const swap = (current: Tree) => {
    const tree = cloneTree(current)
    const levels = levelsOf(tree).filter((level) => level.some((node) => node.children.length))
    if (!levels.length || !swapIn(levels[random(levels.length)]!)) return null
    remember(tree)
    return {tree, edits: ['swap']}
  }
  return {random, mutate, swap}
}

/** Counts of who built each round's Change, and why the local ones were built here. */
export type FuzzStats = {
  rounds: number
  server: number
  local: number
  unchanged: number
  wrong: number
  reasons: Record<string, number>
  edits: Record<string, number>
}

export const newFuzzStats = (): FuzzStats => ({
  rounds: 0,
  server: 0,
  local: 0,
  unchanged: 0,
  wrong: 0,
  reasons: {},
  edits: {},
})

/** Adds one round to `stats`. Block ids and numbers are taken out of the reason so equal causes count together. */
export function recordFuzzRound(
  stats: FuzzStats,
  round: {builtBy?: 'server' | 'local'; localReason?: string; edits: string[]; right: boolean},
) {
  stats.rounds++
  if (!round.right) stats.wrong++
  if (round.builtBy === 'server') stats.server++
  else if (round.builtBy === 'local') {
    stats.local++
    const reason = (round.localReason ?? 'unknown').replace(/block \S+/g, 'block …').replace(/\d+/g, 'N')
    stats.reasons[reason] = (stats.reasons[reason] ?? 0) + 1
  } else stats.unchanged++
  for (const name of round.edits) stats.edits[name] = (stats.edits[name] ?? 0) + 1
}

/** Prints a line of test statistics, and appends it to the file `FUZZ_STATS_FILE` names, if any. */
export function reportStats(line: string) {
  console.log(line)
  if (process.env.FUZZ_STATS_FILE) appendFileSync(process.env.FUZZ_STATS_FILE, `${line}\n`)
}
