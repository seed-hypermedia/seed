import {blocksContentContext} from '@shm/ui/blocks-content'
import {Textarea} from '@shm/ui/components/textarea'
import {Separator} from '@shm/ui/separator'
import {cn} from '@shm/ui/utils'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import {NodeSelection} from 'prosemirror-state'
import {useCallback, useContext, useEffect, useRef, useState} from 'react'
import {findNextBlock, findPreviousBlock} from './block-utils'
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import {selectableNodeTypes} from './blocknote/core/extensions/BlockManipulation/BlockManipulationExtension'
import {Block} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {defaultProps} from './blocknote/core/extensions/Blocks/api/defaultBlocks'
import {getBlockInfoFromSelection} from './blocknote/core/extensions/Blocks/helpers/getBlockInfoFromPos'
import {createReactBlockSpec} from './blocknote/react/ReactBlockSpec'
import {HMBlockSchema} from './schema'

export const MathBlock = (type: 'math') =>
  createReactBlockSpec({
    type,
    propSchema: {
      ...defaultProps,
      text: {
        default: '',
      },
      src: {
        default: '',
      },
    },
    containsInlineContent: true,

    render: ({
      block,
      editor,
    }: {
      block: Block<HMBlockSchema>
      editor: BlockNoteEditor<HMBlockSchema>
    }) => Render(block, editor),
  })

