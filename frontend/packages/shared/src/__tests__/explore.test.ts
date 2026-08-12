import {describe, expect, test} from 'vitest'
import {DocumentFilter_Comparison_Operator} from '../client/grpc-types'
import {
  compileExploreQuery,
  clearExploreConditions,
  cycleExploreSort,
  documentInfoToExploreResultDocument,
  exploreQueryChips,
  parseExploreQuery,
  removeExploreQueryChip,
  searchResultItemToExploreResult,
  serializeExploreQuery,
  toggleExplorePredicate,
  toggleExploreColumn,
} from '../explore'
import {hmId} from '../utils/entity-id-url'
import type {HMDocumentInfo} from '@seed-hypermedia/client/hm-types'
import type {SearchResultItem} from '../models/search'
import {assembleExploreResults, exploreStreamSelection} from '../models/explore'

function searchItem(overrides: Partial<SearchResultItem>): SearchResultItem {
  return {
    id: hmId('alice', {path: ['roadmap']}),
    title: 'Roadmap match',
    icon: '',
    parentNames: ['Docs'],
    searchQuery: 'roadmap',
    type: 'document',
    ...overrides,
  }
}

describe('Explore query grammar', () => {
  test('toggles filter predicates on and off without losing presentation directives', () => {
    const parsed = parseExploreQuery('roadmap view:table sort:status')
    const withStatus = toggleExplorePredicate(parsed, 'status:active')
    expect(serializeExploreQuery(withStatus)).toContain('status:active')
    expect(withStatus.presentation).toEqual(parsed.presentation)
    const withoutStatus = toggleExplorePredicate(withStatus, 'status:active')
    expect(serializeExploreQuery(withoutStatus)).not.toContain('status:active')
    expect(withoutStatus.presentation).toEqual(parsed.presentation)
  })

  test('cycles table sorts and preserves a usable column selection', () => {
    expect(cycleExploreSort([], 'status')).toEqual([{key: 'status', direction: 'asc'}])
    expect(cycleExploreSort([{key: 'status', direction: 'asc'}], 'status')).toEqual([
      {key: 'status', direction: 'desc'},
    ])
    expect(cycleExploreSort([{key: 'status', direction: 'desc'}], 'status')).toEqual([])
    expect(toggleExploreColumn(['title', 'status'], 'status')).toEqual(['title'])
    expect(toggleExploreColumn(['title'], 'priority')).toEqual(['title', 'priority'])
    expect(toggleExploreColumn(['title'], 'title')).toEqual(['title'])
  })

  test('clearing builder conditions retains text leaves', () => {
    const parsed = parseExploreQuery('engelbart status:x')
    expect(serializeExploreQuery(clearExploreConditions(parsed.ast), parsed.presentation)).toBe('engelbart')
    const grouped = parseExploreQuery('(engelbart status:x)')
    expect(serializeExploreQuery(clearExploreConditions(grouped.ast), grouped.presentation)).toBe('engelbart')
  })

  test('parses nested boolean structure, typed values, scopes, and free text', () => {
    const parsed = parseExploreQuery('(in:alice OR in:bob) AND type:task status="In Progress" engelbart')
    expect(parsed.ast).toMatchObject({
      kind: 'and',
      children: [
        {
          kind: 'or',
          children: [
            {kind: 'predicate', predicate: {kind: 'scope', scope: 'space', value: 'alice'}},
            {kind: 'predicate', predicate: {kind: 'scope', scope: 'space', value: 'bob'}},
          ],
        },
        {kind: 'predicate', predicate: {kind: 'attribute', key: 'type', operator: 'contains', value: 'task'}},
        {
          kind: 'predicate',
          predicate: {kind: 'attribute', key: 'status', operator: 'comparison', comparison: '=', value: 'In Progress'},
        },
        {kind: 'text', value: 'engelbart', phrase: false},
      ],
    })
    expect(compileExploreQuery(parsed, {type: 'node'}).textTerms).toEqual([{value: 'engelbart', phrase: false}])
  })

  test('hoists presentation directives and keeps them out of the AST', () => {
    const parsed = parseExploreQuery('status:active view:table cols:title,status sort:status,-priority roadmap')
    expect(parsed.presentation).toEqual({
      view: 'table',
      columns: ['title', 'status'],
      sort: [
        {key: 'status', direction: 'asc'},
        {key: 'priority', direction: 'desc'},
      ],
    })
    expect(serializeExploreQuery(parsed)).toBe(
      'status:active AND roadmap view:table cols:title,status sort:status,-priority',
    )
    expect(parsed.ast).not.toMatchObject({kind: 'predicate', predicate: {kind: 'attribute', key: 'view'}})
  })

  test('does not extract directive-looking text from quoted phrases', () => {
    const parsed = parseExploreQuery('"the sort:asc thing"')
    expect(parsed.presentation).toEqual({})
    expect(compileExploreQuery(parsed, {type: 'node'}).textTerms).toEqual([{value: 'the sort:asc thing', phrase: true}])
  })

  test('supports all attribute operators and scalar types', () => {
    const parsed = parseExploreQuery(
      'has:owner missing:archived status:active title~road title^Engelbart estimate>=3 enabled=false',
    )
    expect(compileExploreQuery(parsed, {type: 'node'}).documentPredicates).toEqual([
      {kind: 'attribute', key: 'owner', operator: 'exists'},
      {kind: 'attribute', key: 'archived', operator: 'missing'},
      {kind: 'attribute', key: 'status', operator: 'contains', value: 'active'},
      {kind: 'attribute', key: 'title', operator: 'contains', value: 'road'},
      {kind: 'attribute', key: 'title', operator: 'prefix', value: 'Engelbart'},
      {kind: 'attribute', key: 'estimate', operator: 'comparison', comparison: '>=', value: 3},
      {kind: 'attribute', key: 'enabled', operator: 'comparison', comparison: '=', value: false},
    ])
  })

  test('parses path exact and subtree scopes plus URL scopes', () => {
    const parsed = parseExploreQuery('path:/specs path:/design/* in:hm://alice/projects')
    expect(parsed.ast).toMatchObject({
      kind: 'and',
      children: [
        {kind: 'predicate', predicate: {kind: 'scope', scope: 'path', value: '/specs', prefix: false}},
        {kind: 'predicate', predicate: {kind: 'scope', scope: 'path', value: '/design', prefix: true}},
        {kind: 'predicate', predicate: {kind: 'scope', scope: 'url', value: 'hm://alice/projects'}},
      ],
    })
  })

  test('is forgiving and returns diagnostics for incomplete input', () => {
    expect(
      parseExploreQuery('(status:active').diagnostics.some((item) => item.message.includes('closing parenthesis')),
    ).toBe(true)
    expect(parseExploreQuery('status:').diagnostics.some((item) => item.message.includes('needs a value'))).toBe(true)
    expect(parseExploreQuery('status:active OR').diagnostics.some((item) => item.message.includes('right-hand'))).toBe(
      true,
    )
    expect(() => parseExploreQuery('status:active (')).not.toThrow()
  })
})

