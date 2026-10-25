import {describe, expect, it, vi} from 'vitest'
import {createChangeOps, unpackHmId} from '@seed-hypermedia/client'
import {decode, encode} from '@ipld/dag-cbor'
import {base58btc} from 'multiformats/bases/base58'
import {createDocumentPageAccess, documentPageContent, DOCUMENT_PAGE_SIGNING_HELPERS} from './document-page-content'
import type {PagePermissionDecision} from './document-page-permissions'
import {DOCUMENT_PAGE_SIGNING_HELPER_NAMES} from './document-page'
import type {UniversalClient} from './universal-client'

async function fixture() {
  const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
  const publicKey = new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))
  const principal = new Uint8Array([0xed, 1, ...publicKey])
  const account = base58btc.encode(principal)
  const controller = new AbortController()
  const sign = vi.fn(
    async (data: Uint8Array) => new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, data)),
  )
  const publish = vi.fn(async (_payload: unknown) => ({cids: ['published-cid']}))
  const approve = vi.fn(
    async (
      _request: import('./document-page-permissions').PagePermissionRequest,
      _signal: AbortSignal,
    ): Promise<PagePermissionDecision> => 'once',
  )
  const request = vi.fn(async (..._args: unknown[]): Promise<unknown> => null)
  const options = {
    context: {
      protocol: 1 as const,
      account,
      document: `hm://${account}/pages/test`,
      version: 'bafybeibowhl2ypujel2qrmcps2qy2szwv3ruyjqliqejr6jg4kil437y3e',
      page: 'bundle',
    },
    visibility: 'PUBLIC' as const,
    client: {
      getSigner: vi.fn(() => ({getPublicKey: async () => principal, sign})),
      publish,
      request: request as UniversalClient['request'],
    },
    access: createDocumentPageAccess(approve),
    signal: controller.signal,
  }
  const content = await documentPageContent({
    ...options,
    method: 'hm.parseMarkdown',
    params: {markdown: 'Hello **world** 🌱'},
  })
  return {options, content, keys, controller, sign, publish, approve, request}
}

