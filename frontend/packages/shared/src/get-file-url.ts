import {API_FILE_URL} from './constants'

export function getFileUrl(ipfsUrl?: string) {
  if (ipfsUrl) {
    return `${API_FILE_URL}/${extractIpfsUrlCid(ipfsUrl)}`
  }
  return ''
}

function extractIpfsUrlCid(url: string): null | string {
  const regex = /^ipfs:\/\/(.+)$/
  const match = url.match(regex)
  return match ? match[1] : null
}
