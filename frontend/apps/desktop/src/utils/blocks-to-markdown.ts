import {EditorBlock} from '@shm/shared/editor-types'
import {HMDocument} from '@shm/shared/hm-types'
import rehypeParse from 'rehype-parse'
import rehypeRemark from 'rehype-remark'
import remarkGfm from 'remark-gfm'
import remarkStringify from 'remark-stringify'
import {unified} from 'unified'

function applyStyles(text: string, styles: any) {
  if (styles.bold) text = `<b>${text}</b>`
  if (styles.italic) text = `<i>${text}</i>`
  if (styles.strike) text = `<del>${text}</del>`
  if (styles.underline) text = `<u>${text}</u>`
  if (styles.code) text = `<code>${text}</code>`
  // if (styles.math) text = `$${text}$$`
  return text
}

function convertContentItemToHtml(contentItem: any) {
  let text = contentItem.text || ''
  const {styles = {}} = contentItem

  text = applyStyles(text, styles)

  if (contentItem.type === 'link') {
    const linkText = applyStyles(
      contentItem.content[0].text,
      contentItem.content[0].styles || {},
    )
    return `<a href="${contentItem.href}">${linkText}</a>`
  } else {
    return text
  }
}

function convertBlockToHtml(block: any, isListItem = false) {
  let childrenHtml = ''
  if (block.children) {
    const childrenContent = block.children
      .map((child: any) =>
        convertBlockToHtml(
          child,
          block.props.childrenType === 'Unordered' ||
            block.props.childrenType === 'Ordered' ||
            block.props.childrenType === 'Blockquote',
        ),
      )
      .join('\n')
    if (block.props.childrenType === 'Unordered') {
      childrenHtml = `<ul>${childrenContent}</ul>`
    } else if (block.props.childrenType === 'Ordered') {
      // childrenHtml = `<ol start="${
      //   block.props.start || 1
      // }">${childrenContent}</ol>`
      childrenHtml = `<ol>${childrenContent}</ol>`
    } else if (block.props.childrenType === 'Blockquote') {
      childrenHtml = `<blockquote>${childrenContent}</blockquote>`
    } else {
      childrenHtml = childrenContent
    }
  }

  const contentHtml = block.content
    ? block.content.map(convertContentItemToHtml).join('')
    : ''

  const blockHtml = (() => {
    switch (block.type) {
      case 'heading':
        return `<h${block.props.level}>${contentHtml}</h${block.props.level}>`
      case 'paragraph':
        return `<p>${contentHtml}</p>`
      case 'image':
        const {url, name, width} = block.props
        const titleWithWidth = `${name} | width=${width}`
        return `<img src="${url}" alt=\"${contentHtml}\" title="${titleWithWidth}">`
      case 'code-block':
        return `<pre><code class="language-${
          block.props.language || 'plaintext'
        }">${contentHtml}</code></pre>`
      case 'video':
        return `<p>![${block.props.name}](${block.props.url} "width=${block.props.width}")</p>`
      case 'file':
        return `<p>[${block.props.name}](${block.props.url} "size=${block.props.size}")</p>`
      case 'web-embed':
        return `<p>[[tweet(${block.props.url})]]</p>`
      case 'math':
        return `<p>$$${contentHtml}$$</p>`
      default:
        return contentHtml
    }
  })()

  if (isListItem) {
    // Wrap the block content in <li> if it's a list item
    return `<li>${blockHtml}${childrenHtml}</li>`
  } else {
    // Return the block content and any children it may have
    return `${blockHtml}\n${childrenHtml}`
  }
}

function convertBlocksToHtml(blocks: EditorBlock[]) {
  const htmlContent: string = blocks
    .map((block: EditorBlock) => convertBlockToHtml(block))
    .join('\n\n')
  return htmlContent
}

export function generateFrontMatter(document: HMDocument) {
  const metadata = document.metadata || {}
  const createTime = document.createTime
  let date = ''
  if (typeof createTime === 'string') {
    date = createTime
  } else if (
    createTime &&
    typeof createTime === 'object' &&
    'seconds' in createTime &&
    'nanos' in createTime
  ) {
    const millis =
      Number(createTime.seconds) * 1000 + Math.floor(createTime.nanos / 1e6)
    date = new Date(millis).toISOString()
  }

  const frontMatter = `---
title: ${metadata.name || ''}
icon: ${metadata.icon || ''}
cover_image: ${metadata.cover || ''}
created_at: ${date}
path: ${document.path || ''}
---

`

  return frontMatter
}

async function extractMediaFiles(blocks: EditorBlock[]) {
  const mediaFiles: {url: string; filename: string; placeholder: string}[] = []
  let counter = 1
  const extractMedia = async (block: EditorBlock) => {
    if (
      block.type === 'image' ||
      block.type === 'video' ||
      block.type === 'file'
    ) {
      const url = block.props.url
      if (url) {
        if (
          url.includes('youtu.be') ||
          url.includes('youtube') ||
          url.includes('vimeo') ||
          url.includes('twitch.tv')
        ) {
          return
        }
        const filename = url.split('/').pop()!
        const placeholder = `file-${counter}`
        mediaFiles.push({url, filename, placeholder})
        counter++
        // Update the URL to point to the local media folder
        block.props = {...block.props, url: `media/${placeholder}`}
      }
    }
    if (block.children) {
      for (const child of block.children) {
        await extractMedia(child)
      }
    }
  }
  for (const block of blocks) {
    await extractMedia(block)
  }
  return mediaFiles
}

export async function convertBlocksToMarkdown(
  blocks: EditorBlock[],
  document: HMDocument,
) {
  const frontMatter = generateFrontMatter(document)
  const mediaFiles = await extractMediaFiles(blocks)
  const markdownFile = await unified()
    .use(rehypeParse, {fragment: true})
    .use(rehypeRemark)
    .use(remarkGfm)
    .use(remarkStringify)
    .process(convertBlocksToHtml(blocks))
  const markdownContent = (frontMatter + markdownFile.value) as string
  return {markdownContent, mediaFiles}
}
