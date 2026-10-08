import type {WebContents} from 'electron'

/** Reads an image incrementally, cancelling rejected or oversized response bodies. */
export async function readBrowserImageResponse(
  response: Response,
  limit: number,
): Promise<{type: string; bytes: Uint8Array} | null> {
  const type = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase() || ''
  if (!response.ok || !type.startsWith('image/') || Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel()
    return null
  }
  const reader = response.body?.getReader()
  if (!reader) return null
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const {done, value} = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        await reader.cancel()
        return null
      }
      chunks.push(value)
    }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) {
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    return {type, bytes}
  } finally {
    reader.releaseLock()
  }
}

/** Fetches bounded image bytes using only the guest's website session. */
export async function fetchBrowserImage(guest: WebContents, url: string, limit: number) {
  if (!/^https?:\/\//i.test(url)) return null
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const response = await guest.session.fetch(url, {
      credentials: 'include',
      referrer: guest.getURL(),
      signal: controller.signal,
    })
    return await readBrowserImageResponse(response, limit)
  } catch {
    return null
  } finally {
    controller.abort()
    clearTimeout(timer)
  }
}
