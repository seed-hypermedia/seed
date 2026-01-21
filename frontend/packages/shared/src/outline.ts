import {
  getMetadataName,
  HMBlockNode,
  HMDraft,
  HMInlineContent,
  HMResourceFetchResult,
  UnpackedHypermediaId,
} from '.'
import {unpackHmId} from './utils'

type IconDefinition = React.FC<{size: any; color: any}>

export type NodeOutline = {
  title?: string
  id: string
  entityId?: UnpackedHypermediaId
  parentBlockId?: string
  children?: NodeOutline[]
  icon?: IconDefinition
}
export type NodesOutline = NodeOutline[]

export function getNodesOutline(
  children: HMBlockNode[],
  entityId?: UnpackedHypermediaId,
  embeds?: HMResourceFetchResult[],
  visitedEmbedIds: Set<string> = new Set(),
): NodesOutline {
  const outline: NodesOutline = []
  children.forEach((child) => {
    if (child.block.type === 'Heading') {
      outline.push({
        id: child.block.id,
        title: child.block.text,
        entityId: entityId,
        children:
          child.children &&
          getNodesOutline(child.children, entityId, embeds, visitedEmbedIds),
      })
    } else if (
      child.block.type === 'Embed' &&
      child.block.attributes?.view !== 'Card'
    ) {
      outline.push(
        ...getEmbedOutline(
          child.block.id,
          child.block.link,
          embeds,
          visitedEmbedIds,
        ),
      )
    } else if (child.children) {
      outline.push(
        ...getNodesOutline(child.children, entityId, embeds, visitedEmbedIds),
      )
    }
  })
  return outline
}

function getEmbedOutline(
  blockId: string,
  link: string,
  embedEntities?: HMResourceFetchResult[],
  visitedEmbedIds: Set<string> = new Set(),
): NodesOutline {
  const outline: NodesOutline = []
  const embedId = unpackHmId(link)
  if (embedId) {
    // Check if we've already processed this embed to prevent circular references
    const embedKey = embedId.id + (embedId.blockRef || '')
    if (visitedEmbedIds.has(embedKey)) {
      return outline // Return empty outline to break the cycle
    }

    // Mark this embed as visited
    const newVisitedEmbedIds = new Set(visitedEmbedIds)
    newVisitedEmbedIds.add(embedKey)

    const embedEntity = embedEntities?.find((e) => e.id.id === embedId.id)
    if (embedId.blockRef && embedEntity?.document?.content) {
      const embedBn = findContentBlock(
        embedEntity.document.content,
        embedId.blockRef,
      )
      if (embedBn && embedBn.block.type === 'Heading') {
        outline.push({
          id: blockId,
          title: embedBn.block.text,
          entityId: embedId,
          children: embedBn.children
            ? getNodesOutline(
                embedBn.children,
                embedId,
                embedEntities,
                newVisitedEmbedIds,
              )
            : [],
        })
      }
    } else {
      outline.push({
        id: blockId,
        title: getMetadataName(embedEntity?.document?.metadata),
        children: embedEntity?.document?.content
          ? getNodesOutline(
              embedEntity?.document?.content,
              embedId,
              embedEntities,
              newVisitedEmbedIds,
            )
          : [],
      })
    }
  }

  return outline
}

export function findContentBlock(
  content: HMBlockNode[],
  blockRef: string,
): HMBlockNode | null {
  let block: HMBlockNode | null = null
  content.find((node) => {
    if (node.block.id === blockRef) {
      block = node
      return true
    } else if (node.children) {
      block = findContentBlock(node.children, blockRef)
      return !!block
    }
    return false
  })
  return block
}

export function getDraftNodesOutline(
  children: HMDraft['content'],
  parentEntityId?: UnpackedHypermediaId,
  embeds?: HMResourceFetchResult[],
  visitedEmbedIds: Set<string> = new Set(),
): NodesOutline {
  const outline: NodesOutline = []
  children.forEach((child) => {
    if (child.type === 'heading') {
      // Extract text from inline content, filtering out non-text items
      const title = child.content
        .filter(
          (c: HMInlineContent): c is Extract<HMInlineContent, {type: 'text'}> =>
            c.type === 'text',
        )
        .map((c: Extract<HMInlineContent, {type: 'text'}>) => c.text)
        .join('')

      outline.push({
        id: child.id,
        title: title || undefined,
        entityId: parentEntityId,
        children:
          child.children &&
          getDraftNodesOutline(
            child.children,
            parentEntityId,
            embeds,
            visitedEmbedIds,
          ),
      })
    } else if (child.type === 'embed' && child.props?.view !== 'Card') {
      outline.push(
        ...getEmbedOutline(child.id, child.props.url, embeds, visitedEmbedIds),
      )
    } else if (child.children) {
      outline.push(
        ...getDraftNodesOutline(
          child.children,
          parentEntityId,
          embeds,
          visitedEmbedIds,
        ),
      )
    }
  })
  return outline
}
