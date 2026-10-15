import {HMInlineContent} from '@seed-hypermedia/client/editor-types'
import {HMBlockNode, HMDraft, HMResourceFetchResult, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {getMetadataName} from './content'
import {blockToPlainText} from './content-to-text'
import type {MentionRef} from './models/inline-mentions'
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

/** Builds the heading outline of published block content. */
export function getNodesOutline(
  children: HMBlockNode[],
  entityId?: UnpackedHypermediaId,
  embeds?: HMResourceFetchResult[],
  resolvedNames: Readonly<Record<string, string>> = {},
  visitedEmbedIds: Set<string> = new Set(),
): NodesOutline {
  const outline: NodesOutline = []
  children.forEach((child) => {
    if (child.block.type === 'Heading') {
      outline.push({
        id: child.block.id,
        title: blockToPlainText(child.block, resolvedNames),
        entityId: entityId,
        children: child.children && getNodesOutline(child.children, entityId, embeds, resolvedNames, visitedEmbedIds),
      })
    } else if (child.block.type === 'Embed' && child.block.attributes?.view !== 'Card') {
      outline.push(...getEmbedOutline(child.block.id, child.block.link, embeds, resolvedNames, visitedEmbedIds))
    } else if (child.children) {
      outline.push(...getNodesOutline(child.children, entityId, embeds, resolvedNames, visitedEmbedIds))
    }
  })
  return outline
}

function getEmbedOutline(
  blockId: string,
  link: string,
  embedEntities: HMResourceFetchResult[] | undefined,
  resolvedNames: Readonly<Record<string, string>>,
  visitedEmbedIds: Set<string>,
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
      const embedBn = findContentBlock(embedEntity.document.content, embedId.blockRef)
      if (embedBn && embedBn.block.type === 'Heading') {
        outline.push({
          id: blockId,
          title: blockToPlainText(embedBn.block, resolvedNames),
          entityId: embedId,
          children: embedBn.children
            ? getNodesOutline(embedBn.children, embedId, embedEntities, resolvedNames, newVisitedEmbedIds)
            : [],
        })
      }
    } else {
      outline.push({
        id: blockId,
        title: getMetadataName(embedEntity?.document?.metadata),
        children: embedEntity?.document?.content
          ? getNodesOutline(embedEntity?.document?.content, embedId, embedEntities, resolvedNames, newVisitedEmbedIds)
          : [],
      })
    }
  }

  return outline
}

export function findContentBlock(content: HMBlockNode[], blockRef: string): HMBlockNode | null {
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

/** Builds the heading outline of draft editor blocks. */
export function getDraftNodesOutline(
  children: HMDraft['content'],
  parentEntityId?: UnpackedHypermediaId,
  embeds?: HMResourceFetchResult[],
  resolvedNames: Readonly<Record<string, string>> = {},
  visitedEmbedIds: Set<string> = new Set(),
): NodesOutline {
  const outline: NodesOutline = []
  children.forEach((child) => {
    if (child.type === 'heading') {
      const title = getInlineContentText(child.content, resolvedNames)
      outline.push({
        id: child.id,
        title: title || undefined,
        entityId: parentEntityId,
        children:
          child.children &&
          getDraftNodesOutline(child.children, parentEntityId, embeds, resolvedNames, visitedEmbedIds),
      })
    } else if (child.type === 'embed' && child.props?.view !== 'Card') {
      outline.push(...getEmbedOutline(child.id, child.props.url, embeds, resolvedNames, visitedEmbedIds))
    } else if (child.children) {
      outline.push(...getDraftNodesOutline(child.children, parentEntityId, embeds, resolvedNames, visitedEmbedIds))
    }
  })
  return outline
}

/** Collects the inline mention links in draft editor blocks to load their names. */
export function getDraftMentionRefs(blocks: HMDraft['content']): MentionRef[] {
  const refs: MentionRef[] = []
  function walkInline(content: HMInlineContent[]) {
    content.forEach((c) => {
      if (c.type === 'inline-embed') refs.push({link: c.link, mentionKind: c.mentionKind})
      else if (c.type === 'link') walkInline(c.content)
    })
  }
  function walk(blocks: HMDraft['content']) {
    blocks.forEach((block) => {
      if (Array.isArray(block.content)) walkInline(block.content)
      if (block.children) walk(block.children)
    })
  }
  walk(blocks)
  return refs
}

// Collects the plain text of editor inline content, descending into links
// so their text is kept and replacing mentions with their resolved names.
function getInlineContentText(content: HMInlineContent[], resolvedNames: Readonly<Record<string, string>>): string {
  return content
    .map((c) => {
      if (c.type === 'text') return c.text
      if (c.type === 'link') return getInlineContentText(c.content, resolvedNames)
      return (c.mentionKind ? resolvedNames[`${c.mentionKind}:${c.link}`] : undefined) ?? resolvedNames[c.link] ?? ''
    })
    .join('')
}
