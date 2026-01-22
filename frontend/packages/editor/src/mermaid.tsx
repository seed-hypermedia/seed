import {blocksContentContext} from '@shm/ui/blocks-content'
import {Button} from '@shm/ui/button'
import {Textarea} from '@shm/ui/components/textarea'
import {Separator} from '@shm/ui/separator'
import {cn} from '@shm/ui/utils'
import mermaid from 'mermaid'
import {NodeSelection} from 'prosemirror-state'
import {useCallback, useContext, useEffect, useRef, useState} from 'react'
import {RiCodeBoxLine, RiCodeSSlashLine, RiEyeLine} from 'react-icons/ri'
import {findNextBlock, findPreviousBlock} from './block-utils'
import {BlockNoteEditor} from './blocknote/core/BlockNoteEditor'
import {selectableNodeTypes} from './blocknote/core/extensions/BlockManipulation/BlockManipulationExtension'
import {Block} from './blocknote/core/extensions/Blocks/api/blockTypes'
import {defaultProps} from './blocknote/core/extensions/Blocks/api/defaultBlocks'
import {getBlockInfoFromSelection} from './blocknote/core/extensions/Blocks/helpers/getBlockInfoFromPos'
import {createReactBlockSpec} from './blocknote/react/ReactBlockSpec'
import {HMBlockSchema} from './schema'

// Initialize mermaid with default config
mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
})

