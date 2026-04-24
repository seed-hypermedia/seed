import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import type {CopyLinkInput} from '@shm/shared'
import {buildCopyLinkUrl} from '@shm/shared'
import {useCallback} from 'react'
import {copyUrlToClipboardWithFeedback} from './copy-to-clipboard'

export type CopyHmLinkOptions = {
  /** Override the default toast label (inferred from the input shape). */
  label?: string
}

/**
 * Returns a function that copies a Hypermedia link for the given `id` (and
 * optional `commentId`) to the clipboard and shows a toast. The URL is built
 * via `buildCopyLinkUrl` so all callsites share one source of truth.
 *
 * The returned function resolves with the URL it copied so callers can use it
 * for logging, tests, or local UI feedback.
 */
export function useCopyHmLink() {
  return useCallback(async (input: CopyLinkInput, opts?: CopyHmLinkOptions) => {
    const url = buildCopyLinkUrl(input)
    const label = opts?.label ?? defaultLabelForInput(input)
    await copyUrlToClipboardWithFeedback(url, label)
    return url
  }, [])
}

function defaultLabelForInput({id, commentId}: CopyLinkInput): string {
  const hasFragment = isFragmentRange(id)
  const hasBlock = !!id.blockRef
  if (commentId) {
    if (hasFragment) return 'Comment Fragment'
    if (hasBlock) return 'Comment Block'
    return 'Comment'
  }
  if (hasFragment) return 'Fragment'
  if (hasBlock) return 'Block'
  return 'Link'
}

function isFragmentRange(id: UnpackedHypermediaId): boolean {
  const range = id.blockRange
  if (!range) return false
  return typeof range.start === 'number' && typeof range.end === 'number'
}
