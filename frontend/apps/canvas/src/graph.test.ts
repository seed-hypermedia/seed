import {describe, expect, it} from 'vitest'
import {
  canonicalId,
  commentConnections,
  extractLinks,
  mergeDocuments,
  parseLayout,
  reconcileSite,
  allocateCards,
  focusBounds,
  focusPositions,
  type CanvasDocument,
} from './graph'

const doc = (id: string, version = 'v1'): CanvasDocument => ({
  id,
  title: id,
  siteUid: 'Alice',
  origin: 'https://alice.example',
  path: [],
  version,
  content: [],
  external: false,
  commentCount: 0,
})

describe('Seed graph', () => {
  it('merges block and version references into the same document without folding account case', () => {
    expect(canonicalId('hm://Alice/notes?v=old#block')).toBe('hm://Alice/notes')
    expect(canonicalId('hm://alice/notes')).not.toBe(canonicalId('hm://Alice/notes'))
    expect(canonicalId('javascript:alert(1)')).toBeNull()
  })

  it('finds nested links and annotations, retaining the passage that created the connection', () => {
    const links = extractLinks(
      'hm://Alice/a',
      [
        {
          block: {
            id: 'paragraph',
            type: 'Paragraph',
            text: 'See this',
            annotations: [{type: 'Link', starts: [0], ends: [3], link: 'hm://Bob/b?v=one#quote'}],
          },
          children: [{block: {id: 'embed', type: 'Embed', link: 'https://alice.example/c'}}],
        },
      ] as never,
      [{uid: 'Alice', origin: 'https://alice.example', title: 'Alice'}],
    )
    expect(links.map((l) => [l.source, l.target, l.sourceBlock])).toEqual([
      ['hm://Alice/a', 'hm://Bob/b', 'paragraph'],
      ['hm://Alice/a', 'hm://Alice/c', 'embed'],
    ])
    expect(links[0].reference).toBe('hm://Bob/b?v=one#quote')
  })

  it('replaces changed content while retaining documents from other loaded sites', () => {
    const previous = {'hm://Alice/a': doc('hm://Alice/a'), 'hm://Bob/b': {...doc('hm://Bob/b'), siteUid: 'Bob'}}
    const next = mergeDocuments(previous, [doc('hm://Alice/a', 'v2'), doc('hm://Alice/new')])
    expect(next['hm://Alice/a'].version).toBe('v2')
    expect(next['hm://Bob/b']).toBe(previous['hm://Bob/b'])
    expect(Object.keys(next)).toHaveLength(3)
  })

  it('rejects malformed saved layouts and accepts finite positions and valid site URLs', () => {
    expect(parseLayout('{broken')).toBeNull()
    expect(parseLayout(JSON.stringify({version: 1, sites: ['javascript:alert(1)']}))).toBeNull()
    const layout = {
      version: 1,
      sites: ['https://alice.example'],
      positions: {'hm://Alice/a': {x: 20, y: 40}},
      viewport: {x: 10, y: 20, zoom: 0.8},
      pinned: [],
      expanded: [],
    }
    expect(parseLayout(JSON.stringify(layout))).toEqual(layout)
    expect(parseLayout(JSON.stringify({...layout, viewport: {x: 0, y: 0, zoom: 0}}))).toBeNull()
  })

  it('resolves cross-site web links to the same target as Seed references', () => {
    const links = extractLinks(
      'hm://Alice/a',
      [{block: {id: 'p', type: 'Embed', link: 'https://bob.example/article#quote'}}] as never,
      [],
      {'https://bob.example/article#quote': 'hm://Bob/article'},
    )
    expect(links[0].target).toBe('hm://Bob/article')
  })

  it('reconciles a complete site snapshot without deleting other sites or clearing existing content', () => {
    const previous = {
      'hm://Alice/a': doc('hm://Alice/a'),
      'hm://Alice/gone': doc('hm://Alice/gone'),
      'hm://Bob/b': {...doc('hm://Bob/b'), siteUid: 'Bob'},
    }
    const result = reconcileSite(previous, [doc('hm://Alice/a', 'v2')], 'Alice')
    expect(result.documents['hm://Alice/a'].content).toBe(previous['hm://Alice/a'].content)
    expect(result.documents['hm://Alice/gone'].unavailable).toBe(true)
    expect(result.documents['hm://Bob/b']).toBe(previous['hm://Bob/b'])
    expect(result.changed.map((d) => d.id)).toEqual(['hm://Alice/a'])
    expect(result.removed).toEqual(['hm://Alice/gone'])
  })

  it('promotes a previously loaded external card when its whole site is added', () => {
    const original = {...doc('hm://Alice/a'), external: true, origin: 'https://hyper.media'}
    const result = reconcileSite({'hm://Alice/a': original}, [doc('hm://Alice/a')], 'Alice')
    expect(result.documents['hm://Alice/a'].external).toBe(false)
    expect(result.documents['hm://Alice/a'].origin).toBe('https://alice.example')
    expect(result.documents['hm://Alice/a'].content).toBe(original.content)
  })

  it('keeps saved positions and puts new sections outside their occupied bounds', () => {
    const first = doc('hm://Alice/a')
    const second = {...doc('hm://Bob/b'), siteUid: 'Bob'}
    const saved = {[first.id]: {x: 120, y: 80}}
    const positions = allocateCards([first, second], saved, new Map())
    expect(positions[first.id]).toEqual({x: 120, y: 80})
    expect(positions[second.id].x).toBeGreaterThan(430)
    expect(saved).toEqual({[first.id]: {x: 120, y: 80}})
  })
})

