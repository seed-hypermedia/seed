import {Code, ConnectError} from '@connectrpc/connect'
import type {HMDocument} from '@seed-hypermedia/client/hm-types'
import {HMNotFoundError} from '@shm/shared/models/entity'
import * as isbotModule from 'isbot'

/**
 * The document as shipped in the route payload: everything except its block
 * content. The page renders content from the dehydrated React Query cache (the
 * resource query carries the full document); the payload's copy only feeds
 * the page meta (title, version, authors). Shipping the blocks a second time
 * doubled the largest part of the payload, and every byte of it is
 * superjson-serialized, JSON-encoded, parsed and deserialized again on each
 * server render.
 */
export type HMDocumentShell = Omit<HMDocument, 'content' | 'detachedBlocks'>

/** Strip the block content from a document for the route payload. */
export function toDocumentShell(document: HMDocument): HMDocumentShell {
  const {content: _content, detachedBlocks: _detachedBlocks, ...shell} = document
  return shell
}

/** The error a tombstoned (deleted) resource is reported with. */
export const RESOURCE_DELETED_MESSAGE = 'Resource has been deleted'

/** Missing, deleted and private resources: routine outcomes, not server faults. */
export function isExpectedResourceError(e: unknown): boolean {
  if (e instanceof HMNotFoundError) return true
  if (e instanceof ConnectError) return e.code === Code.NotFound || e.code === Code.PermissionDenied
  return e instanceof Error && e.message === RESOURCE_DELETED_MESSAGE
}

/** Whether a User-Agent is a crawler (same check entry.server uses to pick the bot render path). */
export function isBotUserAgent(userAgent: string | null | undefined): boolean {
  if (!userAgent) return false
  if ('isbot' in isbotModule && typeof isbotModule.isbot === 'function') return isbotModule.isbot(userAgent)
  return false
}

/**
 * Whether the document route shows something other than the document's
 * content: every view term (/:activity, /:comments, /:directory, profiles, …)
 * replaces the content view, and so does the inspector. The page still loads
 * the document (for the header, meta and panels), but its content HTML would
 * never be displayed.
 */
export function isContentHiddenView(
  routeData: {viewTerm?: string | null; isInspect?: boolean | null} | undefined | null,
): boolean {
  return !!routeData?.viewTerm || !!routeData?.isInspect
}