describe('custom HTML page content and signing', () => {
  it('inherits private visibility and rejects empty comments', async () => {
    const {options, content, publish} = await fixture()
    await documentPageContent({...options, visibility: 'PRIVATE', method: 'comments.create', params: {content}})
    const {blobs} = publish.mock.calls[0]![0] as {blobs: {data: Uint8Array}[]}
    expect((decode(blobs[0]!.data) as Record<string, unknown>).visibility).toBe('Private')
    const empty = await documentPageContent({...options, method: 'hm.parseMarkdown', params: {markdown: ''}})
    await expect(
      documentPageContent({...options, method: 'comments.create', params: {content: empty}}),
    ).rejects.toThrow()
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('uses SDK blocks and produces a verifiable HM comment signed as the viewer on the pinned page document', async () => {
    const {options, content, keys, sign, publish} = await fixture()
    expect(content).toMatchObject([{block: {type: 'Paragraph', text: 'Hello world 🌱', annotations: [{type: 'Bold'}]}}])
    expect(await documentPageContent({...options, method: 'hm.validateContent', params: {content}})).toEqual(content)
    expect(sign).not.toHaveBeenCalled()
    const result = await documentPageContent({...options, method: 'comments.create', params: {content}})
    const {blobs} = publish.mock.calls[0]![0] as {blobs: {data: Uint8Array}[]}
    const blob = decode(blobs[0]!.data) as Record<string, unknown>
    expect(blob.type).toBe('Comment')
    expect(blob.path).toBe('/pages/test')
    expect((blob.version as unknown[]).map(String)).toEqual([options.context.version])
    expect(base58btc.encode(blob.signer as Uint8Array)).toBe(options.context.account)
    expect(
      await crypto.subtle.verify(
        'Ed25519',
        keys.publicKey,
        blob.sig as Uint8Array,
        encode({...blob, sig: new Uint8Array(64)}),
      ),
    ).toBe(true)
    expect(result).toMatchObject({
      commentId: expect.stringContaining(options.context.account),
      version: 'published-cid',
    })
  })

  it('refuses account, destination, and visibility overrides without invoking the signer', async () => {
    const {options, content, sign} = await fixture()
    for (const extra of [{account: 'other'}, {document: 'hm://other'}, {visibility: 'PUBLIC'}, {signer: 'other'}]) {
      await expect(
        documentPageContent({...options, method: 'comments.create', params: {content, ...extra}}),
      ).rejects.toThrow()
    }
    expect(sign).not.toHaveBeenCalled()
  })

  it('cancellation and sign-out never invoke the signer or publisher', async () => {
    const {options, content, sign, publish} = await fixture()
    await expect(
      documentPageContent({
        ...options,
        access: createDocumentPageAccess(async () => 'deny'),
        method: 'comments.create',
        params: {content},
      }),
    ).rejects.toThrow('denied')
    await expect(
      documentPageContent({
        ...options,
        context: {...options.context, account: null},
        method: 'comments.create',
        params: {content},
      }),
    ).rejects.toThrow('Sign in')
    expect(sign).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('revocation while approval is pending prevents signing', async () => {
    const {options, content, controller, sign, publish} = await fixture()
    await expect(
      documentPageContent({
        ...options,
        method: 'comments.create',
        params: {content},
        access: createDocumentPageAccess(async () => {
          controller.abort()
          return 'once'
        }),
      }),
    ).rejects.toThrow()
    expect(sign).not.toHaveBeenCalled()
    expect(publish).not.toHaveBeenCalled()
  })

  it('revocation during signing prevents publishing', async () => {
    const {options, content, controller, sign, publish} = await fixture()
    const signer = options.client.getSigner()
    options.client.getSigner.mockReturnValue({
      ...signer,
      sign: vi.fn(async (data: Uint8Array) => {
        const signature = await sign(data)
        controller.abort()
        return signature
      }),
    })
    await expect(documentPageContent({...options, method: 'comments.create', params: {content}})).rejects.toThrow()
    expect(publish).not.toHaveBeenCalled()
  })
  it('prompts independently for reads, publishing and raw signing', async () => {
    const {options, approve, keys, request, publish} = await fixture()
    const call = (method: string, params = {}) => documentPageContent({...options, method, params})
    await call('permissions.request')
    const message = new TextEncoder().encode('arbitrary account signature')
    const signature = (await call('signer.sign', {data: message})) as Uint8Array
    expect(await crypto.subtle.verify('Ed25519', keys.publicKey, signature, message)).toBe(true)
    expect(base58btc.encode((await call('signer.getPublicKey')) as Uint8Array)).toBe(options.context.account)
    request.mockResolvedValueOnce({type: 'account', metadata: {name: 'Another account'}} as never)
    expect(await call('resource', {url: 'hm://other/:profile'})).toEqual({id: 'other', name: 'Another account'})
    expect(request).toHaveBeenLastCalledWith('Account', 'other', {signal: expect.any(AbortSignal)})
    request.mockResolvedValueOnce(null)
    await call('request', {key: 'Resource', input: await call('hm.unpackHmId', {url: 'hm://other/private'})})
    expect(request).toHaveBeenLastCalledWith('Resource', expect.objectContaining({uid: 'other', path: ['private']}), {
      signal: expect.any(AbortSignal),
    })
    const signed = (await call('hm.signBlob', {input: {type: 'PageVote', choice: 'yes'}})) as {
      data: Uint8Array
      cid: string
    }
    await call('publish', {input: {blobs: [{data: signed.data, cid: signed.cid}]}})
    expect(publish).toHaveBeenCalledTimes(1)
    expect(approve).toHaveBeenCalledTimes(6)
    await call('permissions.revoke')
    approve.mockResolvedValueOnce('deny')
    await expect(call('signer.sign', {data: message})).rejects.toThrow('denied')
    expect(approve).toHaveBeenCalledTimes(7)
  })

  it('creates and publishes a real document Change and Ref with the selected account', async () => {
    const {options, publish, keys} = await fixture()
    const result = (await documentPageContent({
      ...options,
      method: 'hm.createDocumentBlobs',
      params: {
        input: {
          space: options.context.account,
          path: '/created-by-page',
          ops: [{type: 'SetAttributes', attrs: [{key: ['name'], value: 'Created by page'}]}],
        },
      },
    })) as {blobs: {data: Uint8Array; cid: string}[]}
    expect(result.blobs).toHaveLength(2)
    for (const item of result.blobs) {
      const blob = decode(item.data) as Record<string, unknown>
      expect(base58btc.encode(blob.signer as Uint8Array)).toBe(options.context.account)
      expect(
        await crypto.subtle.verify(
          'Ed25519',
          keys.publicKey,
          blob.sig as Uint8Array,
          encode({...blob, sig: new Uint8Array(64)}),
        ),
      ).toBe(true)
    }
    expect((decode(result.blobs[1]!.data) as Record<string, unknown>).path).toBe('/created-by-page')
    await documentPageContent({...options, method: 'publish', params: {input: {blobs: result.blobs}}})
    expect(publish).toHaveBeenCalledWith(structuredClone({blobs: result.blobs}))
    expect(Object.keys(DOCUMENT_PAGE_SIGNING_HELPERS)).toEqual([...DOCUMENT_PAGE_SIGNING_HELPER_NAMES])
  })

  it('prepares and publishes document changes, and returns portable signed-change CIDs', async () => {
    const {options, request, publish} = await fixture()
    const {unsignedBytes} = createChangeOps({
      ops: [{type: 'SetAttributes', attrs: [{key: ['name'], value: 'Updated'}]}],
    })
    request.mockResolvedValueOnce({unsignedChange: unsignedBytes})
    const result = await documentPageContent({
      ...options,
      method: 'publishDocument',
      params: {
        input: {
          account: options.context.account,
          path: '/notes',
          changes: [],
        },
      },
    })
    expect(result).toEqual({document: `hm://${options.context.account}/notes`})
    expect(request).toHaveBeenCalledWith(
      'PrepareDocumentChange',
      expect.objectContaining({account: options.context.account, path: '/notes'}),
      {signal: expect.any(AbortSignal)},
    )
    expect(publish).toHaveBeenCalledTimes(1)
    const signed = (await documentPageContent({
      ...options,
      method: 'hm.signDocumentChange',
      params: {
        input: {
          account: options.context.account,
          path: '/notes',
          unsignedChange: unsignedBytes,
        },
      },
    })) as {changeCid: string}
    expect(typeof structuredClone(signed).changeCid).toBe('string')
    await expect(
      documentPageContent({
        ...options,
        method: 'publishDocument',
        params: {
          input: {
            account: options.context.account,
            path: '/notes',
            changes: [],
            signerAccountUid: 'other',
          },
        },
      }),
    ).rejects.toThrow()
  })

  it('discards reads completed after revocation', async () => {
    const {options, request} = await fixture()
    request.mockImplementationOnce(async () => {
      options.access.revoke()
      return null
    })
    await expect(
      documentPageContent({...options, method: 'request', params: {key: 'Account', input: 'other'}}),
    ).rejects.toThrow('revoked')
  })
  it('classifies actual SDK bytes and allows publishing only the exact approved envelopes', async () => {
    const {options, content, approve, publish} = await fixture()
    approve.mockResolvedValue('type-site')
    await documentPageContent({...options, method: 'comments.create', params: {content}})
    expect(approve.mock.calls[0]?.[0]).toMatchObject({kind: 'sign', type: 'Comment', site: options.context.account})
    expect(approve).toHaveBeenCalledTimes(1)
    await documentPageContent({...options, method: 'comments.create', params: {content}})
    expect(approve).toHaveBeenCalledTimes(1)
    approve.mockResolvedValue('deny')
    const blob = (publish.mock.calls[0]![0] as {blobs: {data: Uint8Array}[]}).blobs[0]!
    const unsigned = {...(decode(blob.data) as Record<string, unknown>), sig: new Uint8Array(64)}
    // Calling the raw signer with a real comment gets the same classification as a helper.
    await documentPageContent({...options, method: 'signer.sign', params: {data: encode(unsigned)}})
    for (const mutated of [
      {...unsigned, type: 'Capability'},
      {...unsigned, extra: 'hidden'},
      {...unsigned, signer: new Uint8Array(34)},
      {...unsigned, id: 'arbitrary-record'},
    ]) {
      await expect(
        documentPageContent({...options, method: 'signer.sign', params: {data: encode(mutated)}}),
      ).rejects.toThrow('denied')
    }
    const changed = encode({...unsigned, path: '/different', sig: new Uint8Array(64)})
    await expect(
      documentPageContent({
        ...options,
        method: 'request',
        params: {key: 'PublishBlobs', input: {blobs: [{data: changed}]}},
      }),
    ).rejects.toThrow('denied')
    expect(approve.mock.calls.at(-1)?.[0]).toMatchObject({kind: 'publish'})
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it('allows its own space but still gates viewer identity and cross-space redirect targets', async () => {
    const {options, approve, request} = await fixture()
    approve.mockResolvedValue('deny')
    for (const method of ['context', 'profile', 'signer.getPublicKey']) {
      await expect(documentPageContent({...options, method, params: {}})).rejects.toThrow('denied')
    }
    expect(request).not.toHaveBeenCalled()
    await documentPageContent({...options, method: 'resource', params: {url: options.context.document}})
    expect(approve).toHaveBeenCalledTimes(3)
    request.mockResolvedValueOnce({
      type: 'document',
      id: {uid: 'other', path: ['private']},
      document: {account: 'other', path: '/private'},
    })
    await expect(
      documentPageContent({...options, method: 'resource', params: {url: options.context.document}}),
    ).rejects.toThrow('denied')
    expect(request).toHaveBeenCalledWith(
      'Resource',
      expect.objectContaining({version: options.context.version}),
      expect.anything(),
    )
    expect(approve.mock.calls.at(-1)?.[0]).toMatchObject({
      kind: 'read',
      resource: 'hm://other/private',
    })
  })
  it('allows same-space documents and bounded queries for another viewer without grants, but keeps signing gated', async () => {
    const {options, approve, request, content, sign} = await fixture()
    options.context.document = 'hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/pages/test'
    approve.mockResolvedValue('deny')
    for (const [method, params] of [
      ['resource', {url: 'hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/private-record'}],
      ['resource', {url: 'hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/:profile'}],
      [
        'request',
        {
          key: 'ResourceMetadata',
          input: unpackHmId('hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/types/task'),
        },
      ],
      ['directory', {url: 'hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/tasks', all: true}],
      [
        'request',
        {
          key: 'QueryDocuments',
          input: {
            filter: {
              and: {
                filters: [
                  {spaceMatch: {space: 'z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj'}},
                  {exists: {key: 'status'}},
                ],
              },
            },
          },
        },
      ],
    ] as const)
      await documentPageContent({...options, method, params})
    expect(approve).not.toHaveBeenCalled()
    expect(request).toHaveBeenCalledTimes(5)
    expect(options.access.snapshot()).toEqual([])
    options.access.revoke()
    await documentPageContent({
      ...options,
      method: 'resource',
      params: {url: 'hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/another'},
    })
    expect(approve).not.toHaveBeenCalled()
    for (const [method, params] of [
      ['resource', {url: `hm://${options.context.account}/private-record`}],
      ['directory', {url: 'hm://other/tasks'}],
      ['request', {key: 'Query', input: {includes: []}}],
      [
        'request',
        {
          key: 'Query',
          input: {
            includes: [
              {space: 'z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj', path: '', mode: 'Children'},
              {space: 'other', path: '', mode: 'Children'},
            ],
          },
        },
      ],
      ['request', {key: 'QueryDocuments', input: {}}],
      ['comments.create', {content}],
    ] as const)
      await expect(documentPageContent({...options, method, params})).rejects.toThrow('denied')
    expect(sign).not.toHaveBeenCalled()
  })

  it('checks unexpected cross-space query results before disclosing them and discards revoked reads', async () => {
    const {options, approve, request} = await fixture()
    approve.mockResolvedValue('deny')
    request.mockResolvedValueOnce({results: [{id: {uid: 'other', path: ['private']}}]})
    await expect(
      documentPageContent({...options, method: 'directory', params: {url: options.context.document}}),
    ).rejects.toThrow('denied')
    expect(approve.mock.calls[0]?.[0]).toMatchObject({site: 'other'})
    request.mockImplementationOnce(async () => {
      options.access.revoke()
      return null
    })
    await expect(
      documentPageContent({...options, method: 'resource', params: {url: options.context.document}}),
    ).rejects.toThrow('revoked')
  })
})
