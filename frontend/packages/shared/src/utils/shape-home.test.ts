import type {HMDocument, HMDocumentInfo, HMBlockNode, HMRawDocumentChange} from '@seed-hypermedia/client/hm-types'
import {describe, expect, it, vi} from 'vitest'
import {
  SHAPE_HOME_CUTOFF_MS,
  getShapeHomeCandidates,
  homeFirstPublishedAt,
  isShapeHomeEligible,
  loadShapeHomeStatus,
} from './shape-home'
import {hmId} from './entity-id-url'

function child(uid: string, path: string[], overrides: Partial<HMDocumentInfo> = {}): HMDocumentInfo {
  return {
    type: 'document',
    id: hmId(uid, {path}),
    path,
    authors: [],
    createTime: {seconds: 0n, nanos: 0} as any,
    updateTime: {seconds: 0n, nanos: 0} as any,
    sortTime: new Date(0),
    genesis: 'g',
    version: 'v',
    breadcrumbs: [],
    activitySummary: {
      latestCommentId: '',
      commentCount: 0,
      latestChangeTime: {seconds: 0n, nanos: 0},
      isUnread: false,
    } as any,
    generationInfo: {genesis: 'g', generation: 0n} as any,
    metadata: {},
    visibility: 'PUBLIC',
    ...overrides,
  } as HMDocumentInfo
}

function card(link: string): HMBlockNode {
  return {block: {id: 'card', type: 'Embed', link, attributes: {view: 'Card'}}, children: []}
}

function home(
  content: HMBlockNode[] = [],
  navigationCards: string[] = [],
): Pick<HMDocument, 'content' | 'navigationCards'> {
  return {content, navigationCards}
}

describe('homeFirstPublishedAt', () => {
  it('returns null for an empty change list', () => {
    expect(homeFirstPublishedAt([])).toBeNull()
  })

  it('ignores the genesis change with createTime 0', () => {
    const changes = [{createTime: '0'}] as HMRawDocumentChange[]
    expect(homeFirstPublishedAt(changes)).toBeNull()
  })

  it('returns the minimum positive createTime', () => {
    const changes = [
      {createTime: '0'},
      {createTime: new Date(Date.UTC(2026, 5, 10)).toISOString()},
      {createTime: new Date(Date.UTC(2026, 0, 1)).toISOString()},
    ] as HMRawDocumentChange[]
    expect(homeFirstPublishedAt(changes)).toBe(Date.UTC(2026, 0, 1))
  })
})

describe('isShapeHomeEligible', () => {
  it('is eligible when first published before the cutoff with candidates', () => {
    expect(
      isShapeHomeEligible({
        firstPublishedAt: SHAPE_HOME_CUTOFF_MS - 1,
        candidates: [{id: hmId('alice', {path: ['about']}), title: 'About'}],
      }),
    ).toBe(true)
  })

  it('is not eligible at or after the cutoff', () => {
    expect(
      isShapeHomeEligible({
        firstPublishedAt: SHAPE_HOME_CUTOFF_MS,
        candidates: [{id: hmId('alice', {path: ['about']}), title: 'About'}],
      }),
    ).toBe(false)
  })

  it('is not eligible when there are no candidates', () => {
    expect(isShapeHomeEligible({firstPublishedAt: SHAPE_HOME_CUTOFF_MS - 1, candidates: []})).toBe(false)
  })

  it('is not eligible when first published is null (genesis only)', () => {
    expect(
      isShapeHomeEligible({
        firstPublishedAt: null,
        candidates: [{id: hmId('alice', {path: ['about']}), title: 'About'}],
      }),
    ).toBe(false)
  })
})

