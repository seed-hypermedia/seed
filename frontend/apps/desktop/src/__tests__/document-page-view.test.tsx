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

import {DocumentPageView, documentPageCid} from '@shm/ui/document-page'
import {DOCUMENT_PAGE_CLIENT_SCRIPT, setDocumentPagePlatform} from '@shm/shared/document-page'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {unpackHmId} from '@seed-hypermedia/client'
import {base58btc} from 'multiformats/bases/base58'
import {decode} from '@ipld/dag-cbor'
import {pagePermissionStorageKey} from '@shm/shared/document-page-permissions'

const cid = 'bafybeibowhl2ypujel2qrmcps2qy2szwv3ruyjqliqejr6jg4kil437y3e'
const host = 'c'.repeat(40)
const docId = unpackHmId('hm://z6MkiAKDcRSzQ4zPZfnJcS5HYx5MwgN6MU9foHihJGrhqNBj/pages/counter')!
const document = {
  metadata: {name: 'Counter', type: 'hm://hyper.media/page', html: `ipfs://${cid}`},
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
  setDocumentPagePlatform(null)
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
        origin: `seed-page://${host}`,
        data: {seedPage: 1, id: crypto.randomUUID(), method, params},
      }),
    ),
  )
}

describe('DocumentPageView', () => {
  it('lets inline startup reads finish after load, including on a subsequent navigation', async () => {
    setDocumentPagePlatform({resolvePageUrl: async () => `seed-page://${host}/`})
    await act(async () => root.render(<DocumentPageView docId={docId} document={document} cid={cid} />))
    const frame = container.querySelector('iframe')!
    const source = frame.contentWindow!
    const resource = {type: 'document', id: docId, document}
    for (let navigation = 0; navigation < 2; navigation++) {
      let deliver!: (event: unknown) => void
      const parent = {
        postMessage: (data: unknown) =>
          window.dispatchEvent(new MessageEvent('message', {source, origin: `seed-page://${host}`, data})),
      }
      const page: any = {parent}
      vi.spyOn(source, 'postMessage').mockImplementation((data: unknown) => deliver({source: parent, data}))
      new Function('window', 'document', 'addEventListener', 'TextEncoder', DOCUMENT_PAGE_CLIENT_SCRIPT)(
        page,
        frame.contentDocument,
        (_name: string, listener: typeof deliver) => {
          deliver = listener
        },
        TextEncoder,
      )
      let finishRead!: (value: unknown) => void
      mocks.request.mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishRead = resolve
          }),
      )
      const initialRead = page.seed.resource(docId.id)
      // The inline script executes before the browser fires iframe load.
      await act(async () => {})
      expect(mocks.request).toHaveBeenCalledTimes(navigation)
      await act(async () => {
        frame.dispatchEvent(new Event('load'))
      })
      expect(mocks.request).toHaveBeenCalledTimes(navigation + 1)
      const signal = mocks.request.mock.calls.at(-1)![2].signal as AbortSignal
      expect(signal.aborted).toBe(false)
      await act(async () => finishRead(resource))
      await expect(initialRead).resolves.toEqual(resource)
    }
    const signal = mocks.request.mock.calls.at(-1)![2].signal as AbortSignal
    await act(async () => root.render(<div />))
    expect(signal.aborted).toBe(true)
  })

  it('asks before running on an unfamiliar site, without requiring a join', async () => {
    mocks.joined = false
    const resolvePageUrl = vi.fn(async () => `seed-page://${host}/`)
    setDocumentPagePlatform({resolvePageUrl})
    await act(async () => root.render(<DocumentPageView docId={docId} document={document} cid={cid} />))
    expect(resolvePageUrl).not.toHaveBeenCalled()
    expect(container.textContent).toContain('Joining is optional')
    await click('Run page')
    expect(resolvePageUrl).toHaveBeenCalledTimes(1)
    expect(container.querySelector('iframe')).not.toBeNull()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('runs a same-site web page without a join or launch prompt', async () => {
    mocks.joined = false
    mocks.originHomeId = {uid: docId.uid}
    const loadPageHtml = vi.fn(() => new Promise<string>(() => {}))
    setDocumentPagePlatform({loadPageHtml})
    await act(async () => root.render(<DocumentPageView docId={docId} document={document} cid={cid} />))
    expect(loadPageHtml).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain('Run page')
  })

  it('offers comment scopes while keeping raw signing and reading separate; remembers by page ID across updates', async () => {
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
    const closePageUrl = vi.fn(async () => {})
    setDocumentPagePlatform({resolvePageUrl: async () => `seed-page://${host}/`, closePageUrl})
    await act(async () =>
      root.render(<DocumentPageView docId={docId} document={{...document, version: cid}} cid={cid} />),
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
    expect(window.document.body.textContent).toContain('Allow this request only.')
    await act(async () => (window.document.querySelector('input[value="type-site"]') as HTMLInputElement).click())
    expect(window.document.body.textContent).toContain(
      'This page can sign future requests of this type on this site without asking again.',
    )
    await click('Allow comments on this site')
    await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(1))
    expect(
      (decode(new Uint8Array(mocks.publish.mock.calls[0]![0].blobs[0].data)) as Record<string, unknown>).path,
    ).toBe('/pages/counter')
    await send('comments.create', params)
    await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(2))
    expect(window.document.querySelector('[role="alertdialog"]')).toBeNull()
    await send('hm.signBlob', {input: {type: 'UnknownAppAction', choice: 'yes'}})
    await vi.waitFor(() => expect(window.document.body.textContent).toContain('Sign unrecognized data'))
    await act(async () => (window.document.querySelector('input[value="all"]') as HTMLInputElement).click())
    expect(window.document.querySelector('input[type="checkbox"]')).toBeNull()
    expect(button('Allow any signing').disabled).toBe(false)
    expect(window.document.body.textContent).toContain(
      'This page can sign anything as your account, including lasting account permissions, without asking again.',
    )
    await click('Deny')
    expect(sign).toHaveBeenCalledTimes(2)
    await send('context')
    expect(window.document.body.textContent).toContain('Identify your account')
    await act(async () => (window.document.querySelector('input[value="all"]') as HTMLInputElement).click())
    expect(window.document.querySelector('input[type="checkbox"]')).toBeNull()
    expect(button('Allow all reading').disabled).toBe(false)
    expect(window.document.body.textContent).toContain(
      'This page can read everything available to your account without asking again.',
    )
    await click('Allow all reading')
    await send('context')
    expect(window.document.querySelector('[role="alertdialog"]')).toBeNull()
    await act(async () =>
      root.render(<DocumentPageView docId={docId} document={{...document, version: `${cid}.${cid}`}} cid={cid} />),
    )
    expect(closePageUrl).toHaveBeenCalled()
    await send('comments.create', params)
    await vi.waitFor(() => expect(mocks.publish).toHaveBeenCalledTimes(3))
    expect(window.document.querySelector('[role="alertdialog"]')).toBeNull()
    await click('Page permissions')
    expect(window.document.querySelector('[role="dialog"]')?.textContent).toContain('Allow comments on this site')
    expect(window.document.querySelector('[role="dialog"]')?.textContent).toContain('Allow all reading')
    await click('Reset additional permissions')
    expect(window.localStorage.getItem(pagePermissionStorageKey(mocks.account, docId.id))).toBe('[]')
  })

  it('updates schema-defined URL input and restores history without restarting the page', async () => {
    const resolvePageUrl = vi.fn(async () => `seed-page://${host}/`)
    setDocumentPagePlatform({resolvePageUrl})
    const pageDocument = {...document, metadata: {...document.metadata, inputSchema: 'hm://hyper.media/example/person'}}
    const navigate = vi.fn()
    const render = (name: string) =>
      root.render(
        <DocumentPageView
          docId={docId}
          document={pageDocument}
          cid={cid}
          inputParams={{name: JSON.stringify(name)}}
          onInputNavigate={navigate}
        />,
      )
    await act(async () => render('Initial'))
    const frame = container.querySelector('iframe')!
    const posted = vi.spyOn(frame.contentWindow!, 'postMessage')
    await send('input.get')
    expect(posted).toHaveBeenLastCalledWith(
      expect.objectContaining({
        result: {values: {name: 'Initial'}, schema: 'hm://hyper.media/example/person', errors: []},
      }),
      `seed-page://${host}`,
    )
    await send('input.push', {values: {name: 'Next'}})
    expect(navigate).toHaveBeenLastCalledWith({name: '"Next"'}, 'push')
    await act(async () => render('Next'))
    await send('input.replace', {values: {name: 'Edited'}})
    expect(navigate).toHaveBeenLastCalledWith({name: '"Edited"'}, 'replace')
    await act(async () => render('Initial'))
    await vi.waitFor(() =>
      expect(posted).toHaveBeenCalledWith(
        expect.objectContaining({type: 'seed-input', state: expect.objectContaining({values: {name: 'Initial'}})}),
        `seed-page://${host}`,
      ),
    )
    expect(container.querySelector('iframe')).toBe(frame)
    expect(resolvePageUrl).toHaveBeenCalledTimes(1)
    expect(window.document.querySelector('[role="alertdialog"]')).toBeNull()
    await send('input.push', {values: {name: 'Invalid', age: 'not a number'}})
    expect(posted).toHaveBeenLastCalledWith(
      expect.objectContaining({error: expect.stringContaining('integer')}),
      `seed-page://${host}`,
    )
    expect(navigate).toHaveBeenCalledTimes(2)
  })

  it('opens the parameter form from host controls and applies without remounting the page', async () => {
    const parametersChanged = vi.fn()
    const navigate = vi.fn()
    const resolvePageUrl = vi.fn(async () => `seed-page://${host}/`)
    setDocumentPagePlatform({resolvePageUrl})
    const pageDocument = {...document, metadata: {...document.metadata, inputSchema: 'hm://hyper.media/example/person'}}
    await act(async () =>
      root.render(
        <DocumentPageView
          docId={docId}
          document={pageDocument}
          cid={cid}
          inputParams={{name: '"Initial"'}}
          onInputNavigate={navigate}
          onParametersChange={parametersChanged}
        />,
      ),
    )
    const frame = container.querySelector('iframe')!
    const posted = vi.spyOn(frame.contentWindow!, 'postMessage')
    expect(container.textContent).not.toContain('Page parameters')
    await act(async () => parametersChanged.mock.calls.at(-1)![0]())
    const field = window.document.querySelector<HTMLInputElement>('input[aria-label="name"]')!
    expect(field.value).toBe('Initial')
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'Edited')
      field.dispatchEvent(new Event('input', {bubbles: true}))
    })
    await click('Apply')
    expect(navigate).toHaveBeenCalledExactlyOnceWith({name: '"Edited"'}, 'push')
    expect(posted).toHaveBeenCalledWith(
      expect.objectContaining({type: 'seed-input', state: expect.objectContaining({values: {name: 'Edited'}})}),
      `seed-page://${host}`,
    )
    expect(container.querySelector('iframe')).toBe(frame)
    expect(resolvePageUrl).toHaveBeenCalledOnce()
    await act(async () => root.render(null))
    expect(parametersChanged).toHaveBeenLastCalledWith(null)
  })

  it('cancels pending consent when the account changes', async () => {
    setDocumentPagePlatform({resolvePageUrl: async () => `seed-page://${host}/`})
    await act(async () => root.render(<DocumentPageView docId={docId} document={document} cid={cid} />))
    await send('profile')
    expect(window.document.body.textContent).toContain('Identify your account')
    mocks.account = 'another-viewer'
    await act(async () => root.render(<DocumentPageView docId={docId} document={document} cid={cid} />))
    expect(window.document.querySelector('[role="alertdialog"]')).toBeNull()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('applies revocation from another window before returning an in-flight read', async () => {
    const key = pagePermissionStorageKey(mocks.account, docId.id)
    window.localStorage.setItem(key, JSON.stringify([{kind: 'read', scope: 'all'}]))
    setDocumentPagePlatform({resolvePageUrl: async () => `seed-page://${host}/`})
    await act(async () => root.render(<DocumentPageView docId={docId} document={document} cid={cid} />))
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
      expect.objectContaining({error: 'Page permissions changed.'}),
      `seed-page://${host}`,
    )
    expect(JSON.stringify(posted.mock.calls)).not.toContain('Must not escape')
    await send('profile')
    expect(window.document.body.textContent).toContain('Identify your account')
  })

  it('fills the main view and opens permission settings from the breadcrumb menu', async () => {
    const accessChanged = vi.fn()
    setDocumentPagePlatform({resolvePageUrl: async () => `seed-page://${host}/`})
    await act(async () =>
      root.render(
        <DocumentPageView docId={docId} document={document} cid={cid} fill onAccountAccessChange={accessChanged} />,
      ),
    )
    const frame = container.querySelector('iframe')!
    expect(frame.classList.contains('h-full')).toBe(true)
    expect(container.querySelector('section')!.classList.contains('border')).toBe(false)
    expect(container.textContent).not.toContain('Page permissions')
    await act(async () => accessChanged.mock.calls.at(-1)![0]())
    expect(window.document.querySelector('[role="dialog"]')?.textContent).toContain('Page permissions')
  })

  it('opens document references through Seed without requesting account access', async () => {
    const external = vi.fn()
    setDocumentPagePlatform({resolvePageUrl: async () => `seed-page://${host}/`, openExternalUrl: external})
    await act(async () => root.render(<DocumentPageView docId={docId} document={document} cid={cid} />))
    const frame = container.querySelector('iframe')!
    const send = async (url: string) =>
      act(async () => {
        window.dispatchEvent(
          new MessageEvent('message', {
            source: frame.contentWindow,
            origin: `seed-page://${host}`,
            data: {seedPage: 1, id: 'open', method: 'open', params: {url, newWindow: true}},
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
    expect(window.document.body.textContent).not.toContain('Give this page full account access?')
    expect(mocks.getSigner).not.toHaveBeenCalled()
  })

  it('reads the page CID from metadata', () => {
    expect(documentPageCid(document)).toBe(cid)
    expect(documentPageCid({metadata: {name: 'Plain'}} as HMDocument)).toBeNull()
  })

  it('explains itself where no platform can run pages', async () => {
    await act(async () => {
      root.render(
        <React.StrictMode>
          <DocumentPageView docId={docId} document={document} cid={cid} perspectiveAccountUid="viewer" />
        </React.StrictMode>,
      )
    })
    expect(container.textContent).toContain('Open it in the Seed desktop application')
    expect(container.querySelector('iframe')).toBeNull()
  })

  it('embeds the resolved page URL in a sandboxed frame and answers bridge requests as the viewer', async () => {
    const resolvePageUrl = vi.fn(async () => `seed-page://${host}/`)
    setDocumentPagePlatform({resolvePageUrl})
    await act(async () => {
      root.render(
        <React.StrictMode>
          <DocumentPageView docId={docId} document={document} cid={cid} perspectiveAccountUid="viewer" />
        </React.StrictMode>,
      )
    })
    await vi.waitFor(async () => {
      await act(async () => {})
      expect(container.querySelector('iframe')).not.toBeNull()
    })
    expect(resolvePageUrl).toHaveBeenCalledWith({id: docId.id, cid, account: mocks.account})
    const frame = container.querySelector('iframe')!
    expect(frame.getAttribute('src')).toBe(`seed-page://${host}/`)
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms')
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer')

    const source = frame.contentWindow!
    const posted = vi.spyOn(source, 'postMessage')
    const send = (data: unknown, origin = `seed-page://${host}`) =>
      act(async () => {
        window.dispatchEvent(new MessageEvent('message', {data, origin, source}))
      })

    mocks.request.mockResolvedValueOnce({type: 'document', document: {account: docId.uid, path: '/tasks'}})
    await send({seedPage: 1, id: 'own-space', method: 'resource', params: {url: `hm://${docId.uid}/tasks`}})
    expect(posted).toHaveBeenLastCalledWith(
      {seedPage: 1, id: 'own-space', result: {type: 'document', document: {account: docId.uid, path: '/tasks'}}},
      `seed-page://${host}`,
    )
    expect(window.document.querySelector('[role="dialog"]')).toBeNull()
    posted.mockClear()

    await send({seedPage: 1, id: 'ctx', method: 'context'})
    expect(posted).not.toHaveBeenCalled()
    await click('Allow once')
    expect(posted).toHaveBeenCalledWith(
      {
        seedPage: 1,
        id: 'ctx',
        result: {protocol: 1, document: docId.id, version: 'v1', account: 'viewer', page: cid},
      },
      `seed-page://${host}`,
    )

    await send({seedPage: 1, id: 'save', method: 'storage.set', params: {key: 'notes', value: ['hello']}})
    await send({seedPage: 1, id: 'read', method: 'storage.get', params: {key: 'notes'}})
    await click('Allow once')
    expect(posted).toHaveBeenLastCalledWith({seedPage: 1, id: 'read', result: ['hello']}, `seed-page://${host}`)
    await send({seedPage: 1, id: 'escape', method: 'storage.get', params: {key: 'notes', account: 'other'}})
    await click('Allow once')
    expect(posted).toHaveBeenLastCalledWith(
      {seedPage: 1, id: 'escape', error: 'Unknown storage parameter'},
      `seed-page://${host}`,
    )

    mocks.request.mockResolvedValueOnce({type: 'account', metadata: {name: 'Eric'}})
    await send({seedPage: 1, id: 'profile', method: 'profile'})
    await click('Allow once')
    expect(mocks.request).toHaveBeenLastCalledWith('Account', 'viewer', expect.anything())
    expect(posted).toHaveBeenLastCalledWith(
      {seedPage: 1, id: 'profile', result: {id: 'viewer', name: 'Eric'}},
      `seed-page://${host}`,
    )

    mocks.request.mockResolvedValueOnce({type: 'account', metadata: {name: 'Eric'}})
    await send({seedPage: 1, id: 'profile-url', method: 'resource', params: {url: 'hm://viewer/:profile'}})
    await click('Allow once')
    expect(posted).toHaveBeenLastCalledWith(
      {seedPage: 1, id: 'profile-url', result: {id: 'viewer', name: 'Eric'}},
      `seed-page://${host}`,
    )

    mocks.request.mockResolvedValueOnce({type: 'document', id: docId, document})
    await send({seedPage: 1, id: 'res', method: 'resource', params: {url: docId.id}})
    expect(window.document.querySelector('[role="dialog"]')).toBeNull()
    expect(mocks.request).toHaveBeenCalledWith('Resource', expect.objectContaining({id: docId.id}), expect.anything())
    expect(posted).toHaveBeenLastCalledWith(
      expect.objectContaining({id: 'res', result: expect.anything()}),
      `seed-page://${host}`,
    )

    await send({seedPage: 1, id: 'bad', method: 'resource', params: {url: 'https://not-hm'}})
    expect(posted).toHaveBeenLastCalledWith(
      {seedPage: 1, id: 'bad', error: 'Expected an hm:// URL'},
      `seed-page://${host}`,
    )

    // Another origin, even with the right shape, is ignored.
    posted.mockClear()
    await send({seedPage: 1, id: 'x', method: 'context'}, 'https://evil.example')
    expect(posted).not.toHaveBeenCalled()
  })
})
