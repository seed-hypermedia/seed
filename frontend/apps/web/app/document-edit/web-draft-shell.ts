import {getWebDraftPlaceholderId, isWebDraftPlaceholderPath} from './web-draft-path'

function isPrivateGeneratedPath(path: string[] | null | undefined): boolean {
  return !!path?.at(-1)?.startsWith('-private-')
}

/** Return true when SSR should render a local draft shell instead of fetching a backend document. */
export function shouldBypassServerDocumentFetchForWebDraftShell({
  path,
  isInspect,
  version,
}: {
  path: string[] | null | undefined
  isInspect: boolean
  version: string | null | undefined
}): boolean {
  return !isInspect && !version && isWebDraftPlaceholderPath(path) && !isPrivateGeneratedPath(path)
}

/** Return the local draft id encoded by a document route's final placeholder segment. */
export function getWebDraftShellId(path: string[] | null | undefined): string | null {
  return getWebDraftPlaceholderId(path)
}

/** Return true while the document page should render a local draft shell instead of fetching the server doc. */
export function shouldUseLocalWebDraftShell({
  placeholderDraftId,
  isDraftLoading,
  hasDraft,
  isReservedDraft,
}: {
  placeholderDraftId: string | null | undefined
  isDraftLoading: boolean
  hasDraft: boolean
  isReservedDraft: boolean
}): boolean {
  return !!placeholderDraftId && (isDraftLoading || hasDraft || isReservedDraft)
}
