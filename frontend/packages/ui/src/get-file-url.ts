import {
  DAEMON_FILE_URL,
  OptimizedImageSize,
  useUniversalAppContext,
} from '@shm/shared'

export function getDaemonFileUrl(ipfsUrl?: string) {
  if (ipfsUrl) {
    return `${DAEMON_FILE_URL}/${extractIpfsUrlCid(ipfsUrl)}`
  }
  return ''
}
export function findtIpfsUrlCid(cidOrIPFSUrl: string): string | null {
  const regex = /^ipfs:\/\/(.+)$/
  const match = cidOrIPFSUrl.match(regex)
  // @ts-ignore
  return match ? match[1] : null
}

export function extractIpfsUrlCid(cidOrIPFSUrl: string): string {
  const cid = findtIpfsUrlCid(cidOrIPFSUrl)
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
