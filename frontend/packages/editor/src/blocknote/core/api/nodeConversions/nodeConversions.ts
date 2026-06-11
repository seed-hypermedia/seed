import {Mark} from '@tiptap/pm/model'
import {Node, Schema} from 'prosemirror-model'
import {Block, BlockSchema, PartialBlock} from '../../extensions/Blocks/api/blockTypes'

import {defaultProps} from '../../extensions/Blocks/api/defaultBlocks'
import {
  ColorStyle,
  FontStyle,
  InlineContent,
  PartialInlineContent,
  PartialLink,
  StringStyle,
  StyledText,
  Styles,
  ToggledStyle,
} from '../../extensions/Blocks/api/inlineContentTypes'
import {UniqueID} from '../../extensions/UniqueID/UniqueID'
import {UnreachableCaseError} from '../../shared/utils'

const toggleStyles = new Set<ToggledStyle>(['bold', 'italic', 'underline', 'strike', 'code'])
const colorStyles = new Set<ColorStyle>(['textColor', 'backgroundColor'])
const fontStyles = new Set<FontStyle>(['textSize', 'textFamily'])

/**
 * Convert a StyledText inline element to a
 * prosemirror text node with the appropriate marks
 */
function styledTextToNodes(styledText: StyledText, schema: Schema): Node[] {
  const marks: Mark[] = []

  for (const [style, value] of Object.entries(styledText.styles)) {
    if (toggleStyles.has(style as ToggledStyle)) {
      marks.push(schema.mark(style))
    } else if (colorStyles.has(style as ColorStyle) || fontStyles.has(style as FontStyle)) {
      marks.push(schema.mark(style, {value}))
    }
  }

  return (
    styledText.text
      // Splits text & line breaks.
      .split(/(\n)/g)
      // If the content ends with a line break, an empty string is added to the
      // end, which this removes.
      .filter((text) => text.length > 0)
      // Converts text & line breaks to nodes.
      .map((text) => {
        if (text === '\n') {
          // @ts-ignore
          return schema.nodes['hardBreak'].create()
        } else {
          return schema.text(text, marks)
        }
      })
  )
}

/**
 * Converts a Link inline content element to
 * prosemirror text nodes with the appropriate marks
 */
function linkToNodes(link: PartialLink, schema: Schema): Node[] {
  // @ts-ignore
  const linkMark = schema.marks.link.create({
    href: link.href,
  })

  return styledTextArrayToNodes(link.content, schema).map((node) => {
    if (node.type.name === 'text') {
      return node.mark([...node.marks, linkMark])
    }

    if (node.type.name === 'hardBreak') {
      return node
    }
    throw new Error('unexpected node type')
  })
}

/**
 * Converts an array of StyledText inline content elements to
 * prosemirror text nodes with the appropriate marks
 */
function styledTextArrayToNodes(content: string | StyledText[], schema: Schema): Node[] {
  const nodes: Node[] = []

  if (typeof content === 'string') {
    nodes.push(...styledTextToNodes({type: 'text', text: content, styles: {}}, schema))
    return nodes
  }

  for (const styledText of content) {
    nodes.push(...styledTextToNodes(styledText, schema))
  }
  return nodes
}

/**
 * converts an array of inline content elements to prosemirror nodes
 */
export function inlineContentToNodes(blockContent: PartialInlineContent[], schema: Schema): Node[] {
  const nodes: Node[] = []

  for (const content of blockContent) {
    if (content.type === 'link') {
      nodes.push(...linkToNodes(content, schema))
    } else if (content.type === 'text') {
      nodes.push(...styledTextArrayToNodes([content], schema))
      // @ts-expect-error
    } else if (content.type == 'inline-embed') {
      nodes.push(
        // @ts-ignore
        schema.nodes['inline-embed'].create({
          // @ts-expect-error
          link: content.link,
        }),
      )
    } else {
      throw new UnreachableCaseError(content)
    }
  }
  return nodes
}

/**
 * Converts a BlockNote block to a TipTap node.
 */
