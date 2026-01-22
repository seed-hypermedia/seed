import {hmBlockSchema} from '../../../../full-schema'
import {DAEMON_FILE_UPLOAD_URL} from '@shm/shared/constants'
import {DOMParser as ProseMirrorDOMParser} from '@tiptap/pm/model'
import rehypeStringify from 'rehype-stringify'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import {unified} from 'unified'
import {
  Block,
  BlockNoteEditor,
  BlockSchema,
  BNLink,
  nodeToBlock,
  StyledText,
  Styles,
} from '../..'
import {remarkCodeClass} from './RemarkCodeClass'
import {remarkImageWidth} from './RemarkImageWidth'

const fileRegex = /\[([^\]]+)\]\(([^)]*) "size=(\d+)"\)/
const videoRegex = /!\[([^\]]*)\]\(([^\s]+)\s"width=([\w]+)"\)/
const mathRegex = /\$\$(.*?)\$\$/
const tweetRegex = /\[\[tweet\(([^)]+)\)\]\]/

const uploadToIpfs = async (file: File): Promise<string> => {
  if (file.size <= 62914560) {
    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch(DAEMON_FILE_UPLOAD_URL, {
        method: 'POST',
        body: formData,
      })
      if (!response.ok) {
        throw new Error('Failed to upload to IPFS')
      }
      const data = await response.text()
      return data
    } catch (error) {
      console.error('Failed to upload to IPFS:', error)
      throw new Error('Failed to upload to IPFS')
    }
  } else {
    throw new Error('The file size exceeds 60 MB')
  }
}

const isWebUrl = (url: string | undefined) => {
  if (!url) return false

  // Remove backslashes from the URL if present
  const cleanedUrl = url.replace(/\\/g, '')

  try {
    new URL(cleanedUrl)
    return true
  } catch (_) {
    return false
  }
}

const readMediaFile = async (filePath: string) => {
  try {
    // @ts-ignore
    const response = await window.docImport.readMediaFile(filePath)
    return response
  } catch (error) {
    console.error('Error reading media file:', error)
    return
  }
}

const parseImageCaptionStyles = (content: string): (StyledText | BNLink)[] => {
  const parser = new DOMParser()
  const doc = parser.parseFromString(content, 'text/html')
  const styledContent: (StyledText | BNLink)[] = []

  function parseNode(node: Node): StyledText | BNLink | null {
    if (node.nodeType === Node.TEXT_NODE) {
      return {
        type: 'text',
        text: node.textContent || '',
        styles: {},
      } as StyledText
    }

    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as HTMLElement
      const styles: Styles = {}

      // Set styles based on tags
      if (element.tagName === 'B' || element.style.fontWeight === 'bold')
        styles.bold = true
      if (element.tagName === 'I' || element.style.fontStyle === 'italic')
        styles.italic = true
      if (
        element.tagName === 'U' ||
        element.style.textDecoration === 'underline'
      )
        styles.underline = true
      if (
        element.tagName === 'S' ||
        element.style.textDecoration === 'line-through'
      )
        styles.strike = true
      if (element.tagName === 'CODE') styles.code = true

      if (element.tagName === 'A' && element.hasAttribute('href')) {
        const href = element.getAttribute('href')!
        const linkContent = Array.from(element.childNodes)
          .map(parseNode)
          .filter((node) => node !== null) as StyledText[]

        return {
          type: 'link',
          href,
          content: linkContent,
        } as BNLink
      } else {
        const styledText: StyledText = {
          type: 'text',
          text: element.textContent || '',
          styles,
        }
        return styledText
      }
    }

    return null
  }

  Array.from(doc.body.childNodes).forEach((node) => {
    const parsedNode = parseNode(node)
    if (parsedNode) styledContent.push(parsedNode)
  })

  return styledContent
}

