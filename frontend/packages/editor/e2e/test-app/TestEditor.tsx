import '@/blocknote/core/style.css'
import '@/editor.css'
import '@shm/ui/hm-prose.css'
import {HMFormattingToolbar} from '@shm/editor/hm-formatting-toolbar'
import {HypermediaLinkPreview} from '@shm/editor/hm-link-preview'
import {SearchResultItem, UniversalAppProvider, writeableStateStream} from '@shm/shared'
import {NavContextProvider} from '@shm/shared/utils/navigation'
import {DocumentMachineProvider, useDocumentMachineRef} from '@shm/shared/models/use-document-machine'
import {DocumentEditor} from '../../src/document-editor'
import {DraftActionsContext, type DraftActions} from '../../src/draft-actions-context'
import {TooltipProvider} from '@shm/ui/tooltip'
import {QueryClient, QueryClientProvider} from '@tanstack/react-query'
import {Extension} from '@tiptap/core'
import {createMachine} from 'xstate'
import {type ReactNode, useEffect, useRef, useState} from 'react'
import {
  BlockNoteView,
  FormattingToolbarPositioner,
  HyperlinkToolbarPositioner,
  SideMenuPositioner,
  SlashMenuPositioner,
  useBlockNote,
} from '../../src/blocknote'
import {fullBlockSelectionPluginKey} from '../../src/blocknote/core/extensions/FullBlockSelection/FullBlockSelectionPlugin'
import type {Block} from '../../src/blocknote/core/extensions/Blocks/api/blockTypes'
import type {HMBlockSchema} from '../../src/schema'
import {hmBlockSchema} from '../../src/schema'
import {getSlashMenuItems} from '../../src/slash-menu-items'
import {selectAllEditorContent} from '../../src/utils'

// Create a dummy gateway URL stream for testing
const [, gwUrl] = writeableStateStream<string | null>('https://hyper.media')

// Minimal navigation context so embed cards (EmbedWrapper → useNavRoute) can render.
const [, navStateStream] = writeableStateStream<any>({routes: [], routeIndex: 0, lastAction: 'push'})
const navContext = {state: navStateStream, dispatch: () => {}} as any

// Minimal document machine forced into the `editing` state with edit permission, so
// `useEditorGate()` reports canEdit=true / isEditing=true. This reproduces the real
// editing scenario (embed cards render as selectable divs, not navigation links).
// Enabled via `?edit=1`.
function makeMockMachine(startEditing: boolean) {
  return createMachine({
    id: 'mockDoc',
    initial: startEditing ? 'editing' : 'idle',
    context: {canEdit: true} as any,
    states: {
      // "editable but viewing" — canEdit=true, isEditing=false. Cards render as links.
      idle: {on: {'edit.start': {target: 'editing'}}},
      // active editing — canEdit=true, isEditing=true. Cards render as selectable divs.
      editing: {},
    },
  }) as any
}

const editModeId = {
  id: 'hm://bafy-doc-uid',
  uid: 'bafy-doc-uid',
  path: [],
  version: null,
  blockRef: null,
  blockRange: null,
  hostname: null,
  scheme: 'hm',
  latest: true,
} as any

// Mock hypermedia document for document search tests
const mockHmDoc: SearchResultItem = {
  type: 'document',
  title: 'Test HM Doc',
  icon: '',
  parentNames: ['Root', 'Notes'],
  searchQuery: 'test',
  id: {
    id: 'hm://seed.test/doc/test-hm-doc',
    uid: 'bafy-doc-uid',
    path: ['Root', 'Notes', 'Test HM Doc'],
    version: null,
    blockRef: null,
    blockRange: null,
    hostname: 'seed.test',
    scheme: 'hm',
    latest: true,
  },
}

// Mock query client for document search tests
const mockQueryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      staleTime: Infinity,
    },
  },
})

