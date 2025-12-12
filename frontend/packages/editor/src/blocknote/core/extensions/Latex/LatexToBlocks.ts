import {DAEMON_FILE_UPLOAD_URL} from '@shm/shared/constants'
import type * as Ast from '@unified-latex/unified-latex-types'
import {parse as parseLatex} from '@unified-latex/unified-latex-util-parse'
import {visit} from '@unified-latex/unified-latex-util-visit'
import {nanoid} from 'nanoid'
import {Block, BlockSchema, StyledText, Styles} from '../..'

// Regex to detect web URLs
const isWebUrl = (url: string | undefined) => {
  if (!url) return false
  const cleanedUrl = url.replace(/\\/g, '')
  try {
    new URL(cleanedUrl)
    return true
  } catch (_) {
    return false
  }
}

// Upload file to IPFS
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

// Read media file via IPC
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

// Extract text content from a LaTeX node
function getStringContent(node: Ast.Node | Ast.Node[]): string {
  if (Array.isArray(node)) {
    return node.map(getStringContent).join('')
  }

  if (node.type === 'string') {
    return node.content
  }

  if (node.type === 'whitespace') {
    return ' '
  }

  if (node.type === 'parbreak') {
    return '\n\n'
  }

  if (node.type === 'macro') {
    // Handle special macros that produce text
    if (node.content === 'textbackslash') return '\\'
    if (node.content === 'textasciitilde') return '~'
    if (node.content === 'textasciicircum') return '^'
    if (node.content === 'ldots' || node.content === 'dots') return '...'
    if (node.content === 'LaTeX') return 'LaTeX'
    if (node.content === 'TeX') return 'TeX'
    if (node.content === '\\') return '\n'
    if (node.content === ' ' || node.content === ',') return ' '

    // Handle text formatting macros - extract their argument content
    if (
      node.content === 'textbf' ||
      node.content === 'textit' ||
      node.content === 'emph' ||
      node.content === 'texttt' ||
      node.content === 'underline' ||
      node.content === 'textrm' ||
      node.content === 'textsf' ||
      node.content === 'textsc'
    ) {
      const args = node.args || []
      for (const arg of args) {
        if (arg.openMark === '{' && arg.content) {
          return getStringContent(arg.content)
        }
      }
    }

    return ''
  }

  if (node.type === 'group') {
    return getStringContent(node.content)
  }

  if (node.type === 'environment') {
    return getStringContent(node.content)
  }

  if (node.type === 'inlinemath' || node.type === 'displaymath') {
    return ''
  }

  return ''
}

// Convert LaTeX nodes to styled text content
function nodesToStyledText(nodes: Ast.Node[]): StyledText[] {
  const result: StyledText[] = []
  let currentText = ''
  let currentStyles: Styles = {}

  function flushText() {
    if (currentText) {
      result.push({
        type: 'text',
        text: currentText,
        styles: {...currentStyles},
      })
      currentText = ''
    }
  }

  function processNode(node: Ast.Node, inheritedStyles: Styles = {}) {
    if (node.type === 'string') {
      if (
        JSON.stringify(currentStyles) !== JSON.stringify(inheritedStyles) &&
        currentText
      ) {
        flushText()
        currentStyles = {...inheritedStyles}
      } else if (!currentText) {
        currentStyles = {...inheritedStyles}
      }
      currentText += node.content
    } else if (node.type === 'whitespace') {
      if (
        JSON.stringify(currentStyles) !== JSON.stringify(inheritedStyles) &&
        currentText
      ) {
        flushText()
        currentStyles = {...inheritedStyles}
      } else if (!currentText) {
        currentStyles = {...inheritedStyles}
      }
      currentText += ' '
    } else if (node.type === 'macro') {
      // Text formatting macros
      if (
        node.content === 'textbf' ||
        node.content === 'textit' ||
        node.content === 'emph' ||
        node.content === 'texttt' ||
        node.content === 'underline'
      ) {
        const args = node.args || []
        for (const arg of args) {
          if (arg.openMark === '{' && arg.content) {
            flushText()
            const newStyles: Styles = {...inheritedStyles}
            if (node.content === 'textbf') newStyles.bold = true
            if (node.content === 'textit' || node.content === 'emph')
              newStyles.italic = true
            if (node.content === 'texttt') newStyles.code = true
            if (node.content === 'underline') newStyles.underline = true

            for (const child of arg.content) {
              processNode(child, newStyles)
            }
          }
        }
      } else if (node.content === 'href' || node.content === 'url') {
        // Handle links
        const args = node.args || []
        let href = ''
        let linkText = ''

        if (node.content === 'url' && args.length >= 1) {
          const urlArg = args[0]
          if (urlArg.content) {
            href = getStringContent(urlArg.content)
            linkText = href
          }
        } else if (node.content === 'href' && args.length >= 2) {
          const urlArg = args[0]
          const textArg = args[1]
          if (urlArg.content) {
            href = getStringContent(urlArg.content)
          }
          if (textArg.content) {
            linkText = getStringContent(textArg.content)
          }
        }

        if (href) {
          flushText()
          result.push({
            type: 'link',
            href,
            content: [
              {
                type: 'text',
                text: linkText || href,
                styles: {...inheritedStyles},
              },
            ],
          } as any)
        }
      } else if (
        node.content === 'textrm' ||
        node.content === 'textsf' ||
        node.content === 'textsc'
      ) {
        // Other text macros - just extract content
        const args = node.args || []
        for (const arg of args) {
          if (arg.openMark === '{' && arg.content) {
            for (const child of arg.content) {
              processNode(child, inheritedStyles)
            }
          }
        }
      } else {
        // Handle other macros that produce text
        const text = getStringContent(node)
        if (text) {
          if (
            JSON.stringify(currentStyles) !== JSON.stringify(inheritedStyles) &&
            currentText
          ) {
            flushText()
            currentStyles = {...inheritedStyles}
          } else if (!currentText) {
            currentStyles = {...inheritedStyles}
          }
          currentText += text
        }
      }
    } else if (node.type === 'group') {
      for (const child of node.content) {
        processNode(child, inheritedStyles)
      }
    } else if (node.type === 'inlinemath') {
      // Inline math - add as styled text with special marker
      flushText()
      const mathContent = getLatexSource(node.content)
      result.push({
        type: 'text',
        text: `$${mathContent}$`,
        styles: {code: true, ...inheritedStyles},
      })
    }
  }

  for (const node of nodes) {
    processNode(node, {})
  }

  flushText()
  return result
}

