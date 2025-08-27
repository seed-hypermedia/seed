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

  // Helper function to get heading level from tag name
  function getHeadingLevel(tagName: string): number | null {
    const match = tagName.match(/^h([1-6])$/)
    // @ts-ignore
    return match ? parseInt(match[1], 10) : null
  }

  // Helper function to check if a paragraph should be treated as a heading
  function shouldTreatAsHeading(
    el: any,
    context?: {hasNewlinesBefore?: boolean},
  ): boolean {
    // Check if the paragraph contains only em/strong/b tags and/or whitespace
    if (!el.children) return false

    let hasOnlyFormattingAndWhitespace = true
    let hasFormattingTag = false
    let hasWhitespaceOutsideFormatting = false
    let formattingTagCount = 0

    for (const child of el.children) {
      if (child.type === 'text') {
        if (child.data && child.data.trim() !== '') {
          // Found non-whitespace text outside formatting tags
          hasOnlyFormattingAndWhitespace = false
          break
        } else if (child.data && child.data.length > 0) {
          // Found whitespace
          hasWhitespaceOutsideFormatting = true
        }
      } else if (child.type === 'tag') {
        if (
          child.name === 'em' ||
          child.name === 'strong' ||
          child.name === 'b'
        ) {
          hasFormattingTag = true
          formattingTagCount++
        } else {
          hasOnlyFormattingAndWhitespace = false
          break
        }
      }
    }

    // Convert to heading if:
    // 1. Has formatting AND whitespace outside the formatting tags, OR
    // 2. Has exactly one formatting tag with no other content AND appears to be isolated (has newlines before/after)
    return (
      hasOnlyFormattingAndWhitespace &&
      hasFormattingTag &&
      (hasWhitespaceOutsideFormatting ||
        (formattingTagCount === 1 && context?.hasNewlinesBefore === true))
    )
  }

  // Helper function to create a heading block
  async function createHeadingBlock(el: any): Promise<HMBlockNode | null> {
    const node = await parseParagraphNode(el)
    if (node?.block.type === 'Paragraph') {
      return {
        block: {
          ...node.block,
          type: 'Heading',
          // Remove annotations since we're converting formatting to heading
          annotations: [],
        },
        children: [],
      }
    }
    return null
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
      // @ts-ignore
      if (a.starts[0] !== b.starts[0]) return a.starts[0] - b.starts[0]
      // @ts-ignore
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

  // First pass: process all elements and collect them
  const children = $('body').children().toArray()
  const processedElements: Array<{
    type: 'heading' | 'content'
    level?: number
    blockNode?: HMBlockNode
  }> = []

  for (let i = 0; i < children.length; i++) {
    const el = children[i]
    const $el = $(el)

    // Check if there are newlines before this element by looking at the original HTML
    // @ts-ignore
    const hasNewlinesBefore = i > 0 && html.includes('\n\n<' + el.name)

    // Check if it's a heading
    // @ts-ignore
    const headingLevel = getHeadingLevel(el.name)
    if (headingLevel) {
      const headingBlock = await createHeadingBlock(el)
      if (headingBlock) {
        processedElements.push({
          type: 'heading',
          level: headingLevel,
          blockNode: headingBlock,
        })
      }
      continue
    }

    // YouTube iframe embed
    if ($el.is('p') && $el.find('iframe').length) {
      const iframe = $el.find('iframe')
      const src = iframe.attr('src')
      if (src && src.startsWith('https://www.youtube.com/embed/')) {
        // Remove query params from src for the block link
        const url = new URL(src)
        const cleanSrc = url.origin + url.pathname
        processedElements.push({
          type: 'content',
          blockNode: {
            block: {
              id: nanoid(8),
              type: 'Video',
              link: cleanSrc,
              revision: nanoid(8),
              text: '',
              attributes: {},
              annotations: [],
            },
            children: [],
          },
        })
        continue
      }
    }

    if ($el.is('p')) {
      // Check if this paragraph should be treated as a heading
      if (shouldTreatAsHeading(el, {hasNewlinesBefore})) {
        const headingBlock = await createHeadingBlock(el)
        if (headingBlock) {
          processedElements.push({
            type: 'heading',
            level: 4, // Default to h4 level for formatted paragraphs to be children of h3
            blockNode: headingBlock,
          })
        }
      } else {
        const node = await parseParagraphNode(el)
        if (node) {
          processedElements.push({
            type: 'content',
            blockNode: node,
          })
        }
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

            processedElements.push({
              type: 'content',
              blockNode: imageBlockNode,
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
          processedElements.push({
            type: 'content',
            blockNode: {
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
            },
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
        processedElements.push({
          type: 'content',
          blockNode: imageBlockNode,
        })
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
        processedElements.push({
          type: 'content',
          blockNode: {
            block: {
              id: nanoid(8),
              type: 'WebEmbed',
              link,
              revision: nanoid(8),
              text: '',
              attributes: {},
              annotations: [],
            },
            children: [],
          },
        })
      }
    } else if ($el.is('blockquote.twitter-tweet')) {
      // Twitter embed
      // Find the last <a> inside the blockquote with an href containing '/status/'
      let link = null
      $el.find('a[href]').each((_, a) => {
        const href = $(a).attr('href')
        if (
          href &&
          (/twitter.com\/[^/]+\/status\//.test(href) ||
            /x.com\/[^/]+\/status\//.test(href))
        ) {
          link = href
        }
      })
      if (link) {
        // Remove query params for canonical URL
        try {
          const url = new URL(link)
          link = url.origin + url.pathname
        } catch {}
        processedElements.push({
          type: 'content',
          blockNode: {
            block: {
              id: nanoid(8),
              type: 'WebEmbed',
              link,
              revision: nanoid(8),
              text: '',
              attributes: {},
              annotations: [],
            },
            children: [],
          },
        })
      }
    }
  }

  // Second pass: build hierarchy
  if (processedElements.length === 0) {
    return blocks
  }

  // Keep track of the heading stack to build proper hierarchy
  const headingStack: Array<{level: number; blockNode: HMBlockNode}> = []

  for (const element of processedElements) {
    if (element.type === 'heading' && element.level && element.blockNode) {
      // Remove any headings from stack that are at same level or deeper
      while (
        headingStack.length > 0 &&
        // @ts-ignore
        headingStack[headingStack.length - 1].level >= element.level
      ) {
        headingStack.pop()
      }

      // Add this heading to the appropriate parent
      if (headingStack.length === 0) {
        // Top level heading
        blocks.push(element.blockNode)
      } else {
        // Child heading
        // @ts-ignore
        const parent = headingStack[headingStack.length - 1].blockNode
        if (!parent.children) parent.children = []
        parent.children.push(element.blockNode)
      }

      // Add to stack
      headingStack.push({level: element.level, blockNode: element.blockNode})
    } else if (element.type === 'content' && element.blockNode) {
      // Add content to the most recent heading, or to root if no headings
      if (headingStack.length === 0) {
        blocks.push(element.blockNode)
      } else {
        // @ts-ignore
        const parent = headingStack[headingStack.length - 1].blockNode
        if (!parent.children) parent.children = []
        parent.children.push(element.blockNode)
      }
    }
  }

  return blocks
}
