// @vitest-environment jsdom
import React, {useState} from 'react'
import {createRoot, type Root} from 'react-dom/client'
import {act} from 'react-dom/test-utils'
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest'
import {hmId, unpackHmId} from '@shm/shared'
import type {HMComment} from '@seed-hypermedia/client/hm-types'
import {CommentDraftReferenceProvider, useCommentDraftReferences} from '@shm/shared/comments-service-provider'
import {DiscussionsPageContent} from '../discussions-page'
import type {CommentEditorProps} from '../resource-page-common'
import {TooltipProvider} from '../tooltip'
;(globalThis as typeof globalThis & {React?: typeof React; IS_REACT_ACT_ENVIRONMENT?: boolean}).React = React
;(globalThis as typeof globalThis & {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true

const state = vi.hoisted(() => ({
  comments: [] as HMComment[],
  detachedComments: [] as HMComment[],
  previousResource: {type: 'not-found'} as {type: string; comment?: HMComment},
}))
vi.mock('@shm/shared', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared')>()),
  useRouteLink: () => ({href: '#'}),
  useUniversalAppContext: () => ({}),
}))
vi.mock('@shm/shared/comments-service-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@shm/shared/comments-service-provider')>()),
  useDeleteComment: () => ({mutate: vi.fn(), isLoading: false}),
  useUpdateComment: () => ({mutate: vi.fn(), isLoading: false}),
}))
vi.mock('@shm/shared/models/comments', () => ({
  useDocumentComments: () => ({data: {comments: state.comments, authors: {}}, isLoading: false}),
  useDocumentDiscussions: () => ({data: {discussions: []}, isLoading: false}),
  useCommentReplyCount: () => ({data: 0}),
  useCommentVersions: () => ({data: {versions: []}, isLoading: false}),
}))
vi.mock('@shm/shared/models/entity', () => ({
  useAccount: () => ({data: {metadata: {name: 'Alice'}}}),
  useAccounts: (ids: Array<string | null>) => ids.map(() => ({data: {metadata: {name: 'Alice'}}})),
  useIsCurrentUser: () => false,
  useResources: () => [],
  useDocumentCollaborators: () => ({data: [], isLoading: false, isError: false}),
  useResource: (id: {uid: string; path?: string[]} | null) => {
    // The app's query client keeps previous data while the next resource loads.
    if (!id) return {data: state.previousResource, isLoading: false}
    const key = `${id.uid}/${id.path?.[0] ?? ''}`
    const found = [...state.comments, ...state.detachedComments].find((comment) => comment.id === key)
    if (found) {
      state.previousResource = {type: 'comment', comment: found}
      return {data: state.previousResource, isLoading: false}
    }
    return {data: state.previousResource, isLoading: true}
  },
}))
vi.mock('@shm/shared/document-actions-context', () => ({
  useDocumentActions: () => ({isBookmarked: () => false}),
}))
vi.mock('@shm/shared/readonly-viewer-context', () => ({
  useReadOnlyViewer:
    () =>
    ({blocks}: any) => <p>{blocks.map((node: any) => node.block.text).join('')}</p>,
}))
vi.mock('@shm/shared/translation', () => ({useTxString: () => (value: string) => value}))
vi.mock('@shm/shared/utils/navigation', () => ({
  NavContextProvider: ({children}: {children: React.ReactNode}) => children,
  useNavigate: () => vi.fn(),
  useNavigation: () => ({}),
  useNavRoute: () => ({key: 'document', panel: null}),
}))
vi.mock('../page-layout', () => ({PageLayout: ({children}: {children: React.ReactNode}) => <div>{children}</div>}))
vi.mock('../components/scroll-area', () => ({
  ScrollArea: ({children}: {children: React.ReactNode}) => <div data-slot="scroll-area-viewport">{children}</div>,
}))
vi.mock('../collaborators-page', () => ({getRenderedCollaboratorsCount: () => 0}))