// Minimal document resource so embed Card/Content views render the real
// DocumentCard/EmbedWrapper DOM (loaded state) instead of an error box.
function mockDocumentResource(id: any) {
  return {
    type: 'document',
    id,
    document: {
      version: 'v-mock',
      account: id?.uid ?? 'bafy-doc-uid',
      path: id?.path?.length ? '/' + id.path.join('/') : '/',
      metadata: {name: (id?.path && id.path[id.path.length - 1]) || 'Mock Doc'},
      authors: [],
      content: [],
      createTime: {seconds: 0, nanos: 0},
      updateTime: {seconds: 0, nanos: 0},
      genesis: 'v-mock',
      visibility: 'PUBLIC',
    },
  }
}

// Mock universal context client for document search tests
const mockUniversalClient = {
  request: async (method: string, params: any) => {
    if (method === 'Search') {
      return {entities: [mockHmDoc]}
    }
    if (method === 'Resource') {
      return mockDocumentResource(params)
    }
    if (method === 'Interaction' || method === 'InteractionSummary') {
      return {comments: 0, children: 0}
    }
    // Unknown methods resolve empty rather than throwing so a card render never crashes the harness.
    return null
  },
  publish: async () => ({cids: []}),
}

// Editor initial content fixtures for link tests
type FixtureName =
  | 'empty'
  | 'withExternalLink'
  | 'withHmLink'
  | 'withEmbed'
  | 'withTwoEmbeds'
  | 'draftAndPublished'
  | 'allBlocks'

const text = (text: string) =>
  ({
    type: 'text',
    text,
    styles: {},
  }) as any

const link = (href: string, label: string) =>
  ({
    type: 'link',
    href,
    content: [text(label)],
  }) as any

const p = (id: string, content: any[]) =>
  ({
    id,
    type: 'paragraph',
    props: {},
    content,
    children: [],
  }) satisfies Block<HMBlockSchema> as any

const embed = (id: string, url: string, view: 'Card' | 'Content' | 'Link' = 'Card') =>
  ({
    id,
    type: 'embed',
    props: {url, view},
    content: [],
    children: [],
  }) as any

const fixtures: Record<FixtureName, Block<HMBlockSchema>[]> = {
  empty: [p('p-empty', [])],

  withExternalLink: [p('p-ext', [text('Hello '), link('https://example.com', 'Link')])],

  withHmLink: [p('p-hm', [text('Hello '), link('hm://bafy-doc-uid/Root/Notes/Test HM Doc?l', 'Link')])],

  withEmbed: [
    p('p-top', [text('Above the card')]),
    embed('embed-1', 'hm://bafy-doc-uid/Root', 'Card'),
    p('p-bottom', [text('Below the card')]),
  ],

  withTwoEmbeds: [
    p('p-top', [text('Above the cards')]),
    embed('embed-1', 'hm://bafy-doc-uid/Root', 'Card'),
    embed('embed-2', 'hm://bafy-doc-uid/Notes', 'Card'),
    p('p-bottom', [text('Below the cards')]),
  ],

  // Mirrors the issue-857 test doc: an unpublished draft card directly above a
  // published card (no paragraphs between).
  draftAndPublished: [
    {
      id: 'embed-draft',
      type: 'embed',
      props: {url: '', view: 'Content', draftId: 'draft-1'},
      content: [],
      children: [],
    } as any,
    embed('embed-pub', 'hm://bafy-doc-uid/Root', 'Card'),
    p('p-bottom', [text('Below the cards')]),
  ],

  // One block of every selectable node type (selectable-node-types.ts) plus
  // text blocks, for the cross-block-type selection-consistency suite.
  // A tiny 1x1 gif data URL keeps the image offline-renderable.
  allBlocks: [
    p('p-top', [text('First paragraph')]),
    {
      id: 'blk-image',
      type: 'image',
      props: {url: 'data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', name: ''},
      content: [text('the caption')],
      children: [],
    } as any,
    {
      id: 'blk-video',
      type: 'video',
      props: {url: '', name: ''},
      content: [],
      children: [],
    } as any,
    {
      id: 'blk-file',
      type: 'file',
      props: {url: 'ipfs://bafyfilefixture', name: 'notes.txt', size: '123'},
      content: [],
      children: [],
    } as any,
    embed('blk-embed', 'hm://bafy-doc-uid/Root', 'Card'),
    {
      id: 'blk-draft',
      type: 'embed',
      props: {url: '', view: 'Content', draftId: 'draft-2'},
      content: [],
      children: [],
    } as any,
    {
      id: 'blk-web',
      type: 'web-embed',
      props: {url: 'https://x.com/seed/status/1'},
      content: [],
      children: [],
    } as any,
    {
      id: 'blk-button',
      type: 'button',
      props: {url: 'hm://bafy-doc-uid/Root', name: 'Click me', alignment: 'center'},
      content: [],
      children: [],
    } as any,
    {
      id: 'blk-math',
      type: 'math',
      props: {},
      content: [text('x^2 + y^2 = z^2')],
      children: [],
    } as any,
    {
      id: 'blk-query',
      type: 'query',
      props: {
        style: 'Card',
        columnCount: '1',
        queryLimit: '',
        queryIncludes: JSON.stringify([{space: 'bafy-doc-uid', path: '', mode: 'Children'}]),
        querySort: JSON.stringify([{term: 'UpdateTime', reverse: false}]),
        banner: 'false',
      },
      content: [],
      children: [],
    } as any,
    p('p-bottom', [text('Last paragraph')]),
  ],
}

