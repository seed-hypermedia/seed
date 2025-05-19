import * as cheerio from 'cheerio'
import {nanoid} from 'nanoid'
import {resolve} from 'path'
import {codePointLength} from './client/unicode'
import {HMAnnotation, HMBlock, HMBlockNode} from './hm-types'

export async function htmlToBlocks(
  html: string,
  htmlPath: string,
  opts: {
    uploadLocalFile?: (path: string) => Promise<string | null>
    resolveHMLink?: (href: string) => Promise<string | null>
  } = {},
): Promise<HMBlockNode[]> {
  const {uploadLocalFile, resolveHMLink} = opts
  const $ = cheerio.load(html)
  const blocks: HMBlockNode[] = []

  function pushBlock(block: HMBlock) {
    blocks.push({block, children: []})
  }

  // Shared function to parse a node into a Paragraph block (text + annotations)
  async function parseParagraphNode(node: any): Promise<HMBlockNode | null> {
    const annotations: HMAnnotation[] = []
    let text = ''
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
        let isBold = active.bold || node.name === 'b' || node.name === 'strong'
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
        if ((node.name === 'b' || node.name === 'strong') && end > start) {
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
    await walk(node, 0, {})
    text = text.trim()
    annotations.sort((a, b) => {
      if (a.starts[0] !== b.starts[0]) return a.starts[0] - b.starts[0]
      if (a.ends[0] !== b.ends[0]) return a.ends[0] - b.ends[0]
      if (a.type !== b.type) return a.type < b.type ? -1 : 1
      return 0
    })
    if (text) {
      return {
        block: {
          id: nanoid(8),
          type: 'Paragraph',
          text,
          revision: nanoid(8),
          link: '',
          attributes: {},
          annotations,
        },
        children: [],
      }
    }
    return null
  }

  const children = $('body').children().toArray()
  for (const el of children) {
    const $el = $(el)

    if ($el.is('p')) {
      const node = await parseParagraphNode(el)
      if (node) pushBlock(node.block)
    } else if ($el.is('figure')) {
      const img = $el.find('img')
      if (img.length) {
        const src = img.attr('src')
        if (src) {
          const absoluteImageUrl = resolve(htmlPath, '..', src)
          const uploadedCID =
            uploadLocalFile && (await uploadLocalFile(absoluteImageUrl))
          if (uploadedCID) {
            pushBlock({
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
          pushBlock({
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
    } else if ($el.is('div.main-image')) {
      // Find the image inside the main-image div
      const img = $el.find('img')
      let imageBlockNode: HMBlockNode | null = null
      if (img.length) {
        const src = img.attr('src')
        if (src) {
          const absoluteImageUrl = resolve(htmlPath, '..', src)
          const uploadedCID =
            uploadLocalFile && (await uploadLocalFile(absoluteImageUrl))
          if (uploadedCID) {
            imageBlockNode = {
              block: {
                id: nanoid(8),
                type: 'Image',
                link: `ipfs://${uploadedCID}`,
                revision: nanoid(8),
                text: '',
                attributes: {},
                annotations: [],
              },
              children: [],
            }
          }
        }
      }
      // Find the caption (span.aft-image-caption > p)
      if (imageBlockNode) {
        const caption = $el.find('span.aft-image-caption p')
        if (caption.length) {
          const node = await parseParagraphNode(caption[0])
          if (node) imageBlockNode.children!.push(node)
        }
        blocks.push(imageBlockNode)
      }
    }
  }

  return blocks
}
