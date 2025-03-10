import {
  DAEMON_FILE_URL,
  OptimizedImageSize,
  useUniversalAppContext,
} from '@shm/shared'

console.log('=== import get-file-url')

export function getDaemonFileUrl(ipfsUrl?: string) {
  if (ipfsUrl) {
    return `${DAEMON_FILE_URL}/${extractIpfsUrlCid(ipfsUrl)}`
  }
  return ''
}

export function extractIpfsUrlCid(cidOrIPFSUrl: string): string {
  const regex = /^ipfs:\/\/(.+)$/
  const match = cidOrIPFSUrl.match(regex)
  return match ? match[1] : cidOrIPFSUrl
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
    return `${ipfsFileUrl || ''}/${cid}`
  }
}
