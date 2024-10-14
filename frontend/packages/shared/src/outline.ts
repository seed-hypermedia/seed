import {HMBlockNode, HMDraft} from '.'
import {UnpackedHypermediaId, unpackHmId} from './utils'

type IconDefinition = React.FC<{size: any; color: any}>

export type NodeOutline = {
  title?: string
  id: string
  entityId?: UnpackedHypermediaId
  embedId?: UnpackedHypermediaId
  parentBlockId?: string
  children?: NodeOutline[]
  icon?: IconDefinition
}
export type NodesOutline = NodeOutline[]

export function getNodesOutline(
  children: HMBlockNode[],
  parentEntityId?: UnpackedHypermediaId,
  parentBlockId?: string,
): NodesOutline {
  const outline: NodesOutline = []
  children.forEach((child) => {
    if (child.block.type === 'heading') {
      outline.push({
        id: child.block.id,
        title: child.block.text,
        entityId: parentEntityId,
        parentBlockId,
        children:
          child.children &&
          getNodesOutline(child.children, parentEntityId, parentBlockId),
      })
    } else if (
      child.block.type === 'Embed' &&
      child.block.attributes?.view !== 'Card'
    ) {
      const embedId = unpackHmId(child.block.link)
      if (embedId) {
        outline.push({
          id: child.block.id,
          embedId,
        })
      }
    } else if (child.children) {
      outline.push(
        ...getNodesOutline(child.children, parentEntityId, parentBlockId),
      )
    }
  })
  return outline
}

export function getDraftNodesOutline(
  children: HMDraft['content'],
  parentEntityId?: UnpackedHypermediaId,
  parentBlockId?: string,
): NodesOutline {
  const outline: NodesOutline = []
  children.forEach((child) => {
    if (child.type === 'heading') {
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
    } else if (child.type === 'embed' && child.props?.view !== 'card') {
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
