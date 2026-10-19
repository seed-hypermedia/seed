import {DAEMON_FILE_UPLOAD_URL} from '@shm/shared/constants'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import type {WebContents} from 'electron'
import {fetchBrowserImage} from './browser-image'

/** Copies archived images into the same local blob store used by desktop draft attachments. */
export async function localizeBrowserArchiveImages(
  guest: WebContents | undefined,
  blocks: HMBlockNode[],
): Promise<void> {
  let remaining = 20 * 1024 * 1024
  let candidates = 0
  const images = new Map<string, string | null>()
  const visit = async (nodes: HMBlockNode[]) => {
    for (const node of nodes) {
      const block = node.block
      if (block.type === 'Image') {
        const url = block.link || ''
        if (!images.has(url)) {
          let local: string | null = null
          if (guest && ++candidates <= 20 && remaining > 0) {
            const image = await fetchBrowserImage(guest, url, Math.min(5 * 1024 * 1024, remaining))
            if (image) {
              remaining -= image.bytes.byteLength
              try {
                const body = new FormData()
                body.append('file', new Blob([new Uint8Array(image.bytes)], {type: image.type}), 'archived-image')
                const response = await fetch(DAEMON_FILE_UPLOAD_URL, {
                  method: 'POST',
                  body,
                  signal: AbortSignal.timeout(10000),
                })
                if (response.ok) {
                  const cid = await response.text()
                  if (/^[a-zA-Z0-9]+$/.test(cid)) local = `ipfs://${cid}`
                }
              } catch {
                /* Keep the source as a text link when local storage fails. */
              }
            }
          }
          images.set(url, local)
        }
        const local = images.get(url)
        if (local) block.link = local
        else {
          const text = block.text || 'Image from source'
          node.block = {
            id: block.id,
            type: 'Paragraph',
            text,
            attributes: {},
            annotations: /^https?:\/\//.test(url)
              ? [{type: 'Link', link: url, starts: [0], ends: [Array.from(text).length]}]
              : [],
          }
        }
      }
      if (node.children) await visit(node.children)
    }
  }
  await visit(blocks)
}