function getFixtureFromUrl(): FixtureName {
  const sp = new URLSearchParams(window.location.search)
  const name = sp.get('fixture') as FixtureName | null
  return name && name in fixtures ? name : 'empty'
}

// Expose editor state for test assertions
declare global {
  interface Window {
    TEST_EDITOR: {
      editor: ReturnType<typeof useBlockNote<HMBlockSchema>> | null
      getBlocks: () => Block<HMBlockSchema>[]
      getSelection: () => ReturnType<ReturnType<typeof useBlockNote<HMBlockSchema>>['getSelection']>
      getSelectedText: () => string
      isEditable: () => boolean
      focus: () => void
      /** Raw ProseMirror selection summary. */
      pmSelection: () => {kind: string; from: number; to: number; nodeType: string | null; blockId: string | null}
      /** Block id the SideMenu (drag handle) is currently showing for, or null if hidden. */
      blockToolsBlockId: () => string | null
      /** Block id the hover-actions card (copy-link + comment block tools) is anchored to, or null if hidden. */
      hoverActionsBlockId: () => string | null
      /** Block ids the FullBlockSelection plugin considers fully selected (the block-tools source). */
      fullBlockIds: () => string[]
      /** Block ids currently showing the blue selection outline in the DOM. */
      outlinedBlockIds: () => string[]
    }
  }
}

// Wraps children in a document machine forced into editing (canEdit=true, isEditing=true)
// so useEditorGate() reports edit mode. Passthrough when disabled.
function MaybeEditMode({mode, children}: {mode: 'off' | 'editing' | 'idle'; children: ReactNode}) {
  if (mode === 'off') return <>{children}</>
  const machine = makeMockMachine(mode === 'editing')
  return (
    <DocumentMachineProvider machine={machine} input={{documentId: editModeId, canEdit: true} as any}>
      {children}
    </DocumentMachineProvider>
  )
}

