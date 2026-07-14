// @vitest-environment jsdom
import {createRoot, type Root} from 'react-dom/client'
import {type HTMLAttributes} from 'react'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

const {draftActionsMock, editorGateMock} = vi.hoisted(() => ({
  draftActionsMock: {
    current: null as any,
  },
  editorGateMock: {
    current: {canEdit: false, isEditing: false, beginEditIfNeeded: vi.fn()},
  },
}))

vi.mock('@shm/shared/models/recents', () => ({
  useRecents: () => ({data: []}),
}))

vi.mock('@shm/shared/models/search', () => ({
  useSearch: () => ({data: {entities: []}}),
}))

vi.mock('@shm/shared/models/interaction-summary', () => ({
  useInteractionSummary: () => ({data: {comments: 0}}),
}))

vi.mock('@shm/shared/utils/navigation', () => ({
  useNavigate: () => vi.fn(),
}))

vi.mock('@shm/shared/gateway-url', () => ({
  useGatewayUrlStream: () => ({get: () => ''}),
}))

vi.mock('@shm/shared/models/use-editor-gate', () => ({
  useEditorGate: () => editorGateMock.current,
}))

vi.mock('./blocknote/react', () => ({
  createReactBlockSpec: (spec: any) => spec,
}))

vi.mock('./draft-actions-context', () => ({
  useDraftActions: () => draftActionsMock.current,
}))

vi.mock('./block-selection-wrapper', () => ({
  BlockSelectionWrapper: ({children}: any) => <div contentEditable={false}>{children}</div>,
  useIsBlockSelected: () => false,
}))

vi.mock('./embed-editor', () => ({
  EmbedEditorView: () => null,
}))

vi.mock('./media-container', () => ({
  MediaContainer: ({children, onPress}: any) => (
    <div
      data-testid="media-container"
      data-has-on-press={String(!!onPress)}
      onClick={onPress ? (e) => onPress(e.nativeEvent) : undefined}
    >
      {children}
    </div>
  ),
}))

vi.mock('./media-render', () => ({
  MediaRender: ({DisplayComponent, editor, block}: any) =>
    DisplayComponent ? <DisplayComponent editor={editor} block={block} assign={vi.fn()} /> : null,
}))

vi.mock('@shm/ui/embed-views', () => ({
  BlockEmbedCard: (props: any) => (
    <div
      data-testid="block-embed-card"
      data-open-on-click={String(props.openOnClick)}
      data-title-link-only={String(props.titleLinkOnly)}
      data-hide-inline-actions={String(props.hideInlineActions)}
    />
  ),
  BlockEmbedComments: () => <div data-testid="block-embed-comments" />,
  BlockEmbedContent: () => <div data-testid="block-embed-content" />,
  BlockEmbedLink: () => <div data-testid="block-embed-link" />,
}))

// SubdocumentMenu (the Card/Link embed "..." menu) now mounts whenever the card
// is present so it can reveal on hover; stub its leaf data hooks so it renders a
// closed dropdown without a QueryClient/route/actions provider.
vi.mock('@shm/shared/models/entity', () => ({
  useResource: () => ({data: undefined, isLoading: false, isInitialLoading: false}),
  useResources: () => [],
  useAccount: () => ({data: undefined}),
}))

vi.mock('@shm/shared/document-actions-context', () => ({
  useDocumentActions: () => ({}),
}))

vi.mock('@shm/ui/newspaper', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shm/ui/newspaper')>()
  return {...actual, useDocumentCardMenuItems: () => []}
})

vi.mock('@shm/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@shm/shared')>()
  return {...actual, useRouteLink: () => ({onClick: undefined, href: undefined})}
})

const resolveHypermediaUrlMock = vi.fn()
vi.mock('@seed-hypermedia/client', () => ({
  resolveHypermediaUrl: (...args: any[]) => resolveHypermediaUrlMock(...args),
}))

vi.mock('@shm/shared/utils/entity-id-url', async (importOriginal) => {
  return await importOriginal<typeof import('@shm/shared/utils/entity-id-url')>()
})

import {EmbedBlock, EmbedLauncherInput, resolveEmbedUrl} from './embed-block'

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
  draftActionsMock.current = null
  editorGateMock.current = {canEdit: false, isEditing: false, beginEditIfNeeded: vi.fn()}
  vi.useRealTimers()
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

function renderEmbedBlock({
  canEdit = false,
  isEditing = false,
  view = 'Card',
  beginEditIfNeeded = vi.fn(),
}: {
  canEdit?: boolean
  isEditing?: boolean
  view?: 'Card' | 'Content' | 'Comments' | 'Link'
  beginEditIfNeeded?: ReturnType<typeof vi.fn>
} = {}) {
  editorGateMock.current = {canEdit, isEditing, beginEditIfNeeded}
  act(() => {
    root.render(
      EmbedBlock.render({
        block: {
          id: 'block-1',
          props: {draftId: '', url: 'hm://uid/doc', view, parentBlockId: ''},
        } as any,
        editor: {} as any,
      }),
    )
  })
}