export function blockToNode<BSchema extends BlockSchema>(block: PartialBlock<BSchema>, schema: Schema) {
  let id = block.id

  if (id === undefined) {
    id = UniqueID.options.generateID()
  }

  let type = block.type

  if (type === undefined) {
    type = 'paragraph'
  }

  let contentNode: Node

  // Tables hold structural inner content and they don't fit the generic
  // content shape used by every other block. Needs a custom handler.
  if (type === 'table') {
    return tableBlockToNode(block, schema, id!)
  } else if (!block.content) {
    // @ts-ignore
    contentNode = schema.nodes[type].create(block.props)
  } else if (typeof block.content === 'string') {
    // @ts-ignore
    contentNode = schema.nodes[type].create(block.props, schema.text(block.content))
  } else {
    let nodes: Node[] = []
    // Don't want hard breaks inserted as nodes in codeblock
    if (block.type === 'code-block' && block.content.length) {
      // Only create a text node when there is actual content — ProseMirror
      // does not allow empty text nodes and will throw a RangeError otherwise.
      // Code-blocks are expected to have at most one text content item.
      // @ts-ignore
      const text: string | undefined = block.content[0]?.text
      if (text) {
        // @ts-ignore
        const textNode = schema.text(text)
        nodes.push(textNode)
      }
    } else nodes = inlineContentToNodes(block.content, schema)
    // @ts-ignore
    contentNode = schema.nodes[type].create(block.props, nodes)
  }

  const children: Node[] = []

  if (block.children) {
    for (const child of block.children) {
      children.push(blockToNode(child, schema))
    }
  }

  const groupAttrs: Record<string, unknown> = {listType: block.props?.childrenType || 'Group'}
  if (block.props?.childrenType === 'Grid' && block.props?.columnCount) {
    groupAttrs.columnCount = block.props.columnCount
  }
  // @ts-ignore
  const groupNode = schema.nodes['blockChildren'].create(groupAttrs, children)

  // @ts-ignore
  return schema.nodes['blockNode'].create(
    {
      id: id,
      ...block.props,
    },
    children.length > 0 ? [contentNode, groupNode] : contentNode,
  )
}

/**
 * Converts an internal (prosemirror) content node to a BlockNote InlineContent array.
 */
function contentNodeToInlineContent(contentNode: Node) {
  const content: InlineContent[] = []
  let currentContent: InlineContent | undefined = undefined

  // Most of the logic below is for handling links because in ProseMirror links are marks
  // while in BlockNote links are a type of inline content
  contentNode.content.forEach((node) => {
    // hardBreak nodes do not have an InlineContent equivalent, instead we
    // add a newline to the previous node.
    if (node.type.name === 'hardBreak') {
      if (currentContent) {
        // Current content exists.
        if (currentContent.type === 'text') {
          // Current content is text.
          currentContent.text += '\n'
        } else if (currentContent.type === 'link') {
          // Current content is a link.
          // @ts-ignore
          currentContent.content[currentContent.content.length - 1].text += '\n'
        }
      } else {
        // Current content does not exist.
        currentContent = {
          type: 'text',
          text: '\n',
          styles: {},
        }
      }

      return
    }

    if (node.type.name == 'inline-embed') {
      if (currentContent) {
        content.push(currentContent)
      }

      content.push({
        type: node.type.name,
        link: node.attrs.link,
      })

      currentContent = undefined
    }

    const styles: Styles = {}
    let linkMark: Mark | undefined

    for (const mark of node.marks) {
      if (mark.type.name === 'link') {
        linkMark = mark
      } else if (toggleStyles.has(mark.type.name as ToggledStyle)) {
        styles[mark.type.name as ToggledStyle] = true
      } else if (colorStyles.has(mark.type.name as ColorStyle) || fontStyles.has(mark.type.name as FontStyle)) {
        styles[mark.type.name as StringStyle] = mark.attrs.value
      } else {
        throw Error('Mark is of an unrecognized type: ' + mark.type.name)
      }
    }

    // Parsing links and text.
    // Current content exists.
    if (currentContent) {
      // Current content is text.
      if (currentContent.type === 'text') {
        if (!linkMark) {
          // Node is text (same type as current content).
          if (JSON.stringify(currentContent.styles) === JSON.stringify(styles)) {
            // Styles are the same.
            currentContent.text += node.textContent
          } else {
            // Styles are different.
            content.push(currentContent)
            currentContent = {
              type: 'text',
              text: node.textContent,
              styles,
            }
          }
        } else {
          // Node is a link (different type to current content).
          content.push(currentContent)
          currentContent = {
            type: 'link',
            href: linkMark.attrs.href,
            content: [
              {
                type: 'text',
                text: node.textContent,
                styles,
              },
            ],
          }
        }
      } else if (currentContent.type === 'link') {
        // Current content is a link.
        if (linkMark) {
          // Node is a link (same type as current content).
          // Link URLs are the same.
          if (currentContent.href === linkMark.attrs.href) {
            // Styles are the same.
            if (
              JSON.stringify(
                // @ts-ignore
                currentContent.content[currentContent.content.length - 1].styles,
              ) === JSON.stringify(styles)
            ) {
              // @ts-ignore
              currentContent.content[currentContent.content.length - 1].text += node.textContent
            } else {
              // Styles are different.
              currentContent.content.push({
                type: 'text',
                text: node.textContent,
                styles,
              })
            }
          } else {
            // Link URLs are different.
            content.push(currentContent)
            currentContent = {
              type: 'link',
              href: linkMark.attrs.href,
              content: [
                {
                  type: 'text',
                  text: node.textContent,
                  styles,
                },
              ],
            }
          }
        } else {
          // Node is text (different type to current content).
          content.push(currentContent)
          currentContent = {
            type: 'text',
            text: node.textContent,
            styles,
          }
        }
      }
    }
    // Current content does not exist.
    else {
      // Node is text.
      if (!linkMark) {
        currentContent = {
          type: 'text',
          text: node.textContent,
          styles,
        }
      }
      // Node is a link.
      else {
        currentContent = {
          type: 'link',
          href: linkMark.attrs.href,
          content: [
            {
              type: 'text',
              text: node.textContent,
              styles,
            },
          ],
        }
      }
    }
  })

  if (currentContent) {
    content.push(currentContent)
  }

  return content
}