// Get raw LaTeX source from nodes
function getLatexSource(nodes: Ast.Node[]): string {
  return nodes
    .map((node) => {
      if (node.type === 'string') return node.content
      if (node.type === 'whitespace') return ' '
      if (node.type === 'macro') {
        let result = '\\' + node.content
        if (node.args) {
          for (const arg of node.args) {
            result +=
              arg.openMark + getLatexSource(arg.content) + arg.closeMark
          }
        }
        return result
      }
      if (node.type === 'group') {
        return '{' + getLatexSource(node.content) + '}'
      }
      if (node.type === 'environment') {
        return `\\begin{${node.env}}${getLatexSource(node.content)}\\end{${node.env}}`
      }
      return ''
    })
    .join('')
}

// Create a new block with default structure
function createBlock(
  type: string,
  props: Record<string, any> = {},
  content: any[] = [],
  children: Block<BlockSchema>[] = [],
): Block<BlockSchema> {
  return {
    id: nanoid(10),
    type,
    props: {
      textAlignment: 'left',
      diff: 'null',
      childrenType: 'Group',
      listLevel: '1',
      ...props,
    },
    content,
    children,
  } as Block<BlockSchema>
}

// Map section commands to heading levels
const sectionLevelMap: Record<string, string> = {
  section: '1',
  subsection: '2',
  subsubsection: '3',
  paragraph: '4',
  subparagraph: '5',
  chapter: '1',
}

// Process images and upload to IPFS
export async function processLatexMedia(
  ast: Ast.Root,
  directoryPath: string,
): Promise<Map<string, string>> {
  const mediaMap = new Map<string, string>()

  visit(ast, (node) => {
    if (node.type === 'macro' && node.content === 'includegraphics') {
      const args = node.args || []
      for (const arg of args) {
        if (arg.openMark === '{' && arg.content) {
          const imagePath = getStringContent(arg.content)
          if (imagePath && !isWebUrl(imagePath)) {
            mediaMap.set(imagePath, imagePath)
          }
        }
      }
    }
  })

  // Process each media file
  for (const [originalPath] of mediaMap) {
    try {
      // Try different extensions if no extension specified
      const extensions = ['', '.png', '.jpg', '.jpeg', '.pdf', '.eps', '.svg']
      let processed = false

      for (const ext of extensions) {
        const fullPath = directoryPath + '/' + originalPath + ext
        try {
          const fileResponse = await readMediaFile(fullPath)
          if (fileResponse) {
            const fileContent = Uint8Array.from(atob(fileResponse.content), (c) =>
              c.charCodeAt(0),
            )
            const file = new File([fileContent], fileResponse.fileName, {
              type: fileResponse.mimeType,
            })
            const ipfsUrl = await uploadToIpfs(file)
            mediaMap.set(originalPath, `ipfs://${ipfsUrl}`)
            processed = true
            break
          }
        } catch {
          // Try next extension
        }
      }

      if (!processed) {
        mediaMap.set(originalPath, 'null')
      }
    } catch (error) {
      console.error(`Error processing media ${originalPath}:`, error)
      mediaMap.set(originalPath, 'null')
    }
  }

  return mediaMap
}

