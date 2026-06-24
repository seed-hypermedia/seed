import type {CitationFragmentClick, CitationFragmentHighlight} from '@shm/shared/document-content-props'
import {Node as ProseMirrorNode} from 'prosemirror-model'
import {Plugin, PluginKey} from 'prosemirror-state'
import type {StepMap} from 'prosemirror-transform'
import {Decoration, DecorationSet} from 'prosemirror-view'
import {codepointOffsetToPos} from '../BlockHighlight/BlockHighlightPlugin'

import './citation-fragment-highlight.css'

/** Mutable callback ref read by the citation fragment highlight plugin. */
export type CitationFragmentClickHandlerRef = {
  current?: ((event: CitationFragmentClick) => void) | null
}

type CitationFragmentHighlightAction =
  | {type: 'set'; citations: CitationFragmentHighlight[]; interactive?: boolean}
  | {type: 'clear'}

type CitationDecorationRange = {
  from: number
  to: number
  citations: CitationFragmentHighlight[]
}

type CitationFragmentHighlightState = {
  decorations: DecorationSet
  ranges: CitationDecorationRange[]
  interactive: boolean
}

/** Plugin key used to dispatch citation fragment highlight actions. */
export const citationFragmentHighlightPluginKey = new PluginKey<CitationFragmentHighlightState>(
  'citationFragmentHighlightPlugin',
)

function emptyState(): CitationFragmentHighlightState {
  return {decorations: DecorationSet.empty, ranges: [], interactive: true}
}

function findBlockContent(
  doc: ProseMirrorNode,
  blockId: string,
): {content: ProseMirrorNode; contentBeforePos: number; revision: string} | null {
  let result: {content: ProseMirrorNode; contentBeforePos: number; revision: string} | null = null

  doc.descendants((node, pos) => {
    if (result) return false
    if (node.type.name === 'blockNode' && node.attrs['id'] === blockId) {
      const blockBeforePos = pos
      let contentBeforePos = blockBeforePos
      let revision = typeof node.attrs['revision'] === 'string' ? node.attrs['revision'] : ''
      node.forEach((child, offset) => {
        if (child.type.spec.group === 'block') {
          contentBeforePos = blockBeforePos + offset + 1
          revision = typeof child.attrs['revision'] === 'string' ? child.attrs['revision'] : revision
          result = {content: child, contentBeforePos, revision}
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
  interactive = true,
): CitationFragmentHighlightState {
  const ranges: CitationDecorationRange[] = []
  const byBlock = new Map<string, CitationFragmentHighlight[]>()

  for (const citation of citations) {
    if (citation.targetRange.end <= citation.targetRange.start) continue
    const blockCitations = byBlock.get(citation.targetBlockId) ?? []
    blockCitations.push(citation)
    byBlock.set(citation.targetBlockId, blockCitations)
  }

  for (const [blockId, blockCitationsForBlock] of Array.from(byBlock.entries())) {
    const found = findBlockContent(doc, blockId)
    if (!found) continue
    const blockCitations = blockCitationsForBlock.filter(
      (citation) => !citation.targetBlockRevision || citation.targetBlockRevision === found.revision,
    )
    if (!blockCitations.length) continue

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

      ranges.push({from, to, citations: covering})
    }
  }

  return {decorations: createDecorationSetFromRanges(doc, ranges, interactive), ranges, interactive}
}

function createDecorationSetFromRanges(doc: ProseMirrorNode, ranges: CitationDecorationRange[], interactive: boolean) {
  return DecorationSet.create(
    doc,
    ranges.map((range) => {
      const overlap = Math.min(range.citations.length, 4)
      const interactiveClass = interactive ? ' bn-citation-fragment-highlight-interactive' : ''
      return Decoration.inline(range.from, range.to, {
        class: `bn-range-highlight-focus bn-citation-fragment-highlight${interactiveClass} bn-citation-fragment-overlap-${overlap}`,
        'data-citation-fragment': 'true',
        'data-citation-ids': range.citations.map((citation) => citation.id).join(','),
      })
    }),
  )
}

function mapRangeThroughStep(range: CitationDecorationRange, stepMap: StepMap): CitationDecorationRange[] {
  const changedRanges: {oldStart: number; oldEnd: number}[] = []
  stepMap.forEach((oldStart: number, oldEnd: number) => {
    changedRanges.push({oldStart, oldEnd})
  })

  const mapPiece = (from: number, to: number, fromAssoc: -1 | 1, toAssoc: -1 | 1) => {
    if (to <= from) return null
    const mappedFrom = stepMap.map(from, fromAssoc)
    const mappedTo = stepMap.map(to, toAssoc)
    if (mappedTo <= mappedFrom) return null
    return {...range, from: mappedFrom, to: mappedTo}
  }

  if (!changedRanges.length) {
    const mapped = mapPiece(range.from, range.to, 1, -1)
    return mapped ? [mapped] : []
  }

  const mappedRanges: CitationDecorationRange[] = []
  let cursor = range.from
  let cursorAssoc: -1 | 1 = 1

  for (const {oldStart, oldEnd} of changedRanges) {
    if (oldStart >= range.to) break
    if (oldEnd <= cursor) continue
    if (oldEnd <= range.from) continue

    const splitStart = Math.max(oldStart, range.from)
    if (splitStart > cursor) {
      const mapped = mapPiece(cursor, Math.min(splitStart, range.to), cursorAssoc, -1)
      if (mapped) mappedRanges.push(mapped)
    }

    cursor = oldEnd > oldStart ? Math.max(cursor, oldEnd) : Math.max(cursor, oldStart)
    cursorAssoc = 1
  }

  if (cursor < range.to) {
    const mapped = mapPiece(cursor, range.to, cursorAssoc, -1)
    if (mapped) mappedRanges.push(mapped)
  }

  return mappedRanges
}

function mapRanges(
  ranges: CitationDecorationRange[],
  tr: Parameters<NonNullable<Plugin['spec']['state']>['apply']>[0],
) {
  let mappedRanges = ranges
  for (const stepMap of tr.mapping.maps) {
    mappedRanges = mappedRanges.flatMap((range) => mapRangeThroughStep(range, stepMap))
  }
  return mappedRanges
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
          return buildCitationDecorations(tr.doc, action.citations, action.interactive ?? true)
        }

        if (action?.type === 'clear') {
          return emptyState()
        }

        if (!tr.docChanged) return oldState

        const ranges = mapRanges(oldState.ranges, tr)
        return {
          decorations: createDecorationSetFromRanges(tr.doc, ranges, oldState.interactive),
          ranges,
          interactive: oldState.interactive,
        }
      },
    },

    props: {
      decorations(state) {
        return citationFragmentHighlightPluginKey.getState(state)?.decorations ?? DecorationSet.empty
      },

      handleClick(view, pos, event) {
        const pluginState = citationFragmentHighlightPluginKey.getState(view.state)
        if (!pluginState?.interactive) return false

        const ranges = pluginState?.ranges ?? []
        const citations = ranges
          .filter((range) => range.from <= pos && pos <= range.to)
          .flatMap((range) => range.citations)

        if (!citations.length) return false
        const handler = handlerRef.current
        if (!handler) return false

        const unique = new Map<string, CitationFragmentHighlight>()
        for (const citation of citations) unique.set(citation.id, citation)
        handler({
          citations: Array.from(unique.values()),
          clientX: event.clientX,
          clientY: event.clientY,
        })
        return true
      },
    },
  })
}
