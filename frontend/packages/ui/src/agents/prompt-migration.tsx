import {replaceContentOps} from '@seed-hypermedia/client/apps'
import type {HMBlockNode, HMDocument, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {isMountableAgentServerUrl} from '@seed-hypermedia/apps-protocol'
import {FileText} from 'lucide-react'
import {useState} from 'react'
import {useAppsPublisher} from '../apps/publish'
import {Button} from '../button'
import {SizableText} from '../text'
import {toast} from '../toast'
import {useAgentDetail} from './models'
import {getAgentsPlatform} from './platform'

/** A top-level card embed: how a document lists a tool or page, not part of the instructions. */
function isCardEmbed(node: HMBlockNode): boolean {
  const block = node.block as {type?: string; attributes?: {view?: string}}
  return block.type === 'Embed' && block.attributes?.view === 'Card'
}

/**
 * Whether an agent's document holds its instructions yet. An agent's document is its system prompt;
 * one that has only card embeds (its tools and pages), or nothing, has not been given the prompt.
 */
export function agentDocumentHasInstructions(document: HMDocument): boolean {
  return (document.content ?? []).some((node) => !isCardEmbed(node))
}

/** The document body that carries `prompt` as the agent's instructions, keeping its card embeds after it. */
export function migratedAgentContent(document: HMDocument, prompt: HMBlockNode[]): HMBlockNode[] {
  return [...prompt, ...(document.content ?? []).filter(isCardEmbed)]
}

/**
 * Offered to a writer of an agent's document while its instructions still live in the agent's
 * settings: one click publishes the stored system prompt into the document, which is the agent's
 * prompt from then on (read at the start of each turn). Shows nothing once the document has
 * instructions, or when the stored prompt is not readable to this account.
 */
export function AgentPromptMigration({
  docId,
  document,
  canEdit,
}: {
  docId: UnpackedHypermediaId
  document: HMDocument
  canEdit: boolean
}) {
  const accountUid = getAgentsPlatform().useAccountUid()
  const serverUrl =
    typeof document.metadata.agentServerUrl === 'string' && isMountableAgentServerUrl(document.metadata.agentServerUrl)
      ? document.metadata.agentServerUrl
      : undefined
  const needsMigration = canEdit && !agentDocumentHasInstructions(document)
  const agent = useAgentDetail(needsMigration ? serverUrl : undefined, accountUid, docId.id)
  const publisher = useAppsPublisher()
  const [moving, setMoving] = useState(false)
  const stored = agent.data?.agent.definition.systemPrompt
  const prompt = Array.isArray(stored) ? (stored as unknown as HMBlockNode[]) : []
  if (!needsMigration || !prompt.length) return null

  async function move() {
    setMoving(true)
    try {
      const ops = replaceContentOps(document.content, migratedAgentContent(document, prompt))
      await publisher.update(docId, ops)
      toast.success('The agent’s instructions are now this document')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setMoving(false)
    }
  }

  return (
    <div
      role="status"
      className="border-border bg-muted/40 mx-auto my-4 flex w-full max-w-2xl items-start gap-3 rounded-lg border p-4"
    >
      <FileText className="text-muted-foreground mt-0.5 size-5 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Move this agent’s instructions into its document
        </SizableText>
        <SizableText size="sm" color="muted">
          This document is the agent’s system prompt. Its instructions still live in its settings: move them here to
          edit them like any document. The agent reads the latest published version at the start of each turn.
        </SizableText>
      </div>
      <Button size="sm" variant="default" className="shrink-0" disabled={moving} onClick={() => void move()}>
        {moving ? 'Moving…' : 'Move instructions'}
      </Button>
    </div>
  )
}
