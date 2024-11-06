import {getMetadataName, HMBlockNode, HMDraft, HMEntityContent} from '.'
import {UnpackedHypermediaId, unpackHmId} from './utils'

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
      const embedId = unpackHmId(child.block.link)
      if (embedId) {
        const embedEntity = embeds?.find((e) => e.id.id === embedId.id)
        console.log('~~ outline embedId', embedId, embedEntity)
        if (embedId.blockRef && embedEntity?.document?.content) {
          const embedBn = findContentBlock(
            embedEntity.document.content,
            embedId.blockRef,
          )
          console.log('~~ outline embedBn', embedBn)
          if (embedBn && embedBn.block.type === 'Heading') {
            outline.push({
              id: embedBn.block.id,
              title: embedBn.block.text,
              entityId: embedId,
              children: embedBn.children
                ? getNodesOutline(embedBn.children, embedId, embeds)
                : [],
            })
          }
        } else {
          console.log({embedEntity})
          outline.push({
            id: child.block.id,
            title: getMetadataName(embedEntity?.document?.metadata),
            children: embedEntity?.document?.content
              ? getNodesOutline(embedEntity?.document?.content, embedId, embeds)
              : [],
          })
        }
      }
    } else if (child.children) {
      outline.push(...getNodesOutline(child.children, entityId, embeds))
    }
  })
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
  parentBlockId?: string,
): NodesOutline {
  const outline: NodesOutline = []
  console.log('getDraftNodesOutline outline', children)
  children.forEach((child) => {
    if (child.type === 'Heading') {
      outline.push({
        id: child.id,
        title: child.content
          .map((c) => {
            if (c.type === 'text') return c.text
          })
          .join(''),
        entityId: parentEntityId,
        parentBlockId,
        children:
          child.children &&
          getDraftNodesOutline(child.children, parentEntityId, parentBlockId),
      })
    } else if (child.type === 'Embed' && child.props?.view !== 'Card') {
      console.error('Outline Might not handle embeds from draft correctly')
      console.error(child)
      const embedId = unpackHmId(child.props.href)
      if (embedId) {
        outline.push({
          id: child.id,
          embedId,
        })
      }
    } else if (child.children) {
      outline.push(
        ...getDraftNodesOutline(child.children, parentEntityId, parentBlockId),
      )
    }
  })
  return outline
}
