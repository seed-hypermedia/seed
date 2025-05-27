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
    let normalizedText = ''

    async function walk(
      node: any,
      offset: number,
      active: {
        bold?: boolean
        italic?: boolean
        underline?: boolean
        strike?: boolean
        code?: boolean
        link?: string
      },
    ) {
      let localOffset = offset
      if (node.type === 'text') {
        const nodeText = node.data || ''
        // Normalize whitespace as we build the text
        const normalizedNodeText = nodeText.replace(/\s+/g, ' ')
        normalizedText += normalizedNodeText
        return codePointLength(normalizedNodeText)
      }
      if (node.type === 'tag') {
        let isBold = active.bold || node.name === 'b' || node.name === 'strong'
        let isItalic = active.italic || node.name === 'em'
        let isUnderline = active.underline || node.name === 'u'
        let isStrike = active.strike || node.name === 's' || node.name === 'del'
        let isCode = active.code || node.name === 'code'
        let linkHref = active.link
        if (node.name === 'a') {
          linkHref = node.attribs['href']
        }
        let start = codePointLength(normalizedText)
        let childOffset = 0
        for (const child of node.children || []) {
          childOffset += await walk(child, localOffset + childOffset, {
            bold: isBold,
            italic: isItalic,
            underline: isUnderline,
            strike: isStrike,
            code: isCode,
            link: linkHref,
          })
        }
        let end = codePointLength(normalizedText)
        if ((node.name === 'b' || node.name === 'strong') && end > start) {
          annotations.push({
            type: 'Bold',
            starts: [start],
            ends: [end],
          })
        }
        if (node.name === 'em' && end > start) {
          annotations.push({
            type: 'Italic',
            starts: [start],
            ends: [end],
          })
        }
        if (node.name === 'u' && end > start) {
          annotations.push({
            type: 'Underline',
            starts: [start],
            ends: [end],
          })
        }
        if ((node.name === 's' || node.name === 'del') && end > start) {
          annotations.push({
            type: 'Strike',
            starts: [start],
            ends: [end],
          })
        }
        if (node.name === 'code' && end > start) {
          annotations.push({
            type: 'Code',
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

    // Calculate how much whitespace we're trimming from the start
    const originalLength = normalizedText.length
    const trimmedText = normalizedText.trim()
    const leadingWhitespaceLength =
      normalizedText.length - normalizedText.trimStart().length

    // Adjust annotation positions to account for trimmed leading whitespace
    const adjustedAnnotations = annotations.map((annotation) => ({
      ...annotation,
      starts: annotation.starts.map((pos) =>
        Math.max(0, pos - leadingWhitespaceLength),
      ),
      ends: annotation.ends.map((pos) =>
        Math.max(0, pos - leadingWhitespaceLength),
      ),
    }))

    adjustedAnnotations.sort((a, b) => {
      if (a.starts[0] !== b.starts[0]) return a.starts[0] - b.starts[0]
      if (a.ends[0] !== b.ends[0]) return a.ends[0] - b.ends[0]
      if (a.type !== b.type) return a.type < b.type ? -1 : 1
      return 0
    })

    normalizedText = trimmedText
    if (normalizedText) {
      return {
        block: {
          id: nanoid(8),
          type: 'Paragraph',
          text: normalizedText,
          revision: nanoid(8),
          link: '',
          attributes: {},
          annotations: adjustedAnnotations,
        },
        children: [],
      }
    }
    return null
  }

  const children = $('body').children().toArray()
  for (const el of children) {
    const $el = $(el)

    // YouTube iframe embed
    if ($el.is('p') && $el.find('iframe').length) {
      const iframe = $el.find('iframe')
      const src = iframe.attr('src')
      if (src && src.startsWith('https://www.youtube.com/embed/')) {
        // Remove query params from src for the block link
        const url = new URL(src)
        const cleanSrc = url.origin + url.pathname
        pushBlock({
          id: nanoid(8),
          type: 'Video',
          link: cleanSrc,
          revision: nanoid(8),
          text: '',
          attributes: {},
          annotations: [],
        })
        continue
      }
    }

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
            let imageBlockNode: HMBlockNode = {
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

            // Check for figcaption
            const figcaption = $el.find('figcaption')
            if (figcaption.length) {
              const captionNode = await parseParagraphNode(figcaption[0])
              if (captionNode?.block.type === 'Paragraph') {
                imageBlockNode = {
                  ...imageBlockNode,
                  block: {
                    ...imageBlockNode.block,
                    text: captionNode.block.text,
                    annotations: captionNode.block.annotations,
                  } as HMBlock,
                }
              }
            }

            blocks.push(imageBlockNode)
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
      if (imageBlockNode?.block?.type === 'Image') {
        const caption = $el.find('span.aft-image-caption p')
        if (caption.length) {
          const node = await parseParagraphNode(caption[0])
          if (node?.block.type === 'Paragraph') {
            imageBlockNode = {
              ...imageBlockNode,
              block: {
                ...imageBlockNode.block,
                text: node.block.text,
                annotations: node.block.annotations,
              },
            }
          }
        }
        blocks.push(imageBlockNode)
      }
    } else if ($el.is('blockquote.instagram-media')) {
      // Instagram embed
      let link = $el.attr('data-instgrm-permalink')
      if (!link) {
        // fallback: try to find the first <a> inside
        const a = $el.find('a[href]').first()
        link = a.attr('href')
      }
      if (link) {
        pushBlock({
          id: nanoid(8),
          type: 'WebEmbed',
          link,
          revision: nanoid(8),
          text: '',
          attributes: {},
          annotations: [],
        })
      }
    } else if ($el.is('blockquote.twitter-tweet')) {
      // Twitter embed
      // Find the last <a> inside the blockquote with an href containing '/status/'
      let link = null
      $el.find('a[href]').each((_, a) => {
        const href = $(a).attr('href')
        if (href && /twitter.com\/[^/]+\/status\//.test(href)) {
          link = href
        }
      })
      if (link) {
        // Remove query params for canonical URL
        try {
          const url = new URL(link)
          link = url.origin + url.pathname
        } catch {}
        pushBlock({
          id: nanoid(8),
          type: 'WebEmbed',
          link,
          revision: nanoid(8),
          text: '',
          attributes: {},
          annotations: [],
        })
      }
    }
  }

  return blocks
}
