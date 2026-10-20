import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'

const mocks = vi.hoisted(() => ({request: vi.fn()}))
vi.mock('@shm/shared/routing', () => ({useUniversalClient: () => ({request: mocks.request})}))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({fetchQuery: (options: {queryFn: () => Promise<unknown>}) => options.queryFn()}),
}))

import {DocumentAppView, documentAppCid} from '@shm/ui/document-app'
import {setDocumentAppPlatform} from '@shm/shared/document-app'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {unpackHmId} from '@seed-hypermedia/client'

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
  mocks.request.mockReset()
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
