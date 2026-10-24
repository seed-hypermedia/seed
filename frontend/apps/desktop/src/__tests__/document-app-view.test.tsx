import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => {
  const request = vi.fn()
  const getSigner = vi.fn()
  const publish = vi.fn()
  return {
    request,
    getSigner,
    publish,
    account: 'viewer',
    client: {request, getSigner, publish},
    queryClient: {
      fetchQuery: (options: {queryFn: () => Promise<unknown>}) => options.queryFn(),
      invalidateQueries: vi.fn(),
    },
  }
})
vi.mock('@shm/shared/routing', () => ({useUniversalClient: () => mocks.client}))
vi.mock('@shm/shared/models/entity', () => ({useSelectedAccountId: () => mocks.account, useResource: vi.fn()}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => mocks.queryClient,
  useQuery: () => ({data: {metadata: {name: 'Eric'}}}),
}))

import {DocumentAppView, documentAppCid} from '@shm/ui/document-app'
import {setDocumentAppPlatform} from '@shm/shared/document-app'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {unpackHmId} from '@seed-hypermedia/client'
import {base58btc} from 'multiformats/bases/base58'
import {decode} from '@ipld/dag-cbor'

const cid = 'bafybeibowhl2ypujel2qrmcps2qy2szwv3ruyjqliqejr6jg4kil437y3e'
const host = 'c'.repeat(40)
const docId = unpackHmId('hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/apps/counter')!
const document = {
  metadata: {name: 'Counter', app: `ipfs://${cid}`},
  version: 'v1',
  content: [],
} as unknown as HMDocument

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
  mocks.account = 'viewer'
  mocks.request.mockReset()
  mocks.getSigner.mockReset()
  mocks.publish.mockReset()
  window.localStorage.clear()
  container = window.document.createElement('div')
  window.document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  setDocumentAppPlatform(null)
})

