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
  } else if (type === 'tableRow' || type === 'tableColumn') {
    // Table row and column only exist nested inside a Table
    // block.
    throw new Error(
      `[blockToNode] orphan ${String(type)} block reached blockToNode — caller must filter these before this point`,
    )
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

  // Collect rows and their cells from PM.
  type PmRow = {node: Node; cells: Node[]}
  const rows: PmRow[] = []
  let maxCols = 0
  tableNode.content.forEach((rowNode) => {
    if (rowNode.type.name !== 'tableRow') return
    const cells: Node[] = []
    rowNode.content.forEach((cellNode) => {
      if (cellNode.type.name === 'tableCell' || cellNode.type.name === 'tableHeader') {
        cells.push(cellNode)
      }
    })
    if (cells.length > maxCols) maxCols = cells.length
    rows.push({node: rowNode, cells})
  })

  // Per-column metadata derived from PM cells at that column position.
  type ColMeta = {id: string; isHeader: boolean; width?: number}
  const columnMeta: ColMeta[] = []
  for (let col = 0; col < maxCols; col++) {
    let columnId: string | undefined
    let allHeader = true
    let any = false
    let width: number | undefined
    for (const row of rows) {
      const cell = row.cells[col]
      if (!cell) continue
      any = true
      if (!columnId && typeof cell.attrs?.columnId === 'string' && cell.attrs.columnId) {
        columnId = cell.attrs.columnId
      }
      if (cell.type.name !== 'tableHeader') allHeader = false
      if (width === undefined && Array.isArray(cell.attrs?.colwidth) && cell.attrs.colwidth[0]) {
        width = cell.attrs.colwidth[0]
      }
    }
    if (!any) continue
    // Only the first column can be a header column.
    columnMeta.push({
      id: columnId || UniqueID.options.generateID(),
      isHeader: col === 0 && allHeader,
      width,
    })
  }

  // TableColumn editor blocks.
  const columnBlocks: Block<BSchema>[] = columnMeta.map((meta) => {
    const colProps: Record<string, any> = {}
    if (meta.isHeader) colProps.isHeader = true
    if (meta.width !== undefined) colProps.width = String(meta.width)
    return {
      id: meta.id,
      type: 'tableColumn',
      props: colProps,
      content: [],
      children: [],
    } as unknown as Block<BSchema>
  })

  // TableRow editor blocks with Paragraph cell children.
  const rowBlocks: Block<BSchema>[] = rows.map(({node: rowNode, cells}, rowIdx) => {
    const rowIsHeader = rowIdx === 0 && cells.length > 0 && cells.every((c) => c.type.name === 'tableHeader')
    const cellBlocks: Block<BSchema>[] = cells.map((cellNode, idx) => {
      const inner = cellNode.firstChild
      const inlineContent = inner ? contentNodeToInlineContent(inner) : []
      const cellColumnId =
        typeof cellNode.attrs?.columnId === 'string' && cellNode.attrs.columnId
          ? cellNode.attrs.columnId
          : columnMeta[idx]?.id
      const cellProps: Record<string, any> = {}
      if (cellColumnId) cellProps.columnId = cellColumnId
      return {
        id: cellNode.attrs?.id || UniqueID.options.generateID(),
        type: 'paragraph',
        props: cellProps,
        content: inlineContent,
        children: [],
      } as unknown as Block<BSchema>
    })
    const rowProps: Record<string, any> = {}
    if (rowIsHeader) rowProps.isHeader = true
    return {
      id: rowNode.attrs?.id || UniqueID.options.generateID(),
      type: 'tableRow',
      props: rowProps,
      content: [],
      children: cellBlocks,
    } as unknown as Block<BSchema>
  })

  // TableColumn blocks first, then TableRow blocks.
  const children: Block<BSchema>[] = [...columnBlocks, ...rowBlocks]

  return {
    id,
    type: 'table',
    props,
    content: [],
    children,
  } as unknown as Block<BSchema>
}