describe('Explore query serialization', () => {
  const corpus = [
    '(in:alice OR in:bob) AND type:document status="In Progress" engelbart',
    '(in:alice OR in:bob) AND type:task status="In Progress" engelbart view:table cols:title,status sort:-status',
    'NOT (missing:status OR priority!=low)',
    'project.phase:launch estimate>=3 enabled=true "quoted phrase"',
    'path:/specs/* view:table cols:title,status sort:status,-priority',
  ]

  test.each(corpus)('round-trips %s', (query) => {
    const parsed = parseExploreQuery(query)
    const serialized = parseExploreQuery(serializeExploreQuery(parsed))
    expect(serialized.ast).toEqual(parsed.ast)
    expect(serialized.presentation).toEqual(parsed.presentation)
  })
})

describe('Explore document filter compilation', () => {
  test('preserves nested AND/OR/NOT and excludes free text and global types', () => {
    const filter = compileExploreQuery(parseExploreQuery('(in:alice OR in:bob) AND type:document NOT status:done'), {
      type: 'node',
    }).filter
    expect(filter?.filter.case).toBe('and')
    const children = filter?.filter.case === 'and' ? filter.filter.value.filters : []
    expect(children.map((child) => child.filter.case)).toEqual(['or', 'not'])
    expect(
      children[0]?.filter.case === 'or' ? children[0].filter.value.filters.map((item) => item.filter.case) : [],
    ).toEqual(['spaceMatch', 'spaceMatch'])
  })

  test('adds site context as an outer subtree constraint', () => {
    const filter = compileExploreQuery(parseExploreQuery('status:active has:owner'), {
      type: 'site',
      id: hmId('alice', {path: ['docs']}),
    }).filter
    expect(filter?.filter.case).toBe('and')
    const children = filter?.filter.case === 'and' ? filter.filter.value.filters : []
    expect(children.map((child) => child.filter.case)).toEqual(['urlMatch', 'and'])
    expect(children[0]?.filter.case === 'urlMatch' ? children[0].filter.value.url : '').toBe('hm://alice/docs')
  })

  test('compiles numeric comparisons to typed comparison filters', () => {
    const filter = compileExploreQuery(parseExploreQuery('estimate>=3'), {type: 'node'}).filter
    expect(filter?.filter.case).toBe('comparison')
    if (filter?.filter.case !== 'comparison') throw new Error('expected comparison')
    expect(filter.filter.value.operator).toBe(DocumentFilter_Comparison_Operator.GREATER_THAN_OR_EQUAL)
    expect(filter.filter.value.value?.value.case).toBe('intValue')
    expect(filter.filter.value.value?.value.value).toBe(BigInt(3))
  })

  test('returns engine projections for dropped text and global types', () => {
    const compilation = compileExploreQuery(parseExploreQuery('type:block "search API" status:active'), {type: 'node'})
    expect(compilation.requestedTypes).toEqual(['block'])
    expect(compilation.textTerms).toEqual([{value: 'search API', phrase: true}])
    expect(compilation.documentPredicates).toHaveLength(1)
  })

  test('keeps mixed OR expressions unconstrained on the document side', () => {
    expect(compileExploreQuery(parseExploreQuery('status:x OR engelbart'), {type: 'node'}).filter).toBeUndefined()
    expect(compileExploreQuery(parseExploreQuery('type:comment OR status:x'), {type: 'node'}).filter).toBeUndefined()
    const nested = compileExploreQuery(parseExploreQuery('(status:x OR engelbart) AND type:task'), {
      type: 'node',
    }).filter
    expect(nested?.filter.case).toBe('stringMatch')
    expect(compileExploreQuery(parseExploreQuery('NOT engelbart'), {type: 'node'}).filter).toBeUndefined()
  })

  test('does not compile a partially representable conjunction under NOT', () => {
    expect(
      compileExploreQuery(parseExploreQuery('NOT (status:x AND engelbart)'), {type: 'node'}).filter,
    ).toBeUndefined()
  })

  test('keeps negated scopes and types out of positive search projections', () => {
    const scope = compileExploreQuery(parseExploreQuery('NOT in:alice engelbart'), {type: 'node'})
    expect(scope.positiveScopes).toEqual([])
    expect(scope.documentPredicates).toHaveLength(1)
    const types = compileExploreQuery(parseExploreQuery('NOT type:comment engelbart'), {type: 'node'})
    expect(types.requestedTypes).toEqual([])
    expect(types.excludedTypes).toEqual(['comment'])
  })
})