const docId = hmId('alice', {path: ['doc']})
const rootComment: HMComment = {
  id: 'alice/root',
  version: 'root-version',
  author: 'alice',
  targetAccount: 'alice',
  targetPath: '/doc',
  targetVersion: 'doc-version',
  replyParent: '',
  content: [{block: {id: 'root-text', type: 'Paragraph', text: 'Root message', attributes: {}}}],
  createTime: '2026-01-01T00:00:00Z',
  updateTime: '2026-01-01T00:00:00Z',
  visibility: 'PUBLIC',
}
const reply: HMComment = {
  ...rootComment,
  id: 'alice/reply',
  version: 'reply-version',
  replyParent: rootComment.id,
  threadRoot: rootComment.id,
  threadRootVersion: rootComment.version,
  content: [{block: {id: 'reply-text', type: 'Paragraph', text: 'Selected reply', attributes: {}}}],
}
let root: Root
let container: HTMLDivElement
let references: ReturnType<typeof useCommentDraftReferences>
let editorProps: CommentEditorProps
let updateDraft: (text: string) => void
let scrolled: HTMLElement[]
const resizeCallbacks = new Set<() => void>()

function DraftEditor(props: CommentEditorProps) {
  editorProps = props
  const [text, setText] = useState('')
  updateDraft = setText
  return <textarea readOnly value={text} />
}
function ReferenceProbe() {
  references = useCommentDraftReferences()
  return null
}
function render(isPanel: boolean, replyCommentId?: string, openComment: string | null = rootComment.id) {
  act(() => {
    root.render(
      <CommentDraftReferenceProvider>
        <ReferenceProbe />
        <TooltipProvider>
          <DiscussionsPageContent
            docId={docId}
            isPanel={isPanel}
            openComment={openComment ?? undefined}
            replyCommentId={replyCommentId}
            commentEditor={<DraftEditor docId={docId} />}
          />
        </TooltipProvider>
      </CommentDraftReferenceProvider>,
    )
  })
}
beforeEach(() => {
  resizeCallbacks.clear()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(private callback: () => void) {}
      observe() {
        resizeCallbacks.add(this.callback)
      }
      disconnect() {
        resizeCallbacks.delete(this.callback)
      }
    },
  )
  state.comments = [rootComment, reply]
  state.detachedComments = []
  state.previousResource = {type: 'not-found'}
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
  scrolled = []
  HTMLElement.prototype.scrollIntoView = function () {
    scrolled.push(this)
  }
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollIntoView')
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