/** Builds the window.TEST_EDITOR API shared by raw and real harness modes. */
function buildTestEditorApi(editor: any) {
  return {
    editor,
    getBlocks: () => editor.topLevelBlocks,
    getSelection: () => editor.getSelection(),
    getSelectedText: () => editor.getSelectedText(),
    isEditable: () => editor.isEditable,
    focus: () => editor.focus(),
    pmSelection: () => {
      const s = editor._tiptapEditor.state.selection as any
      let blockId: string | null = null
      try {
        // Nearest containing blockNode id (works for text carets and
        // NodeSelections alike).
        const $pos = editor._tiptapEditor.state.doc.resolve(s.from)
        for (let d = $pos.depth; d >= 0; d--) {
          const n = $pos.node(d)
          if (n.type?.name === 'blockNode' && n.attrs?.id) {
            blockId = n.attrs.id
            break
          }
        }
        if (!blockId) blockId = $pos.parent?.attrs?.id ?? null
      } catch {}
      return {
        kind: s.node ? 'NodeSelection' : s.empty ? 'TextSelection(empty)' : s.constructor?.name ?? 'unknown',
        from: s.from,
        to: s.to,
        nodeType: s.node?.type?.name ?? null,
        blockId,
      }
    },
    // Which block the RENDERED block tools (side menu) are attached to, derived
    // purely from the visible DOM: the tools are vertically anchored to their
    // block's first line. Returns null when the tools are not visibly shown.
    blockToolsBlockId: () => {
      const menu = document.querySelector('.side-menu') as HTMLElement | null
      if (!menu) return null
      const menuRect = menu.getBoundingClientRect()
      if (menuRect.width === 0 || menuRect.height === 0) return null
      const menuCenterY = menuRect.y + menuRect.height / 2
      let best: {id: string; dist: number} | null = null
      document.querySelectorAll('[data-node-type="blockNode"][data-id]').forEach((el) => {
        const r = el.getBoundingClientRect()
        if (r.height === 0) return
        const dist = Math.abs(r.y + Math.min(r.height, 40) / 2 - menuCenterY)
        const id = el.getAttribute('data-id')!
        if (!best || dist < best.dist) best = {id, dist}
      })
      return best && (best as any).dist < 60 ? (best as any).id : null
    },
    // Which block the RENDERED hover-actions card (copy-link + comment) is
    // anchored to, derived purely from visible DOM geometry: the card is
    // top-aligned with its block's content element and placed just right of it.
    hoverActionsBlockId: () => {
      const card = document.querySelector('[data-bn-block-hover-actions="true"]') as HTMLElement | null
      if (!card) return null
      const cardRect = card.getBoundingClientRect()
      if (cardRect.width === 0 || cardRect.height === 0) return null
      let best: {id: string; score: number} | null = null
      document.querySelectorAll('[data-node-type="blockNode"][data-id]').forEach((el) => {
        // Mirror the plugin's findDirectContentElement: direct child or one
        // wrapper level down.
        const content = el.querySelector(
          ':scope > [data-content-type], :scope > :not([data-node-type="blockChildren"]) > [data-content-type]',
        )
        const r = (content ?? el).getBoundingClientRect()
        if (r.height === 0) return
        const score = Math.abs(r.top - cardRect.top) + Math.abs(r.right + 8 - cardRect.left)
        const id = el.getAttribute('data-id')!
        if (!best || score < best.score) best = {id, score}
      })
      return best && (best as any).score < 60 ? (best as any).id : null
    },
    fullBlockIds: () => {
      const st = fullBlockSelectionPluginKey.getState(editor._tiptapEditor.state)
      return st?.blockIds ?? []
    },
    outlinedBlockIds: () => {
      return Array.from(document.querySelectorAll('.bn-media-selected'))
        .map((el) => el.closest('[data-node-type="blockNode"][data-id]')?.getAttribute('data-id'))
        .filter((id): id is string => !!id)
    },
  }
}

/** Exposes window.TEST_EDITOR for the given editor. */
function useExposeTestEditor(editor: any | null) {
  useEffect(() => {
    if (!editor) return
    window.TEST_EDITOR = buildTestEditorApi(editor)
    return () => {
      // @ts-expect-error - cleanup
      window.TEST_EDITOR = null
    }
  }, [editor])
}

/**
 * Faithful desktop reproduction: the REAL DocumentEditor driven by the REAL
 * documentMachine. The machine starts in `loading`; we resolve document+draft
 * so it reaches `loaded`, exactly like desktop-resource does via queries.
 * Tests then send `edit.start` via window.TEST_MACHINE to enter editing —
 * running the real entry actions (setEditable / applyInitialContent / placeCursor).
 */