export const processMediaMarkdown = async (
  markdownContent: string,
  directoryPath: string,
) => {
  const filePattern = /\[([^\]]+)\]\\\(([^\s]+\.[^\s]+) "size=(\d+)"\)/g
  const videoPattern = /!\\\[([^\]]*)\]\\\(([^\s]+) "width=(\d*|undefined)"\)/g
  const imagePattern = /!\[([^\]]*)\]\(([^\s]+\.[^\s]+)(?: "([^"]*)")?\)/g

  const mediaMatches = []
  const mediaRegex = new RegExp(
    `${filePattern.source}|${videoPattern.source}|${imagePattern.source}`,
    'g',
  )
  let match
  while ((match = mediaRegex.exec(markdownContent)) !== null) {
    mediaMatches.push(match)
  }

  for (const match of mediaMatches) {
    let url
    if (match[2]) {
      // File pattern
      url = match[2]
    } else if (match[5]) {
      // Video pattern
      url = match[5]
    } else if (match[8]) {
      // Image pattern
      url = match[8]
    }
    if (url && !isWebUrl(url)) {
      try {
        const filePath = directoryPath + '/' + url
        const fileResponse = await readMediaFile(filePath)
        const fileContent = Uint8Array.from(atob(fileResponse.content), (c) =>
          c.charCodeAt(0),
        )
        const file = new File([fileContent], fileResponse.fileName, {
          type: fileResponse.mimeType,
        })
        const ipfsUrl = await uploadToIpfs(file)
        markdownContent = markdownContent.replace(url, `ipfs://${ipfsUrl}`)
      } catch (error) {
        console.error(`Error processing file ${url}:`, error)
        markdownContent = markdownContent.replace(url, 'null')
      }
    }
  }

  return markdownContent
}

export const processLinkMarkdown = (
  markdownContent: string,
  docMap: Map<string, {name: string; path: string}>,
): string => {
  // Regex to match markdown links
  const linkPattern = /\[([^\]]+)\]\((\.\/[^\s)]+|[^\s)]+)\)/g

  // Replace links based on mappings in docMap
  return markdownContent.replace(linkPattern, (match, linkText, url) => {
    // Check if the URL matches any key in docMap
    if (docMap.has(url)) {
      const {path} = docMap.get(url)!
      return `[${linkText}](${path})` // Replace the link's URL with the 'path' from docMap
    }
    return match // If no mapping found, return the original match
  })
}

function unwrapImagesFromParagraphs(doc: Document) {
  // Select all paragraphs that contain an image
  const paragraphsWithImages = doc.querySelectorAll('p > img')

  paragraphsWithImages.forEach((img) => {
    const parentParagraph: Element | null = img.parentNode as Element

    if (parentParagraph && parentParagraph.parentNode) {
      // Insert the image before the paragraph
      parentParagraph.parentNode.insertBefore(img, parentParagraph)

      // If the paragraph is empty after removing the image, remove the paragraph
      if (parentParagraph.innerHTML.trim() === '') {
        parentParagraph.parentNode.removeChild(parentParagraph)
      }
    }
  })

  return doc
}

