import {describe, expect, it, vi} from 'vitest'
import {hmId} from './entity-id-url'
import {
  inspectChildDeletions,
  validateConfirmedChildDeletions,
  executeConfirmedChildDeletion,
  reconcileChildRemovalIntent,
  reviewConfirmedChildDeletion,
} from './confirmed-child-deletion'
import type {UniversalClient} from '../universal-client'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'

const parentId = hmId('account', {path: ['parent']})
const childId = hmId('account', {path: ['parent', 'child']})
const grandchild = hmId('account', {path: ['parent', 'child', 'nested']})
function clientWith(documents: Map<string, string>, redirects = new Set<string>()) {
  return {
    request: async (type: string, input: any) => {
      if (type === 'Query')
        return {
          results: Array.from(documents.keys())
            .filter((id) => id.startsWith(childId.id + '/'))
            .map((id) => ({id: hmId('account', {path: id.split('/').slice(3)}), version: documents.get(id)})),
        }
      if (redirects.has(input.id)) return {type: 'redirect'}
      if (!documents.has(input.id)) return {type: 'tombstone'}
      return {type: 'document', document: {version: documents.get(input.id), genesis: 'genesis', content: []}}
    },
  } as unknown as Pick<UniversalClient, 'request'>
}

describe('confirmed child deletion safety', () => {
  it('captures the child and its complete descendant scope', async () => {
    const client = clientWith(
      new Map([
        [childId.id, 'v1'],
        [grandchild.id, 'v2'],
      ]),
    )
    expect(await inspectChildDeletions(client, {parentId, childIds: [childId]})).toEqual([
      {
        childId,
        documents: [
          {id: childId.id, version: 'v1'},
          {id: grandchild.id, version: 'v2'},
        ],
      },
    ])
  })
  it('discovers a direct child from an authored custom-domain link removal', async () => {
    resolveUrl.mockResolvedValueOnce({hmId: childId})
    const client = clientWith(new Map([[childId.id, 'v1']]))
    expect(
      await inspectChildDeletions(client, {
        parentId,
        childIds: [],
        removedReferenceTargets: ['https://site.example/parent/child'],
        content: [],
      }),
    ).toEqual([{childId, documents: [{id: childId.id, version: 'v1'}]}])
  })
  it('does not propose deletion when a custom-domain alias survives', async () => {
    resolveUrl.mockResolvedValueOnce({hmId: childId})
    const content = [
      {block: {id: 'link', type: 'Button', link: 'https://site.example/parent/child', attributes: {}}, children: []},
    ] as HMBlockNode[]
    expect(
      await inspectChildDeletions(clientWith(new Map([[childId.id, 'v1']])), {parentId, childIds: [childId], content}),
    ).toEqual([])
  })
  it('keeps children referenced by a self-query, including limited queries', async () => {
    const content = [
      {
        block: {
          id: 'query',
          type: 'Query',
          attributes: {query: {includes: [{space: parentId.uid, path: '/parent', mode: 'Children'}], limit: 1}},
        },
        children: [],
      },
    ] as unknown as HMBlockNode[]
    const client = clientWith(new Map([[childId.id, 'v1']]))
    expect(await inspectChildDeletions(client, {parentId, childIds: [childId], content})).toEqual([])
    await expect(
      validateConfirmedChildDeletions(client, {
        parentId,
        content,
        confirmations: [{childId, documents: [{id: childId.id, version: 'v1'}]}],
      }),
    ).rejects.toThrow('reference')
  })
  it('reviews direct children exposed by removing a self-query, excluding surviving links and foreign results', async () => {
    const retained = hmId('account', {path: ['parent', 'retained']})
    const client = clientWith(
      new Map([
        [childId.id, 'v1'],
        [grandchild.id, 'v2'],
        [retained.id, 'v3'],
      ]),
    )
    const request = client.request
    client.request = (async (type: string, input: any) => {
      if (type === 'Query' && input.includes[0].mode === 'Children')
        return {
          results: [childId, retained, grandchild, hmId('other', {path: ['parent', 'child']})].map((id) => ({id})),
        }
      return request(type as any, input)
    }) as typeof client.request
    const content = [
      {block: {id: 'retained', type: 'Embed', link: retained.id, attributes: {view: 'Card'}}, children: []},
    ] as HMBlockNode[]
    const result = await inspectChildDeletions(client, {parentId, childIds: [], content, removedSelfQuery: true})
    expect(result).toEqual([
      {
        childId,
        documents: [
          {id: childId.id, version: 'v1'},
          {id: grandchild.id, version: 'v2'},
        ],
      },
    ])
  })
  it('rejects targets outside the direct-parent relationship', async () => {
    await expect(inspectChildDeletions(clientWith(new Map()), {parentId, childIds: [grandchild]})).rejects.toThrow(
      'direct child',
    )
  })
  it('requires renewed confirmation for new descendants or changed versions', async () => {
    const confirmations = [{childId, documents: [{id: childId.id, version: 'v1'}]}]
    await expect(
      validateConfirmedChildDeletions(
        clientWith(
          new Map([
            [childId.id, 'v1'],
            [grandchild.id, 'v2'],
          ]),
        ),
        {parentId, content: [], confirmations},
      ),
    ).rejects.toThrow('Confirmation required:')
    await expect(
      validateConfirmedChildDeletions(clientWith(new Map([[childId.id, 'v2']])), {
        parentId,
        content: [],
        confirmations,
      }),
    ).rejects.toThrow('Confirmation required:')
  })
  it('never follows moved targets', async () => {
    await expect(
      inspectChildDeletions(clientWith(new Map(), new Set([childId.id])), {parentId, childIds: [childId]}),
    ).rejects.toThrow('Confirmation required:')
  })
  it('rejects deletion if an inline reference was restored', async () => {
    const content = [
      {
        block: {
          id: 'p',
          type: 'Paragraph',
          text: 'child',
          attributes: {},
          annotations: [{type: 'Link', link: childId.id, starts: [0], ends: [5]}],
        },
        children: [],
      },
    ] as HMBlockNode[]
    await expect(
      validateConfirmedChildDeletions(clientWith(new Map([[childId.id, 'v1']])), {
        parentId,
        content,
        confirmations: [{childId, documents: [{id: childId.id, version: 'v1'}]}],
      }),
    ).rejects.toThrow('reference')
  })
  it('resolves remaining custom-domain links before authorizing deletion', async () => {
    resolveUrl.mockResolvedValueOnce({hmId: childId})
    const content = [
      {block: {id: 'link', type: 'Button', link: 'https://site.example/parent/child', attributes: {}}, children: []},
    ] as HMBlockNode[]
    await expect(
      validateConfirmedChildDeletions(clientWith(new Map([[childId.id, 'v1']])), {
        parentId,
        content,
        confirmations: [{childId, documents: [{id: childId.id, version: 'v1'}]}],
      }),
    ).rejects.toThrow('reference')
  })
  it('does not treat a verified ordinary web link as an unresolved document reference', async () => {
    resolveUrl.mockResolvedValueOnce(null)
    const content = [
      {block: {id: 'link', type: 'Button', link: 'https://ordinary.example/article', attributes: {}}, children: []},
    ] as HMBlockNode[]
    await expect(
      validateConfirmedChildDeletions(clientWith(new Map([[childId.id, 'v1']])), {
        parentId,
        content,
        confirmations: [{childId, documents: [{id: childId.id, version: 'v1'}]}],
      }),
    ).resolves.toBeUndefined()
    expect(resolveUrl).toHaveBeenCalledWith('https://ordinary.example/article', {requireSuccessfulResponse: true})
  })
  it('fails closed when an external link cannot be resolved', async () => {
    resolveUrl.mockRejectedValueOnce(new Error('Network unavailable'))
    const content = [
      {block: {id: 'link', type: 'Button', link: 'https://offline.example/child', attributes: {}}, children: []},
    ] as HMBlockNode[]
    await expect(
      validateConfirmedChildDeletions(clientWith(new Map([[childId.id, 'v1']])), {
        parentId,
        content,
        confirmations: [{childId, documents: [{id: childId.id, version: 'v1'}]}],
      }),
    ).rejects.toThrow('unresolved')
  })
  it('allows retries after an approved descendant was already deleted', async () => {
    await expect(
      validateConfirmedChildDeletions(clientWith(new Map([[childId.id, 'v1']])), {
        parentId,
        content: [],
        confirmations: [
          {
            childId,
            documents: [
              {id: childId.id, version: 'v1'},
              {id: grandchild.id, version: 'v2'},
            ],
          },
        ],
      }),
    ).resolves.toBeUndefined()
  })
})

