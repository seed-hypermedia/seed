import {hmBlockSchema} from '@/editor/schema'
import {API_FILE_UPLOAD_URL, API_FILE_URL} from '@shm/shared'
import {toast} from '@shm/ui'
import {DOMParser as ProseMirrorDOMParser} from '@tiptap/pm/model'
import rehypeStringify from 'rehype-stringify'
import remarkParse from 'remark-parse'
import remarkRehype from 'remark-rehype'
import {unified} from 'unified'
import {Block, BlockNoteEditor, BlockSchema, nodeToBlock} from '../..'

const fileRegex = /\[([^\]]+)\]\((http:\/\/[^\s]*ipfs[^\s]*) "size=(\d+)"\)/
const videoRegex = /!\[([^\]]+)\]\((http:\/\/[^\s]*ipfs[^\s]*) "width=(\d*)"\)/

const uploadToIpfs = async (file: File): Promise<string> => {
  if (file.size <= 62914560) {
    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch(API_FILE_UPLOAD_URL, {
        method: 'POST',
        body: formData,
      })
      if (!response.ok) {
        throw new Error('Failed to upload to IPFS')
      }
      const data = await response.text()
      return data // The IPFS URL
    } catch (error) {
      console.error('Failed to upload to IPFS:', error)
      throw new Error('Failed to upload to IPFS')
    }
  } else {
    throw new Error('The file size exceeds 60 MB')
  }
}

export const uploadAndReplaceMediaUrls = async (
  markdownContent: string,
  mediaFiles: {name: string; content: string; type: string}[],
) => {
  const mediaRegex = /media\/([^\s)]+)/g
  const mediaMatches = markdownContent.match(mediaRegex)

  if (mediaMatches) {
    for (const mediaFile of mediaMatches) {
      const fileName = mediaFile.replace('media/', '')
      const fileData = mediaFiles.find(
        (file) => file.name.split('.')[0] === fileName,
      )
      if (fileData) {
        const fileContent = Uint8Array.from(atob(fileData.content), (c) =>
          c.charCodeAt(0),
        ) // Decode base64
        const file = new File([fileContent], fileData.name, {
          type: fileData.type,
        }) // Use the file content and name
        // console.log(file)
        try {
          const ipfsCid = await uploadToIpfs(file)
          markdownContent = markdownContent.replace(
            mediaFile,
            `${API_FILE_URL}/${ipfsCid}`,
          )
        } catch (err) {
          toast.error(
            `Error uploading file ${fileName}. Removing this file from the markdown content.`,
          )
          markdownContent = removeMarkdownBlock(markdownContent, mediaFile)
        }
      }
    }
  }

  console.log(markdownContent)

  return markdownContent
}

const removeMarkdownBlock = (markdownContent: string, mediaFile: string) => {
  // Escape special characters in mediaFile
  const escapedMediaFile = mediaFile.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')

  // Define regex patterns for different types of media blocks with 'media/' in the URL
  const imagePattern = new RegExp(
    `!\\[[^\\]]*\\]\\(${escapedMediaFile}(?: ".*")?\\)`,
    'g',
  )
  const videoPattern = new RegExp(
    `!\\[[^\\]]*\\]\\(${escapedMediaFile}.*\\)`,
    'g',
  )

  const filePattern = new RegExp(
    `\\[[^\\]]*\\]\\(${escapedMediaFile} "size=(\\d+)"\\)`,
    'g',
  )

  // Remove the markdown block based on the media file pattern
  markdownContent = markdownContent.replace(imagePattern, '')
  markdownContent = markdownContent.replace(videoPattern, '')
  markdownContent = markdownContent.replace(filePattern, '')

  return markdownContent
}

export const MarkdownToBlocks = async (
  markdown: string,
  editor: BlockNoteEditor,
) => {
  const blocks: Block<BlockSchema>[] = []
  const organizedBlocks: Block<BlockSchema>[] = []
  // const markdownWithMedia = uploadAndReplaceMediaUrls()

  const file = await unified()
    .use(remarkParse)
    .use(remarkRehype)
    .use(rehypeStringify)
    .process(markdown)

  const parser = new DOMParser()
  const doc = parser.parseFromString(file.value.toString(), 'text/html')

  const {view} = editor._tiptapEditor
  const {state} = view
  const {selection} = state

  // Get ProseMirror fragment from pasted markdown, previously converted to HTML
  const fragment = ProseMirrorDOMParser.fromSchema(view.state.schema).parse(
    doc.body,
  )
  fragment.firstChild!.content.forEach((node) => {
    if (node.type.name !== 'blockContainer') {
      return false
    }
    blocks.push(nodeToBlock(node, hmBlockSchema))
  })

  // Function to determine heading level
  const getHeadingLevel = (block: Block<BlockSchema>) => {
    if (block.type.startsWith('heading')) {
      return parseInt(block.props.level, 10)
    }
    return 0
  }

  // Stack to track heading levels for hierarchy
  const stack: {level: number; block: Block<BlockSchema>}[] = []

  blocks.forEach((block) => {
    const headingLevel = getHeadingLevel(block)

    if (headingLevel > 0) {
      while (stack.length && stack[stack.length - 1].level >= headingLevel) {
        stack.pop()
      }

      if (stack.length) {
        stack[stack.length - 1].block.children.push(block)
      } else {
        organizedBlocks.push(block)
      }

      stack.push({level: headingLevel, block})
    } else {
      let blockToInsert = block
      if (block.content.length > 0) {
        const blockContent =
          block.content[0].type === 'link'
            ? block.content[0].content[0].text
            : // @ts-ignore
              block.content[0].text

        if (blockContent.startsWith('!')) {
          console.log(blockContent)
          const videoMatch = blockContent.match(videoRegex)
          console.log(videoMatch)
          if (videoMatch) {
            const videoProps = {
              name: videoMatch[1],
              url: videoMatch[2],
              width: videoMatch[3] || '',
            }
            blockToInsert = {
              id: block.id,
              type: 'video',
              props: videoProps,
              content: [],
              children: [],
            }
          } else {
            console.error('Video match not found:', blockContent)
          }
        } else if (blockContent.startsWith('[')) {
          console.log(blockContent)
          const fileMatch = blockContent.match(fileRegex)
          console.log(fileMatch)
          if (fileMatch) {
            const fileProps = {
              name: fileMatch[1],
              url: fileMatch[2],
              size: fileMatch[3],
            }
            blockToInsert = {
              id: block.id,
              type: 'file',
              props: fileProps,
              content: [],
              children: [],
            }
          } else {
            console.error('File match not found:', blockContent)
          }
        }
      }
      if (stack.length) {
        stack[stack.length - 1].block.children.push(blockToInsert)
      } else {
        organizedBlocks.push(blockToInsert)
      }
    }
  })
  return organizedBlocks
}
