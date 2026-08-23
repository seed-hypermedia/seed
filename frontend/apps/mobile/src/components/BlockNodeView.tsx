import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import React from 'react'
import {StyleSheet, Text, View} from 'react-native'
import {EmbedBlockView} from './EmbedBlockView'
import {QueryBlockView} from './QueryBlockView'

/**
 * Minimal hypermedia block renderer: text-bearing blocks, query blocks and
 * embeds, with indented children. Shared by every document surface.
 */
export function BlockNodeView({node, depth = 0}: {node: HMBlockNode; depth?: number}) {
  const block = node.block
  const indent = {marginLeft: depth > 0 ? 12 : 0}

  if (block?.type === 'Query') {
    return (
      <View style={indent}>
        <QueryBlockView block={block} />
        <BlockChildren node={node} depth={depth} />
      </View>
    )
  }
  if (block?.type === 'Embed' && 'link' in block && block.link) {
    return (
      <View style={indent}>
        <EmbedBlockView link={block.link} />
        <BlockChildren node={node} depth={depth} />
      </View>
    )
  }

  const text = block && 'text' in block ? block.text : null
  return (
    <View style={indent}>
      {text != null && text !== '' && (
        <Text
          style={[
            styles.blockText,
            block?.type === 'Heading' && styles.headingText,
            block?.type === 'Code' && styles.codeText,
          ]}
        >
          {text}
        </Text>
      )}
      <BlockChildren node={node} depth={depth} />
    </View>
  )
}

function BlockChildren({node, depth}: {node: HMBlockNode; depth: number}) {
  if (!node.children?.length) return null
  return (
    <>
      {node.children.map((child, index) => (
        <BlockNodeView key={child.block?.id ?? index} node={child} depth={depth + 1} />
      ))}
    </>
  )
}

const styles = StyleSheet.create({
  blockText: {
    fontSize: 16,
    color: '#ddd',
    marginBottom: 10,
    lineHeight: 22,
  },
  headingText: {
    fontSize: 20,
    fontWeight: '600',
    color: '#fff',
  },
  codeText: {
    fontFamily: 'Menlo',
    fontSize: 14,
    backgroundColor: '#16302f',
    padding: 8,
    borderRadius: 6,
  },
})