function RealModeInner({fixtureName}: {fixtureName: FixtureName}) {
  const actorRef = useDocumentMachineRef()
  const [editor, setEditor] = useState<any>(null)
  useExposeTestEditor(editor)

  useEffect(() => {
    actorRef.send({type: 'document.loaded', document: mockDocumentResource(editModeId).document} as any)
    actorRef.send({type: 'draft.resolved', draftId: null, content: null, cursorPosition: null} as any)
    ;(window as any).TEST_MACHINE = {
      state: () => actorRef.getSnapshot().value,
      matches: (s: string) => actorRef.getSnapshot().matches(s as any),
      send: (e: any) => actorRef.send(e),
    }
    return () => {
      ;(window as any).TEST_MACHINE = null
    }
  }, [actorRef])

  // Optional saved-draft cursor position, to exercise the edit-start placeCursor path.
  const sp = new URLSearchParams(window.location.search)
  const cursorParam = sp.get('cursor')
  const draftCursorPosition = cursorParam ? Number(cursorParam) : undefined

  // `?published=none` marks every block as draft-only, so block-tool actions
  // hit the publish-required interception. Default: everything published.
  const publishedParam = sp.get('published') ?? 'all'
  const isBlockInPublishedVersion = publishedParam === 'none' ? () => false : () => true

  return (
    <div className="test-harness" data-testid="editor-harness">
      <div data-testid="editor-container">
        <DocumentEditor
          blocks={fixtures[fixtureName] as any}
          resourceId={editModeId}
          onEditorReady={setEditor}
          draftCursorPosition={draftCursorPosition}
          isUnpublishedDraft={publishedParam === 'none'}
          isBlockInPublishedVersion={isBlockInPublishedVersion}
          onBlockSelect={(blockId: string, opts: any) => {
            blockToolCalls.copyLink.push({blockId, opts})
          }}
          onBlockCommentClick={(blockId?: string | null, range?: any, startNew?: boolean) => {
            blockToolCalls.comment.push({blockId, range, startNew})
          }}
        />
      </div>
    </div>
  )
}

// Recording block-tool callbacks: mounting these makes DocumentEditor render
// the REAL BlockHoverActionsPositioner (copy-link + comment card), exactly
// like desktop resource-page-common does.
const blockToolCalls: {copyLink: any[]; comment: any[]} = {copyLink: [], comment: []}
;(window as any).TEST_BLOCK_TOOL_CALLS = blockToolCalls

// Recording DraftActions mock: lets DraftEmbedPlaceholder (draft cards) render
// like on desktop, and records navigation calls for tests to assert on.
const draftCalls: {onOpenDraft: any[]; onDeleteDraft: any[]} = {onOpenDraft: [], onDeleteDraft: []}
;(window as any).TEST_DRAFT_CALLS = draftCalls
const mockDraftActions: DraftActions = {
  useInlineDraft: (id) => ({
    data: id
      ? ({
          id,
          metadata: {name: 'Draft card'},
          locationUid: 'bafy-doc-uid',
          locationPath: [],
          editUid: 'bafy-doc-uid',
          editPath: [`-${id}`],
        } as any)
      : null,
  }),
  onOpenDraft: (...args) => draftCalls.onOpenDraft.push(args),
  onDeleteDraft: async (...args) => {
    draftCalls.onDeleteDraft.push(args)
  },
  onUpdateDraftName: () => {},
}

function RealModeApp({fixtureName}: {fixtureName: FixtureName}) {
  return (
    <DocumentMachineProvider input={{documentId: editModeId, canEdit: true} as any}>
      <DraftActionsContext.Provider value={mockDraftActions}>
        <RealModeInner fixtureName={fixtureName} />
      </DraftActionsContext.Provider>
    </DocumentMachineProvider>
  )
}

