import {describe, expect, it, vi} from 'vitest'
import {createChangeOps} from '@seed-hypermedia/client'
import {decode, encode} from '@ipld/dag-cbor'
import {base58btc} from 'multiformats/bases/base58'
import {createDocumentAppAccess, documentAppContent, DOCUMENT_APP_SIGNING_HELPERS} from './document-app-content'
import type {AppPermissionDecision} from './document-app-permissions'
import {DOCUMENT_APP_SIGNING_HELPER_NAMES} from './document-app'
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
      _request: import('./document-app-permissions').AppPermissionRequest,
      _signal: AbortSignal,
    ): Promise<AppPermissionDecision> => 'once',
  )
  const request = vi.fn(async (..._args: unknown[]): Promise<unknown> => null)
  const options = {
    context: {
      protocol: 1 as const,
      account,
      document: `hm://${account}/apps/test`,
      version: 'bafybeibowhl2ypujel2qrmcps2qy2szwv3ruyjqliqejr6jg4kil437y3e',
      app: 'bundle',
    },
    visibility: 'PUBLIC' as const,
    client: {
      getSigner: vi.fn(() => ({getPublicKey: async () => principal, sign})),
      publish,
      request: request as UniversalClient['request'],
    },
    access: createDocumentAppAccess(approve),
    signal: controller.signal,
  }
  const content = await documentAppContent({
    ...options,
    method: 'hm.parseMarkdown',
    params: {markdown: 'Hello **world** 🌱'},
  })
  return {options, content, keys, controller, sign, publish, approve, request}
}