export const MarkdownToBlocks = async (
  markdown: string,
  editor: BlockNoteEditor,
) => {
  const blocks: Block<BlockSchema>[] = []
  const organizedBlocks: Block<BlockSchema>[] = []

  const file = await unified()
    .use(remarkParse)
    .use(remarkCodeClass)
    .use(remarkImageWidth)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(markdown)

  const parser = new DOMParser()
  let doc = parser.parseFromString(file.value.toString(), 'text/html')

  const {view} = editor._tiptapEditor
  const {state} = view

  doc = unwrapImagesFromParagraphs(doc)

  // Get ProseMirror fragment from parsed HTML
  const fragment = ProseMirrorDOMParser.fromSchema(state.schema).parse(doc.body)

  // @ts-ignore
  fragment.firstChild!.content.forEach((node) => {
    if (node.type.name !== 'blockContainer') {
      return false
    }

    blocks.push(nodeToBlock(node, hmBlockSchema))
  })

  // Function to determine heading level
  const getHeadingLevel = (block: Block<BlockSchema>) => {
    if (block.type.startsWith('heading')) {
      // @ts-ignore
      return parseInt(block.props.level, 10)
    }
    return 0
  }

  // Stack to track heading levels for hierarchy
  const stack: {level: number; block: Block<BlockSchema>}[] = []

  blocks.forEach((block) => {
    const headingLevel = getHeadingLevel(block)

    if (headingLevel > 0) {
      // @ts-ignore
      while (stack.length && stack[stack.length - 1].level >= headingLevel) {
        stack.pop()
      }

      if (stack.length) {
        // @ts-ignore
        stack[stack.length - 1].block.children.push(block)
      } else {
        organizedBlocks.push(block)
      }

      stack.push({level: headingLevel, block})
    } else {
      let blockToInsert = block

      // Convert code blocks with mermaid language to mermaid blocks
      if (block.type === 'code-block' && block.props.language === 'mermaid') {
        // @ts-ignore
        const codeContent = block.content[0]?.text || ''
        blockToInsert = {
          id: block.id,
          type: 'mermaid',
          content: [
            {
              type: 'text',
              text: codeContent,
              styles: {},
            },
          ],
          children: [],
          props: {},
        }
      } else if (block.type === 'image') {
        if (block.props.src == 'null') blockToInsert.props = {}
        else if (block.props.alt) {
          const contentArray = parseImageCaptionStyles(block.props.alt)
          block.content = contentArray
        }
      }
      if (block.content.length > 0) {
        const blockContent =
          // @ts-ignore
          block.content[0].type === 'link'
            ? // @ts-ignore
              block.content[0].content[0].text
            : // @ts-ignore
              block.content[0].text

        if (blockContent.startsWith('!')) {
          const videoMatch = blockContent.match(videoRegex)
          if (videoMatch) {
            let videoProps = {}
            if (
              videoMatch[2].startsWith('ipfs://') ||
              videoMatch[2].includes('youtube') ||
              videoMatch[2].includes('youtu.be') ||
              videoMatch[2].includes('vimeo')
            ) {
              videoProps = {
                name: videoMatch[1],
                url: videoMatch[2],
                width:
                  videoMatch[3] && videoMatch[3] !== 'undefined'
                    ? videoMatch[3]
                    : '',
              }
            }
            blockToInsert = {
              id: block.id,
              type: 'video',
              props: videoProps,
              content: [],
              children: [],
            }
          }
        } else if (tweetRegex.test(blockContent)) {
          const tweetMatch = blockContent.match(tweetRegex)
          if (tweetMatch) {
            blockToInsert = {
              id: block.id,
              type: 'web-embed',
              props: {
                url: tweetMatch[1],
              },
              content: [],
              children: [],
            }
          }
        } else if (blockContent.startsWith('[')) {
          const fileMatch = blockContent.match(fileRegex)
          if (fileMatch) {
            let fileProps = {}
            if (fileMatch[2].startsWith('ipfs://')) {
              fileProps = {
                name: fileMatch[1],
                url: fileMatch[2],
                size: fileMatch[3],
              }
            }
            blockToInsert = {
              id: block.id,
              type: 'file',
              props: fileProps,
              content: [],
              children: [],
            }
          }
        } else if (mathRegex.test(blockContent)) {
          const mathMatch = blockContent.match(mathRegex)
          if (mathMatch) {
            const mathContent = mathMatch[1]
            blockToInsert = {
              id: block.id,
              type: 'math',
              content: [
                {
                  text: mathContent,
                  type: 'text',
                  styles: {},
                },
              ],
              children: [],
              props: {
                childrenType: 'Group',
              },
            }
          }
        }
      }
      if (stack.length) {
        // @ts-ignore
        stack[stack.length - 1].block.children.push(blockToInsert)
      } else {
        organizedBlocks.push(blockToInsert)
      }
    }
  })
  return organizedBlocks
}
