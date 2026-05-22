import type {HMAnnotation, HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {annotationContains} from '@seed-hypermedia/client/hmblock-to-editorblock'

/** Version-keyed cache: document versions are immutable so entries never go stale. */
const htmlCache = new Map<string, string>()

/** Resolved embed data passed from the loader for SSR card rendering. */
export type SSREmbedData = {
  title?: string
  summary?: string
  /** CID of cover/first image — caller converts to full URL before passing. */
  imageUrl?: string | null
  path?: string
}

export type SSRRenderOpts = {
  textUnit?: number
  layoutUnit?: number
  cacheKey?: string
  /** Map from hm:// link → resolved embed data for card rendering. */
  embeds?: Record<string, SSREmbedData>
  /** Converts raw document links into the href value emitted in SSR HTML. */
  renderHref?: (url: string) => string | null | undefined
}

/**
 * Server-side render document blocks to HTML.
 * Produces DOM structure identical to the BlockNote editor output so the same
 * CSS rules apply, avoiding any flash of unstyled content before hydration.
 */
export function renderDocumentToHTML(blocks: HMBlockNode[], opts?: SSRRenderOpts): string | null {
  if (!blocks || blocks.length === 0) return null

  const key = opts?.cacheKey
  if (key) {
    const cached = htmlCache.get(key)
    if (cached) return cached
  }

  try {
    const embeds = opts?.embeds ?? {}
    const renderHref = opts?.renderHref
    // Wrap in a blockChildren container at depth 1 (matching editor's root group).
    // `nestingDepth` tracks blockNode-ancestor count so headings can render
    // the right h-tag without trusting the stored level prop.
    const inner = renderBlockChildren(blocks, 'Group', 1, null, embeds, renderHref, 0)
    if (!inner) return null
    const result = `<div class="ssr-content-placeholder hm-prose">${inner}</div>`

    if (key) {
      htmlCache.set(key, result)
    }
    return result
  } catch (e) {
    console.error('[ssr-render] Failed to render document content:', e)
    return null
  }
}

/**
 * Render a blockChildren container with its child blockNodes.
 * Matches the editor's BlockChildren renderHTML output.
 */
function renderBlockChildren(
  blocks: HMBlockNode[],
  listType: string,
  listLevel: number,
  columnCount: number | null,
  embeds: Record<string, SSREmbedData>,
  renderHref: SSRRenderOpts['renderHref'],
  nestingDepth: number,
): string {
  const tag = listTag(listType)
  const isGrid = listType === 'Grid'
  const gridStyle = isGrid
    ? ` style="display: grid; grid-template-columns: repeat(${columnCount || 3}, 1fr); gap: 8px;"`
    : ''
  const columnCountAttr = columnCount ? ` data-column-count="${columnCount}"` : ''
  const isListContainer = listType === 'Ordered' || listType === 'Unordered'

  const childrenHtml = blocks
    .map((node) => renderBlockNode(node, isListContainer, listLevel, embeds, renderHref, nestingDepth))
    .join('')

  return `<${tag} class="blockChildren" data-node-type="blockChildren" data-list-type="${esc(
    listType,
  )}" data-list-level="${listLevel}"${columnCountAttr}${gridStyle}>${childrenHtml}</${tag}>`
}

/**
 * Render a single blockNode (the outer container for each block).
 * When inside a ul/ol, uses <li>; otherwise <div>.
 */
function renderBlockNode(
  node: HMBlockNode,
  insideList: boolean,
  listLevel: number,
  embeds: Record<string, SSREmbedData>,
  renderHref: SSRRenderOpts['renderHref'],
  nestingDepth: number,
): string {
  const block = node.block
  const tag = insideList ? 'li' : 'div'
  const idAttr = block.id ? ` data-id="${esc(block.id)}" id="${esc(block.id)}"` : ''

  // This blockNode itself contributes one ancestor to nested children. The
  // current heading (if this block is a heading) renders at h{nestingDepth+1}.
  const contentHtml = renderBlockContent(block, embeds, renderHref, nestingDepth + 1)

  // Render children if present
  let childrenHtml = ''
  if (node.children?.length) {
    const attrs = (block as any).attributes || {}
    const childrenType: string = normalizeChildrenType(attrs.childrenType)
    const colCount = childrenType === 'Grid' ? attrs.columnCount || null : null

    const nextLevel = childrenType === 'Ordered' || childrenType === 'Unordered' ? listLevel + 1 : listLevel

    childrenHtml = renderBlockChildren(
      node.children,
      childrenType,
      nextLevel,
      colCount,
      embeds,
      renderHref,
      nestingDepth + 1,
    )
  }

  return `<${tag} class="blockNode" data-node-type="blockNode"${idAttr}>${contentHtml}${childrenHtml}</${tag}>`
}

/**
 * Render the blockContent element for a given block.
 * Matches the editor's content-type-specific renderHTML output.
 */
function renderBlockContent(
  block: any,
  embeds: Record<string, SSREmbedData>,
  renderHref: SSRRenderOpts['renderHref'],
  headingLevel: number,
): string {
  const text: string = block.text || ''
  const annotations: HMAnnotation[] = block.annotations || []

  switch (block.type) {
    case 'Paragraph': {
      const inlineHtml = renderAnnotatedText(text, annotations, renderHref)
      return `<p class="blockContent inlineContent block-paragraph" data-content-type="paragraph">${inlineHtml}</p>`
    }

    case 'Heading': {
      // Visual level is driven by nesting depth (see `headingLevel` arg),
      // not the stored `level` attribute, so legacy/imported docs render
      // consistently and the h-tag always reflects document hierarchy.
      // `+ 1` shifts the scale so a top-level heading is h2 — h1 is
      // reserved for the document title.
      const h = Math.min(Math.max(headingLevel + 1, 2), 6)
      const inlineHtml = renderAnnotatedText(text, annotations, renderHref)
      return `<div class="blockContent" data-content-type="heading" data-level="${h}"><h${h} class="inlineContent">${inlineHtml}</h${h}></div>`
    }

    case 'Code': {
      const lang = block.attributes?.language || ''
      const langAttr = lang ? ` data-language="${esc(lang)}"` : ''
      return `<pre class="blockContent" data-content-type="code-block"${langAttr}><code>${esc(text)}</code></pre>`
    }

    case 'Math':
      return `<div class="blockContent" data-content-type="math"><code>${esc(text)}</code></div>`

    case 'Image': {
      const link = block.link || ''
      const width = block.attributes?.width
      const widthAttr = width && width > 100 ? ` width="${width}"` : ''
      const widthStyle = width && width > 0 && width <= 100 ? ` style="width:${width}%"` : ''
      const imgHtml = link
        ? `<img src="/hm/api/image/${esc(link)}" alt="${esc(text)}" loading="lazy"${widthAttr}${widthStyle} />`
        : ''
      const captionHtml = text
        ? `<span class="inlineContent">${renderAnnotatedText(text, annotations, renderHref)}</span>`
        : ''
      return `<div class="blockContent" data-content-type="image">${imgHtml}${captionHtml}</div>`
    }

    case 'Video':
      return `<div class="blockContent" data-content-type="video"></div>`

    case 'File': {
      const name = block.attributes?.name || 'File'
      return `<div class="blockContent" data-content-type="file"><span>${esc(name)}</span></div>`
    }

    case 'Embed': {
      const link = block.link || ''
      const view = block.attributes?.view || 'Content'
      const dataUrlAttr = link ? ` data-url="${esc(link)}"` : ''
      const dataViewAttr = ` data-view="${esc(view)}"`
      const embedData = link ? embeds[link] : undefined
      if (embedData?.title) {
        return `<div class="blockContent" data-content-type="embed"${dataUrlAttr}${dataViewAttr}>${renderEmbedCard(
          embedData,
          link,
          view,
          renderHref,
        )}</div>`
      }
      return `<div class="blockContent" data-content-type="embed"${dataUrlAttr}${dataViewAttr}><div class="ssr-embed-block"></div></div>`
    }

    case 'WebEmbed':
      return `<div class="blockContent" data-content-type="web-embed"><div class="ssr-web-embed-block"></div></div>`

    case 'Button': {
      const label = text || 'Button'
      const alignment = block.attributes?.alignment || 'flex-start'
      return `<div class="blockContent" data-content-type="button" style="justify-content: ${esc(
        alignment,
      )}"><span>${esc(label)}</span></div>`
    }

    case 'Query': {
      const style = block.attributes?.style || 'Card'
      const colCount = block.attributes?.columnCount || 3
      return `<div class="blockContent" data-content-type="query" data-style="${esc(
        style,
      )}" data-column-count="${colCount}"><div class="ssr-query-block"></div></div>`
    }

    default: {
      if (text) {
        const inlineHtml = renderAnnotatedText(text, annotations, renderHref)
        return `<p class="blockContent inlineContent block-paragraph" data-content-type="paragraph">${inlineHtml}</p>`
      }
      return `<div class="blockContent" data-content-type="paragraph"></div>`
    }
  }
}

/**
 * Render text with annotations (bold, italic, underline, strike, code, links).
 * Uses the same codepoint-based annotation range logic as the editor to split
 * text into styled spans matching the editor's inline content output.
 */
function renderAnnotatedText(
  text: string,
  annotations: HMAnnotation[],
  renderHref: SSRRenderOpts['renderHref'],
): string {
  if (!text) return ''
  if (!annotations || annotations.length === 0) return esc(text)

  // Build spans using the same codepoint-based approach as the editor
  const spans: Array<{start: number; end: number; annotations: Set<HMAnnotation>}> = []
  let currentAnnotations = new Set<HMAnnotation>()
  let spanStart = 0

  // Iterate by codepoint position
  let pos = 0
  let i = 0
  while (i < text.length) {
    const codeUnit = text.charCodeAt(i)
    const isSurr = codeUnit >= 0xd800 && codeUnit <= 0xdbff
    const charLen = isSurr ? 2 : 1

    // Compute annotations active at this codepoint position
    const activeAnnotations = new Set<HMAnnotation>()
    for (const ann of annotations) {
      if (annotationContains(ann as any, pos) !== -1) {
        activeAnnotations.add(ann)
      }
    }

    // Check if annotations changed
    let changed = false
    if (activeAnnotations.size !== currentAnnotations.size) {
      changed = true
    } else {
      for (const a of activeAnnotations) {
        if (!currentAnnotations.has(a)) {
          changed = true
          break
        }
      }
    }

    if (changed && pos > 0) {
      spans.push({start: spanStart, end: i, annotations: currentAnnotations})
      spanStart = i
    }

    currentAnnotations = activeAnnotations
    pos++
    i += charLen
  }

  // Final span
  if (spanStart < text.length) {
    spans.push({start: spanStart, end: text.length, annotations: currentAnnotations})
  }

  return spans
    .map((span) => {
      const content = esc(text.substring(span.start, span.end))
      if (span.annotations.size === 0) return content

      let html = content
      let linkHref: string | null = null
      let embedHref: string | null = null
      let isInlineEmbed = false

      for (const ann of span.annotations) {
        switch (ann.type) {
          case 'Bold':
            html = `<strong>${html}</strong>`
            break
          case 'Italic':
            html = `<em>${html}</em>`
            break
          case 'Underline':
            html = `<u>${html}</u>`
            break
          case 'Strike':
            html = `<s>${html}</s>`
            break
          case 'Code':
            html = `<code>${html}</code>`
            break
          case 'Link':
            linkHref = (ann as any).link || ''
            break
          case 'Embed':
            isInlineEmbed = true
            embedHref = (ann as any).link || ''
            break
          case 'Range':
            break
          case 'TextColor': {
            const color = (ann as any).attributes?.value
            if (typeof color === 'string' && color) {
              html = `<span data-text-color="${esc(color)}">${html}</span>`
            }
            break
          }
          case 'BackgroundColor': {
            const color = (ann as any).attributes?.value
            if (typeof color === 'string' && color) {
              html = `<span data-background-color="${esc(color)}">${html}</span>`
            }
            break
          }
          case 'TextSize': {
            const size = (ann as any).attributes?.value
            if (typeof size === 'string' && size) {
              html = `<span data-text-size="${esc(size)}">${html}</span>`
            }
            break
          }
          case 'TextFamily': {
            const family = (ann as any).attributes?.value
            if (typeof family === 'string' && family) {
              html = `<span data-text-family="${esc(family)}">${html}</span>`
            }
            break
          }
        }
      }

      const rawHref = embedHref ?? linkHref
      if (rawHref != null) {
        const inlineEmbedAttr = isInlineEmbed ? ` data-inline-embed="${esc(embedHref || rawHref)}"` : ''
        const inlineEmbedClass = isInlineEmbed ? ' inline-embed' : ''
        html = `<a class="link${inlineEmbedClass}" href="${esc(resolveHref(rawHref, renderHref))}" data-hm-link="${esc(
          rawHref,
        )}"${inlineEmbedAttr}>${html}</a>`

        return html
      }

      if (isInlineEmbed) {
        const inlineEmbedAttr = embedHref ? ` data-inline-embed="${esc(embedHref)}"` : ''
        html = `<span class="inline-embed"${inlineEmbedAttr}>${html}</span>`
      }

      return html
    })
    .join('')
}

function renderEmbedCard(
  data: SSREmbedData,
  link: string,
  view: string,
  renderHref: SSRRenderOpts['renderHref'],
): string {
  const title = esc(data.title || '')
  const summary = esc(data.summary || '')
  const href = link ? esc(resolveHref(link, renderHref)) : ''

  const imageHtml = data.imageUrl
    ? `<div class="ssr-card-image"><img src="${esc(data.imageUrl)}" alt="" loading="lazy" /></div>`
    : ''

  return (
    `<a class="ssr-card" data-content-type="embed" data-url="${esc(link)}" data-view="${esc(view)}" ${
      href ? `href="${href}"` : ''
    }>` +
    imageHtml +
    `<div class="ssr-card-content">` +
    `<div class="ssr-card-title">${title}</div>` +
    (summary ? `<div class="ssr-card-summary">${summary}</div>` : '') +
    `</div>` +
    `</a>`
  )
}

function resolveHref(link: string, renderHref: SSRRenderOpts['renderHref']): string {
  return renderHref?.(link) || linkToHref(link)
}

/** Convert hm://uid/path to a relative URL. */
function linkToHref(hmLink: string): string {
  if (hmLink.startsWith('hm://')) {
    return '/hm/' + hmLink.slice(5)
  }
  return hmLink
}

function normalizeChildrenType(ct: any): string {
  if (ct === 'Group' || ct === 'Ordered' || ct === 'Unordered' || ct === 'Blockquote' || ct === 'Grid') {
    return ct
  }
  return 'Group'
}

function listTag(listType: string): string {
  if (listType === 'Unordered') return 'ul'
  if (listType === 'Ordered') return 'ol'
  if (listType === 'Blockquote') return 'blockquote'
  return 'div'
}

/** HTML-escape a string for safe embedding in attributes and content. */
function esc(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
