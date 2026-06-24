import {blocksToMarkdown} from '@seed-hypermedia/client'
import type {HMBlockNode, HMDocument} from '@seed-hypermedia/client/hm-types'
import {CommentEditor} from '@shm/editor/comment-editor'

/** Converts rich prompt blocks to the markdown sent to the agents service. */
export function promptBlocksToMarkdown(blocks: HMBlockNode[]): string {
  return blocksToMarkdown({metadata: {}, content: blocks} as HMDocument, {ipfsGateway: true})
    .replace(/^---\n---\n\n?/, '')
    .replace(/[ \t]*<!-- id:[^>]+ -->/g, '')
    .trim()
}

/** Rich-text prompt editor used for agent and trigger prompts. */
export function AgentPromptEditor({
  initialBlocks,
  onChange,
  focusOnMount = true,
}: {
  initialBlocks: HMBlockNode[]
  onChange: (blocks: HMBlockNode[]) => void
  focusOnMount?: boolean
}) {
  return (
    <div className="border-border bg-background min-h-80 rounded-md border p-3">
      <CommentEditor
        focusOnMount={focusOnMount}
        hideAvatar
        initialBlocks={initialBlocks}
        onContentChange={(blocks) => onChange(blocks)}
        handleSubmit={() => {}}
        submitButton={() => <></>}
      />
    </div>
  )
}
