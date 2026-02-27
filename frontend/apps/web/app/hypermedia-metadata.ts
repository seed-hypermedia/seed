import type {MetaFunction} from '@remix-run/react'
import {
  getCommentTargetId,
  getDocumentTitle,
  HMDocument,
  hmIdPathToEntityQueryPath,
  hostnameStripProtocol,
  packHmId,
  UnpackedHypermediaId,
} from '@shm/shared'
import {HMComment} from '@shm/shared/hm-types'
import {extractIpfsUrlCid} from '@shm/ui/get-file-url'
import {defaultSiteIcon} from './meta'
import {getOptimizedImageUrl} from './providers'

export type HypermediaResourceMetadata = {
  id: string
  version: string
  title: string
  type: 'Document' | 'Comment'
  authors: string[]
  target?: string
}

/**
 * Create metadata for a hypermedia resource (document or comment).
 *
 * For documents, only `id` and `document` are needed.
 * For comments, pass the `comment` and optionally a `commentAuthorTitle`
 * (defaults to "Somebody"). The `document` should be the comment's target document.
 */
export function createResourceMetadata(opts: {
  id: UnpackedHypermediaId
  document: HMDocument
  comment?: HMComment | null
  commentAuthorTitle?: string
}): HypermediaResourceMetadata {
  if (opts.comment) {
    const targetId = getCommentTargetId(opts.comment)
    return {
      id: opts.id.id,
      version: opts.comment.version,
      title: `${opts.commentAuthorTitle || 'Somebody'} on ${getDocumentTitle(opts.document)}`,
      type: 'Comment',
      authors: [opts.comment.author],
      target: targetId ? packHmId(targetId) : undefined,
    }
  }
  return {
    id: opts.id.id,
    version: opts.document.version,
    title: getDocumentTitle(opts.document),
    type: 'Document',
    authors: opts.document.authors,
  }
}

export function metadataToHeaders(metadata: HypermediaResourceMetadata): Record<string, string> {
  const headers: Record<string, string> = {}
  headers['X-Hypermedia-Id'] = encodeURIComponent(metadata.id)
  headers['X-Hypermedia-Version'] = metadata.version
  headers['X-Hypermedia-Title'] = encodeURIComponent(metadata.title)
  headers['X-Hypermedia-Type'] = metadata.type
  headers['X-Hypermedia-Authors'] = metadata.authors.map((author) => encodeURIComponent(`hm://${author}`)).join(',')
  if (metadata.target) {
    headers['X-Hypermedia-Target'] = encodeURIComponent(metadata.target)
  }
  return headers
}

export function metadataToPageMeta(
  metadata: HypermediaResourceMetadata,
  display: {
    origin: string
    id: UnpackedHypermediaId
    siteHomeIcon?: string | null
  },
): ReturnType<MetaFunction> {
  const meta: ReturnType<MetaFunction> = []

  const siteHomeIcon = display.siteHomeIcon ? getOptimizedImageUrl(extractIpfsUrlCid(display.siteHomeIcon), 'S') : null

  meta.push({
    tagName: 'link',
    rel: 'icon',
    href: siteHomeIcon || defaultSiteIcon,
    type: 'image/png',
  })

  meta.push({name: 'hypermedia_id', content: metadata.id})

  const imageUrl = `${display.origin}/hm/api/content-image?space=${display.id.uid}&path=${hmIdPathToEntityQueryPath(
    display.id.path,
  )}&version=${metadata.version}`
  const currentUrl = `${display.origin}${display.id.path?.length ? '/' + display.id.path.join('/') : ''}`
  const domain = hostnameStripProtocol(display.origin)
  const description = ''

  meta.push({title: metadata.title})
  meta.push({name: 'description', content: description})

  meta.push({property: 'og:url', content: currentUrl})
  meta.push({property: 'og:type', content: 'website'})
  meta.push({property: 'og:title', content: metadata.title})
  meta.push({property: 'og:description', content: description})
  meta.push({property: 'og:image', content: imageUrl})

  meta.push({name: 'twitter:card', content: 'summary_large_image'})
  meta.push({property: 'twitter:domain', content: domain})
  meta.push({property: 'twitter:url', content: currentUrl})
  meta.push({name: 'twitter:title', content: metadata.title})
  meta.push({name: 'twitter:description', content: description})
  meta.push({name: 'twitter:image', content: imageUrl})

  meta.push({name: 'hypermedia_version', content: metadata.version})
  meta.push({name: 'hypermedia_title', content: metadata.title})
  meta.push({name: 'hypermedia_type', content: metadata.type})
  meta.push({
    name: 'hypermedia_authors',
    content: metadata.authors.map((author) => `hm://${author}`).join(','),
  })
  if (metadata.target) {
    meta.push({name: 'hypermedia_target', content: metadata.target})
  }

  return meta
}