const {resolveUrl} = vi.hoisted(() => ({resolveUrl: vi.fn(async () => null as any)}))
vi.mock('@seed-hypermedia/client', () => ({
  createTombstoneRef: async (input: unknown) => input,
  resolveHypermediaUrl: resolveUrl,
}))

describe('confirmed deletion execution', () => {
  function setup() {
    const documents = new Map([
      [parentId.id, 'parent-v2'],
      [childId.id, 'v1'],
      [grandchild.id, 'v2'],
    ])
    const base = clientWith(documents)
    const published: string[] = []
    const client = {
      ...base,
      getSigner: () => ({}),
      publish: async (input: any) => {
        const id = `hm://${input.space}${input.path}`
        published.push(id)
        documents.delete(id)
      },
    } as unknown as Pick<UniversalClient, 'request' | 'getSigner' | 'publish'>
    const job = {
      parentDocumentId: parentId.id,
      sourceDocumentId: childId.id,
      approvedSubtree: [
        {id: childId.id, version: 'v1'},
        {id: grandchild.id, version: 'v2'},
      ],
      authorizingParentVersion: 'parent-v2',
      signingAccountUid: 'account',
    }
    return {client, job, documents, published}
  }
  it('deletes deepest first and retries completed work without duplicate tombstones', async () => {
    const {client, job, published} = setup()
    await executeConfirmedChildDeletion(client, job)
    expect(published).toEqual([grandchild.id, childId.id])
    await executeConfirmedChildDeletion(client, job)
    expect(published).toEqual([grandchild.id, childId.id])
  })
  it('requires proof of the authorizing published parent version', async () => {
    const {client, job, published} = setup()
    await expect(
      executeConfirmedChildDeletion(client, {...job, authorizingParentVersion: 'unpublished-version'}),
    ).rejects.toThrow('Confirmation required:')
    expect(published).toEqual([])
  })
  it('does not execute an incomplete approval', async () => {
    const {client, job, published} = setup()
    await expect(executeConfirmedChildDeletion(client, {...job, authorizingParentVersion: undefined})).rejects.toThrow(
      'Confirmation required:',
    )
    expect(published).toEqual([])
  })
  it('stops when a remaining document changes during the deletion sequence', async () => {
    const {client, job, documents, published} = setup()
    const publish = client.publish
    client.publish = async (...args) => {
      const result = await publish(...args)
      documents.set(childId.id, 'edited')
      return result
    }
    await expect(executeConfirmedChildDeletion(client, job)).rejects.toThrow('Confirmation required:')
    expect(published).toEqual([grandchild.id])
  })
})