/**
 * Convert a TipTap node to a BlockNote block.
 */
export function nodeToBlock<BSchema extends BlockSchema>(
  node: Node,
  blockSchema: BSchema,
  blockCache?: WeakMap<Node, Block<BSchema>>,
): Block<BSchema> {
  if (node.type.name !== 'blockNode') {
    throw Error('Node must be of type blockNode, but is of type' + node.type.name + '.')
  }

  const cachedBlock = blockCache?.get(node)

  if (cachedBlock) {
    return cachedBlock
  }

  // const blockInfo = getBlockInfo(node)

  let id = node.attrs.id

  // Only used for blocks converted from other formats.
  if (id === null) {
    id = UniqueID.options.generateID()
  }

  const props: any = {}
  for (const [attr, value] of Object.entries({
    ...node.attrs,
    ...node.firstChild!.attrs,
  })) {
    const blockSpec = blockSchema[node.firstChild!.type.name]
    if (!blockSpec) {
      if (node.firstChild!.type.name === 'code-block' || node.firstChild!.type.name === 'inline-embed') {
        break
      } else throw Error('Block is of an unrecognized type: ' + node.firstChild!.type.name)
    }

    const propSchema = blockSpec.propSchema

    if (attr in propSchema) {
      props[attr] = value
    }
    // Block ids are stored as node attributes the same way props are, so we
    // need to ensure we don't attempt to read block ids as props.

    // the second check is for the backgroundColor & textColor props.
    // Since we want them to be inherited by child blocks, we can't put them on the blockContent node,
    // and instead have to put them on the blockContainer node.
    // The blockContainer node is the same for all block types, but some custom blocks might not use backgroundColor & textColor,
    // so these 2 props are technically unexpected but we shouldn't log a warning.
    // (this is a bit hacky)
    else if (attr !== 'id' && !(attr in defaultProps)) {
      // console.warn('Block has an unrecognized attribute: ' + attr)
    }
  }

  if (node.lastChild!.attrs.listType) {
    const {listType, listLevel, start, columnCount} = node.lastChild!.attrs
    props['childrenType'] = listType
    props['listLevel'] = listLevel
    props['start'] = start
    if (listType === 'Grid' && columnCount) {
      props['columnCount'] = columnCount
    }
  }

  // Walk the table's PM tree by hand and pack rows and cells into the block
  // representation so they survive the BlockNote save/load round-trip.
  if (node.firstChild!.type.name === 'table') {
    // Table's children are structural rows/columns. Strip list/grid affiliated
    // attributes because tables cannot have nested blockChildren nodes.
    delete props.childrenType
    delete props.listLevel
    delete props.start
    delete props.columnCount

    const block = tableNodeToBlock<BSchema>(node, id, props)
    blockCache?.set(node, block)
    return block
  }

  const content = contentNodeToInlineContent(node.firstChild!)

  const children: Block<BSchema>[] = []
  for (let i = 0; i < (node.childCount === 2 ? node.lastChild!.childCount : 0); i++) {
    const childNode = node.lastChild!.child(i)
    children.push(nodeToBlock(childNode, blockSchema, blockCache))

    // Warp nested groups under tables in a new empty paragraph, whose
    // children preserve all the group attributes.
    if (
      childNode.firstChild?.type.name === 'table' &&
      childNode.childCount === 2 &&
      childNode.lastChild!.type.name === 'blockChildren'
    ) {
      const orphanedContainer = childNode.lastChild!
      const orphanedChildren: Block<BSchema>[] = []
      for (let j = 0; j < orphanedContainer.childCount; j++) {
        orphanedChildren.push(nodeToBlock(orphanedContainer.child(j), blockSchema, blockCache))
      }
      const listType = orphanedContainer.attrs?.listType || 'Group'
      const listLevel = orphanedContainer.attrs?.listLevel || '1'
      children.push({
        id: UniqueID.options.generateID(),
        type: 'paragraph',
        props: {childrenType: listType, listLevel},
        content: [],
        children: orphanedChildren,
      } as unknown as Block<BSchema>)
    }
  }

  const block: Block<BSchema> = {
    id,
    type: node.firstChild!.type.name,
    props,
    content,
    children,
  }

  blockCache?.set(node, block)

  return block
}

