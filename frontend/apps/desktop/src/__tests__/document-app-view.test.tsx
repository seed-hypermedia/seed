import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => {
  const request = vi.fn()
  const getSigner = vi.fn()
  const publish = vi.fn()
  return {
    openUrl: vi.fn(),
    request,
    getSigner,
    publish,
    account: 'viewer',
    joined: true,
    originHomeId: null as null | {uid: string},
    client: {request, getSigner, publish},
    queryClient: {
      fetchQuery: (options: {queryFn: () => Promise<unknown>}) => options.queryFn(),
      invalidateQueries: vi.fn(),
    },
  }
})
vi.mock('@shm/shared/routing', () => ({
  useUniversalClient: () => mocks.client,
  useOpenUrl: () => mocks.openUrl,
  useUniversalAppContext: () => ({originHomeId: mocks.originHomeId}),
}))
vi.mock('@shm/shared/models/contacts', () => ({
  useSelectedAccountContacts: () => ({
    data: mocks.joined ? [{subject: 'z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj', subscribe: {site: true}}] : [],
  }),
}))
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
import {appPermissionStorageKey} from '@shm/shared/document-app-permissions'

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
  mocks.joined = true
  mocks.originHomeId = null
  mocks.openUrl.mockReset()
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

function button(label: string): HTMLButtonElement {
  const found = Array.from(window.document.querySelectorAll('button')).find((button) => button.textContent === label)
  expect(found, `button: ${label}`).toBeDefined()
  return found!
}
async function click(label: string) {
  await act(async () => button(label).click())
}
async function send(method: string, params = {}) {
  const frame = container.querySelector('iframe')!
  await act(async () =>
    window.dispatchEvent(
      new MessageEvent('message', {
        source: frame.contentWindow,
        origin: `seed-app://${host}`,
        data: {seedApp: 1, id: crypto.randomUUID(), method, params},
      }),
    ),
  )
}