describe('DocumentAppView', () => {
  it('grants full account access once, signs a comment and arbitrary data, then revokes access', async () => {
    const keys = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify'])
    const principal = new Uint8Array([
      0xed,
      1,
      ...Array.from(new Uint8Array(await crypto.subtle.exportKey('raw', keys.publicKey))),
    ])
    mocks.account = base58btc.encode(principal)
    const sign = vi.fn(
      async (bytes: Uint8Array) => new Uint8Array(await crypto.subtle.sign('Ed25519', keys.privateKey, bytes)),
    )
    mocks.getSigner.mockReturnValue({getPublicKey: async () => principal, sign})
    mocks.publish.mockResolvedValue({cids: ['comment-version']})
    setDocumentAppPlatform({resolveAppUrl: async () => `seed-app://${host}/`})
    await act(async () => {
      root.render(<DocumentAppView docId={docId} document={{...document, version: cid}} cid={cid} />)
    })
    const frame = container.querySelector('iframe')!
    const posted = vi.spyOn(frame.contentWindow!, 'postMessage')
    const params = {
      content: [{block: {id: 'message', type: 'Paragraph', text: 'Reviewed message', attributes: {}, annotations: []}}],
    }
    const send = (id: string) =>
      act(async () => {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: frame.contentWindow,
            origin: `seed-app://${host}`,
            data: {seedApp: 1, id, method: 'comments.create', params},
          }),
        )
      })
    await send('first')
    expect(sign).not.toHaveBeenCalled()
    const confirm = Array.from(window.document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Allow full access',
    )!
    await act(async () => {
      confirm.click()
    })
    await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1))
    const blob = decode(mocks.publish.mock.calls[0]![0].blobs[0].data) as Record<string, unknown>
    expect(blob.path).toBe('/apps/counter')
    expect((blob.version as unknown[]).map(String)).toEqual([cid])
    expect(mocks.getSigner).toHaveBeenCalledWith(mocks.account)
    expect(JSON.stringify(blob.body)).toContain('Reviewed message')
    expect(posted).toHaveBeenCalledWith(
      expect.objectContaining({id: 'first', result: {commentId: expect.any(String), version: 'comment-version'}}),
      `seed-app://${host}`,
    )
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          origin: `seed-app://${host}`,
          data: {seedApp: 1, id: 'raw', method: 'signer.sign', params: {data: new Uint8Array([1, 2, 3])}},
        }),
      )
    })
    await vi.waitFor(() =>
      expect(posted).toHaveBeenCalledWith(
        expect.objectContaining({id: 'raw', result: expect.any(Uint8Array)}),
        `seed-app://${host}`,
      ),
    )
    expect(window.document.querySelector('[role="alertdialog"]')).toBeNull()
    const revoke = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Revoke access',
    )!
    await act(async () => {
      revoke.click()
    })
    const signatures = sign.mock.calls.length
    await send('after-revoke')
    expect(window.document.querySelector('[role="alertdialog"]')?.textContent).toContain(
      'Give this app full account access?',
    )
    expect(sign).toHaveBeenCalledTimes(signatures)
  })

  it('requires host confirmation and revokes a pending comment when the account changes', async () => {
    setDocumentAppPlatform({resolveAppUrl: async () => `seed-app://${host}/`})
    await act(async () => {
      root.render(<DocumentAppView docId={docId} document={document} cid={cid} />)
    })
    const frame = container.querySelector('iframe')!
    const params = {
      content: [
        {block: {id: 'message', type: 'Paragraph', text: 'Hello from the mini app', attributes: {}, annotations: []}},
      ],
    }
    await act(async () => {
      window.dispatchEvent(
        new MessageEvent('message', {
          source: frame.contentWindow,
          origin: `seed-app://${host}`,
          data: {seedApp: 1, id: 'post', method: 'comments.create', params},
        }),
      )
    })
    expect(window.document.querySelector('[role="alertdialog"]')?.textContent).toContain(
      'Give this app full account access?',
    )
    expect(mocks.getSigner).not.toHaveBeenCalled()
    mocks.account = 'another-viewer'
    await act(async () => {
      root.render(<DocumentAppView docId={docId} document={document} cid={cid} />)
    })
    expect(window.document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(mocks.getSigner).not.toHaveBeenCalled()
    expect(mocks.publish).not.toHaveBeenCalled()
  })

  it('reads the app CID from metadata', () => {
    expect(documentAppCid(document)).toBe(cid)
    expect(documentAppCid({metadata: {name: 'Plain'}} as HMDocument)).toBeNull()
  })

  it('explains itself where no platform can run apps', async () => {
    await act(async () => {
      root.render(<DocumentAppView docId={docId} document={document} cid={cid} perspectiveAccountUid="viewer" />)
    })
    expect(container.textContent).toContain('Open it in the Seed desktop app')
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('embeds the resolved app URL in a sandboxed frame and answers bridge requests as the viewer', async () => {
    const resolveAppUrl = vi.fn(async () => `seed-app://${host}/`)
    setDocumentAppPlatform({resolveAppUrl})
    await act(async () => {
      root.render(<DocumentAppView docId={docId} document={document} cid={cid} perspectiveAccountUid="viewer" />)
    })
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(container.querySelector('iframe')).not.toBeNull()
    })
    expect(resolveAppUrl).toHaveBeenCalledWith({id: docId.id, cid})
    const frame = container.querySelector('iframe')!
    expect(frame.getAttribute('src')).toBe(`seed-app://${host}/`)
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')

    const source = frame.contentWindow!
    const posted = vi.spyOn(source, 'postMessage')
    const send = (data: unknown, origin = `seed-app://${host}`) =>
      act(async () => {
        window.dispatchEvent(new MessageEvent('message', {data, origin, source}))
        await new Promise((resolve) => setTimeout(resolve, 0))
      })

    await send({seedApp: 1, id: 'ctx', method: 'context'})
    expect(posted).toHaveBeenCalledWith(
      {
        seedApp: 1,
        id: 'ctx',
        result: {protocol: 1, document: docId.id, version: 'v1', account: 'viewer', app: cid},
      },
      `seed-app://${host}`,
    )

    await send({seedApp: 1, id: 'save', method: 'storage.set', params: {key: 'notes', value: ['hello']}})
    await send({seedApp: 1, id: 'read', method: 'storage.get', params: {key: 'notes'}})
    expect(posted).toHaveBeenLastCalledWith({seedApp: 1, id: 'read', result: ['hello']}, `seed-app://${host}`)
    await send({seedApp: 1, id: 'escape', method: 'storage.get', params: {key: 'notes', account: 'other'}})
    expect(posted).toHaveBeenLastCalledWith(
      {seedApp: 1, id: 'escape', error: 'Unknown storage parameter'},
      `seed-app://${host}`,
    )

    mocks.request.mockResolvedValueOnce({type: 'account', metadata: {name: 'Eric'}})
    await send({seedApp: 1, id: 'profile', method: 'profile'})
    expect(mocks.request).toHaveBeenLastCalledWith('Account', 'viewer', expect.anything())
    expect(posted).toHaveBeenLastCalledWith(
      {seedApp: 1, id: 'profile', result: {id: 'viewer', name: 'Eric'}},
      `seed-app://${host}`,
    )

    mocks.request.mockResolvedValueOnce({type: 'account', metadata: {name: 'Eric'}})
    await send({seedApp: 1, id: 'profile-url', method: 'resource', params: {url: 'hm://viewer/:profile'}})
    expect(posted).toHaveBeenLastCalledWith(
      {seedApp: 1, id: 'profile-url', result: {id: 'viewer', name: 'Eric'}},
      `seed-app://${host}`,
    )

    mocks.request.mockResolvedValueOnce({type: 'document', id: docId, document})
    await send({seedApp: 1, id: 'res', method: 'resource', params: {url: docId.id}})
    expect(mocks.request).toHaveBeenCalledWith('Resource', expect.objectContaining({id: docId.id}), expect.anything())
    expect(posted).toHaveBeenLastCalledWith(
      expect.objectContaining({id: 'res', result: expect.anything()}),
      `seed-app://${host}`,
    )

    await send({seedApp: 1, id: 'bad', method: 'resource', params: {url: 'https://not-hm'}})
    expect(posted).toHaveBeenLastCalledWith(
      {seedApp: 1, id: 'bad', error: 'Expected an hm:// URL'},
      `seed-app://${host}`,
    )

    // Another origin, even with the right shape, is ignored.
    posted.mockClear()
    await send({seedApp: 1, id: 'x', method: 'context'}, 'https://evil.example')
    expect(posted).not.toHaveBeenCalled()
  })
})