export const MermaidBlock = createReactBlockSpec({
  type: 'mermaid',
  propSchema: {
    ...defaultProps,
    text: {
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
  const [showPreview, setShowPreview] = useState(false)
  const mermaidRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const tiptapEditor = editor._tiptapEditor
  const selection = tiptapEditor.state.selection
  const containerRef = useRef<HTMLDivElement>(null)
  const [error, setError] = useState<string | null>(null)
  const [svgContent, setSvgContent] = useState<string>('')

  const blocksContentCtx = useContext(blocksContentContext)
  const commentStyle = blocksContentCtx?.commentStyle ?? false

  // @ts-expect-error
  const mermaidText = block.content[0]?.text ?? ''

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

  const renderMermaid = useCallback(async () => {
    if (!mermaidText) {
      setError(null)
      setSvgContent('')
      return
    }

    try {
      const id = `mermaid-${block.id}-${Date.now()}`
      const {svg} = await mermaid.render(id, mermaidText)
      setSvgContent(svg)
      setError(null)
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : 'Invalid diagram'
      setError(errorMessage)
      setSvgContent('')
    }
  }, [mermaidText, block.id])

  // Render diagram when preview is shown or when text changes in preview mode
  useEffect(() => {
    if (showPreview || !opened) {
      renderMermaid()
    }
  }, [showPreview, mermaidText, opened, renderMermaid])

  useEffect(() => {
    if (opened && inputRef.current) {
      inputRef.current.focus()
      const length = inputRef.current.value.length
      inputRef.current.setSelectionRange(length, length)
    }
  }, [opened])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    const key = e.key

    if (key === 'ArrowUp' && !e.shiftKey) {
      const textarea = inputRef.current
      if (textarea) {
        const cursorPos = textarea.selectionStart
        const textBeforeCursor = textarea.value.substring(0, cursorPos)
        const hasNewlineBefore = textBeforeCursor.includes('\n')

        // Only navigate if cursor is on first line
        if (!hasNewlineBefore) {
          e.preventDefault()
          navigateToPrevBlock()
        }
      }
    } else if (key === 'ArrowDown' && !e.shiftKey) {
      const textarea = inputRef.current
      if (textarea) {
        const cursorPos = textarea.selectionStart
        const textAfterCursor = textarea.value.substring(cursorPos)
        const hasNewlineAfter = textAfterCursor.includes('\n')

        // Only navigate if cursor is on last line
        if (!hasNewlineAfter) {
          e.preventDefault()
          navigateToNextBlock()
        }
      }
    } else if (key === 'Backspace') {
      const blockInfo = getBlockInfoFromSelection(tiptapEditor.state)
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
  }

  const navigateToPrevBlock = () => {
    const {state, view} = tiptapEditor
    const prevBlockInfo = findPreviousBlock(view, state.selection.from)

    if (prevBlockInfo) {
      const {prevBlock, prevBlockPos} = prevBlockInfo
      const prevNode = prevBlock.firstChild!
      const prevNodePos = prevBlockPos + 1

      if (selectableNodeTypes.includes(prevNode.type.name)) {
        const selection = NodeSelection.create(state.doc, prevNodePos)
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
  }

  const navigateToNextBlock = () => {
    const {state, view} = tiptapEditor
    const nextBlockInfo = findNextBlock(view, state.selection.from)

    if (nextBlockInfo) {
      const {nextBlock, nextBlockPos} = nextBlockInfo
      const nextNode = nextBlock.firstChild!
      const nextNodePos = nextBlockPos + 1

      if (selectableNodeTypes.includes(nextNode.type.name)) {
        const selection = NodeSelection.create(state.doc, nextNodePos)
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
  }

  const placeholderDiagram = `graph TD
    A[Start] --> B{Decision}
    B -->|Yes| C[Result 1]
    B -->|No| D[Result 2]`

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
          'items-center overflow-auto',
        )}
      >
        {!opened && (
          <>
            {error ? (
              <div className="w-full rounded-md bg-red-100 p-3 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                <p className="font-mono text-sm">Mermaid Error: {error}</p>
              </div>
            ) : svgContent ? (
              <div
                ref={mermaidRef}
                className="mermaid-diagram w-full"
                dangerouslySetInnerHTML={{__html: svgContent}}
              />
            ) : (
              <p className="text-muted-foreground text-base select-none">
                Mermaid Diagram
              </p>
            )}
          </>
        )}
        {opened && showPreview && (
          <>
            {error ? (
              <div className="w-full rounded-md bg-red-100 p-3 text-red-600 dark:bg-red-900/30 dark:text-red-400">
                <p className="font-mono text-sm">Mermaid Error: {error}</p>
              </div>
            ) : svgContent ? (
              <div
                ref={mermaidRef}
                className="mermaid-diagram w-full"
                dangerouslySetInnerHTML={{__html: svgContent}}
              />
            ) : (
              <p className="text-muted-foreground text-base select-none">
                Enter diagram code below
              </p>
            )}
          </>
        )}
      </div>
      {opened && (
        <div className="flex flex-col">
          <Separator />
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-muted-foreground text-xs">
              Mermaid Diagram Code
            </span>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  // Convert to code block with mermaid language
                  editor.replaceBlocks(
                    [block.id],
                    [
                      {
                        type: 'code-block',
                        props: {
                          language: 'mermaid',
                        },
                        content: [
                          {
                            type: 'text',
                            text: mermaidText,
                            styles: {},
                          },
                        ],
                      },
                    ],
                  )
                }}
                className="gap-1"
                title="Convert to Code Block"
              >
                <RiCodeBoxLine size={14} />
                <span className="text-xs">To Code</span>
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowPreview(!showPreview)}
                className="gap-1"
              >
                {showPreview ? (
                  <>
                    <RiCodeSSlashLine size={14} />
                    <span className="text-xs">Hide Preview</span>
                  </>
                ) : (
                  <>
                    <RiEyeLine size={14} />
                    <span className="text-xs">Preview</span>
                  </>
                )}
              </Button>
            </div>
          </div>
          <div className="relative flex min-h-7 items-center px-[16px] py-[10px]">
            <Textarea
              ref={inputRef}
              onBlur={() => {
                // Delay to allow button clicks to register
                setTimeout(() => setOpened(false), 150)
              }}
              onKeyDown={handleKeyDown}
              placeholder={placeholderDiagram}
              value={mermaidText}
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
              className="min-h-[100px] w-full font-mono text-sm"
            />
          </div>
        </div>
      )}
    </div>
  )
}