export function TestEditor() {
  const fixtureName = getFixtureFromUrl()
  const sp = new URLSearchParams(window.location.search)
  const real = sp.get('real') === '1'
  if (real) {
    return (
      <TooltipProvider>
        <QueryClientProvider client={mockQueryClient}>
          <NavContextProvider value={navContext}>
            <UniversalAppProvider
              universalClient={mockUniversalClient as any}
              openUrl={(url?: string, newWindow?: boolean) => {
                const w = window as any
                w.TEST_OPEN_URL = w.TEST_OPEN_URL || []
                w.TEST_OPEN_URL.push({url, newWindow})
              }}
              openRoute={(...args: any[]) => {
                const w = window as any
                w.TEST_OPEN_ROUTE = w.TEST_OPEN_ROUTE || []
                w.TEST_OPEN_ROUTE.push(args)
              }}
            >
              <RealModeApp fixtureName={fixtureName} />
            </UniversalAppProvider>
          </NavContextProvider>
        </QueryClientProvider>
      </TooltipProvider>
    )
  }
  return <RawModeApp fixtureName={fixtureName} />
}

function RawModeApp({fixtureName}: {fixtureName: FixtureName}) {
  const editParam = new URLSearchParams(window.location.search).get('edit')
  const editMode: 'off' | 'editing' | 'idle' = editParam === '1' ? 'editing' : editParam === 'idle' ? 'idle' : 'off'

  const [editorContent, setEditorContent] = useState<Block<HMBlockSchema>[]>([])

  const editor = useBlockNote<HMBlockSchema>({
    blockSchema: hmBlockSchema,
    getSlashMenuItems: getSlashMenuItems,
    onEditorContentChange: (e) => {
      setEditorContent(e.topLevelBlocks)
    },
    // Link extension options required for paste handler
    linkExtensionOptions: {
      gwUrl,
    } as any,
    // Mirror DocumentEditor/CommentEditor: Mod-a sets AllSelection so
    // trailing non-textblock atoms (embed/query cards) are included.
    _tiptapOptions: {
      extensions: [
        Extension.create({
          name: 'test-editor-select-all',
          priority: 1000,
          addKeyboardShortcuts() {
            return {
              'Mod-a': ({editor}) => {
                return selectAllEditorContent(editor)
              },
            }
          },
        }),
      ],
    },
    // @ts-expect-error
    initialContent: fixtures[fixtureName],
  })

  // Track SideMenu (block tools) + expose window.TEST_EDITOR.
  useExposeTestEditor(editor)

  return (
    <TooltipProvider>
      <QueryClientProvider client={mockQueryClient}>
        <NavContextProvider value={navContext}>
          <UniversalAppProvider
            universalClient={mockUniversalClient as any}
            openUrl={(url?: string, newWindow?: boolean) => {
              console.log('openUrl', {url, newWindow})
            }}
            openRoute={(...args: any[]) => {
              console.log('openRoute', args)
            }}
          >
            <div className="test-harness" data-testid="editor-harness">
              <div className="test-info" data-testid="editor-info">
                <strong>Block count:</strong> {editorContent.length} | <strong>Editor ready:</strong>{' '}
                {editor.ready ? 'Yes' : 'No'}
              </div>
              <div data-testid="editor-container">
                <MaybeEditMode mode={editMode}>
                  <BlockNoteView editor={editor} theme="light">
                    {/* Block tools (SideMenu) — mirrors desktop editor.tsx (editable only). */}
                    {editMode !== 'off' ? <SideMenuPositioner editor={editor} placement="left" /> : null}
                    <SlashMenuPositioner editor={editor} />
                    <FormattingToolbarPositioner editor={editor} formattingToolbar={HMFormattingToolbar} />
                    <HyperlinkToolbarPositioner
                      editor={editor}
                      openUrl={() => {}}
                      // @ts-expect-error
                      hyperlinkToolbar={HypermediaLinkPreview}
                    />
                  </BlockNoteView>
                </MaybeEditMode>
              </div>
            </div>
          </UniversalAppProvider>
        </NavContextProvider>
      </QueryClientProvider>
    </TooltipProvider>
  )
}