describe('DocumentAppView', () => {
  it('asks before running on an unfamiliar site, without requiring a join', async () => {
    mocks.joined = false
    const resolveAppUrl = vi.fn(async () => `seed-app://${host}/`)
    setDocumentAppPlatform({resolveAppUrl})
    await act(async () => root.render(<DocumentAppView docId={docId} document={document} cid={cid} />))
    expect(resolveAppUrl).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Joining is optional')
    await click('Run app')
    expect(resolveAppUrl).toHaveBeenCalledTimes(1)
    expect(container.querySelector('iframe')).not.toBeNull()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('runs a same-site web app without a join or launch prompt', async () => {
    mocks.joined = false
    mocks.originHomeId = {uid: docId.uid}
    const loadAppHtml = vi.fn(() => new Promise<string>(() => {}))
    setDocumentAppPlatform({loadAppHtml})
    await act(async () => root.render(<DocumentAppView docId={docId} document={document} cid={cid} />))
    expect(loadAppHtml).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain('Run app')
  })

  it('offers comment scopes while keeping raw signing and reading separate; remembers by app ID across updates', async () => {
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
    const closeAppUrl = vi.fn(async () => {})
    setDocumentAppPlatform({resolveAppUrl: async () => `seed-app://${host}/`, closeAppUrl})
    await act(async () =>
      root.render(<DocumentAppView docId={docId} document={{...document, version: cid}} cid={cid} />),
    )
    const params = {
      content: [{block: {id: 'message', type: 'Paragraph', text: 'Reviewed message', attributes: {}, annotations: []}}],
    }
    await send('comments.create', params)
    await vi.waitFor(() =>
      expect(window.document.querySelector('[role="alertdialog"]')?.textContent).toContain('Post a public comment'),
    )
    expect(sign).not.toHaveBeenCalled()
    expect(window.document.body.textContent).toContain('Reviewed message')
    await act(async () => (window.document.querySelector('input[value="type-site"]') as HTMLInputElement).click())
    await click('Allow comments on this site')
    await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1))
    expect(
      (decode(new Uint8Array(mocks.publish.mock.calls[0]![0].blobs[0].data)) as Record<string, unknown>).path,
    ).toBe('/apps/counter')
    await send('comments.create', params)
    await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(2))
    expect(window.document.querySelector('[role="alertdialog"]')).toBeNull()
    await send('hm.signBlob', {input: {type: 'UnknownAppAction', choice: 'yes'}})
    await vi.waitFor(() => expect(window.document.body.textContent).toContain('Sign unrecognized data'))
    await act(async () => (window.document.querySelector('input[value="all"]') as HTMLInputElement).click())
    expect(button('Allow any signing').disabled).toBe(true)
    await click('Deny')
    expect(sign).toHaveBeenCalledTimes(2)
    await send('context')
    expect(window.document.body.textContent).toContain('Identify your account')
    await click('Deny')
    await act(async () =>
      root.render(<DocumentAppView docId={docId} document={{...document, version: `${cid}.${cid}`}} cid={cid} />),
    )
    expect(closeAppUrl).toHaveBeenCalled()
    await send('comments.create', params)
    await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(3))
    expect(window.document.querySelector('[role="alertdialog"]')).toBeNull()
    await click('App permissions')
    expect(window.document.querySelector('[role="dialog"]')?.textContent).toContain('Allow comments on this site')
    await click('Reset all to ask')
    expect(window.localStorage.getItem(appPermissionStorageKey(mocks.account, docId.id))).toBe('[]')
  })

  it('cancels pending consent when the account changes', async () => {
    setDocumentAppPlatform({resolveAppUrl: async () => `seed-app://${host}/`})
    await act(async () => root.render(<DocumentAppView docId={docId} document={document} cid={cid} />))
    await send('profile')
    expect(window.document.body.textContent).toContain('Identify your account')
    mocks.account = 'another-viewer'
    await act(async () => root.render(<DocumentAppView docId={docId} document={document} cid={cid} />))
    expect(window.document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('applies revocation from another window before returning an in-flight read', async () => {
    const key = appPermissionStorageKey(mocks.account, docId.id)
    window.localStorage.setItem(key, JSON.stringify([{kind: 'read', scope: 'all'}]))
    setDocumentAppPlatform({resolveAppUrl: async () => `seed-app://${host}/`})
    await act(async () => root.render(<DocumentAppView docId={docId} document={document} cid={cid} />))
    const frame = container.querySelector('iframe')!
    const posted = vi.spyOn(frame.contentWindow!, 'postMessage')
    let finish!: (value: unknown) => void
    mocks.request.mockReturnValueOnce(
      new Promise((resolve) => {
        finish = resolve
      }),
    )
    await send('profile')
    expect(mocks.request).toHaveBeenCalledTimes(1)
    await act(async () => {
      window.localStorage.removeItem(key)
      window.dispatchEvent(new StorageEvent('storage', {key}))
      finish({type: 'account', metadata: {name: 'Must not escape'}})
    })
    expect(posted).toHaveBeenLastCalledWith(
      expect.objectContaining({error: 'App permissions changed.'}),
      `seed-app://${host}`,
    )
    expect(JSON.stringify(posted.mock.calls)).not.toContain('Must not escape')
    await send('profile')
    expect(window.document.body.textContent).toContain('Identify your account')
  })

  it('fills the main view and opens permission settings from the breadcrumb menu', async () => {
    const accessChanged = vi.fn()
    setDocumentAppPlatform({resolveAppUrl: async () => `seed-app://${host}/`})
    await act(async () =>
      root.render(
        <DocumentAppView docId={docId} document={document} cid={cid} fill onAccountAccessChange={accessChanged} />,
      ),
    )
    const frame = container.querySelector('iframe')!
    expect(frame.classList.contains('h-full')).toBe(true)
    expect(container.querySelector('section')!.classList.contains('border')).toBe(false)
    expect(container.textContent).not.toContain('App permissions')
    await act(async () => accessChanged.mock.calls.at(-1)![0]())
    expect(window.document.querySelector('[role="dialog"]')?.textContent).toContain('App permissions')
  })

  it('opens document references through Seed without requesting account access', async () => {
    const external = vi.fn()
    setDocumentAppPlatform({resolveAppUrl: async () => `seed-app://${host}/`, openExternalUrl: external})
    await act(async () => root.render(<DocumentAppView docId={docId} document={document} cid={cid} />))
    const frame = container.querySelector('iframe')!
    const send = async (url: string) =>
      act(async () => {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: frame.contentWindow,
            origin: `seed-app://${host}`,
            data: {seedApp: 1, id: 'open', method: 'open', params: {url, newWindow: true}},
          }),
        )
      })
    const reference = `${docId.id}?v=v2#block123`
    await send(reference)
    expect(mocks.openUrl).toHaveBeenCalledWith(reference, true)
    await send('https://private.example/hm/alice/doc?v=rev#block')
    expect(external).toHaveBeenCalledWith('https://private.example/hm/alice/doc?v=rev#block', true)
    await send('javascript:alert(1)')
    expect(mocks.openUrl).toHaveBeenCalledTimes(1)
    expect(external).toHaveBeenCalledTimes(1)
    expect(window.document.body.textContent).not.toContain('Give this app full account access?')
    expect(mocks.getSigner).not.toHaveBeenCalled()
  })

  it('reads the app CID from metadata', () => {
    expect(documentAppCid(document)).toBe(cid)
    expect(documentAppCid({metadata: {name: 'Plain'}} as HMDocument)).toBeNull()
  })

  it('explains itself where no platform can run apps', async () => {
    await act(async () => {
      root.render(
        <React.StrictMode>
          <DocumentAppView docId={docId} document={document} cid={cid} perspectiveAccountUid="viewer" />
        </React.StrictMode>,
      )
    })
    expect(container.textContent).toContain('Open it in the Seed desktop app')
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('embeds the resolved app URL in a sandboxed frame and answers bridge requests as the viewer', async () => {
    const resolveAppUrl = vi.fn(async () => `seed-app://${host}/`)
    setDocumentAppPlatform({resolveAppUrl})
    await act(async () => {
      root.render(
        <React.StrictMode>
          <DocumentAppView docId={docId} document={document} cid={cid} perspectiveAccountUid="viewer" />
        </React.StrictMode>,
      )
    })
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(container.querySelector('iframe')).not.toBeNull()
    })
    expect(resolveAppUrl).toHaveBeenCalledWith({id: docId.id, cid, account: mocks.account})
    const frame = container.querySelector('iframe')!
    expect(frame.getAttribute('src')).toBe(`seed-app://${host}/`)
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')

    const source = frame.contentWindow!
    const posted = vi.spyOn(source, 'postMessage')
    const send = (data: unknown, origin = `seed-app://${host}`) =>
      act(async () => {
        window.dispatchEvent(new MessageEvent('message', {data, origin, source}))
      })

    await send({seedApp: 1, id: 'ctx', method: 'context'})
    expect(posted).not.toHaveBeenCalled()
    await click('Allow once')
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
    await click('Allow once')
    expect(posted).toHaveBeenLastCalledWith({seedApp: 1, id: 'read', result: ['hello']}, `seed-app://${host}`)
    await send({seedApp: 1, id: 'escape', method: 'storage.get', params: {key: 'notes', account: 'other'}})
    await click('Allow once')
    expect(posted).toHaveBeenLastCalledWith(
      {seedApp: 1, id: 'escape', error: 'Unknown storage parameter'},
      `seed-app://${host}`,
    )

    mocks.request.mockResolvedValueOnce({type: 'account', metadata: {name: 'Eric'}})
    await send({seedApp: 1, id: 'profile', method: 'profile'})
    await click('Allow once')
    expect(mocks.request).toHaveBeenLastCalledWith('Account', 'viewer', expect.anything())
    expect(posted).toHaveBeenLastCalledWith(
      {seedApp: 1, id: 'profile', result: {id: 'viewer', name: 'Eric'}},
      `seed-app://${host}`,
    )

    mocks.request.mockResolvedValueOnce({type: 'account', metadata: {name: 'Eric'}})
    await send({seedApp: 1, id: 'profile-url', method: 'resource', params: {url: 'hm://viewer/:profile'}})
    await click('Allow once')
    expect(posted).toHaveBeenLastCalledWith(
      {seedApp: 1, id: 'profile-url', result: {id: 'viewer', name: 'Eric'}},
      `seed-app://${host}`,
    )

    mocks.request.mockResolvedValueOnce({type: 'document', id: docId, document})
    await send({seedApp: 1, id: 'res', method: 'resource', params: {url: docId.id}})
    await click('Allow once')
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