describe('mini-app content and signing', () => {
  it('inherits private visibility and rejects empty comments', async () => {
    const {options, content, publish} = await fixture()
    await documentAppContent({...options, visibility: 'PRIVATE', method: 'comments.create', params: {content}})
    const {blobs} = publish.mock.calls[0]![0] as {blobs: {data: Uint8Array}[]}
    expect((decode(blobs[0]!.data) as Record<string, unknown>).visibility).toBe('Private')
    const empty = await documentAppContent({...options, method: 'hm.parseMarkdown', params: {markdown: ''}})
    await expect(
      documentAppContent({...options, method: 'comments.create', params: {content: empty}}),
    ).rejects.toThrow()
    expect(publish).toHaveBeenCalledTimes(1)
  })

  it('uses SDK blocks and produces a verifiable HM comment signed as the viewer on the pinned app document', async () => {
    const {options, content, keys, sign, publish} = await fixture()
    expect(content).toMatchObject([{block: {type: 'Paragraph', text: 'Hello world 🌱', annotations: [{type: 'Bold'}]}}])
    expect(await documentAppContent({...options, method: 'hm.validateContent', params: {content}})).toEqual(content)
    expect(sign).not.toHaveBeenCalled()
    const result = await documentAppContent({...options, method: 'comments.create', params: {content}})
    const {blobs} = publish.mock.calls[0]![0] as {blobs: {data: Uint8Array}[]}
    const blob = decode(blobs[0]!.data) as Record<string, unknown>
    expect(blob.type).toBe('Comment')
    expect(blob.path).toBe('/apps/test')
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
        documentAppContent({...options, method: 'comments.create', params: {content, ...extra}}),
      ).rejects.toThrow()
    }
    expect(sign).not.toHaveBeenCalled()
  })

  it('cancellation and sign-out never invoke the signer or publisher', async () => {
    const {options, content, sign, publish} = await fixture()
    await expect(
      documentAppContent({
        ...options,
        access: createDocumentAppAccess(async () => 'deny'),
        method: 'comments.create',
        params: {content},
      }),
    ).rejects.toThrow('denied')
    await expect(
      documentAppContent({
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
      documentAppContent({
        ...options,
        method: 'comments.create',
        params: {content},
        access: createDocumentAppAccess(async () => {
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
    await expect(documentAppContent({...options, method: 'comments.create', params: {content}})).rejects.toThrow()
    expect(publish).not.toHaveBeenCalled()
  })
  it('prompts independently for reads, publishing and raw signing', async () => {
    const {options, approve, keys, request, publish} = await fixture()
    const call = (method: string, params = {}) => documentAppContent({...options, method, params})
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
    const signed = (await call('hm.signBlob', {input: {type: 'MiniAppVote', choice: 'yes'}})) as {
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
    const result = (await documentAppContent({
      ...options,
      method: 'hm.createDocumentBlobs',
      params: {
        input: {
          space: options.context.account,
          path: '/created-by-app',
          ops: [{type: 'SetAttributes', attrs: [{key: ['name'], value: 'Created by app'}]}],
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
    expect((decode(result.blobs[1]!.data) as Record<string, unknown>).path).toBe('/created-by-app')
    await documentAppContent({...options, method: 'publish', params: {input: {blobs: result.blobs}}})
    expect(publish).toHaveBeenCalledWith(structuredClone({blobs: result.blobs}))
    expect(Object.keys(DOCUMENT_APP_SIGNING_HELPERS)).toEqual([...DOCUMENT_APP_SIGNING_HELPER_NAMES])
  })

  it('prepares and publishes document changes, and returns portable signed-change CIDs', async () => {
    const {options, request, publish} = await fixture()
    const {unsignedBytes} = createChangeOps({
      ops: [{type: 'SetAttributes', attrs: [{key: ['name'], value: 'Updated'}]}],
    })
    request.mockResolvedValueOnce({unsignedChange: unsignedBytes})
    const result = await documentAppContent({
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
    const signed = (await documentAppContent({
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
      documentAppContent({
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
      documentAppContent({...options, method: 'request', params: {key: 'Account', input: 'other'}}),
    ).rejects.toThrow('revoked')
  })
  it('classifies actual SDK bytes and allows publishing only the exact approved envelopes', async () => {
    const {options, content, approve, publish} = await fixture()
    approve.mockResolvedValue('type-site')
    await documentAppContent({...options, method: 'comments.create', params: {content}})
    expect(approve.mock.calls[0]?.[0]).toMatchObject({kind: 'sign', type: 'Comment', site: options.context.account})
    expect(approve).toHaveBeenCalledTimes(1)
    await documentAppContent({...options, method: 'comments.create', params: {content}})
    expect(approve).toHaveBeenCalledTimes(1)
    approve.mockResolvedValue('deny')
    const blob = (publish.mock.calls[0]![0] as {blobs: {data: Uint8Array}[]}).blobs[0]!
    const unsigned = {...(decode(blob.data) as Record<string, unknown>), sig: new Uint8Array(64)}
    // Calling the raw signer with a real comment gets the same classification as a helper.
    await documentAppContent({...options, method: 'signer.sign', params: {data: encode(unsigned)}})
    for (const mutated of [
      {...unsigned, type: 'Capability'},
      {...unsigned, extra: 'hidden'},
      {...unsigned, signer: new Uint8Array(34)},
      {...unsigned, id: 'arbitrary-record'},
    ]) {
      await expect(
        documentAppContent({...options, method: 'signer.sign', params: {data: encode(mutated)}}),
      ).rejects.toThrow('denied')
    }
    const changed = encode({...unsigned, path: '/different', sig: new Uint8Array(64)})
    await expect(
      documentAppContent({
        ...options,
        method: 'request',
        params: {key: 'PublishBlobs', input: {blobs: [{data: changed}]}},
      }),
    ).rejects.toThrow('denied')
    expect(approve.mock.calls.at(-1)?.[0]).toMatchObject({kind: 'publish'})
    expect(publish).toHaveBeenCalledTimes(2)
  })

  it('does not disclose identity, own content or redirect targets without the corresponding read approval', async () => {
    const {options, approve, request} = await fixture()
    approve.mockResolvedValue('deny')
    for (const method of ['context', 'profile', 'signer.getPublicKey']) {
      await expect(documentAppContent({...options, method, params: {}})).rejects.toThrow('denied')
    }
    await expect(
      documentAppContent({...options, method: 'resource', params: {url: options.context.document}}),
    ).rejects.toThrow('denied')
    expect(request).not.toHaveBeenCalled()
    approve.mockResolvedValueOnce('resource')
    request.mockResolvedValueOnce({
      type: 'document',
      id: {uid: options.context.account, path: ['private']},
      document: {account: options.context.account, path: '/private'},
    })
    await expect(
      documentAppContent({...options, method: 'resource', params: {url: options.context.document}}),
    ).rejects.toThrow('denied')
    expect(request).toHaveBeenCalledWith(
      'Resource',
      expect.objectContaining({version: options.context.version}),
      expect.anything(),
    )
    expect(approve.mock.calls.at(-1)?.[0]).toMatchObject({
      kind: 'read',
      resource: `hm://${options.context.account}/private`,
    })
  })
})
