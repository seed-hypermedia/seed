import {findNextBlock, findPreviousBlock} from '@/block-utils'
import {BlockNoteEditor} from '@/blocknote/core/BlockNoteEditor'
import {Block} from '@/blocknote/core/extensions/Blocks/api/blockTypes'
import {defaultProps} from '@/blocknote/core/extensions/Blocks/api/defaultBlocks'
import {getBlockInfoFromSelection} from '@/blocknote/core/extensions/Blocks/helpers/getBlockInfoFromPos'
import {createReactBlockSpec} from '@/blocknote/react/ReactBlockSpec'
import {HMBlockSchema} from '@/schema'
import {TextArea} from '@tamagui/input'
import {Separator} from '@tamagui/separator'
import {XStack, YStack} from '@tamagui/stacks'
import {SizableText} from '@tamagui/text'
import katex from 'katex'
import 'katex/dist/katex.min.css'
import {NodeSelection} from 'prosemirror-state'
import {useCallback, useEffect, useRef, useState} from 'react'
import {useDocContentContext} from '../../ui/src/document-content'
import {selectableNodeTypes} from './blocknote/core/extensions/BlockManipulation/BlockManipulationExtension'

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
  const [error, setError] = useState<string>()
  const {comment} = useDocContentContext()

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
          katex.render(block.content[0].text, mathRef.current, {
            throwOnError: true,
            displayMode: true,
          })
        } catch (e) {
          if (e instanceof katex.ParseError) {
            mathRef.current.innerText =
              "Error in LaTeX '" +
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
      const containerPaddingHorizontal = 24 // $3 in most Tamagui themes is around 12px per side
      const adjustedContainerWidth = containerWidth - containerPaddingHorizontal

      // Update state based on comparison
      const shouldCenter = contentWidth < adjustedContainerWidth
      if (shouldCenter !== isContentSmallerThanContainer) {
        setIsContentSmallerThanContainer(shouldCenter)
      }
    }
  }, [isContentSmallerThanContainer])

  // Update measurements when content changes
  useEffect(() => {
    if (block.content[0] && block.content[0].text) {
      // Use a timeout to ensure KaTeX has finished rendering
      const timerId = setTimeout(() => {
        measureContentAndContainer()
      }, 50)

      return () => clearTimeout(timerId)
    }
  }, [block.content, measureContentAndContainer])

  // Also measure after mathRef updates (when KaTeX rendering is done)
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
    <YStack
      backgroundColor={selected ? '$color3' : comment ? '$color5' : '$color4'}
      borderColor={selected ? '$color8' : 'transparent'}
      borderWidth={2}
      borderRadius="$2"
      overflow="hidden"
      hoverStyle={{
        backgroundColor: '$color3',
      }}
      // @ts-ignore
      contentEditable={false}
      className={block.type}
      group="item"
      outlineWidth="$0"
    >
      <YStack
        minHeight="$7"
        paddingVertical="10px"
        position="relative"
        userSelect="none"
        overflow={isContentSmallerThanContainer ? 'hidden' : 'scroll'}
        paddingHorizontal="$3"
        width="100%"
        ref={containerRef}
        onPress={() => {
          if (selected && !opened) {
            const selectedNode = getBlockInfoFromSelection(tiptapEditor.state)
            if (selectedNode && selectedNode.block.node.attrs.id) {
              if (
                selectedNode.block.node.attrs.id === block.id &&
                selectedNode.block.beforePos + 1 === selection.$anchor.pos
              ) {
                setSelected(true)
                setOpened(true)
              }
            }
          }
        }}
        ai={isContentSmallerThanContainer ? 'center' : 'flex-start'}
      >
        <SizableText ref={mathRef} userSelect="none" />
      </YStack>
      {opened && (
        <YStack>
          <Separator backgroundColor="$color12" />
          <XStack
            minHeight="$7"
            paddingVertical="10px"
            paddingHorizontal="16px"
            position="relative"
            ai="center"
          >
            <TextArea
              ref={inputRef}
              onBlur={(e) => {
                // if (!selected)
                setOpened(false)
              }}
              onKeyDown={(e) => {
                if (e.nativeEvent.key === 'ArrowUp') {
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
                    // editor.focus()
                    view.focus()
                    setOpened(false)
                  }
                  return
                } else if (e.nativeEvent.key === 'ArrowDown') {
                  e.preventDefault()
                  const {state, view} = tiptapEditor
                  let nextBlockInfo = findNextBlock(view, state.selection.from)
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
                  return
                } else if (e.nativeEvent.key === 'Backspace') {
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
                  return
                }
              }}
              width={'100%'}
              placeholder="E = mc^2"
              value={block.content[0] ? block.content[0].text : ''}
              onChange={(e) => {
                // @ts-ignore
                const newText = e.target?.value ?? e.nativeEvent.text ?? ''

                if (newText !== block.content?.[0]?.text)
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
              }}
            />
          </XStack>
        </YStack>
      )}
    </YStack>
  )
}
