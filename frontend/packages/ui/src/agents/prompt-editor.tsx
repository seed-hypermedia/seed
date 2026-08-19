import {blocksToMarkdown, trimTrailingEmptyBlocks} from '@seed-hypermedia/client'
import type {HMBlockNode, HMDocument} from '@seed-hypermedia/client/hm-types'
import type {AgentPromptBlock} from '@seed-hypermedia/agents-protocol'
import {getAgentsPlatform} from './platform'

/** Converts rich prompt blocks to display/draft markdown (embeds stay as links). */
export function promptBlocksToMarkdown(blocks: HMBlockNode[]): string {
  return blocksToMarkdown({metadata: {}, content: blocks} as HMDocument, {ipfsGateway: true})
    .replace(/^---\n---\n\n?/, '')
    .replace(/[ \t]*<!-- id:[^>]+ -->/g, '')
    .trim()
}

/**
 * Prepares rich prompt blocks for an agents-service request. Prompts are sent
 * as blocks (not flattened markdown) so Embed blocks survive and the service
 * can inline the referenced hypermedia content into the model-facing prompt.
 */
export function promptBlocksForRequest(blocks: HMBlockNode[]): AgentPromptBlock[] {
  return trimTrailingEmptyBlocks(blocks) as unknown as AgentPromptBlock[]
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
  const {CommentEditor} = getAgentsPlatform()
  return (
    // The editor draws its own rounded border; this wrapper only stretches the editing area so a
    // prompt gets a roomy click target without adding a second frame around the editor's own.
    <div className="[&_.comment-editor]:min-h-80">
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