function renderDraftEmbed({
  draft = {
    id: 'draft-1',
    metadata: {name: 'Draft title'},
    locationUid: 'uid-1',
    locationPath: ['parent'],
    editUid: 'uid-1',
    editPath: ['parent', '-draft-1'],
  },
  onUpdateDraftName = vi.fn(),
  onOpenDraft = vi.fn(),
  onDeleteDraft = vi.fn(),
  lastCreatedInlineDraftId = null as string | null,
  clearLastCreatedInlineDraftId = vi.fn(),
  parentHandlers = {},
}: {
  draft?: any
  onUpdateDraftName?: any
  onOpenDraft?: any
  onDeleteDraft?: any
  lastCreatedInlineDraftId?: string | null
  clearLastCreatedInlineDraftId?: any
  parentHandlers?: HTMLAttributes<HTMLDivElement>
} = {}) {
  const editor = {
    updateBlock: vi.fn(),
    insertBlocks: vi.fn(),
    removeBlocks: vi.fn(),
  }
  draftActionsMock.current = {
    useInlineDraft: () => ({data: draft}),
    onUpdateDraftName,
    onOpenDraft,
    onDeleteDraft,
    lastCreatedInlineDraftId,
    clearLastCreatedInlineDraftId,
  }
  act(() => {
    root.render(
      <div data-testid="parent" {...parentHandlers}>
        {EmbedBlock.render({
          block: {id: 'block-1', props: {draftId: draft.id}} as any,
          editor: editor as any,
        })}
      </div>,
    )
  })
  const input = container.querySelector('input') as HTMLInputElement | null
  if (!input) throw new Error('Draft title input not rendered')
  return {input, editor, onUpdateDraftName, onOpenDraft, onDeleteDraft, clearLastCreatedInlineDraftId}
}

describe('EmbedBlock card navigation mode', () => {
  it('uses title-only navigation for card embeds when the user can edit', () => {
    renderEmbedBlock({canEdit: true, isEditing: false, view: 'Card'})

    const card = container.querySelector('[data-testid="block-embed-card"]') as HTMLElement | null
    expect(card).toBeTruthy()
    expect(card?.dataset.titleLinkOnly).toBe('true')
    expect(card?.dataset.openOnClick).toBe('true')
    expect(card?.dataset.hideInlineActions).toBe('false')
    expect((container.querySelector('[data-testid="media-container"]') as HTMLElement | null)?.dataset.hasOnPress).toBe(
      'false',
    )
  })

  it('does not render the editor floating actions for card embeds outside active editing', () => {
    renderEmbedBlock({canEdit: true, isEditing: false, view: 'Card'})

    expect(container.querySelector('[aria-label="View comments"]')).toBeNull()
  })

  it.each(['Card', 'Link'] as const)(
    'does not render custom copy or comment block actions for %s embeds while editing',
    (view) => {
      renderEmbedBlock({canEdit: true, isEditing: true, view})

      expect(container.querySelector('[aria-label="View comments"]')).toBeNull()
      expect(container.querySelector('[aria-label="Copy link"]')).toBeNull()
    },
  )

  it.each(['Card', 'Link'] as const)(
    'renders the %s embed options menu while editing so it can reveal on hover',
    (view) => {
      renderEmbedBlock({canEdit: true, isEditing: true, view})

      expect(container.querySelector('[aria-label="Subdocument options"]')).toBeTruthy()
    },
  )

  it('does not render the embed options menu outside active editing', () => {
    renderEmbedBlock({canEdit: true, isEditing: false, view: 'Card'})

    expect(container.querySelector('[aria-label="Subdocument options"]')).toBeNull()
  })

  it('disables title-only navigation while editing so the first click can select the block', () => {
    renderEmbedBlock({canEdit: true, isEditing: true, view: 'Card'})

    const card = container.querySelector('[data-testid="block-embed-card"]') as HTMLElement | null
    expect(card).toBeTruthy()
    expect(card?.dataset.titleLinkOnly).toBe('false')
    expect(card?.dataset.openOnClick).toBe('false')
    expect(card?.dataset.hideInlineActions).toBe('true')
  })

  it('keeps whole-card navigation for card embeds when the user cannot edit', () => {
    renderEmbedBlock({canEdit: false, isEditing: false, view: 'Card'})

    const card = container.querySelector('[data-testid="block-embed-card"]') as HTMLElement | null
    expect(card).toBeTruthy()
    expect(card?.dataset.titleLinkOnly).toBe('false')
    expect(card?.dataset.openOnClick).toBe('true')
    expect((container.querySelector('[data-testid="media-container"]') as HTMLElement | null)?.dataset.hasOnPress).toBe(
      'false',
    )
  })

  it('does not attach a custom click handler for editable card embeds', () => {
    renderEmbedBlock({canEdit: true, isEditing: false, view: 'Card'})

    expect((container.querySelector('[data-testid="media-container"]') as HTMLElement | null)?.dataset.hasOnPress).toBe(
      'false',
    )
  })
})

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