// Extract a PM table tree into the BlockNote block shape, preserving headers.
function tableNodeToBlock<BSchema extends BlockSchema>(blockNode: Node, id: string, props: any): Block<BSchema> {
  const tableNode = blockNode.firstChild!
  const children: Block<BSchema>[] = []
  let headerExtracted = false

  tableNode.content.forEach((rowNode, _offset, rowIdx) => {
    if (rowNode.type.name !== 'tableRow') return

    // Treat the first row as the header row if every cell is a tableHeader.
    const isHeaderRow = rowIdx === 0 && !headerExtracted && isAllHeaderRow(rowNode)

    if (isHeaderRow) {
      rowNode.content.forEach((cellNode) => {
        const inner = cellNode.firstChild
        const inlineContent = inner ? contentNodeToInlineContent(inner) : []
        // Set ID to the cell node if it has none.
        children.push({
          id: cellNode.attrs?.id || UniqueID.options.generateID(),
          type: 'tableColumn',
          props: {},
          content: inlineContent,
          children: [],
        } as unknown as Block<BSchema>)
      })
      headerExtracted = true
      return
    }

    const cellBlocks: Block<BSchema>[] = []
    rowNode.content.forEach((cellNode) => {
      // Expect a single paragraph per cell. If paste edge cases land more
      // than one block in a cell, the first block's inline content is what
      // is kept.
      const inner = cellNode.firstChild
      const inlineContent = inner ? contentNodeToInlineContent(inner) : []
      // Same as above — prefer the cell's stable PM `id` over a fresh one.
      cellBlocks.push({
        id: cellNode.attrs?.id || UniqueID.options.generateID(),
        type: 'paragraph',
        props: {},
        content: inlineContent,
        children: [],
      } as unknown as Block<BSchema>)
    })

    children.push({
      id: UniqueID.options.generateID(),
      type: 'tableRow',
      props: {},
      content: [],
      children: cellBlocks,
    } as unknown as Block<BSchema>)
  })

  return {
    id,
    type: 'table',
    props,
    content: [],
    children,
  } as unknown as Block<BSchema>
}

function isAllHeaderRow(rowNode: Node): boolean {
  if (rowNode.childCount === 0) return false
  let all = true
  rowNode.content.forEach((cell) => {
    if (cell.type.name !== 'tableHeader') all = false
  })
  return all
}

// Rebuild a PM table tree from a BlockNote table block.
function tableBlockToNode<BSchema extends BlockSchema>(block: PartialBlock<BSchema>, schema: Schema, id: string): Node {
  const rowNodes: Node[] = []

  const columnBlocks = (block.children ?? []).filter((c) => c.type === 'tableColumn')
  const rowBlocks = (block.children ?? []).filter((c) => c.type === 'tableRow')

  // Header row from TableColumn blocks. The TableColumn block's id
  // translates into the tableHeader node's id attribute.
  if (columnBlocks.length > 0) {
    const headerCellNodes: Node[] = []
    for (const colBlock of columnBlocks) {
      const inlineNodes = colBlock.content ? inlineContentToNodes(colBlock.content as any, schema) : []
      // @ts-ignore
      const paragraphNode = schema.nodes['paragraph'].create(null, inlineNodes)
      // @ts-ignore
      headerCellNodes.push(schema.nodes['tableHeader'].createChecked({id: colBlock.id ?? null}, paragraphNode))
    }
    // @ts-ignore
    rowNodes.push(schema.nodes['tableRow'].createChecked(null, headerCellNodes))
  }

  // Cell paragraph block ids translate into the tableCell PM
  // node's id attribute.
  for (const rowBlock of rowBlocks) {
    const cellNodes: Node[] = []
    for (const cellBlock of rowBlock.children ?? []) {
      const inlineNodes = cellBlock.content ? inlineContentToNodes(cellBlock.content as any, schema) : []
      // @ts-ignore
      const paragraphNode = schema.nodes['paragraph'].create(null, inlineNodes)
      // @ts-ignore
      cellNodes.push(schema.nodes['tableCell'].createChecked({id: cellBlock.id ?? null}, paragraphNode))
    }
    // @ts-ignore
    rowNodes.push(schema.nodes['tableRow'].createChecked(null, cellNodes))
  }

  // If there are no rows, fall back to createAndFill so PM
  // produces a valid empty table instead of throwing.
  let tableNode: Node
  if (rowNodes.length > 0) {
    // @ts-ignore
    tableNode = schema.nodes['table'].createChecked(block.props, rowNodes)
  } else {
    // @ts-ignore
    tableNode = schema.nodes['table'].createAndFill(block.props)!
  }

  // @ts-ignore
  return schema.nodes['blockNode'].create({id, ...block.props}, tableNode)
}