describe('system maintenance and authored removal intent', () => {
  it('renames existing intent but never invents it', () => {
    const target = hmId('account', {path: ['parent', 'renamed']})
    expect(
      reconcileChildRemovalIntent({operation: 'rewrite', sourceDocumentId: childId.id, targetDocumentId: target.id}, [
        childId.id,
      ]),
    ).toEqual([target.id])
    expect(
      reconcileChildRemovalIntent(
        {operation: 'rewrite', sourceDocumentId: childId.id, targetDocumentId: target.id},
        [],
      ),
    ).toEqual([])
  })
  it('clears intent for a moved/deleted target only', () => {
    expect(
      reconcileChildRemovalIntent({operation: 'remove', sourceDocumentId: childId.id}, [childId.id, grandchild.id]),
    ).toEqual([grandchild.id])
  })
})

describe('renewed deletion consent', () => {
  it('reviews new descendants without deleting anything', async () => {
    const client = clientWith(
      new Map([
        [parentId.id, 'parent-v2'],
        [childId.id, 'v1'],
        [grandchild.id, 'v2'],
      ]),
    )
    expect(
      await reviewConfirmedChildDeletion(client, {
        parentDocumentId: parentId.id,
        sourceDocumentId: childId.id,
        approvedSubtree: [{id: childId.id, version: 'v1'}],
        authorizingParentVersion: 'parent-v2',
      }),
    ).toEqual([
      {id: childId.id, version: 'v1'},
      {id: grandchild.id, version: 'v2'},
    ])
  })
  it('cannot renew consent by following a moved child', async () => {
    const client = clientWith(new Map([[parentId.id, 'parent-v2']]), new Set([childId.id]))
    await expect(
      reviewConfirmedChildDeletion(client, {
        parentDocumentId: parentId.id,
        sourceDocumentId: childId.id,
        approvedSubtree: [{id: childId.id, version: 'v1'}],
        authorizingParentVersion: 'parent-v2',
      }),
    ).rejects.toThrow('original child')
  })
})
