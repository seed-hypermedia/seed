import {
  getMetadataName,
  HMBlockNode,
  HMDraft,
  HMEntityContent,
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
  embeds?: HMEntityContent[],
): NodesOutline {
  const outline: NodesOutline = []
  children.forEach((child) => {
    if (child.block.type === 'Heading') {
      outline.push({
        id: child.block.id,
        title: child.block.text,
        entityId: entityId,
        children:
          child.children && getNodesOutline(child.children, entityId, embeds),
      })
    } else if (
      child.block.type === 'Embed' &&
      child.block.attributes?.view !== 'Card'
    ) {
      outline.push(...getEmbedOutline(child.block.id, child.block.link, embeds))
    } else if (child.children) {
      outline.push(...getNodesOutline(child.children, entityId, embeds))
    }
  })
  return outline
}

function getEmbedOutline(
  blockId: string,
  link: string,
  embedEntities?: HMEntityContent[],
): NodesOutline {
  const outline: NodesOutline = []
  const embedId = unpackHmId(link)
  if (embedId) {
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
            ? getNodesOutline(embedBn.children, embedId, embedEntities)
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
            )
          : [],
      })
    }
  }

  return outline
}

function findContentBlock(
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
  embeds?: HMEntityContent[],
): NodesOutline {
  const outline: NodesOutline = []
  children.forEach((child) => {
    if (child.type === 'heading') {
      outline.push({
        id: child.id,
        title: child.content
          // @ts-expect-error
          .map((c) => {
            if (c.type === 'text') return c.text
          })
          .join(''),
        entityId: parentEntityId,
        children:
          child.children &&
          getDraftNodesOutline(child.children, parentEntityId, embeds),
      })
    } else if (child.type === 'embed' && child.props?.view !== 'Card') {
      outline.push(...getEmbedOutline(child.id, child.props.url, embeds))
    } else if (child.children) {
      outline.push(
        ...getDraftNodesOutline(child.children, parentEntityId, embeds),
      )
    }
  })
  return outline
}