const Render = (
  block: Block<HMBlockSchema>,
  editor: BlockNoteEditor<HMBlockSchema>,
) => {
  const [selected, setSelected] = useState(false)
  const [opened, setOpened] = useState(false)
  const mathRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const tiptapEditor = editor._tiptapEditor
  const selection = tiptapEditor.state.selection
  const containerRef = useRef<HTMLDivElement>(null)
  const [isContentSmallerThanContainer, setIsContentSmallerThanContainer] =
    useState(true)

  // Use context directly to avoid error when not in a provider
  const blocksContentCtx = useContext(blocksContentContext)
  const commentStyle = blocksContentCtx?.commentStyle ?? false

  useEffect(() => {
    const selectedNode = getBlockInfoFromSelection(tiptapEditor.state)
    if (selectedNode && selectedNode.block.node.attrs.id) {
      if (
        selectedNode.block.node.attrs.id === block.id &&
        selectedNode.block.beforePos + 1 === selection.$anchor.pos
      ) {
        setSelected(true)
        setOpened(true)
      } else if (selectedNode.block.node.attrs.id !== block.id) {
        setSelected(false)
        setOpened(false)
      }
    }
  }, [selection, block.id])

  useEffect(() => {
    if (mathRef.current) {
      if (block.content[0]) {
        try {
          mathRef.current.style.color = ''
          // @ts-expect-error
          katex.render(block.content[0].text, mathRef.current, {
            throwOnError: true,
            displayMode: true,
          })
        } catch (e) {
          if (e instanceof katex.ParseError) {
            mathRef.current.innerText =
              "Error in LaTeX '" +
              // @ts-expect-error
              block.content[0].text +
              "':\n" +
              e.message.split(':')[1]
            mathRef.current.style.color = 'red'
          } else {
            throw e
          }
        }
      } else {
        katex.render('\\color{gray} TeX math', mathRef.current, {
          throwOnError: false,
          displayMode: true,
        })
      }
    }
  }, [block.content])

  useEffect(() => {
    if (opened && inputRef.current) {
      // @ts-ignore
      inputRef.current.focus()
      const length = inputRef.current.value.length
      inputRef.current.setSelectionRange(length, length)
    }
  }, [opened])

  // Function to measure content and container widths
  const measureContentAndContainer = useCallback(() => {
    if (mathRef.current && containerRef.current) {
      // Get the actual rendered content width from the first child of mathRef
      // (KaTeX creates nested elements)
      const contentElement = mathRef.current.firstElementChild as HTMLElement
      const contentWidth = contentElement
        ? contentElement.offsetWidth
        : mathRef.current.offsetWidth
      const containerWidth = containerRef.current.offsetWidth

      // Account for padding
      const containerPaddingHorizontal = 24
      const adjustedContainerWidth = containerWidth - containerPaddingHorizontal

      // Update state based on comparison
      const shouldCenter = contentWidth < adjustedContainerWidth
      if (shouldCenter !== isContentSmallerThanContainer) {
        setIsContentSmallerThanContainer(shouldCenter)
      }
    }
  }, [isContentSmallerThanContainer])

  // Update measurements when content changes
  // @ts-ignore
  useEffect(() => {
    // @ts-expect-error
    if (block.content[0] && block.content[0].text) {
      // Use a timeout to ensure KaTeX has finished rendering
      const timerId = setTimeout(() => {
        measureContentAndContainer()
      }, 50)

      return () => clearTimeout(timerId)
    }
  }, [block.content, measureContentAndContainer])

  // Also measure after mathRef updates (when KaTeX rendering is done)
  // @ts-ignore
  useEffect(() => {
    if (mathRef.current) {
      // Use MutationObserver to detect when KaTeX finishes rendering
      const observer = new MutationObserver((mutations) => {
        measureContentAndContainer()
      })

      observer.observe(mathRef.current, {
        childList: true,
        subtree: true,
        attributes: true,
      })

      return () => {
        observer.disconnect()
      }
    }
  }, [measureContentAndContainer])

  // Add resize observer to handle container size changes
  // @ts-ignore
  useEffect(() => {
    const container = containerRef.current

    if (container) {
      const resizeObserver = new ResizeObserver(() => {
        measureContentAndContainer()
      })

      resizeObserver.observe(container)

      return () => {
        resizeObserver.disconnect()
      }
    }
  }, [measureContentAndContainer])

  return (
    <div
      contentEditable={false}
      className={cn(
        block.type,
        'flex w-full flex-col overflow-hidden rounded-md border-2 transition-colors',
        selected
          ? 'border-foreground/20 dark:border-foreground/30 bg-muted'
          : commentStyle
          ? 'border-border bg-black/5 dark:bg-white/10'
          : 'bg-muted border-border',
        'hover:bg-black/3 dark:hover:bg-white/3',
      )}
    >
      <div
        ref={containerRef}
        onClick={() => {
          if (selected && !opened) {
            const selectedNode = getBlockInfoFromSelection(tiptapEditor.state)
            if (
              selectedNode?.block.node.attrs.id === block.id &&
              selectedNode.block.beforePos + 1 === selection.$anchor.pos
            ) {
              setSelected(true)
              setOpened(true)
            }
          }
        }}
        className={cn(
          'relative flex min-h-7 w-full flex-col px-3 py-[10px] select-none',
          isContentSmallerThanContainer
            ? 'items-center overflow-hidden'
            : 'items-start overflow-scroll',
        )}
      >
        <p ref={mathRef} className="text-base select-none" />
      </div>
      {opened && (
        <div className="flex flex-col">
          <Separator />
          <div className="relative flex min-h-7 items-center px-[16px] py-[10px]">
            <Textarea
              ref={inputRef}
              onBlur={() => setOpened(false)}
              onKeyDown={(e) => {
                const key = e.key

                if (key === 'ArrowUp') {
                  e.preventDefault()
                  const {state, view} = tiptapEditor
                  const prevBlockInfo = findPreviousBlock(
                    view,
                    state.selection.from,
                  )

                  if (prevBlockInfo) {
                    const {prevBlock, prevBlockPos} = prevBlockInfo
                    const prevNode = prevBlock.firstChild!
                    const prevNodePos = prevBlockPos + 1

                    if (selectableNodeTypes.includes(prevNode.type.name)) {
                      const selection = NodeSelection.create(
                        state.doc,
                        prevNodePos,
                      )
                      view.dispatch(state.tr.setSelection(selection))
                    } else {
                      editor.setTextCursorPosition(
                        editor.getTextCursorPosition().prevBlock!,
                        'end',
                      )
                    }

                    view.focus()
                    setOpened(false)
                  }
                } else if (key === 'ArrowDown') {
                  e.preventDefault()
                  const {state, view} = tiptapEditor
                  const nextBlockInfo = findNextBlock(
                    view,
                    state.selection.from,
                  )

                  if (nextBlockInfo) {
                    const {nextBlock, nextBlockPos} = nextBlockInfo
                    const nextNode = nextBlock.firstChild!
                    const nextNodePos = nextBlockPos + 1

                    if (selectableNodeTypes.includes(nextNode.type.name)) {
                      const selection = NodeSelection.create(
                        state.doc,
                        nextNodePos,
                      )
                      view.dispatch(state.tr.setSelection(selection))
                    } else {
                      editor.setTextCursorPosition(
                        editor.getTextCursorPosition().nextBlock!,
                        'start',
                      )
                    }

                    view.focus()
                    setOpened(false)
                  }
                } else if (key === 'Backspace') {
                  const blockInfo = getBlockInfoFromSelection(
                    tiptapEditor.state,
                  )
                  if (
                    blockInfo.block.node.attrs.id === block.id &&
                    !blockInfo.blockContent.node.textContent.length
                  ) {
                    const {state, view} = tiptapEditor
                    view.dispatch(
                      state.tr.delete(
                        blockInfo.block.beforePos + 1,
                        blockInfo.block.afterPos - 1,
                      ),
                    )
                    editor.focus()
                  }
                }
              }}
              placeholder="E = mc^2"
              // @ts-expect-error
              value={block.content[0]?.text ?? ''}
              onChange={(e) => {
                const newText = e.target.value
                // @ts-expect-error
                if (newText !== block.content?.[0]?.text) {
                  editor.updateBlock(
                    block,
                    // @ts-ignore
                    {
                      ...block,
                      content: [
                        {
                          type: 'text',
                          text: newText,
                          styles: {},
                        },
                      ],
                    },
                    true,
                  )
                }
              }}
              className="w-full"
            />
          </div>
        </div>
      )}
    </div>
  )
}
