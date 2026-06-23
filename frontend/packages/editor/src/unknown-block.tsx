import {AlertCircle, ChevronDown, ChevronRight} from 'lucide-react'
import {useState} from 'react'
import {Block, BlockNoteEditor, defaultProps} from './blocknote/core'
import {createReactBlockSpec} from './blocknote/react'
import {HMBlockSchema} from './schema'

export const UnknownBlock = createReactBlockSpec({
  type: 'unknown',
  propSchema: {
    ...defaultProps,
    originalType: {
      default: '',
    },
    originalData: {
      default: '',
    },
  },
  containsInlineContent: true,
  render: ({block, editor}: {block: Block<HMBlockSchema>; editor: BlockNoteEditor<HMBlockSchema>}) => (
    <UnknownBlockRender block={block} editor={editor} />
  ),
})

function UnknownBlockRender({block, editor}: {block: Block<HMBlockSchema>; editor: BlockNoteEditor<HMBlockSchema>}) {
  const [expanded, setExpanded] = useState(false)
  const originalType = (block.props as any).originalType || 'Unknown'
  const originalData = (block.props as any).originalData || '{}'

  let parsedData: any = {}
  try {
    parsedData = JSON.parse(originalData)
  } catch {
    parsedData = {raw: originalData}
  }

  return (
    <div
      className="block-content block-unknown flex flex-1 flex-col overflow-hidden rounded-md border border-red-300 bg-red-100 dark:border-red-800 dark:bg-red-950"
      contentEditable={false}
    >
      <div className="flex cursor-pointer items-center gap-2 p-2" onClick={() => setExpanded(!expanded)}>
        <AlertCircle className="size-4 text-red-600 dark:text-red-400" />
        <span className="flex-1 font-sans text-sm text-red-700 dark:text-red-300">
          Unsupported Block: {originalType}
        </span>
        {expanded ? (
          <ChevronDown className="size-4 text-red-600 dark:text-red-400" />
        ) : (
          <ChevronRight className="size-4 text-red-600 dark:text-red-400" />
        )}
      </div>
      {expanded && (
        <pre className="mx-2 mb-2 overflow-auto rounded-md border border-red-200 bg-red-50/60 p-2 dark:border-red-900 dark:bg-red-950/60">
          <code className="font-mono text-xs wrap-break-word text-red-900 dark:text-red-200">
            {JSON.stringify(parsedData, null, 2)}
          </code>
        </pre>
      )}
    </div>
  )
}