describe('DraftEmbedPlaceholder title input', () => {
  it('renders the child draft title in an editable input', () => {
    const {input} = renderDraftEmbed()

    expect(input.value).toBe('Draft title')
    expect(input.placeholder).toBe('Untitled document')
  })

  it('focuses newly created draft title and clears the focus marker', () => {
    const clearLastCreatedInlineDraftId = vi.fn()
    const {input} = renderDraftEmbed({
      lastCreatedInlineDraftId: 'draft-1',
      clearLastCreatedInlineDraftId,
    })

    expect(document.activeElement).toBe(input)
    expect(clearLastCreatedInlineDraftId).toHaveBeenCalledWith('draft-1')
  })

  it('debounces title saves to child draft metadata without mutating parent editor blocks', () => {
    vi.useFakeTimers()
    const {input, editor, onUpdateDraftName} = renderDraftEmbed()

    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      nativeInputValueSetter.call(input, 'Renamed child')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })

    expect(onUpdateDraftName).not.toHaveBeenCalled()
    expect(editor.updateBlock).not.toHaveBeenCalled()
    expect(editor.insertBlocks).not.toHaveBeenCalled()
    expect(editor.removeBlocks).not.toHaveBeenCalled()

    act(() => {
      vi.advanceTimersByTime(500)
    })

    expect(onUpdateDraftName).toHaveBeenCalledWith('draft-1', 'Renamed child')
    expect(editor.updateBlock).not.toHaveBeenCalled()
    expect(editor.insertBlocks).not.toHaveBeenCalled()
    expect(editor.removeBlocks).not.toHaveBeenCalled()
  })

  it('stops title input keyboard/input events from bubbling to the parent editor wrapper', () => {
    const onKeyDown = vi.fn()
    const onInput = vi.fn()
    const {input} = renderDraftEmbed({
      parentHandlers: {onKeyDown, onInput},
    })

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'a', bubbles: true}))
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })

    expect(onKeyDown).not.toHaveBeenCalled()
    expect(onInput).not.toHaveBeenCalled()
  })

  it('flushes title save before opening the child draft on Enter', async () => {
    const onUpdateDraftName = vi.fn().mockResolvedValue(undefined)
    const onOpenDraft = vi.fn()
    const {input} = renderDraftEmbed({onUpdateDraftName, onOpenDraft})

    act(() => {
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
      nativeInputValueSetter.call(input, 'Open me')
      input.dispatchEvent(new Event('input', {bubbles: true}))
    })

    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter', bubbles: true}))
    })

    expect(onUpdateDraftName).toHaveBeenCalledWith('draft-1', 'Open me')
    expect(onOpenDraft).toHaveBeenCalledWith('draft-1', ['parent', '-draft-1'])
  })

  it('removes the draft card without deleting the child draft immediately', async () => {
    const onDeleteDraft = vi.fn().mockResolvedValue(undefined)
    const {editor} = renderDraftEmbed({onDeleteDraft})
    const menuButton = container.querySelector('button[aria-label="Draft options"]') as HTMLButtonElement | null
    expect(menuButton).toBeTruthy()

    await act(async () => {
      menuButton!.dispatchEvent(new MouseEvent('pointerdown', {bubbles: true, cancelable: true}))
    })
    const removeItem = Array.from(document.body.querySelectorAll('[role="menuitem"]')).find(
      (el) => el.textContent?.includes('Remove card'),
    ) as HTMLElement | undefined
    expect(removeItem).toBeTruthy()

    await act(async () => {
      removeItem!.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true}))
    })

    expect(onDeleteDraft).not.toHaveBeenCalled()
    expect(editor.removeBlocks).toHaveBeenCalledWith(['block-1'])
  })

  it('blurs title input on Escape', () => {
    const {input} = renderDraftEmbed()
    input.focus()

    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}))
    })

    expect(document.activeElement).not.toBe(input)
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

  it('returns direct kind for gateway hm URLs without calling resolver', async () => {
    const result = await resolveEmbedUrl('https://hyper.media/hm/abc/path?v=v1#blk1')
    expect(result).toEqual({kind: 'direct', url: 'hm://abc/path?v=v1#blk1'})
    expect(resolveHypermediaUrlMock).not.toHaveBeenCalled()
  })

  it('returns direct kind for gateway hm URLs even when they are not on the current gateway', async () => {
    const gwUrl = {get: () => 'https://other-gateway.example'}
    const result = await resolveEmbedUrl('https://hyper.media/hm/abc/path', {gwUrl})
    expect(result).toEqual({kind: 'direct', url: 'hm://abc/path'})
    expect(resolveHypermediaUrlMock).not.toHaveBeenCalled()
  })

  it('returns resolved kind when resolveHypermediaUrl yields an hmId', async () => {
    resolveHypermediaUrlMock.mockResolvedValueOnce({
      hmId: {id: 'hm://xyz/posts/foo', uid: 'xyz', path: ['posts', 'foo'], version: null, blockRef: null},
    })
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
