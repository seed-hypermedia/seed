/** Bounded, exact-URL media checks for agent document publication (not full-file integrity checks). */
import * as dns from 'node:dns/promises'
import * as http from 'node:http'
import * as https from 'node:https'
import * as net from 'node:net'
import {CID} from 'multiformats/cid'
import type {HMBlockNode, HMMetadata} from '@seed-hypermedia/client/hm-types'

export type PublicationAsset = {url: string; kind: 'Image' | 'Video' | 'File'}
export type AssetProbe = {status: number; contentType: string; sample: Uint8Array}
export type AssetCheck = PublicationAsset & {status: 'checked' | 'pending-publication'; bytes?: number}
const MAX_ASSETS = 64
const SAMPLE_BYTES = 1024
const CONCURRENCY = 4
// node:http forwards these socket options; its RequestOptions type omits them.
const FAMILY_OPTIONS: Pick<net.TcpNetConnectOpts, 'autoSelectFamily' | 'autoSelectFamilyAttemptTimeout'> = {
  autoSelectFamily: true,
  autoSelectFamilyAttemptTimeout: 250,
}
const PRIVATE_V4 = new net.BlockList()
for (const [ip, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
] as const)
  PRIVATE_V4.addSubnet(ip, prefix)
const GLOBAL_V6 = new net.BlockList()
GLOBAL_V6.addSubnet('2000::', 3, 'ipv6')
const PRIVATE_V6 = new net.BlockList()
PRIVATE_V6.addSubnet('2001::', 23, 'ipv6') // transition / special-purpose ranges
PRIVATE_V6.addSubnet('2001:db8::', 32, 'ipv6')
PRIVATE_V6.addSubnet('2002::', 16, 'ipv6') // 6to4 can tunnel private IPv4
PRIVATE_V6.addSubnet('3fff::', 20, 'ipv6') // documentation

export function isPublicAssetAddress(address: string): boolean {
  const family = net.isIP(address)
  if (family === 4) return !PRIVATE_V4.check(address)
  return family === 6 && GLOBAL_V6.check(address, 'ipv6') && !PRIVATE_V6.check(address, 'ipv6')
}

export function collectPublicationAssets(nodes: HMBlockNode[], metadata: HMMetadata = {}): PublicationAsset[] {
  const assets = new Map<string, PublicationAsset>()
  const add = (url: unknown, kind: PublicationAsset['kind']) => {
    if (typeof url !== 'string' || !url) return
    // Keep different uses of one URL: a downloadable text file is not a valid image.
    assets.set(`${kind}:${url}`, {url, kind})
    if (new Set([...assets.values()].map((a) => a.url)).size > MAX_ASSETS)
      throw new Error(`Publication asset check supports at most ${MAX_ASSETS} distinct URLs; split the document.`)
  }
  const visit = (list: HMBlockNode[]) => {
    for (const node of list) {
      const block = node.block
      if (block && (block.type === 'Image' || block.type === 'Video' || block.type === 'File')) {
        if (!block.link?.trim()) throw new Error(`${block.type} block has no asset URL`)
        add(block.link, block.type)
      }
      if (node.children?.length) visit(node.children)
    }
  }
  visit(nodes)
  add(metadata.icon, 'Image')
  add(metadata.cover, 'Image')
  return [...assets.values()]
}

function publicHttpUrl(raw: string): URL {
  if (raw.length > 4096) throw new Error('Asset URL is too long')
  const url = new URL(raw)
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.port)
    throw new Error('Assets require public HTTP(S) URLs on standard ports without credentials')
  return url
}

/** GET the literal URL, pin validated DNS to the connection, and revalidate every redirect. */
export async function probePublicAsset(raw: string, signal: AbortSignal): Promise<AssetProbe> {
  let next = raw
  for (let hop = 0; hop <= 3; hop++) {
    signal.throwIfAborted()
    const url = publicHttpUrl(next)
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    const addresses = net.isIP(hostname)
      ? [{address: hostname, family: net.isIP(hostname)}]
      : await withAbort(dns.lookup(hostname, {all: true}), signal)
    signal.throwIfAborted()
    if (!addresses.length || addresses.some((a) => !isPublicAssetAddress(a.address)))
      throw new Error('Asset destination is not public')
    const pinned = addresses[0]!
    const response = await new Promise<AssetProbe & {location?: string}>((resolve, reject) => {
      // No ambient proxy, cookies, authorization, or connection pool. The TLS hostname stays the
      // original host while lookup always returns the checked address (including on reconnect).
      const request = (url.protocol === 'https:' ? https : http).get(
        url,
        {
          signal,
          agent: false,
          ...FAMILY_OPTIONS,
          lookup: (_host, options, callback) => {
            if (options.all) callback(null, addresses)
            else callback(null, pinned.address, pinned.family)
          },
          headers: {Range: `bytes=0-${SAMPLE_BYTES - 1}`, 'Accept-Encoding': 'identity'},
        },
        (response) => {
          const status = response.statusCode || 0
          const contentType = String(response.headers['content-type'] || '')
            .split(';')[0]!
            .trim()
            .toLowerCase()
          const location = response.headers.location
          if (status !== 200 && status !== 206) {
            response.destroy()
            resolve({status, contentType, sample: new Uint8Array(), location})
            return
          }
          const chunks: Buffer[] = []
          let size = 0
          let settled = false
          const finish = () => {
            if (settled) return
            settled = true
            resolve({status, contentType, sample: Buffer.concat(chunks, size)})
            response.destroy()
          }
          response.on('data', (chunk: Buffer) => {
            const part = chunk.subarray(0, SAMPLE_BYTES - size)
            chunks.push(part)
            size += part.length
            if (size >= SAMPLE_BYTES) finish()
          })
          response.on('end', finish)
          response.on('error', reject)
          response.on('aborted', () => {
            if (!settled) reject(new Error('Asset response aborted'))
          })
        },
      )
      request.on('error', reject)
    })
    if ([301, 302, 303, 307, 308].includes(response.status) && response.location) {
      next = new URL(response.location, url).href
      continue
    }
    return response
  }
  throw new Error('Too many asset redirects')
}

