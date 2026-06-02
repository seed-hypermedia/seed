import type {CitationFragmentClick, CitationFragmentHighlight} from '@shm/shared/document-content-props'
import {Node as ProseMirrorNode} from 'prosemirror-model'
import {Plugin, PluginKey} from 'prosemirror-state'
import {Decoration, DecorationSet} from 'prosemirror-view'
import {codepointOffsetToPos} from '../BlockHighlight/BlockHighlightPlugin'

import './citation-fragment-highlight.css'

/** Mutable callback ref read by the citation fragment highlight plugin. */
export type CitationFragmentClickHandlerRef = {
  current?: ((event: CitationFragmentClick) => void) | null
}

type CitationFragmentHighlightAction = {type: 'set'; citations: CitationFragmentHighlight[]} | {type: 'clear'}

type CitationDecorationRange = {
  from: number
  to: number
  citations: CitationFragmentHighlight[]
}

type CitationFragmentHighlightState = {
  decorations: DecorationSet
  ranges: CitationDecorationRange[]
}

/** Plugin key used to dispatch citation fragment highlight actions. */
export const citationFragmentHighlightPluginKey = new PluginKey<CitationFragmentHighlightState>(
  'citationFragmentHighlightPlugin',
)

function emptyState(): CitationFragmentHighlightState {
  return {decorations: DecorationSet.empty, ranges: []}
}

function findBlockContent(
  doc: ProseMirrorNode,
  blockId: string,
): {content: ProseMirrorNode; contentBeforePos: number} | null {
  let result: {content: ProseMirrorNode; contentBeforePos: number} | null = null

  doc.descendants((node, pos) => {
    if (result) return false
    if (node.type.name === 'blockNode' && node.attrs['id'] === blockId) {
      const blockBeforePos = pos
      let contentBeforePos = blockBeforePos
      node.forEach((child, offset) => {
        if (child.type.spec.group === 'block') {
          contentBeforePos = blockBeforePos + offset + 1
          result = {content: child, contentBeforePos}
        }
      })
      return false
    }
    return undefined
  })

  return result
}

function buildCitationDecorations(
  doc: ProseMirrorNode,
  citations: CitationFragmentHighlight[],
): CitationFragmentHighlightState {
  const decorations: Decoration[] = []
  const ranges: CitationDecorationRange[] = []
  const byBlock = new Map<string, CitationFragmentHighlight[]>()

  for (const citation of citations) {
    if (citation.targetRange.end <= citation.targetRange.start) continue
    const blockCitations = byBlock.get(citation.targetBlockId) ?? []
    blockCitations.push(citation)
    byBlock.set(citation.targetBlockId, blockCitations)
  }

  for (const [blockId, blockCitations] of Array.from(byBlock.entries())) {
    const found = findBlockContent(doc, blockId)
    if (!found) continue

    const endpoints: number[] = Array.from(
      new Set(blockCitations.flatMap((citation) => [citation.targetRange.start, citation.targetRange.end])),
    ).sort((a, b) => a - b)

    for (let i = 0; i < endpoints.length - 1; i++) {
      const start = endpoints[i]
      const end = endpoints[i + 1]
      if (start == null || end == null) continue
      if (end <= start) continue

      const covering = blockCitations.filter(
        (citation) => citation.targetRange.start < end && citation.targetRange.end > start,
      )
      if (!covering.length) continue

      const from = codepointOffsetToPos(found.content, found.contentBeforePos, start)
      const to = codepointOffsetToPos(found.content, found.contentBeforePos, end)
      if (to <= from) continue

      const overlap = Math.min(covering.length, 4)
      decorations.push(
        Decoration.inline(from, to, {
          class: `bn-range-highlight-focus bn-citation-fragment-highlight bn-citation-fragment-overlap-${overlap}`,
          'data-citation-fragment': 'true',
          'data-citation-ids': covering.map((citation) => citation.id).join(','),
        }),
      )
      ranges.push({from, to, citations: covering})
    }
  }

  return {decorations: DecorationSet.create(doc, decorations), ranges}
}

function mapRanges(
  ranges: CitationDecorationRange[],
  tr: Parameters<NonNullable<Plugin['spec']['state']>['apply']>[0],
) {
  return ranges
    .map((range) => ({
      ...range,
      from: tr.mapping.map(range.from, 1),
      to: tr.mapping.map(range.to, -1),
    }))
    .filter((range) => range.to > range.from)
}

/**
 * Creates a decoration-only plugin for inbound ranged citation fragments.
 *
 * Dispatch actions with `tr.setMeta(citationFragmentHighlightPluginKey, action)`.
 * Callers should also set `tr.setMeta('addToHistory', false)` so highlight
 * refreshes never participate in undo/redo history.
 */
export function createCitationFragmentHighlightPlugin(handlerRef: CitationFragmentClickHandlerRef): Plugin {
  return new Plugin<CitationFragmentHighlightState>({
    key: citationFragmentHighlightPluginKey,

    state: {
      init: emptyState,

      apply(tr, oldState) {
        const action: CitationFragmentHighlightAction | undefined = tr.getMeta(citationFragmentHighlightPluginKey)

        if (action?.type === 'set') {
          return buildCitationDecorations(tr.doc, action.citations)
        }

        if (action?.type === 'clear') {
          return emptyState()
        }

        if (!tr.docChanged) return oldState

        return {
          decorations: oldState.decorations.map(tr.mapping, tr.doc),
          ranges: mapRanges(oldState.ranges, tr),
        }
      },
    },

    props: {
      decorations(state) {
        return citationFragmentHighlightPluginKey.getState(state)?.decorations ?? DecorationSet.empty
      },

      handleClick(view, pos, event) {
        const pluginState = citationFragmentHighlightPluginKey.getState(view.state)
        const ranges = pluginState?.ranges ?? []
        const citations = ranges
          .filter((range) => range.from <= pos && pos <= range.to)
          .flatMap((range) => range.citations)

        if (!citations.length) return false

        const unique = new Map<string, CitationFragmentHighlight>()
        for (const citation of citations) unique.set(citation.id, citation)
        handlerRef.current?.({
          citations: Array.from(unique.values()),
          clientX: event.clientX,
          clientY: event.clientY,
        })
        return true
      },
    },
  })
}
