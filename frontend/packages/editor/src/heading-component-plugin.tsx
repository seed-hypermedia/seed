import {createTipTapBlock} from './blocknote/core/extensions/Blocks/api/block'
import {updateBlockCommand} from './blocknote/core/api/blockManipulation/commands/updateBlock'
import {getBlockInfoFromPos} from './blocknote/core/extensions/Blocks/helpers/getBlockInfoFromPos'
import styles from './blocknote/core/extensions/Blocks/nodes/Block.module.css'
import {InputRule, mergeAttributes} from '@tiptap/core'
import {Plugin, PluginKey} from 'prosemirror-state'

/**
 * Compute the visual heading level for a heading node at the given doc
 * position. Top-level document headings are h2 — h1 is reserved for the
 * document title rendered above the editor body — and each level of
 * nesting demotes one step further, clamped to h6.
 */
function computeHeadingDepth(doc: any, pos: number): number {
  const $pos = doc.resolve(pos)
  let ancestors = 0
  for (let d = 0; d <= $pos.depth; d++) {
    if ($pos.node(d).type.name === 'blockNode') ancestors++
  }
  // `ancestors` is 1 for a top-level heading; +1 shifts the scale so the
  // first level is h2 rather than h1.
  return Math.min(Math.max(ancestors + 1, 2), 6)
}

const headingDepthNormalizerKey = new PluginKey('headingDepthNormalizer')

/**
 * Keeps each heading node's `level` attribute in sync with its actual
 * nesting depth in the doc tree. Runs once per dispatched transaction
 * that changes the doc, and is a no-op when every heading is already
 * at the right level — so it converges in one pass and does not loop.
 */
const headingDepthNormalizer = new Plugin({
  key: headingDepthNormalizerKey,
  appendTransaction(transactions, _oldState, newState) {
    if (!transactions.some((tr) => tr.docChanged)) return null

    let tr = newState.tr
    let modified = false

    newState.doc.descendants((node, pos) => {
      if (node.type.name !== 'heading') return
      const target = String(computeHeadingDepth(newState.doc, pos))
      if (node.attrs.level !== target) {
        tr = tr.setNodeMarkup(pos, undefined, {...node.attrs, level: target})
        modified = true
      }
    })

    return modified ? tr : null
  },
})

export const HMHeadingBlockContent = createTipTapBlock<'heading'>({
  name: 'heading',
  content: 'inline*',

  addAttributes() {
    return {
      level: {
        default: '2',
        // instead of "level" attributes, use "data-level"
        parseHTML: (element) => element.getAttribute('data-level'),
        renderHTML: (attributes) => {
          return {
            'data-level': attributes.level,
          }
        },
      },
      revision: {
        default: '',
        parseHTML: (element) => element.getAttribute('data-revision') || '',
        renderHTML: (attributes) => (attributes.revision ? {'data-revision': attributes.revision} : {}),
      },
    }
  },

  addInputRules() {
    return [
      new InputRule({
        find: new RegExp(`^#\\s$`),
        handler: ({state, chain, range}) => {
          // Resolve the enclosing block regardless of nesting depth — the
          // old `$pos.start() - 2` math assumed the paragraph was a direct
          // child of the top-level blockChildren and silently no-oped for
          // any nested paragraph (issue #490).
          const blockInfo = getBlockInfoFromPos(state, state.selection.from)
          chain()
            .command(
              updateBlockCommand(blockInfo.block.beforePos, {
                type: 'heading',
                props: {
                  level: '2',
                },
              }),
            )
            .deleteRange({from: range.from, to: range.to})
        },
      }),
    ]
  },

  parseHTML() {
    return [
      {
        tag: 'span[role="heading"]',
        attrs: {level: 2},
        node: 'heading',
        // priority: 500,
      },
      {
        tag: 'h1',
        attrs: {level: 2},
        node: 'heading',
      },
      {
        tag: 'h2',
        attrs: {level: 2},
        node: 'heading',
      },
      {
        tag: 'h3',
        attrs: {level: 3},
        node: 'heading',
      },
      {
        tag: 'h4',
        attrs: {level: 4},
        node: 'heading',
      },
      {
        tag: 'h5',
        attrs: {level: 5},
        node: 'heading',
      },
      {
        tag: 'h6',
        attrs: {level: 6},
        node: 'heading',
      },
    ]
  },

  renderHTML({HTMLAttributes, node}) {
    return [
      `h${node.attrs.level}`,
      mergeAttributes(HTMLAttributes, {
        // Heading typography (size, weight, color, line-height) is owned
        // by `.hm-prose h1..h6` in packages/ui/src/hm-prose.css. Emitting
        // Tailwind utility classes on the element itself — as the old
        // `headingVariants()` helper did — baked per-heading styling into
        // the DOM and overrode the prose class.
        class: `block-heading heading-content ${styles.blockContent}`,
        'data-content-type': this.name,
      }),
      0,
    ]
  },

  addProseMirrorPlugins() {
    return [headingDepthNormalizer]
  },
})

export const Heading = {
  propSchema: {
    listLevel: {
      default: '1',
    },
  },
  node: HMHeadingBlockContent,
}