/** Only for CID-derived paths on the operator-configured HM gateway, which may be local. */
async function probeGatewayAsset(url: string, signal: AbortSignal): Promise<AssetProbe> {
  const response = await fetch(url, {
    headers: {Range: `bytes=0-${SAMPLE_BYTES - 1}`, 'Accept-Encoding': 'identity'},
    redirect: 'error',
    signal,
  })
  const contentType = (response.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase()
  const reader = response.body?.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    if (reader && (response.status === 200 || response.status === 206)) {
      while (size < SAMPLE_BYTES) {
        const {done, value} = await reader.read()
        if (done) break
        const chunk = value.subarray(0, SAMPLE_BYTES - size)
        chunks.push(chunk)
        size += chunk.length
      }
    }
    return {status: response.status, contentType, sample: Buffer.concat(chunks, size)}
  } finally {
    await reader?.cancel()
  }
}

async function withAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted()
  let listener: () => void
  const abort = new Promise<never>((_, reject) => {
    listener = () => reject(signal.reason)
    signal.addEventListener('abort', listener, {once: true})
  })
  try {
    return await Promise.race([promise, abort])
  } finally {
    signal.removeEventListener('abort', listener!)
  }
}

function isSvgPrefix(text: string): boolean {
  // Inspect only the bounded sample; never parse/fetch a DTD or external entity.
  let prefix = text.trimStart()
  const prolog = /^(?:<\?xml[\s\S]*?\?>|<!--[\s\S]*?-->|<!DOCTYPE\s+svg(?:[^>\[]|\[[\s\S]*?\])*>)/i
  for (;;) {
    const match = prolog.exec(prefix)
    if (!match) return /^<svg[\s>]/i.test(prefix)
    prefix = prefix.slice(match[0].length).trimStart()
  }
}

function mediaKind(sample: Uint8Array): 'image' | 'video' | undefined {
  const b = Buffer.from(sample)
  const text = b.toString('utf8')
  const ascii = b.toString('latin1')
  if (
    b.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) ||
    (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) ||
    /^GIF8[79]a/.test(ascii) ||
    (ascii.startsWith('RIFF') && ascii.slice(8, 12) === 'WEBP') ||
    ascii.startsWith('BM') ||
    b.subarray(0, 4).equals(Buffer.from([0, 0, 1, 0])) ||
    isSvgPrefix(text)
  )
    return 'image'
  if (ascii.slice(4, 8) === 'ftyp') return /avif|avis|heic|heix|mif1/.test(ascii.slice(8, 32)) ? 'image' : 'video'
  if (b.subarray(0, 4).equals(Buffer.from('1a45dfa3', 'hex')) || ascii.startsWith('OggS')) return 'video'
  return undefined
}

export async function checkPublicationAssets(
  assets: PublicationAsset[],
  options: {
    gateway: string
    deferIpfs?: boolean
    probe?: typeof probePublicAsset
    timeoutMs?: number
  },
): Promise<AssetCheck[]> {
  const urls = [...new Set(assets.map((a) => a.url))]
  if (urls.length > MAX_ASSETS) throw new Error(`Publication asset check supports at most ${MAX_ASSETS} URLs`)
  if (!urls.length) return []
  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(new Error('Asset verification deadline exceeded')),
    options.timeoutMs ?? 20000,
  )
  const results = new Map<string, AssetProbe | 'pending'>()
  let index = 0
  try {
    await Promise.all(
      Array.from({length: Math.min(CONCURRENCY, urls.length)}, async () => {
        for (;;) {
          const url = urls[index++]
          if (url === undefined) return
          controller.signal.throwIfAborted()
          let endpoint = url
          if (url.startsWith('ipfs://')) {
            const cid = url.slice(7)
            CID.parse(cid) // file links must name a complete CID, not arbitrary gateway paths
            if (options.deferIpfs) {
              results.set(url, 'pending')
              continue
            }
            endpoint = `${options.gateway.replace(/\/$/, '')}/ipfs/${cid}`
          }
          try {
            const probe = await (options.probe ?? (url.startsWith('ipfs://') ? probeGatewayAsset : probePublicAsset))(
              endpoint,
              controller.signal,
            )
            if (probe.status !== 200 && probe.status !== 206) throw new Error(`HTTP ${probe.status}`)
            if (!probe.sample.length) throw new Error('Empty asset response')
            for (const asset of assets.filter((a) => a.url === url)) {
              if (
                asset.kind === 'Image' &&
                (!probe.contentType.startsWith('image/') || mediaKind(probe.sample) !== 'image')
              )
                throw new Error('Expected image content type and recognized image signature')
              if (
                asset.kind === 'Video' &&
                (!probe.contentType.startsWith('video/') || mediaKind(probe.sample) !== 'video')
              )
                throw new Error('Expected video content type and recognized video signature')
            }
            results.set(url, probe)
          } catch (error) {
            throw new Error(
              `Cannot verify publication asset ${url}: ${error instanceof Error ? error.message : String(error)}`,
            )
          }
        }
      }),
    )
    return assets.map((asset) => {
      const result = results.get(asset.url)!
      return {
        ...asset,
        status: result === 'pending' ? 'pending-publication' : 'checked',
        ...(result === 'pending' ? {} : {bytes: result.sample.length}),
      }
    })
  } finally {
    controller.abort()
    clearTimeout(timer)
  }
}
