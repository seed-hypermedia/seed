import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it, vi} from 'vitest'
import {findLatestVersionWithBlock} from '../block-version'

function contentWith(...blockIds: string[]): HMBlockNode[] {
  return blockIds.map(
    (id) =>
      ({
        block: {id, type: 'Paragraph', text: `text ${id}`, attributes: {}, annotations: []},
        children: [],
      }) as HMBlockNode,
  )
}

function loader(contents: Record<string, HMBlockNode[] | null>) {
  const calls: string[] = []
  const loadContent = vi.fn(async (version: string) => {
    calls.push(version)
    return contents[version] ?? null
  })
  return {loadContent, calls}
}

describe('findLatestVersionWithBlock', () => {
  // Linear history A → B → C → D; the embed was written on B.
  const changes = [
    {id: 'A', deps: [], createTime: '2024-01-01'},
    {id: 'B', deps: ['A'], createTime: '2024-01-02'},
    {id: 'C', deps: ['B'], createTime: '2024-01-03'},
    {id: 'D', deps: ['C'], createTime: '2024-01-04'},
  ]

  it('returns the newest descendant that still contains the block', async () => {
    const {loadContent, calls} = loader({
      C: contentWith('block-1'),
      B: contentWith('block-1'),
    })
    const result = await findLatestVersionWithBlock({
      changes,
      latestVersion: 'D',
      knownVersion: 'B',
      blockId: 'block-1',
      loadContent,
    })
    expect(result).toBe('C')
    expect(calls).not.toContain('D')
  })

  it('falls back to the known version when no descendant contains the block', async () => {
    const {loadContent} = loader({C: contentWith('other-block')})
    const result = await findLatestVersionWithBlock({
      changes,
      latestVersion: 'D',
      knownVersion: 'B',
      blockId: 'block-1',
      loadContent,
    })
    expect(result).toBe('B')
  })

  it('returns the known version without lookups when it is not in changes', async () => {
    const {loadContent, calls} = loader({})
    const result = await findLatestVersionWithBlock({
      changes,
      latestVersion: 'D',
      knownVersion: 'X',
      blockId: 'block-1',
      loadContent,
    })
    expect(result).toBe('X')
    expect(calls).toHaveLength(0)
  })

  it('caps lookups at maxLookups and falls back to the known version', async () => {
    const longChain = [
      {id: 'A', deps: [], createTime: '2024-01-01'},
      {id: 'B', deps: ['A'], createTime: '2024-01-02'},
      ...Array.from({length: 20}, (_, i) => ({
        id: `N${i}`,
        deps: [i === 0 ? 'B' : `N${i - 1}`],
        createTime: `2024-02-${String(i + 1).padStart(2, '0')}`,
      })),
      {id: 'D', deps: ['N19'], createTime: '2024-03-01'},
    ]
    const {loadContent, calls} = loader({})
    const result = await findLatestVersionWithBlock({
      changes: longChain,
      latestVersion: 'D',
      knownVersion: 'B',
      blockId: 'block-1',
      loadContent,
      maxLookups: 3,
    })
    expect(result).toBe('B')
    expect(calls).toHaveLength(3)
  })

  it('returns the newest of several descendants containing the block', async () => {
    const branching = [
      {id: 'B', deps: ['A'], createTime: '2024-01-02'},
      {id: 'A', deps: [], createTime: '2024-01-01'},
      {id: 'C', deps: ['B'], createTime: '2024-01-03'},
      {id: 'E', deps: ['B'], createTime: '2024-01-05'},
      {id: 'D', deps: ['C', 'E'], createTime: '2024-01-06'},
    ]
    const {loadContent} = loader({
      C: contentWith('block-1'),
      E: contentWith('block-1'),
    })
    const result = await findLatestVersionWithBlock({
      changes: branching,
      latestVersion: 'D',
      knownVersion: 'B',
      blockId: 'block-1',
      loadContent,
    })
    expect(result).toBe('E')
  })

  it('accepts a dot-separated multi-head known version', async () => {
    const multiHead = [
      {id: 'A', deps: [], createTime: '2024-01-01'},
      {id: 'B1', deps: ['A'], createTime: '2024-01-02'},
      {id: 'B2', deps: ['A'], createTime: '2024-01-02'},
      {id: 'C', deps: ['B1'], createTime: '2024-01-03'},
      {id: 'F', deps: ['B2'], createTime: '2024-01-04'},
      {id: 'D', deps: ['C', 'F'], createTime: '2024-01-05'},
    ]
    const {loadContent} = loader({
      C: contentWith('block-1'),
      F: contentWith('other'),
    })
    const result = await findLatestVersionWithBlock({
      changes: multiHead,
      latestVersion: 'D',
      knownVersion: 'B1.B2',
      blockId: 'block-1',
      loadContent,
    })
    expect(result).toBe('C')
  })
})
