/**
 * Server-side rendering of document content as REAL editor markup.
 *
 * The pre-hydration HTML for a document is generated from the same sources
 * of truth the mounted editor uses, so it cannot drift from the client:
 *
 *  1. HM blocks → editor blocks via hmBlocksToEditorContent (same conversion
 *     the editor runs at mount).
 *  2. Editor blocks → a ProseMirror document via blockToNode + the same doc
 *     recipe as BlockNoteEditor.onBeforeCreate.
 *  3. The PM document → DOM via DOMSerializer.fromSchema(schema), executing
 *     the schema's own renderHTML definitions (including the hashed
 *     CSS-module class names the live editor emits).
 *  4. React node-view blocks (image, video, query, embed, …) → rendered with
 *     react-dom/server using the same components the node views mount, fed
 *     by the loader's prefetched React Query cache, and spliced into the
 *     same wrapper structure the live node view produces.
 *
 * The client swaps this HTML for the live editor after mount (ProseMirror
 * cannot adopt existing DOM); identical markup makes the swap invisible.
 * The string is injected via dangerouslySetInnerHTML and never React-hydrated,
 * so server-only render branches in components are safe here.
 */
// The blocknote core barrel must be imported before ./schema: the block-spec
// modules participate in an import cycle through the barrel, and loading
// ./schema first hits a TDZ error inside createReactBlockSpec.
import {getBlockNoteExtensions, mergeCSSClasses} from './blocknote'
import type {HMBlockChildrenType, HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {hmBlocksToEditorContent} from '@seed-hypermedia/client/hmblock-to-editorblock'
import {DocumentActionsProvider} from '@shm/shared/document-actions-context'
import {UniversalAppProvider} from '@shm/shared/routing'
import {defaultRoute} from '@shm/shared/routes'
import {NavContextProvider} from '@shm/shared/utils/navigation'
import {writeableStateStream} from '@shm/shared/utils/stream'
import {TooltipProvider} from '@shm/ui/tooltip'
import type {QueryClient} from '@tanstack/react-query'
import {QueryClientProvider} from '@tanstack/react-query'
import {getSchema} from '@tiptap/core'
import {Window as HappyDOMWindow} from 'happy-dom'
import type {Schema} from 'prosemirror-model'
import {DOMSerializer} from 'prosemirror-model'
import type {ReactNode} from 'react'
import {renderToString} from 'react-dom/server'
import {common, createLowlight} from 'lowlight'
import {blockToNode} from './blocknote/core/api/nodeConversions/nodeConversions'
import editorStyles from './blocknote/core/editor.module.css'
import blockStyles from './blocknote/core/extensions/Blocks/nodes/Block.module.css'
import {hmBlockSchema} from './schema'
import {setSSREmbedRenderer} from './ssr-embed-renderer'
import {CodeBlockScroller} from './tiptap-extension-code-block/code-block-view'
import {getHighlightRuns} from './tiptap-extension-code-block/lowlight-plugin'

/** LRU-ish cap; keys include a query-results fingerprint so entries churn. */
const HTML_CACHE_MAX_ENTRIES = 500
const htmlCache = new Map<string, string>()

export type SSRRenderOpts = {
  /** Cache key: must include doc version AND a fingerprint of any data that
   * affects rendered output independently of the version (query results). */
  cacheKey?: string
  /** Children type for the document root group. */
  rootChildrenType?: HMBlockChildrenType
  /** Rewrites hm:// hrefs in the output to site-relative URLs (SEO / no-JS
   * usability; does not affect visual parity). */
  renderHref?: (url: string) => string | null | undefined
  /** The loader's prefetched React Query cache; block components read from
   * it synchronously during renderToString. */
  queryClient: QueryClient
  /** Props spread into UniversalAppProvider (origin, originHomeId,
   * universalClient, ipfsFileUrl, getOptimizedImageUrl, openUrl, …). */
  appContext?: Record<string, any>
  /** The editor content width the document will render at (derived from the
   * document's contentWidth setting). Media blocks with absolute pixel
   * widths compute their percentage size against it. */
  editorWidth?: number
}

// ---------------------------------------------------------------------------
// Shared server DOM + schema singletons
// ---------------------------------------------------------------------------

let ssrWindow: InstanceType<typeof HappyDOMWindow> | null = null
function getServerDocument(): Document {
  if (!ssrWindow) ssrWindow = new HappyDOMWindow()
  return ssrWindow.document as unknown as Document
}

/**
 * A minimal stand-in for the BlockNoteEditor that block components receive.
 * Read-only components only consult selection/editable state during render;
 * everything interactive happens in effects and callbacks that never run
 * server-side.
 */
function createEditorStub(editorWidth?: number) {
  const state = {selection: {}, doc: {descendants: () => {}}}
  return {
    renderType: 'embed',
    disableTrailingNode: true,
    isEditable: false,
    commentEditor: false,
    _tiptapEditor: {
      state,
      view: {state, hasFocus: () => false},
      on: () => {},
      off: () => {},
    },
    // Media blocks measure the mounted editor to size px-width media; give
    // the stub the width the document will actually render at.
    domElement: editorWidth ? {firstElementChild: {clientWidth: editorWidth}} : undefined,
    getBlock: () => undefined,
  } as any
}

let ssrSchema: Schema | null = null
function getSSRSchema(): Schema {
  if (!ssrSchema) {
    ssrSchema = getSchema(
      getBlockNoteExtensions({
        editor: createEditorStub(),
        domAttributes: {},
        blockSchema: hmBlockSchema,
      }),
    )
  }
  return ssrSchema
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export function renderDocumentToHTML(blocks: HMBlockNode[], opts: SSRRenderOpts): string | null {
  if (!blocks || blocks.length === 0) return null

  const key = opts.cacheKey
  if (key) {
    const cached = htmlCache.get(key)
    if (cached) return cached
  }

  try {
    // Content-view embeds recurse through the same pipeline (registry avoids
    // the schema↔embed import cycle). Depth-capped like the live editor.
    let embedDepth = 0
    setSSREmbedRenderer((embedBlocks, rootChildrenType) => {
      if (embedDepth >= 3) return null
      embedDepth++
      try {
        return renderUncached(embedBlocks, {...opts, cacheKey: undefined, rootChildrenType})
      } finally {
        embedDepth--
      }
    })
    const result = renderUncached(blocks, opts)
    if (key && result) {
      if (htmlCache.size >= HTML_CACHE_MAX_ENTRIES) {
        const oldest = htmlCache.keys().next().value
        if (oldest !== undefined) htmlCache.delete(oldest)
      }
      htmlCache.set(key, result)
    }
    return result
  } catch (e) {
    console.error('[ssr-render] Failed to render document content:', e)
    return null
  } finally {
    setSSREmbedRenderer(null)
  }
}

function renderUncached(blocks: HMBlockNode[], opts: SSRRenderOpts): string | null {
  const schema = getSSRSchema()
  const doc = getServerDocument()

  // 1. Same conversion the editor runs at mount (document-editor.tsx).
  const editorBlocks = hmBlocksToEditorContent(blocks, {})
  if (editorBlocks.length === 0) return null

  // 2. Same PM doc recipe as BlockNoteEditor.onBeforeCreate.
  const pmDoc = schema.node(
    'doc',
    undefined,
    schema.node(
      'blockChildren',
      {listType: opts.rootChildrenType || 'Group'},
      editorBlocks.map((b) => blockToNode(b as any, schema)),
    ),
  )

  // 3. Serialize scaffolding with the schema's own renderHTML definitions.
  // Custom blocks' render() helper reaches for the global document, which
  // the {document} option does not cover — scope one around the (synchronous)
  // call.
  const target = doc.createElement('div')
  const hadDocument = Object.prototype.hasOwnProperty.call(globalThis, 'document')
  const prevDocument = (globalThis as any).document
  ;(globalThis as any).document = doc
  try {
    DOMSerializer.fromSchema(schema).serializeFragment(pmDoc.content, {document: doc}, target)
  } finally {
    if (hadDocument) (globalThis as any).document = prevDocument
    else delete (globalThis as any).document
  }

  // 4. Post-process: React node-view blocks, code highlighting, link hrefs.
  const blockById = indexEditorBlocks(editorBlocks)
  renderReactBlocks(target, blockById, opts)
  renderCodeBlocks(target, blockById)
  addTrailingBreaks(target)
  rewriteLinkHrefs(target, opts.renderHref)

  // 5. Same wrapper stack as the live editor: BlockNoteView root classes on
  // the outside, the ProseMirror/bnEditor/bnRoot/defaultStyles element inside.
  const pmClass = mergeCSSClasses(
    'ProseMirror',
    (editorStyles as any).bnEditor,
    (editorStyles as any).bnRoot,
    (editorStyles as any).defaultStyles,
  )
  // prosemirror-view injects `white-space: break-spaces` (with pre-wrap
  // fallback) via a runtime style tag; inline the same properties so text
  // wraps identically before the editor mounts.
  const pmStyle = 'position: relative; word-wrap: break-word; white-space: break-spaces;'
  return (
    `<div class="ssr-content-placeholder hm-prose draft-editor">` +
    `<div class="${pmClass}" style="${pmStyle}" contenteditable="false" translate="no">${target.innerHTML}</div>` +
    `</div>`
  )
}

// ---------------------------------------------------------------------------
// React node-view blocks
// ---------------------------------------------------------------------------

type EditorBlockLike = {id?: string; type?: string; props?: Record<string, any>; children?: EditorBlockLike[]}

function indexEditorBlocks(blocks: EditorBlockLike[]): Map<string, EditorBlockLike> {
  const map = new Map<string, EditorBlockLike>()
  const walk = (list: EditorBlockLike[]) => {
    for (const block of list) {
      if (block.id) map.set(block.id, block)
      if (block.children?.length) walk(block.children)
    }
  }
  walk(blocks)
  return map
}

/**
 * Replace each React block's serialized container (a bare
 * div[data-content-type=X] from the schema's clipboard renderHTML) with the
 * structure the live node view produces:
 *
 *   div.{reactNodeViewRenderer}
 *     div.{blockContent}[data-content-type=X][data-*]   ← NodeViewWrapper
 *       …renderToString(<Render block editor/>)…
 *
 * Serialized inline content (image/video captions) is moved into the
 * component's [data-node-view-content] slot.
 */
/** Static navigation context: components read the route during render (e.g.
 * DocumentListItem's useNavigate); dispatching is meaningless server-side. */
function createSSRNavigation() {
  const [, state] = writeableStateStream({
    sidebarLocked: false,
    routes: [defaultRoute],
    routeIndex: 0,
    lastAction: 'replace',
  } as any)
  return {state, dispatch: () => {}}
}

function renderReactBlocks(target: Element, blockById: Map<string, EditorBlockLike>, opts: SSRRenderOpts) {
  const doc = getServerDocument()
  const editorStub = createEditorStub(opts.editorWidth)
  const navigation = createSSRNavigation()

  for (const [type, spec] of Object.entries(hmBlockSchema)) {
    const Render = (spec as any).render as ((props: {block: any; editor: any}) => ReactNode) | undefined
    if (!Render) continue

    const containers = Array.from(target.querySelectorAll(`div[data-content-type="${type}"]`))
    for (const container of containers) {
      const blockNodeEl = container.closest('[data-node-type="blockNode"]')
      const blockId = blockNodeEl?.getAttribute('data-id') || blockNodeEl?.getAttribute('id') || undefined
      const block = blockId ? blockById.get(blockId) : undefined
      if (!block) continue

      // Serialized inline content (caption) lives in the container's inner
      // contentDOM div; capture it before replacing.
      const serializedInline = container.firstElementChild?.innerHTML ?? ''

      let componentHTML = ''
      try {
        componentHTML = renderToString(
          <QueryClientProvider client={opts.queryClient}>
            <UniversalAppProvider
              openUrl={() => {}}
              openRoute={() => {}}
              universalClient={undefined as any}
              {...(opts.appContext || {})}
            >
              <NavContextProvider value={navigation}>
                <TooltipProvider>
                  {/* Mirrors the web page's provider for anonymous readers so
                      action chrome (the options button) renders identically. */}
                  <DocumentActionsProvider onCopyLink={() => {}}>
                    <Render block={block} editor={editorStub} />
                  </DocumentActionsProvider>
                </TooltipProvider>
              </NavContextProvider>
            </UniversalAppProvider>
          </QueryClientProvider>,
        )
      } catch (e: any) {
        console.error(`[ssr-render] Failed to render ${type} block ${blockId}:`, e)
        container.setAttribute('data-ssr-error', String(e?.message || e).slice(0, 300))
        continue
      }

      replaceWithNodeView(container, type, componentHTML, serializedInline)
    }
  }
}

/**
 * Replace a serialized custom-block container with the structure the live
 * node view produces: an outer ReactNodeViewRenderer div and a NodeViewWrapper
 * div carrying the blockContent class, with the rendered component inside and
 * any serialized inline content (captions) moved into its
 * [data-node-view-content] slot.
 */
function replaceWithNodeView(container: Element, type: string, componentHTML: string, serializedInline: string) {
  const doc = getServerDocument()
  const outer = doc.createElement('div')
  outer.className = mergeCSSClasses('react-renderer', `node-${type}`, (blockStyles as any).reactNodeViewRenderer)
  const wrapper = doc.createElement('div')
  wrapper.className = (blockStyles as any).blockContent
  wrapper.setAttribute('data-node-view-wrapper', '')
  wrapper.setAttribute('style', 'white-space: normal;')
  wrapper.setAttribute('data-content-type', type)
  // Carry over the non-default data-* props the serializer emitted.
  for (const attr of Array.from(container.attributes)) {
    if (attr.name.startsWith('data-') && attr.name !== 'data-content-type') {
      wrapper.setAttribute(attr.name, attr.value)
    }
  }
  wrapper.innerHTML = componentHTML
  // Fill the NodeViewContent slot with the same structure ProseMirror's
  // contentDOM produces: an inner div holding the serialized inline content,
  // or a trailing break when empty (an empty caption still keeps its line
  // height in the live editor).
  // (Skip slots the component already filled itself, e.g. code blocks.)
  const slot = wrapper.querySelector('[data-node-view-content]')
  if (slot && !slot.childNodes.length) {
    const inner = doc.createElement('div')
    inner.setAttribute('style', 'white-space: inherit;')
    inner.innerHTML = serializedInline || '<br class="ProseMirror-trailingBreak">'
    slot.appendChild(inner)
  }
  outer.appendChild(wrapper)
  container.replaceWith(outer)
}

// ---------------------------------------------------------------------------
// Code blocks: the live node view (CodeBlockView) wraps the text in scroll
// chrome and the lowlight plugin decorates it with hljs spans. Reuse the same
// chrome component and tokenizer so SSR output matches.
// ---------------------------------------------------------------------------

const ssrLowlight = createLowlight(common)

function escapeHTML(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function renderCodeBlocks(target: Element, blockById: Map<string, EditorBlockLike>) {
  for (const container of Array.from(target.querySelectorAll('[data-content-type="code-block"]'))) {
    // Guard against re-processing (the replacement wrapper also carries the
    // data attribute).
    if (container.hasAttribute('data-node-view-wrapper')) continue
    // The language attribute is `rendered: false` in the schema, so it never
    // appears in serialized HTML — read it from the block data instead.
    const blockNodeEl = container.closest('[data-node-type="blockNode"]')
    const blockId = blockNodeEl?.getAttribute('data-id') || undefined
    const language = ((blockId && blockById.get(blockId)?.props?.language) || '') as string
    const text = container.textContent || ''

    // The client renders ProseMirror's text with highlight runs layered on
    // top as decorations; runs that don't reproduce the full text (e.g.
    // highlightAuto finding nothing) mean the client shows plain text.
    let highlighted = ''
    try {
      const runs = getHighlightRuns({
        lowlight: ssrLowlight,
        language,
        defaultLanguage: 'plaintext',
        text,
      })
      if (runs.map((run) => run.text).join('') === text) {
        highlighted = runs
          .map((run) =>
            run.classes.length
              ? `<span class="${run.classes.join(' ')}">${escapeHTML(run.text)}</span>`
              : escapeHTML(run.text),
          )
          .join('')
      } else {
        highlighted = escapeHTML(text)
      }
    } catch (e) {
      highlighted = escapeHTML(text)
    }

    // ProseMirror renders a trailing break after text ending in a newline so
    // the final empty line is visible; match it or the block is a line short.
    if (text.endsWith('\n')) {
      highlighted += '<br class="ProseMirror-trailingBreak">'
    }

    const componentHTML = renderToString(
      <div className="relative flex min-w-0 flex-col overflow-hidden">
        <CodeBlockScroller language={language || 'plaintext'}>
          <div data-node-view-content="" style={{whiteSpace: 'pre'}}>
            <div style={{whiteSpace: 'inherit'}} dangerouslySetInnerHTML={{__html: highlighted}} />
          </div>
        </CodeBlockScroller>
      </div>,
    )
    replaceWithNodeView(container, 'code-block', componentHTML, '')
  }
}

/**
 * ProseMirror renders a trailing <br> in empty textblocks so they keep a
 * line height; the DOMSerializer emits them truly empty. Match the editor
 * or empty paragraphs/headings collapse and shift everything below.
 */
function addTrailingBreaks(target: Element) {
  const doc = getServerDocument()
  for (const el of Array.from(target.querySelectorAll('p, h1, h2, h3, h4, h5, h6, [data-node-view-content] > div'))) {
    if (!el.childNodes.length) {
      const br = doc.createElement('br')
      br.className = 'ProseMirror-trailingBreak'
      el.appendChild(br)
    }
  }
}

// ---------------------------------------------------------------------------
// Link rewriting (SEO / no-JS usability; pixel-neutral)
// ---------------------------------------------------------------------------

function rewriteLinkHrefs(target: Element, renderHref: SSRRenderOpts['renderHref']) {
  for (const a of Array.from(target.querySelectorAll('a[href^="hm://"]'))) {
    const raw = a.getAttribute('href')!
    const href = renderHref?.(raw) || '/hm/' + raw.slice('hm://'.length)
    a.setAttribute('href', href)
    a.setAttribute('data-hm-link', raw)
  }
}