it('maps view suffixes to the document, including home views and encoded web suffixes', () => {
  expect(canonicalId('hm://Alice/notes:activity?v=old#block')).toBe('hm://Alice/notes')
  expect(canonicalId('hm://Alice/:discussions')).toBe('hm://Alice')
  expect(canonicalId('hm://Alice:directory')).toBe('hm://Alice')
  const links = extractLinks(
    'hm://Alice',
    [
      {block: {id: 'a', type: 'Embed', link: 'hm://Alice/notes:activity'}},
      {block: {id: 'a', type: 'Embed', link: 'https://alice.example/notes%3Adiscussions'}},
    ] as never,
    [{uid: 'Alice', origin: 'https://alice.example', title: 'Alice'}],
  )
  expect(links).toHaveLength(1)
  expect(links[0].target).toBe('hm://Alice/notes')
})

it('migrates saved view cards to one page while preferring its original position', () => {
  const layout = parseLayout(
    JSON.stringify({
      version: 1,
      sites: ['https://alice.example'],
      positions: {'hm://Alice/a:activity': {x: 9, y: 9}, 'hm://Alice/a': {x: 1, y: 2}},
      viewport: {x: 0, y: 0, zoom: 1},
      pinned: [],
      expanded: ['hm://Alice/a:activity', 'hm://Alice/a'],
    }),
  )!
  expect(layout.positions).toEqual({'hm://Alice/a': {x: 1, y: 2}})
  expect(layout.expanded).toEqual(['hm://Alice/a'])
})

it('fits only the focused page and direct connections, even when nodes are hidden or unmeasured', () => {
  const nodes = [
    {id: 'a', position: {x: 100, y: 100}, hidden: true},
    {id: 'b', position: {x: 500, y: 100}, hidden: true},
    {id: 'unrelated', position: {x: 90000, y: 90000}},
  ]
  expect(
    focusBounds(
      'a',
      [
        {source: 'a', target: 'b'},
        {source: 'b', target: 'unrelated'},
      ],
      nodes,
    ),
  ).toEqual({x: 100, y: 100, width: 740, height: 330})
  expect(focusBounds('a', [], nodes)).toEqual({x: 100, y: 100, width: 340, height: 330})
})

it('places home first and nested documents beside their path group', () => {
  const records = [
    {...doc('hm://Alice/z/child'), path: ['z', 'child']},
    {...doc('hm://Alice/z'), path: ['z']},
    doc('hm://Alice'),
  ]
  const positions = allocateCards(records, {}, new Map())
  expect(positions['hm://Alice'].x).toBeLessThan(positions['hm://Alice/z'].x)
  expect(positions['hm://Alice/z/child'].x).toBeGreaterThan(positions['hm://Alice/z'].x)
})

it('retains settled redirect state across an unchanged listing', () => {
  const redirect = {...doc('hm://Alice/old'), resourceType: 'redirect' as const, redirectTarget: 'hm://Alice/new'}
  const result = reconcileSite({[redirect.id]: redirect}, [doc(redirect.id)], 'Alice')
  expect(result.changed).toEqual([])
  expect(result.documents[redirect.id]).toBe(redirect)
})

it('keeps focus compact regardless of where site cards are saved', () => {
  const positions = focusPositions('a', [
    {source: 'b', target: 'a'},
    {source: 'a', target: 'c'},
    {source: 'c', target: 'other'},
  ])
  expect(Object.keys(positions).sort()).toEqual(['a', 'b', 'c'])
  expect(positions.a.x).toBe(0)
  expect(positions.b.x).toBe(600)
  expect(positions.c.x).toBe(1170)
})

