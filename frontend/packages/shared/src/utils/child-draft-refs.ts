/** Collect unique inline child draft ids referenced by embed blocks. */
export function collectChildDraftIds(blocks: unknown): string[] {
  const ids = new Set<string>()

  const visit = (node: unknown) => {
    if (!node) return
    if (Array.isArray(node)) {
      for (const child of node) visit(child)
      return
    }
    if (typeof node !== 'object') return

    const record = node as Record<string, unknown>
    const block = record.block && typeof record.block === 'object' ? (record.block as Record<string, unknown>) : null
    const props = record.props && typeof record.props === 'object' ? (record.props as Record<string, unknown>) : null
    const attributes =
      block?.attributes && typeof block.attributes === 'object' ? (block.attributes as Record<string, unknown>) : null

    const nodeType = record.type
    const blockType = block?.type
    const isEmbed = nodeType === 'embed' || blockType === 'Embed'
    const draftId = props?.draftId ?? attributes?.draftId
    if (isEmbed && typeof draftId === 'string' && draftId.length > 0) {
      ids.add(draftId)
    }

    visit(record.children)
  }

  visit(blocks)
  return Array.from(ids)
}
