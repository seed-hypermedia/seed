import {PartialMessage} from '@bufbuild/protobuf'
import * as cheerio from 'cheerio'
import {nanoid} from 'nanoid'
import {resolve} from 'path'
import {Block} from './client'
import {codePointLength} from './client/unicode'
import {HMAnnotation} from './hm-types'

export async function htmlToBlocks(
  html: string,
  htmlPath: string,
  opts: {
    uploadLocalFile?: (path: string) => Promise<string | null>
    resolveHMLink?: (href: string) => Promise<string | null>
  } = {},
): Promise<PartialMessage<Block>[]> {
  const {uploadLocalFile, resolveHMLink} = opts
  const $ = cheerio.load(html)
  const blocks: PartialMessage<Block>[] = []

  await Promise.all(
    $('body')
      .children()
      .map(async (_, el) => {
        const $el = $(el)

        if ($el.is('p')) {
          // Recursively walk the DOM to build text and annotations
          const annotations: HMAnnotation[] = []
          let text = ''

          // Helper to walk nodes
          async function walk(
            node: any,
            offset: number,
            active: {bold?: boolean; link?: string},
          ) {
            let localOffset = offset
            if (node.type === 'text') {
              const nodeText = node.data || ''
              text += nodeText
              return codePointLength(nodeText)
            }
            if (node.type === 'tag') {
              let isBold =
                active.bold || node.name === 'b' || node.name === 'strong'
              let linkHref = active.link
              if (node.name === 'a') {
                linkHref = node.attribs['href']
              }
              let start = codePointLength(text)
              let childOffset = 0
              for (const child of node.children || []) {
                childOffset += await walk(child, localOffset + childOffset, {
                  bold: isBold,
                  link: linkHref,
                })
              }
              let end = codePointLength(text)
              if (
                (node.name === 'b' || node.name === 'strong') &&
                end > start
              ) {
                annotations.push({
                  type: 'Bold',
                  starts: [start],
                  ends: [end],
                })
              }
              if (node.name === 'a' && end > start && linkHref) {
                let resolvedLink = linkHref
                if (resolveHMLink) {
                  resolvedLink = (await resolveHMLink(linkHref)) || linkHref
                }
                annotations.push({
                  type: 'Link',
                  starts: [start],
                  ends: [end],
                  link: resolvedLink,
                })
              }
              return end - start
            }
            return 0
          }

          await walk(el, 0, {})
          text = text.trim()
          annotations.sort((a, b) => {
            if (a.starts[0] !== b.starts[0]) return a.starts[0] - b.starts[0]
            if (a.ends[0] !== b.ends[0]) return a.ends[0] - b.ends[0]
            if (a.type !== b.type) return a.type < b.type ? -1 : 1
            return 0
          })
          if (text) {
            blocks.push({
              id: nanoid(8),
              type: 'Paragraph',
              text,
              revision: nanoid(8),
              link: '',
              attributes: {},
              annotations,
            })
          }
        } else if ($el.is('figure')) {
          const img = $el.find('img')
          if (img.length) {
            const src = img.attr('src')
            if (src) {
              const absoluteImageUrl = resolve(htmlPath, '..', src)
              const uploadedCID =
                uploadLocalFile && (await uploadLocalFile(absoluteImageUrl))
              if (uploadedCID) {
                blocks.push({
                  id: nanoid(8),
                  type: 'Image',
                  link: `ipfs://${uploadedCID}`,
                  revision: nanoid(8),
                  text: '',
                  attributes: {},
                  annotations: [],
                })
              }
            }
          }
        } else if ($el.is('img')) {
          const src = $el.attr('src')
          if (src) {
            const absoluteImageUrl = resolve(htmlPath, '..', src)
            const uploadedCID =
              uploadLocalFile && (await uploadLocalFile(absoluteImageUrl))
            if (uploadedCID) {
              blocks.push({
                id: nanoid(8),
                type: 'Image',
                link: `ipfs://${uploadedCID}`,
                revision: nanoid(8),
                text: '',
                attributes: {},
                annotations: [],
              })
            }
          }
        }
      }),
  )

  return blocks
}
