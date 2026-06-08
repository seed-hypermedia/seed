import type {LoaderFunctionArgs} from '@remix-run/node'
import {MAX_FILE_SIZE_B, MAX_FILE_SIZE_MB} from '@shm/shared/constants'
import {lookup} from 'dns/promises'
import net from 'net'

const MAX_REDIRECTS = 5

export async function loader({request}: LoaderFunctionArgs) {
  const urlParam = new URL(request.url).searchParams.get('url')
  if (!urlParam) return new Response('Missing url', {status: 400})

  try {
    const response = await fetchRemoteFile(urlParam)
    const contentLength = Number(response.headers.get('content-length') || '0')
    if (contentLength > MAX_FILE_SIZE_B) {
      return new Response(`File too large, max size is ${MAX_FILE_SIZE_MB}MB`, {status: 413})
    }

    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > MAX_FILE_SIZE_B) {
      return new Response(`File too large, max size is ${MAX_FILE_SIZE_MB}MB`, {status: 413})
    }

    return new Response(buffer, {
      headers: {
        'Content-Type': response.headers.get('content-type') || 'application/octet-stream',
        'Content-Length': String(buffer.byteLength),
        'Cache-Control': 'no-store',
      },
    })
  } catch (error) {
    console.error('hm.api.web-file loader error:', error)
    return new Response(error instanceof Error ? error.message : 'Failed to fetch file', {status: 400})
  }
}

async function fetchRemoteFile(url: string, redirects = 0): Promise<Response> {
  if (redirects > MAX_REDIRECTS) throw new Error('Too many redirects')

  const parsedUrl = new URL(url)
  if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
    throw new Error('Only http and https URLs are supported')
  }
  await assertPublicHost(parsedUrl.hostname)

  const response = await fetch(parsedUrl, {
    redirect: 'manual',
    headers: {
      'User-Agent': 'Seed-Web-File-Import',
    },
  })

  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location')
    if (!location) throw new Error('Redirect without location header')
    return fetchRemoteFile(new URL(location, parsedUrl).toString(), redirects + 1)
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`)
  }

  return response
}

async function assertPublicHost(hostname: string) {
  const normalizedHostname = hostname.replace(/^\[|\]$/g, '')
  const addresses = net.isIP(normalizedHostname)
    ? [{address: normalizedHostname}]
    : await lookup(normalizedHostname, {
        all: true,
        verbatim: true,
      })

  if (addresses.some(({address}) => isPrivateAddress(address))) {
    throw new Error('URL host is not allowed')
  }
}

function isPrivateAddress(address: string) {
  if (net.isIPv6(address)) {
    const normalized = address.toLowerCase()
    return (
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:')
    )
  }

  const parts = address.split('.').map((part) => Number(part))
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true
  const first = parts[0]!
  const second = parts[1]!

  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  )
}
