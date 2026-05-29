// @vitest-environment jsdom
import React from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {UniversalAppProvider} from '@shm/shared'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const useBlockNoteMock = vi.hoisted(() =>
  vi.fn(() => ({
    _tiptapEditor: {
      view: null,
    },
  })),
)

vi.mock('@seed-hypermedia/client/hmblock-to-editorblock', () => ({
  hmBlocksToEditorContent: () => [{type: 'paragraph'}],
}))

vi.mock('./blocknote', () => ({
  BlockNoteEditor: class {},
  useBlockNote: (...args: any[]) => useBlockNoteMock(...args),
}))

vi.mock('./blocknote/react/BlockNoteView', () => ({
  BlockNoteView: ({children}: {children?: React.ReactNode}) => <div data-testid="block-note-view">{children}</div>,
}))

vi.mock('./schema', () => ({
  hmBlockSchema: {},
}))

import {EmbedEditorView} from './embed-editor'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  useBlockNoteMock.mockClear()
})

afterEach(() => {
  act(() => {
    root.unmount()
  })
  container.remove()
})

describe('EmbedEditorView', () => {
  it('configures embedded read-only links with the platform URL handler', () => {
    const openUrl = vi.fn()
    const openRouteNewWindow = vi.fn()

    act(() => {
      root.render(
        <UniversalAppProvider
          originHomeId={hmId('uid1')}
          openUrl={openUrl}
          openRoute={vi.fn()}
          openRouteNewWindow={openRouteNewWindow}
          universalClient={{request: vi.fn(), publish: vi.fn()} as any}
        >
          <EmbedEditorView blocks={[]} id={hmId('uid1', {path: ['docs']})} />
        </UniversalAppProvider>,
      )
    })

    const options = useBlockNoteMock.mock.calls.at(-1)?.[0]
    expect(options?.linkExtensionOptions?.openUrl).toBe(openUrl)
    expect(options?.linkExtensionOptions?.handleModifiedClicks).toBe(true)
    expect(options?.linkExtensionOptions?.renderHref('hm://uid1/docs')).toBe('https://hyper.media/docs')
  })
})