for (const isPanel of [true, false]) {
  describe(isPanel ? 'Panel reply selection' : 'Expanded reply selection', () => {
    it('scrolls to the highlighted reply on entry and keeps the root reply editor visible', () => {
      render(isPanel, reply.id)
      expect(scrolled.at(-1)?.textContent).toContain('Selected reply')
      expect(scrolled.at(-1)?.contains(container.querySelector('.bg-highlight')!)).toBe(true)
      expect(container.querySelector('textarea')).not.toBeNull()
      expect(editorProps.commentId).toBe(rootComment.id)
    })

    if (isPanel)
      it('keeps the reply visible as the editor grows, until the user scrolls', () => {
        render(isPanel, reply.id)
        scrolled = []
        act(() => resizeCallbacks.forEach((callback) => callback()))
        expect(scrolled.at(-1)?.textContent).toContain('Selected reply')
        container
          .querySelector('[data-slot="scroll-area-viewport"]')!
          .dispatchEvent(new WheelEvent('wheel', {bubbles: true}))
        scrolled = []
        act(() => resizeCallbacks.forEach((callback) => callback()))
        expect(scrolled).toEqual([])
      })

    it('queues the selected reply once without changing the root draft or submission target', () => {
      render(isPanel)
      act(() => updateDraft('Keep my unsent text'))
      render(isPanel, reply.id)
      expect(container.querySelector('textarea')?.value).toBe('Keep my unsent text')
      expect(references!.references).toHaveLength(1)
      const reference = references!.references[0]!
      expect(reference.documentId).toBe(docId.id)
      expect(reference.commentId).toBe(rootComment.id)
      expect(unpackHmId(reference.link)).toMatchObject({uid: 'alice', path: ['reply'], version: reply.version})
      expect(editorProps.commentId).toBe(rootComment.id)
      expect(editorProps.replyCommentVersion).toBe(rootComment.version)
      expect(editorProps.rootReplyCommentVersion).toBe(rootComment.version)
      act(() => references!.consumeReference(reference))
      state.comments = state.comments.map((comment) => ({...comment}))
      render(isPanel, reply.id)
      expect(references!.references).toEqual([])
      expect(container.querySelector('textarea')?.value).toBe('Keep my unsent text')
    })

    it('waits for the linked reply to load without replacing the root draft', () => {
      state.comments = [rootComment]
      render(isPanel, reply.id)
      act(() => updateDraft('Draft while reply loads'))
      expect(references!.references).toEqual([])
      state.comments = [rootComment, reply]
      render(isPanel, reply.id)
      expect(references!.references).toHaveLength(1)
      expect(references!.references[0]?.commentId).toBe(rootComment.id)
      expect(container.querySelector('textarea')?.value).toBe('Draft while reply loads')
      expect(scrolled.at(-1)?.textContent).toContain('Selected reply')
    })

    it('does not quote the reply just submitted when navigation selects it', () => {
      render(isPanel, reply.id)
      act(() => references!.consumeReference(references!.references[0]!))
      const submitted = {...reply, id: 'alice/new-reply', version: 'new-version'}
      act(() => editorProps.onCommentSubmitted?.(submitted))
      state.comments = [...state.comments, submitted]
      render(isPanel, submitted.id)
      expect(references!.references).toEqual([])
      render(isPanel, reply.id)
      act(() => references!.consumeReference(references!.references[0]!))
      render(isPanel, submitted.id)
      expect(references!.references).toHaveLength(1)
      expect(unpackHmId(references!.references[0]!.link)?.path).toEqual(['new-reply'])
    })

    it('moves focus from root to reply and keeps only the selected comment highlighted', () => {
      vi.useFakeTimers()
      render(isPanel)
      expect(scrolled.at(-1)?.textContent).toContain('Root message')
      expect(container.querySelectorAll('.bg-highlight')).toHaveLength(1)
      expect(container.querySelector('.bg-highlight')?.textContent).toContain('Root message')
      render(isPanel, reply.id)
      expect(scrolled.at(-1)?.textContent).toContain('Selected reply')
      act(() => vi.advanceTimersByTime(10000))
      expect(container.querySelectorAll('.bg-highlight')).toHaveLength(1)
      expect(container.querySelector('.bg-highlight')?.textContent).toContain('Selected reply')
      render(isPanel)
      expect(container.querySelectorAll('.bg-highlight')).toHaveLength(1)
      expect(container.querySelector('.bg-highlight')?.textContent).toContain('Root message')
    })

    it('renders the reply editor from the comment itself when the list lags behind the notification', () => {
      state.comments = []
      state.detachedComments = [rootComment]
      render(isPanel, undefined, rootComment.id)
      expect(container.querySelector('textarea')).not.toBeNull()
      expect(editorProps.commentId).toBe(rootComment.id)
      expect(editorProps.replyCommentVersion).toBe(rootComment.version)
      expect(editorProps.rootReplyCommentVersion).toBe(rootComment.version)
    })

    it('targets the thread root when a lagging list opens a reply directly', () => {
      state.comments = []
      state.detachedComments = [reply]
      render(isPanel, undefined, reply.id)
      expect(container.querySelector('textarea')).not.toBeNull()
      expect(editorProps.commentId).toBe(rootComment.id)
      expect(editorProps.replyCommentVersion).toBe(rootComment.version)
      expect(editorProps.rootReplyCommentVersion).toBe(rootComment.version)
    })

    it('publishes root comments after leaving a thread that loaded before its list', () => {
      state.comments = []
      state.detachedComments = [rootComment]
      render(isPanel)
      expect(editorProps.commentId).toBe(rootComment.id)
      state.comments = [rootComment, reply]
      state.detachedComments = []
      render(isPanel)
      render(isPanel, undefined, null)
      expect(editorProps.commentId).toBeUndefined()
      expect(editorProps.replyCommentVersion).toBeUndefined()
      expect(editorProps.rootReplyCommentVersion).toBeUndefined()
      expect(container.querySelector('textarea')).not.toBeNull()
    })

    it('does not reply to the previous thread while the next one loads', () => {
      state.comments = []
      state.detachedComments = [rootComment]
      render(isPanel)
      expect(editorProps.commentId).toBe(rootComment.id)
      render(isPanel, undefined, 'alice/other-root')
      expect(container.querySelector('textarea')).toBeNull()
    })

    it('hides the reply editor when the opened comment belongs to another document', () => {
      state.comments = []
      state.detachedComments = [{...rootComment, targetPath: '/other-doc'}]
      render(isPanel, undefined, rootComment.id)
      expect(container.querySelector('textarea')).toBeNull()
    })
  })
}