describe('getShapeHomeCandidates', () => {
  const homeId = hmId('alice')

  it('excludes private children', () => {
    const candidates = getShapeHomeCandidates({
      homeId,
      home: home(),
      children: [
        child('alice', ['about'], {visibility: 'PRIVATE', metadata: {name: 'About'}}),
        child('alice', ['projects'], {metadata: {name: 'Projects'}}),
      ],
    })
    expect(candidates.map((c) => c.title)).toEqual(['Projects'])
  })

  it('excludes children already in navigationCards', () => {
    const about = child('alice', ['about'], {metadata: {name: 'About'}})
    const candidates = getShapeHomeCandidates({
      homeId,
      home: home([], [about.id.id]),
      children: [about, child('alice', ['projects'], {metadata: {name: 'Projects'}})],
    })
    expect(candidates.map((c) => c.title)).toEqual(['Projects'])
  })

  it('excludes children already linked as a Card embed (nested included)', () => {
    const about = child('alice', ['about'], {metadata: {name: 'About'}})
    const projects = child('alice', ['projects'], {metadata: {name: 'Projects'}})
    const content: HMBlockNode[] = [
      {block: {id: 'wrap', type: 'Paragraph', text: '', attributes: {}}, children: [card(about.id.id)]},
    ]
    const candidates = getShapeHomeCandidates({homeId, home: home(content), children: [about, projects]})
    expect(candidates.map((c) => c.title)).toEqual(['Projects'])
  })

  it('keeps a child with an inline (non-Card) link', () => {
    const about = child('alice', ['about'], {metadata: {name: 'About'}})
    const content: HMBlockNode[] = [
      {
        block: {id: 'p', type: 'Paragraph', text: 'see', attributes: {}},
        children: [
          {
            block: {id: 'link', type: 'Paragraph', text: '', attributes: {}},
            children: [],
          } as any,
        ],
      },
    ]
    // Inline link annotation is not a Card embed, so About stays a candidate.
    const candidates = getShapeHomeCandidates({homeId, home: home(content), children: [about]})
    expect(candidates.map((c) => c.title)).toEqual(['About'])
  })

  it('excludes nested (path length > 1) children', () => {
    const candidates = getShapeHomeCandidates({
      homeId,
      home: home(),
      children: [
        child('alice', ['about'], {metadata: {name: 'About'}}),
        child('alice', ['projects', 'alpha'], {metadata: {name: 'Alpha'}}),
      ],
    })
    expect(candidates.map((c) => c.title)).toEqual(['About'])
  })

  it('sorts by title ignoring leading non-letter/non-digit chars, with id tie-break', () => {
    const candidates = getShapeHomeCandidates({
      homeId,
      home: home(),
      children: [
        child('alice', ['quienes'], {metadata: {name: '¿Quiénes somos?'}}),
        child('alice', ['projects'], {metadata: {name: 'Projects'}}),
        child('alice', ['about'], {metadata: {name: 'About'}}),
      ],
    })
    expect(candidates.map((c) => c.title)).toEqual(['About', 'Projects', '¿Quiénes somos?'])
  })

  it('falls back to the last path segment when metadata.name is empty', () => {
    const candidates = getShapeHomeCandidates({
      homeId,
      home: home(),
      children: [child('alice', ['about'], {metadata: {}})],
    })
    expect(candidates.map((c) => c.title)).toEqual(['about'])
  })
})

describe('loadShapeHomeStatus', () => {
  it('returns ineligible when the resource is not a document', async () => {
    const client = {
      request: vi.fn(async (key: string) => {
        if (key === 'Resource') return {type: 'not-found'}
        if (key === 'ListChanges') return {changes: [], latestVersion: ''}
        if (key === 'Query') return {in: hmId('alice'), results: []}
        return {}
      }),
    } as any
    const status = await loadShapeHomeStatus(client, 'alice')
    expect(status).toEqual({firstPublishedAt: null, candidates: [], eligible: false})
  })

  it('composes eligibility from home, changes, and children', async () => {
    const about = child('alice', ['about'], {metadata: {name: 'About'}})
    const homeDoc = {content: [], navigationCards: [], version: 'v'} as any
    const client = {
      request: vi.fn(async (key: string) => {
        if (key === 'Resource') return {type: 'document', document: homeDoc}
        if (key === 'ListChanges')
          return {
            changes: [{createTime: new Date(SHAPE_HOME_CUTOFF_MS - 1000).toISOString()}],
            latestVersion: 'v',
          }
        if (key === 'Query') return {in: hmId('alice'), results: [about]}
        return {}
      }),
    } as any
    const status = await loadShapeHomeStatus(client, 'alice')
    expect(status.eligible).toBe(true)
    expect(status.firstPublishedAt).toBe(SHAPE_HOME_CUTOFF_MS - 1000)
    expect(status.candidates.map((c) => c.title)).toEqual(['About'])
  })
})
