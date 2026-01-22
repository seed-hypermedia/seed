import {mergeCSSClasses} from '../blocknote'
import styles from '../blocknote/core/extensions/Blocks/nodes/Block.module.css'
import {getBlockInfoFromPos} from '../blocknote/core/extensions/Blocks/helpers/getBlockInfoFromPos'
import {
  NodeViewProps,
  NodeViewWrapper,
  ReactNodeViewRenderer,
} from '@tiptap/react'
import {FC, useCallback} from 'react'
import {CodeBlock, CodeBlockOptions} from './code-block'
import {CodeBlockView} from './code-block-view'
import {LowlightPlugin} from './lowlight-plugin.js'

export interface CodeBlockLowlightOptions extends CodeBlockOptions {
  lowlight: any
  defaultLanguage: string | null | undefined
}

export const CodeBlockLowlight = CodeBlock.extend<CodeBlockLowlightOptions>({
  addOptions() {
    return {
      ...this.parent?.(),
      lowlight: {},
      defaultLanguage: null,
    }
  },

  addStorage() {
    return {
      blockNoteEditor: null as any,
    }
  },

  addNodeView() {
    const BlockContent: FC<NodeViewProps> = (props: NodeViewProps) => {
      const Content = CodeBlockView
      const blockContentDOMAttributes =
        this.options.domAttributes?.blockContent || {}
      const language = props.node.attrs.language

      // Get block ID and handle conversion
      const handleConvertToMermaidBlock = useCallback(
        (content: string) => {
          const {state} = this.editor
          const pos = props.getPos()

          if (typeof pos !== 'number') return

          const blockInfo = getBlockInfoFromPos(state, pos)
          if (!blockInfo) return

          const blockId = blockInfo.block.node.attrs.id

          // Get the BlockNoteEditor from storage
          const blockNoteEditor = this.storage.blockNoteEditor

          if (blockNoteEditor && blockId) {
            // Use replaceBlocks to convert code block to mermaid block
            blockNoteEditor.replaceBlocks(
              [blockId],
              [
                {
                  type: 'mermaid',
                  content: [
                    {
                      type: 'text',
                      text: content,
                      styles: {},
                    },
                  ],
                },
              ],
            )
          }
        },
        [props.getPos],
      )

      return (
        <NodeViewWrapper
          {...Object.fromEntries(
            Object.entries(blockContentDOMAttributes).filter(
              ([key]) => key !== 'class',
            ),
          )}
          className={mergeCSSClasses(
            // @ts-ignore
            styles.blockContent,
            blockContentDOMAttributes.class,
            language.length ? this.options.languageClassPrefix + language : '',
          )}
          data-content-type={props.node.type.name}
        >
          <Content
            props={props}
            languages={[...this.options.lowlight.listLanguages(), 'html'].sort(
              (a, b) => a.localeCompare(b),
            )}
            onConvertToMermaidBlock={
              this.storage.blockNoteEditor
                ? handleConvertToMermaidBlock
                : undefined
            }
          />
        </NodeViewWrapper>
      )
    }

    return ReactNodeViewRenderer(BlockContent, {
      className: styles.reactNodeViewRenderer,
    })
  },

  addProseMirrorPlugins() {
    return [
      ...(this.parent?.() || []),
      LowlightPlugin({
        name: this.name,
        lowlight: this.options.lowlight,
        defaultLanguage: this.options.defaultLanguage,
      }),
    ]
  },
})