// Main converter function
export async function LatexToBlocks(
  latex: string,
  directoryPath: string = '',
): Promise<Block<BlockSchema>[]> {
  const blocks: Block<BlockSchema>[] = []
  const organizedBlocks: Block<BlockSchema>[] = []

  // Parse LaTeX
  const ast = parseLatex(latex)

  // Process media files
  const mediaMap = await processLatexMedia(ast, directoryPath)

  // Track current paragraph content
  let currentParagraphContent: Ast.Node[] = []

  // Flush current paragraph as a block
  function flushParagraph() {
    if (currentParagraphContent.length > 0) {
      // Filter out pure whitespace
      const hasContent = currentParagraphContent.some(
        (n) =>
          n.type !== 'whitespace' &&
          n.type !== 'parbreak' &&
          (n.type !== 'string' || n.content.trim() !== ''),
      )

      if (hasContent) {
        const styledContent = nodesToStyledText(currentParagraphContent)
        if (styledContent.length > 0) {
          blocks.push(createBlock('paragraph', {type: 'p'}, styledContent))
        }
      }
      currentParagraphContent = []
    }
  }

  // Process top-level nodes
  function processNode(node: Ast.Node) {
    if (node.type === 'parbreak') {
      flushParagraph()
      return
    }

    if (node.type === 'macro') {
      // Section headings
      if (sectionLevelMap[node.content]) {
        flushParagraph()
        const level = sectionLevelMap[node.content]
        const args = node.args || []
        let titleContent: StyledText[] = []

        for (const arg of args) {
          if (arg.openMark === '{' && arg.content) {
            titleContent = nodesToStyledText(arg.content)
            break
          }
        }

        if (titleContent.length > 0) {
          blocks.push(createBlock('heading', {level}, titleContent))
        }
        return
      }

      // Images
      if (node.content === 'includegraphics') {
        flushParagraph()
        const args = node.args || []
        let imagePath = ''
        let width = ''

        for (const arg of args) {
          if (arg.openMark === '[' && arg.content) {
            // Parse options like width=0.5\textwidth
            const optStr = getStringContent(arg.content)
            const widthMatch = optStr.match(/width\s*=\s*([^\s,]+)/)
            if (widthMatch) {
              width = widthMatch[1]
            }
          }
          if (arg.openMark === '{' && arg.content) {
            imagePath = getStringContent(arg.content)
          }
        }

        if (imagePath) {
          const ipfsUrl = mediaMap.get(imagePath) || imagePath
          blocks.push(
            createBlock('image', {
              src: ipfsUrl !== 'null' ? ipfsUrl : undefined,
              width: width || undefined,
            }),
          )
        }
        return
      }

      // Otherwise, add to current paragraph
      currentParagraphContent.push(node)
      return
    }

    if (node.type === 'environment') {
      flushParagraph()

      // Math environments
      if (
        node.env === 'equation' ||
        node.env === 'equation*' ||
        node.env === 'align' ||
        node.env === 'align*' ||
        node.env === 'gather' ||
        node.env === 'gather*' ||
        node.env === 'multline' ||
        node.env === 'multline*'
      ) {
        const mathContent = getLatexSource(node.content)
        blocks.push(
          createBlock(
            'math',
            {},
            [
              {
                type: 'text',
                text: mathContent,
                styles: {},
              },
            ],
          ),
        )
        return
      }

      // Lists
      if (node.env === 'itemize' || node.env === 'enumerate') {
        const listType = node.env === 'itemize' ? 'Unordered' : 'Ordered'
        const listItemChildren: Block<BlockSchema>[] = []

        let currentItemContent: Ast.Node[] = []

        function flushItem() {
          if (currentItemContent.length > 0) {
            const styledContent = nodesToStyledText(currentItemContent)
            if (styledContent.length > 0) {
              // Each list item is a normal paragraph as a child
              listItemChildren.push(
                createBlock('paragraph', {type: 'p'}, styledContent),
              )
            }
            currentItemContent = []
          }
        }

        for (const child of node.content) {
          if (child.type === 'macro' && child.content === 'item') {
            flushItem()
          } else if (child.type !== 'parbreak') {
            currentItemContent.push(child)
          }
        }
        flushItem()

        // Create parent block with childrenType set to list type, children are the items
        if (listItemChildren.length > 0) {
          blocks.push(
            createBlock(
              'paragraph',
              {type: 'p', childrenType: listType},
              [], // empty content for parent
              listItemChildren,
            ),
          )
        }
        return
      }

      // Quote environments
      if (node.env === 'quote' || node.env === 'quotation') {
        const styledContent = nodesToStyledText(node.content)
        if (styledContent.length > 0) {
          // Create a child paragraph with the quote content
          const quoteChild = createBlock('paragraph', {type: 'p'}, styledContent)
          // Create parent block with childrenType: 'Blockquote' and the content as child
          blocks.push(
            createBlock(
              'paragraph',
              {type: 'p', childrenType: 'Blockquote'},
              [], // empty content for parent
              [quoteChild],
            ),
          )
        }
        return
      }

      // Code environments
      if (
        node.env === 'verbatim' ||
        node.env === 'lstlisting' ||
        node.env === 'minted'
      ) {
        const codeContent = getStringContent(node.content)
        let language = ''

        // Try to extract language from lstlisting options
        if (node.env === 'lstlisting' || node.env === 'minted') {
          // Check for language in args
          const args = (node as any).args || []
          for (const arg of args) {
            if (arg.content) {
              const argStr = getStringContent(arg.content)
              const langMatch = argStr.match(/language\s*=\s*(\w+)/)
              if (langMatch) {
                language = langMatch[1].toLowerCase()
              }
            }
          }
        }

        blocks.push(
          createBlock('code-block', {language}, [
            {
              type: 'text',
              text: codeContent.trim(),
              styles: {},
            },
          ]),
        )
        return
      }

      // Abstract, document - process content
      if (node.env === 'abstract' || node.env === 'document') {
        for (const child of node.content) {
          processNode(child)
        }
        return
      }

      // Figure environment
      if (node.env === 'figure' || node.env === 'figure*') {
        for (const child of node.content) {
          processNode(child)
        }
        return
      }

      // Default: try to process content
      for (const child of node.content) {
        processNode(child)
      }
      return
    }

    if (node.type === 'displaymath') {
      flushParagraph()
      const mathContent = getLatexSource(node.content)
      blocks.push(
        createBlock(
          'math',
          {},
          [
            {
              type: 'text',
              text: mathContent,
              styles: {},
            },
          ],
        ),
      )
      return
    }

    // String, whitespace, etc - add to current paragraph
    if (
      node.type === 'string' ||
      node.type === 'whitespace' ||
      node.type === 'group' ||
      node.type === 'inlinemath'
    ) {
      currentParagraphContent.push(node)
    }
  }

  // Process all top-level content
  for (const node of ast.content) {
    processNode(node)
  }

  // Flush any remaining paragraph
  flushParagraph()

  // Organize blocks by heading hierarchy (same as markdown)
  const getHeadingLevel = (block: Block<BlockSchema>) => {
    if (block.type === 'heading') {
      return parseInt((block.props as any).level, 10)
    }
    return 0
  }

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
      if (stack.length) {
        stack[stack.length - 1].block.children.push(block)
      } else {
        organizedBlocks.push(block)
      }
    }
  })

  return organizedBlocks
}

// Extract document metadata from LaTeX preamble
export function extractLatexMetadata(latex: string): {
  title?: string
  author?: string
  date?: string
} {
  const metadata: {title?: string; author?: string; date?: string} = {}

  try {
    const ast = parseLatex(latex)

    visit(ast, (node) => {
      if (node.type === 'macro') {
        if (node.content === 'title') {
          const args = node.args || []
          for (const arg of args) {
            if (arg.openMark === '{' && arg.content) {
              metadata.title = getStringContent(arg.content).trim()
              break
            }
          }
        }
        if (node.content === 'author') {
          const args = node.args || []
          for (const arg of args) {
            if (arg.openMark === '{' && arg.content) {
              metadata.author = getStringContent(arg.content).trim()
              break
            }
          }
        }
        if (node.content === 'date') {
          const args = node.args || []
          for (const arg of args) {
            if (arg.openMark === '{' && arg.content) {
              metadata.date = getStringContent(arg.content).trim()
              break
            }
          }
        }
      }
    })
  } catch (error) {
    console.error('Error extracting LaTeX metadata:', error)
  }

  return metadata
}
