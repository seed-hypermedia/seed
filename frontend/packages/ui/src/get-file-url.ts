import {OptimizedImageSize, useUniversalAppContext} from '@shm/shared'
import {DAEMON_FILE_URL} from '@shm/shared/constants'

export function getDaemonFileUrl(ipfsUrl?: string, filename?: string) {
  if (ipfsUrl) {
    const cid = extractIpfsUrlCid(ipfsUrl)
    const url = `${DAEMON_FILE_URL}/${cid}`
    // File name parameter for web download
    if (filename) {
      return `${url}?filename=${encodeURIComponent(filename)}`
    }
    return url
  }
  return ''
}

export function findIpfsUrlCid(cidOrIPFSUrl: string): string | null {
  const regex = /^ipfs:\/\/(.+)$/
  const match = cidOrIPFSUrl.match(regex)
  const cid = match ? match[1] : null
  return cid || null
}

export function extractIpfsUrlCid(cidOrIPFSUrl: string): string {
  const cid = findIpfsUrlCid(cidOrIPFSUrl)
  if (cid) return cid
  return cidOrIPFSUrl
}

export function isIpfsUrl(url: string): boolean {
  return url.startsWith('ipfs://')
}

export function useImageUrl() {
  const {ipfsFileUrl, getOptimizedImageUrl} = useUniversalAppContext()
  return (ipfsUrl: string, optimizedSize?: OptimizedImageSize) => {
    const cid = extractIpfsUrlCid(ipfsUrl)
    if (!cid) return ''
    if (getOptimizedImageUrl) return getOptimizedImageUrl(cid, optimizedSize)
    return `${ipfsFileUrl || ''}/${cid}`
  }
}

export function useFileUrl() {
  const {ipfsFileUrl} = useUniversalAppContext()
  return (ipfsUrl: string) => {
    const cid = extractIpfsUrlCid(ipfsUrl)
    if (!cid) return ''
    return `${ipfsFileUrl || DAEMON_FILE_URL}/${cid}`
  }
}

/**
 * Returns a function that builds a /hm/api/file/[cid] URL for non-image
 * files (videos, documents, etc.). This proxies through the web server,
 * avoiding localhost daemon URLs that break on hosted sites.
 * Falls back to the direct IPFS URL on desktop.
 */
export function useFileProxyUrl() {
  const {getOptimizedImageUrl} = useUniversalAppContext()
  // If getOptimizedImageUrl exists, we're in a web context that supports proxy routes
  const isWebContext = !!getOptimizedImageUrl
  const getFileUrl = useFileUrl()

  return (ipfsUrl: string) => {
    const cid = extractIpfsUrlCid(ipfsUrl)
    if (!cid) return ''
    if (isWebContext) {
      return `/hm/api/file/${cid}`
    }
    // Desktop: use direct daemon URL
    return getFileUrl(ipfsUrl)
  }
}