it('drops cached comment connections after the parent or target is deleted', () => {
  const parent = doc('hm://Alice/a'),
    target = doc('hm://Alice/b')
  const threads = [
    {
      id: 'thread',
      documentId: parent.id,
      authors: {},
      comments: [{id: 'comment', content: [{block: {id: 'p', type: 'Embed', link: target.id}}]}],
    },
  ] as never
  expect(commentConnections(threads, {[parent.id]: parent, [target.id]: target}, [], {})).toHaveLength(1)
  expect(commentConnections(threads, {[parent.id]: {...parent, resourceType: 'tombstone'}}, [], {})).toEqual([])
  expect(commentConnections(threads, {[parent.id]: {...parent, unavailable: true}}, [], {})).toEqual([])
  expect(
    commentConnections(threads, {[parent.id]: parent, [target.id]: {...target, unavailable: true}}, [], {}),
  ).toEqual([])
})

it('retries failed citations even when the document body and version are unchanged', () => {
  const page = {...doc('hm://Alice/a'), citationError: true}
  expect(reconcileSite({[page.id]: page}, [doc(page.id)], 'Alice').changed.map((d) => d.id)).toEqual([page.id])
})

it('lays out thousands of documents without duplicate positions and preserves them during updates', () => {
  const documents = Array.from({length: 2000}, (_, index) => ({
    ...doc(`hm://Alice/tasks/${index}`),
    path: ['tasks', String(index)],
  }))
  const sections = new Map<string, number>()
  const positions = allocateCards(documents, {}, sections)
  expect(new Set(Object.values(positions).map((p) => `${p.x},${p.y}`)).size).toBe(2000)
  expect(allocateCards(documents, positions, sections)).toEqual(positions)
})

it('keeps the focused page anchored while new connections arrive', () => {
  const before = focusPositions('a', [])
  const after = focusPositions(
    'a',
    Array.from({length: 100}, (_, i) => ({source: 'a', target: `neighbor-${i}`})),
  )
  expect(after.a).toEqual(before.a)
  const nodes = Object.entries(after).map(([id, position]) => ({id, position}))
  const bounds = focusBounds(
    'a',
    Object.keys(after)
      .filter((id) => id !== 'a')
      .map((target) => ({source: 'a', target})),
    nodes,
  )!
  expect(bounds.x).toBe(0)
  expect(bounds.y).toBe(0)
  expect(bounds.width).toBeGreaterThan(5000)
})

it('keeps profile views as accounts distinct from home and other document views', () => {
  expect(canonicalId('hm://Alice:profile')).toBe('hm://Alice/:profile')
  expect(canonicalId('hm://Alice/:profile?v=old#bio')).toBe('hm://Alice/:profile')
  expect(canonicalId('hm://Alice/notes:profile')).toBe('hm://Alice/:profile')
  expect(canonicalId('hm://Alice/:activity')).toBe('hm://Alice')
  const links = extractLinks(
    'hm://Bob/page',
    [
      {block: {id: 'a', type: 'Embed', link: 'https://alice.example/:profile'}},
      {block: {id: 'b', type: 'Embed', link: 'hm://Alice/'}},
    ] as never,
    [{uid: 'Alice', origin: 'https://alice.example', title: 'Alice'}],
  )
  expect(links.map((l) => l.target)).toEqual(['hm://Alice/:profile', 'hm://Alice'])
})

it('keeps an account card when the site document listing has no profile entry', () => {
  const account = {...doc('hm://Alice/:profile'), resourceType: 'account' as const}
  const result = reconcileSite({[account.id]: account}, [doc('hm://Alice')], 'Alice')
  expect(result.documents[account.id]).toBe(account)
  expect(result.removed).toEqual([])
})

it('restores profile positions separately from home positions', () => {
  const layout = parseLayout(
    JSON.stringify({
      version: 1,
      sites: ['https://alice.example'],
      positions: {'hm://Alice:profile': {x: 8, y: 9}, 'hm://Alice': {x: 1, y: 2}},
      viewport: {x: 0, y: 0, zoom: 1},
      pinned: [],
      expanded: ['hm://Alice:profile'],
    }),
  )!
  expect(layout.positions['hm://Alice/:profile']).toEqual({x: 8, y: 9})
  expect(layout.positions['hm://Alice']).toEqual({x: 1, y: 2})
})