// Rebuild a PM table tree from a BlockNote table block.
function tableBlockToNode<BSchema extends BlockSchema>(block: PartialBlock<BSchema>, schema: Schema, id: string): Node {
  const rowNodes: Node[] = []

  const columnBlocks = (block.children ?? []).filter((c) => c.type === 'tableColumn')
  const rowBlocks = (block.children ?? []).filter((c) => c.type === 'tableRow')

  type ColMeta = {isHeader: boolean; width?: number; index: number; id: string}
  const colMetaById = new Map<string, ColMeta>()
  columnBlocks.forEach((colBlock, idx) => {
    if (!colBlock.id) return
    const isHeader = idx === 0 && (colBlock as any).props?.isHeader === true
    const widthStr = (colBlock as any).props?.width
    const width = widthStr ? Number(widthStr) : undefined
    colMetaById.set(colBlock.id, {isHeader, width, index: idx, id: colBlock.id})
  })

  let rowIdx = 0
  for (const rowBlock of rowBlocks) {
    const rowIsHeader = rowIdx === 0 && (rowBlock as any).props?.isHeader === true
    rowIdx++

    // Group cells by their column index. Orphan cells where columnId doesn't match
    // any TableColumn are dropped.
    const cellsByIndex = new Map<number, any>()
    for (const cellBlock of rowBlock.children ?? []) {
      const cellColumnId = (cellBlock as any).props?.columnId
      const meta = cellColumnId ? colMetaById.get(cellColumnId) : undefined
      if (!meta) continue
      cellsByIndex.set(meta.index, cellBlock)
    }

    // Build PM cells in column order, creating empty cells for missing positions.
    const cellNodes: Node[] = []
    for (let idx = 0; idx < columnBlocks.length; idx++) {
      const columnBlock = columnBlocks[idx]
      if (!columnBlock?.id) continue
      const colMeta = colMetaById.get(columnBlock.id)!
      const cellBlock = cellsByIndex.get(idx)
      const useHeader = rowIsHeader || colMeta.isHeader
      const nodeType = useHeader ? 'tableHeader' : 'tableCell'

      const inlineNodes: Node[] =
        cellBlock && cellBlock.content ? inlineContentToNodes(cellBlock.content as any, schema) : []
      // @ts-ignore
      const paragraphNode = schema.nodes['paragraph'].create(null, inlineNodes)

      const cellAttrs: Record<string, any> = {
        id: cellBlock?.id ?? null,
        columnId: colMeta.id,
      }
      if (colMeta.width !== undefined) cellAttrs.colwidth = [colMeta.width]

      // @ts-ignore
      cellNodes.push(schema.nodes[nodeType].createChecked(cellAttrs, paragraphNode))
    }

    // @ts-ignore
    rowNodes.push(schema.nodes['tableRow'].createChecked({id: rowBlock.id ?? null}, cellNodes))
  }

  let tableNode: Node
  if (rowNodes.length > 0) {
    // @ts-ignore
    tableNode = schema.nodes['table'].createChecked(block.props, rowNodes)
  } else if (columnBlocks.length > 0) {
    // Create one empty row if there are none, so it's a valid PM table.
    const emptyCells: Node[] = []
    for (const columnBlock of columnBlocks) {
      if (!columnBlock.id) continue
      const colMeta = colMetaById.get(columnBlock.id)!
      const nodeType = colMeta.isHeader ? 'tableHeader' : 'tableCell'
      // @ts-ignore
      const paragraphNode = schema.nodes['paragraph'].create(null, [])
      const cellAttrs: Record<string, any> = {id: null, columnId: colMeta.id}
      if (colMeta.width !== undefined) cellAttrs.colwidth = [colMeta.width]
      // @ts-ignore
      emptyCells.push(schema.nodes[nodeType].createChecked(cellAttrs, paragraphNode))
    }
    // @ts-ignore
    const emptyRow = schema.nodes['tableRow'].createChecked(null, emptyCells)
    // @ts-ignore
    tableNode = schema.nodes['table'].createChecked(block.props, [emptyRow])
  } else {
    // @ts-ignore
    tableNode = schema.nodes['table'].createAndFill(block.props)!
  }

  // @ts-ignore
  return schema.nodes['blockNode'].create({id, ...block.props}, tableNode)
}