describe('Explore chips', () => {
  test('projects stable chips and removes nested leaves while collapsing groups', () => {
    const parsed = parseExploreQuery('(in:alice OR in:bob) AND status:active engelbart')
    const chips = exploreQueryChips(parsed)
    expect(chips.map((chip) => chip.label)).toEqual(['In alice', 'In bob', 'status : active', 'text engelbart'])
    const next = removeExploreQueryChip(parsed, chips[0]!.id)
    expect(exploreQueryChips(next).map((chip) => chip.label)).toEqual(['In bob', 'status : active', 'text engelbart'])
    const final = removeExploreQueryChip(next, exploreQueryChips(next)[0]!.id)
    expect(final.ast).toMatchObject({kind: 'and'})
    expect(exploreQueryChips(final).map((chip) => chip.label)).toEqual(['status : active', 'text engelbart'])
  })
})

describe('search result mapping', () => {
  test('maps document, block, comment, and excludes contacts', () => {
    expect(searchResultItemToExploreResult(searchItem({type: 'document'}))).toMatchObject({
      type: 'document',
      matchText: 'Roadmap match',
    })
    const id = hmId('alice', {path: ['roadmap'], blockRef: 'block-1', blockRange: {start: 2, end: 6}})
    expect(searchResultItemToExploreResult(searchItem({id, type: 'document'}))).toMatchObject({
      type: 'block',
      id: {blockRef: 'block-1'},
    })
    expect(searchResultItemToExploreResult(searchItem({type: 'comment', commentId: 'comment-1'}))).toMatchObject({
      type: 'comment',
      commentId: 'comment-1',
    })
    expect(searchResultItemToExploreResult(searchItem({type: 'contact'}))).toBe(null)
  })

  test('maps document info to a document result', () => {
    const document = {
      type: 'document',
      id: hmId('alice', {path: ['roadmap']}),
      path: ['roadmap'],
      metadata: {name: 'Roadmap'},
      updateTime: '2026-01-01T00:00:00.000Z',
      breadcrumbs: [{id: hmId('alice'), name: 'Home'}],
    } as unknown as HMDocumentInfo
    expect(documentInfoToExploreResultDocument(document)).toMatchObject({
      type: 'document',
      breadcrumb: ['Home'],
      versionTime: '2026-01-01T00:00:00.000Z',
    })
  })

  test('intersects text hits with document results and deduplicates documents', () => {
    const parsed = parseExploreQuery('status:active roadmap')
    const document = {
      type: 'document',
      id: hmId('alice', {path: ['roadmap'], version: 'document-version'}),
      path: ['roadmap'],
      metadata: {status: 'active'},
      updateTime: '2026-01-01T00:00:00.000Z',
      breadcrumbs: [],
    } as unknown as HMDocumentInfo
    const result = assembleExploreResults({
      parsed,
      context: {type: 'node'},
      documentPages: [{documents: [document], nextPageToken: ''}],
      textPages: [
        {
          entities: [
            searchItem({id: hmId('alice', {path: ['roadmap'], version: 'search-version'})}),
            searchItem({id: hmId('alice', {path: ['unrelated']}), title: 'Unrelated'}),
          ],
          nextPageToken: '',
        },
      ],
    })
    expect(result.results).toHaveLength(1)
    expect(result.results[0]).toMatchObject({
      type: 'document',
      matchText: 'Roadmap match',
      matchedFields: [{label: 'status', value: 'active'}],
    })
  })

  test('intersects documents across stream versions and groups blocks by versionless parent', () => {
    const document = {
      type: 'document',
      id: hmId('alice', {path: ['roadmap'], version: 'document-version'}),
      path: ['roadmap'],
      metadata: {status: 'active'},
      updateTime: '2026-01-01T00:00:00.000Z',
      breadcrumbs: [],
    } as unknown as HMDocumentInfo
    const result = assembleExploreResults({
      parsed: parseExploreQuery('status:active roadmap'),
      context: {type: 'node'},
      documentPages: [{documents: [document], nextPageToken: ''}],
      textPages: [
        {
          entities: [
            searchItem({id: hmId('alice', {path: ['roadmap'], version: 'search-version'})}),
            searchItem({
              id: hmId('alice', {
                path: ['roadmap'],
                version: 'search-block-version',
                blockRef: 'block-1',
                blockRange: {start: 0, end: 4},
              }),
            }),
          ],
          nextPageToken: '',
        },
      ],
    })
    expect(result.documents).toHaveLength(1)
    expect(result.blocksByDocument['alice:roadmap']).toHaveLength(1)
  })

  test('filters negated result types and scopes without narrowing search projections', () => {
    const result = assembleExploreResults({
      parsed: parseExploreQuery('NOT type:comment NOT in:alice roadmap'),
      context: {type: 'node'},
      textPages: [
        {
          entities: [searchItem({type: 'document'}), searchItem({type: 'comment', commentId: 'excluded'})],
          nextPageToken: '',
        },
      ],
    })
    expect(result.results).toHaveLength(1)
    expect(result.results[0]?.type).toBe('document')
  })

  test('does not emit predicate-only documents during an intersection', () => {
    const parsed = parseExploreQuery('status:active roadmap')
    const matching = {
      type: 'document',
      id: hmId('alice', {path: ['roadmap']}),
      path: ['roadmap'],
      metadata: {status: 'active'},
      updateTime: '2026-01-01T00:00:00.000Z',
      breadcrumbs: [],
    } as unknown as HMDocumentInfo
    const predicateOnly = {
      ...matching,
      id: hmId('alice', {path: ['other']}),
      path: ['other'],
    } as unknown as HMDocumentInfo
    const result = assembleExploreResults({
      parsed,
      context: {type: 'node'},
      documentPages: [{documents: [matching, predicateOnly], nextPageToken: ''}],
      textPages: [{entities: [searchItem({id: matching.id})], nextPageToken: ''}],
    })
    expect(result.documents.map((item) => item.type === 'document' && item.id.path)).toEqual([['roadmap']])
  })

  test('holds intersection results until the document stream is ready', () => {
    const result = assembleExploreResults({
      parsed: parseExploreQuery('status:active roadmap'),
      context: {type: 'node'},
      textPages: [{entities: [searchItem({})], nextPageToken: ''}],
      intersectionPending: true,
    })
    expect(result.results).toEqual([])
    expect(result.intersectionPending).toBe(true)
  })

  test('selects only the streams represented by the query', () => {
    expect(exploreStreamSelection(parseExploreQuery('roadmap'), {type: 'node'})).toEqual({
      text: true,
      documents: false,
      intersection: false,
    })
    expect(exploreStreamSelection(parseExploreQuery('status:active'), {type: 'node'})).toEqual({
      text: false,
      documents: true,
      intersection: false,
    })
    expect(exploreStreamSelection(parseExploreQuery('status:active roadmap'), {type: 'node'})).toEqual({
      text: true,
      documents: true,
      intersection: true,
    })
  })

  test('applies global type filters while retaining text terms and diagnostics', () => {
    const parsed = parseExploreQuery('type:comment roadmap')
    const result = assembleExploreResults({
      parsed,
      context: {type: 'node'},
      textPages: [
        {
          entities: [searchItem({type: 'comment', commentId: 'c1'}), searchItem({type: 'document'})],
          nextPageToken: '',
        },
      ],
    })
    expect(result.comments).toHaveLength(1)
    expect(result.documents).toHaveLength(0)
    expect(result.textTerms).toEqual(['roadmap'])
    expect(result.counts).toMatchObject({all: 1, comment: 1})
  })
})
