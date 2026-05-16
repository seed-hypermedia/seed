// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

vi.mock('@shm/shared/models/recents', () => ({
  useRecents: () => ({data: []}),
}))

vi.mock('@shm/shared/models/search', () => ({
  useSearch: () => ({data: {entities: []}}),
}))

vi.mock('@shm/shared/gateway-url', () => ({
  useGatewayUrlStream: () => ({get: () => ''}),
}))

vi.mock('@shm/shared/models/use-editor-gate', () => ({
  useEditorGate: () => ({canEdit: false, isEditing: false}),
}))

vi.mock('./blocknote/react', () => ({
  createReactBlockSpec: (spec: any) => spec,
}))

vi.mock('./draft-actions-context', () => ({
  useDraftActions: () => null,
}))

vi.mock('./embed-editor', () => ({
  EmbedEditorView: () => null,
}))

vi.mock('./media-container', () => ({
  MediaContainer: ({children}: any) => <div>{children}</div>,
}))

vi.mock('./media-render', () => ({
  MediaRender: () => null,
}))

const resolveHypermediaUrlMock = vi.fn()
vi.mock('@seed-hypermedia/client', () => ({
  resolveHypermediaUrl: (...args: any[]) => resolveHypermediaUrlMock(...args),
}))

vi.mock('@shm/shared/utils/entity-id-url', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shm/shared/utils/entity-id-url')>()
  return {
    ...actual,
    isHypermediaScheme: (url: string) => url.startsWith('hm://'),
    isPublicGatewayLink: (url: string, gwUrl: any) => {
      const gw = typeof gwUrl?.get === 'function' ? gwUrl.get() : gwUrl
      return typeof gw === 'string' && !!gw && url.startsWith(gw)
    },
    normalizeHmId: (url: string) => (url.startsWith('hm://') ? url : null),
    packHmId: (hmId: any) => hmId?.id ?? `hm://${hmId?.uid ?? 'unknown'}`,
  }
})

import {EmbedLauncherInput, resolveEmbedUrl} from './embed-block'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

function renderLauncher(overrides: Partial<Parameters<typeof EmbedLauncherInput>[0]> = {}) {
  const props = {
    editor: {} as any,
    assign: vi.fn(),
    setUrl: vi.fn(),
    fileName: {name: 'Upload File', color: undefined as string | undefined},
    setFileName: vi.fn(),
    submit: vi.fn(),
    setLoading: vi.fn(),
    ...overrides,
  }
  act(() => {
    root.render(<EmbedLauncherInput {...props} />)
  })
  const input = container.querySelector('input') as HTMLInputElement | null
  if (!input) throw new Error('Input not rendered')
  return {input, props}
}

describe('EmbedLauncherInput paste handling', () => {
  it('stops paste event propagation so ProseMirror handlers do not intercept', () => {
    const {input} = renderLauncher()

    const stopPropagation = vi.fn()
    const pasteEvent = new Event('paste', {bubbles: true}) as any
    pasteEvent.stopPropagation = stopPropagation
    pasteEvent.clipboardData = {
      getData: (type: string) => (type === 'text/plain' ? 'https://example.com' : ''),
    }

    act(() => {
      input.dispatchEvent(pasteEvent)
    })

    expect(stopPropagation).toHaveBeenCalled()
  })

  it('updates URL state when text is typed/changed', () => {
    const {input, props} = renderLauncher()

    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      nativeInputValueSetter.call(input, 'https://pasted.example')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })

    expect(props.setUrl).toHaveBeenCalledWith('https://pasted.example')
  })

  it('calls submit when Enter is pressed on a URL value', () => {
    const submit = vi.fn()
    const {input, props} = renderLauncher({submit})

    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      nativeInputValueSetter.call(input, 'https://example.com')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))
    })

    expect(submit).toHaveBeenCalledWith('https://example.com', props.assign, props.setFileName, props.setLoading)
  })

  it('calls submit when Enter is pressed on a hm:// URL', () => {
    const submit = vi.fn()
    const {input} = renderLauncher({submit})

    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      nativeInputValueSetter.call(input, 'hm://z6Mk...')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))
    })

    expect(submit).toHaveBeenCalled()
  })

  it('does not call submit when Enter is pressed on non-URL text', () => {
    const submit = vi.fn()
    const {input} = renderLauncher({submit})

    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      nativeInputValueSetter.call(input, 'just a search query')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))
    })

    expect(submit).not.toHaveBeenCalled()
  })
})

describe('resolveEmbedUrl', () => {
  beforeEach(() => {
    resolveHypermediaUrlMock.mockReset()
  })

  it('returns direct kind for hm:// URLs without calling resolver', async () => {
    const result = await resolveEmbedUrl('hm://abc/path')
    expect(result).toEqual({kind: 'direct', url: 'hm://abc/path'})
    expect(resolveHypermediaUrlMock).not.toHaveBeenCalled()
  })

  it('returns direct kind for public gateway links without calling resolver', async () => {
    const gwUrl = {get: () => 'https://hyper.media'}
    const result = await resolveEmbedUrl('https://hyper.media/abc/path', {gwUrl})
    // normalizeHmId mock only normalizes hm://, so falls back to raw url
    expect(result).toEqual({kind: 'direct', url: 'https://hyper.media/abc/path'})
    expect(resolveHypermediaUrlMock).not.toHaveBeenCalled()
  })

  it('returns resolved kind when resolveHypermediaUrl yields an hmId', async () => {
    resolveHypermediaUrlMock.mockResolvedValueOnce({hmId: {id: 'hm://xyz/posts/foo', uid: 'xyz'}})
    const domainResolver = vi.fn().mockResolvedValue('xyz')
    const result = await resolveEmbedUrl('https://eric.vicenti.net/posts/foo', {domainResolver})
    expect(result).toEqual({kind: 'resolved', url: 'hm://xyz/posts/foo'})
    expect(resolveHypermediaUrlMock).toHaveBeenCalledWith(
      'https://eric.vicenti.net/posts/foo',
      expect.objectContaining({domainResolver}),
    )
  })

  it('returns no-match kind when resolveHypermediaUrl returns null', async () => {
    resolveHypermediaUrlMock.mockResolvedValueOnce(null)
    const result = await resolveEmbedUrl('https://example.com/whatever')
    expect(result).toEqual({kind: 'no-match'})
  })

  it('returns no-match kind when resolveHypermediaUrl returns an object without hmId', async () => {
    resolveHypermediaUrlMock.mockResolvedValueOnce({hmId: null})
    const result = await resolveEmbedUrl('https://example.com/whatever')
    expect(result).toEqual({kind: 'no-match'})
  })

  it('returns error kind when resolveHypermediaUrl throws', async () => {
    const fetchError = new Error('CORS preflight failed')
    resolveHypermediaUrlMock.mockRejectedValueOnce(fetchError)
    const result = await resolveEmbedUrl('https://offline.example')
    expect(result).toEqual({kind: 'error', error: fetchError})
  })

  it('passes the provided domainResolver through to resolveHypermediaUrl', async () => {
    resolveHypermediaUrlMock.mockResolvedValueOnce({hmId: {id: 'hm://x', uid: 'x'}})
    const domainResolver = vi.fn()
    await resolveEmbedUrl('https://site.example/p', {domainResolver})
    expect(resolveHypermediaUrlMock).toHaveBeenCalledWith(
      'https://site.example/p',
      expect.objectContaining({domainResolver}),
    )
  })
})
