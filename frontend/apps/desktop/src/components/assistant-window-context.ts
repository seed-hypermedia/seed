import {useResource} from '@shm/shared/models/entity'
import {hmId, packHmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {useMemo} from 'react'

/**
 * Derives the "current window" context the assistant sidebar attaches to every send.
 *
 * This is what makes "summarize this" work: the model learns which document, view, panel, and
 * focused block the user is looking at. Ported from the old assistant runtime (`app-chat.ts`
 * system-prompt assembly plus the route derivation that lived in the old `assistant-panel.tsx`);
 * it now travels as a `context` content part that the agents service feeds to the model without
 * showing it in the transcript.
 */

/** Structured description of what the current window is showing. */
export type AssistantWindowContext = {
  url?: string
  title?: string
  view?: 'document' | 'comments' | 'directory' | 'activity' | 'collaborators' | 'feed' | 'inspect' | 'draft'
  activePanel?: 'comments' | 'activity' | 'directory' | 'collaborators' | 'options'
  openComment?: string
  focusedBlockId?: string
  focusedBlockRange?: {start: number; end: number}
  isDraft?: boolean
  editingDocumentUrl?: string
}

/** Formats window context into the model-facing lines of a `context` message part. */
export function formatWindowContextLines(context: AssistantWindowContext | undefined): string[] | undefined {
  if (!context || (!context.url && !context.isDraft)) return undefined
  const lines: string[] = ['## Current window']
  if (context.url) lines.push(`URL: ${context.url}`)
  if (context.title) lines.push(`Title: "${context.title}"`)
  if (context.view) lines.push(`View: ${context.view}`)
  if (context.activePanel) lines.push(`Side panel: ${context.activePanel}`)
  if (context.openComment) lines.push(`Open comment: ${context.openComment}`)
  if (context.focusedBlockId) {
    const rangeStr = context.focusedBlockRange
      ? `[${context.focusedBlockRange.start}:${context.focusedBlockRange.end}]`
      : ''
    lines.push(`Focused block: ${context.focusedBlockId}${rangeStr}`)
  }
  if (context.isDraft) {
    lines.push('The user is editing a draft.')
    if (context.editingDocumentUrl) lines.push(`Editing document: ${context.editingDocumentUrl}`)
  }
  lines.push(
    'Treat this as the default referent when the user says "this document", "this comment", etc. Use `read` to verify content before answering.',
  )
  return lines
}

/** Reads the current route and returns the context lines to attach to an assistant send. */
export function useAssistantWindowContextLines(): string[] | undefined {
  const navRoute = useNavRoute()
  const routeId =
    'id' in navRoute && navRoute.key !== 'draft'
      ? (navRoute.id as import('@seed-hypermedia/client/hm-types').UnpackedHypermediaId)
      : undefined
  const resource = useResource(routeId)
  const documentTitle =
    resource.data?.type === 'document' ? resource.data.document?.metadata?.name || undefined : undefined

  const context = useMemo<AssistantWindowContext | undefined>(() => {
    const panel =
      'panel' in navRoute ? (navRoute.panel as {key: string; openComment?: string} | null | undefined) : undefined
    const activePanel = panel?.key as AssistantWindowContext['activePanel']

    switch (navRoute.key) {
      case 'document':
      case 'directory':
      case 'activity':
      case 'collaborators':
      case 'inspect':
      case 'feed': {
        const id = navRoute.id
        try {
          const ctx: AssistantWindowContext = {
            url: packHmId(id),
            title: documentTitle,
            view: navRoute.key,
            activePanel,
          }
          if (id.blockRef) ctx.focusedBlockId = id.blockRef
          if (id.blockRange) {
            ctx.focusedBlockRange = {start: id.blockRange.start ?? 0, end: id.blockRange.end ?? 0}
          }
          if (panel?.key === 'comments' && panel.openComment) ctx.openComment = panel.openComment
          return ctx
        } catch {
          return undefined
        }
      }
      case 'comments': {
        const id = navRoute.id
        try {
          const ctx: AssistantWindowContext = {
            url: packHmId(id),
            title: documentTitle,
            view: 'comments',
            activePanel,
          }
          if (navRoute.openComment) ctx.openComment = navRoute.openComment
          if (navRoute.targetBlockId) ctx.focusedBlockId = navRoute.targetBlockId
          else if (navRoute.blockId) ctx.focusedBlockId = navRoute.blockId
          if (navRoute.blockRange) {
            ctx.focusedBlockRange = {start: navRoute.blockRange.start ?? 0, end: navRoute.blockRange.end ?? 0}
          }
          return ctx
        } catch {
          return undefined
        }
      }
      case 'draft': {
        const ctx: AssistantWindowContext = {view: 'draft', isDraft: true, activePanel}
        if (navRoute.editUid) {
          try {
            ctx.editingDocumentUrl = packHmId(hmId(navRoute.editUid, {path: navRoute.editPath}))
          } catch {
            // ignore if packing fails
          }
        }
        return ctx
      }
      default:
        return undefined
    }
  }, [navRoute, documentTitle])

  return useMemo(() => formatWindowContextLines(context), [context])
}
