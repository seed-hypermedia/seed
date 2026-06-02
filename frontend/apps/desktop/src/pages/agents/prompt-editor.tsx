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
}: {
  initialBlocks: HMBlockNode[]
  onChange: (blocks: HMBlockNode[]) => void
}) {
  return (
    <div className="border-input bg-background min-h-80 rounded-lg border p-3">
      <CommentEditor
        focusOnMount
        hideAvatar
        initialBlocks={initialBlocks}
        onContentChange={(blocks) => onChange(blocks)}
        handleSubmit={() => {}}
        submitButton={() => <></>}
      />
    </div>
  )
}
