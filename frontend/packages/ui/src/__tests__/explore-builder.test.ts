import {describe, expect, test} from 'vitest'
import {parseExploreQuery} from '@shm/shared/explore'
import {serializeExploreBuilderQuery} from '../explore-page'

describe('Explore builder serialization', () => {
  test('keeps an empty group pending until it has serializable conditions', () => {
    const base = parseExploreQuery('in:alice path:/tasks/*')
    const pending = {
      kind: 'and' as const,
      children: [base.ast!, {kind: 'or' as const, children: []}],
    }

    expect(parseExploreQuery(serializeExploreBuilderQuery(pending, base.presentation)).ast).toEqual(base.ast)

    const completed = {
      ...pending,
      children: [
        pending.children[0]!,
        {
          kind: 'or' as const,
          children: [
            {
              kind: 'predicate' as const,
              predicate: {kind: 'attribute' as const, key: 'status', operator: 'contains' as const, value: 'done'},
            },
            {
              kind: 'predicate' as const,
              predicate: {kind: 'attribute' as const, key: 'priority', operator: 'contains' as const, value: 'high'},
            },
          ],
        },
      ],
    }
    const query = serializeExploreBuilderQuery(completed, base.presentation)
    const parsed = parseExploreQuery(query)

    expect(parsed.diagnostics).toEqual([])
    expect(parsed.ast).toMatchObject({
      kind: 'and',
      children: [{kind: 'predicate'}, {kind: 'predicate'}, {kind: 'or'}],
    })
  })
})
