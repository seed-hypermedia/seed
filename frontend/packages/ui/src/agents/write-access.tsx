import {createCapability} from '@seed-hypermedia/client'
import type {HMCapability, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useCapabilities} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useUniversalAppContext, useUniversalClient} from '@shm/shared/routing'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useMutation} from '@tanstack/react-query'
import {FileText, Globe, Lock} from 'lucide-react'
import type {LucideIcon} from 'lucide-react'
import {SizableText} from '../text'

/**
 * Where an agent's signing key may publish in the space that holds its document: the whole space,
 * its own document and everything under it, or nowhere (only the agent key's own space, which
 * nobody browses). Capabilities cannot be revoked, so a scope can only be widened later.
 */
export type AgentWriteScope = 'document' | 'space' | 'none'

const SCOPE_RANK: Record<AgentWriteScope, number> = {none: 0, document: 1, space: 2}

/** Whether `next` gives the agent more than `current`. */
export function widensAgentWriteScope(current: AgentWriteScope, next: AgentWriteScope) {
  return SCOPE_RANK[next] > SCOPE_RANK[current]
}

export const AGENT_WRITE_SCOPE_OPTIONS: {
  scope: AgentWriteScope
  label: string
  description: string
  icon: LucideIcon
}[] = [
  {
    scope: 'document',
    label: 'Its own document',
    description: 'It can edit its document and publish its tools, pages and notes under it.',
    icon: FileText,
  },
  {
    scope: 'space',
    label: 'The whole space',
    description: 'It can publish and edit anywhere in this space, like any writer.',
    icon: Globe,
  },
  {
    scope: 'none',
    label: 'Nothing here',
    description: 'It can only publish into its own account, which you will not see unless it links it.',
    icon: Lock,
  },
]

/** The widest scope the capabilities on the agent's document give any of its accounts. */
export function agentWriteScopeOf(
  capabilities: HMCapability[] | undefined,
  agentAccountIds: string[],
  docId: UnpackedHypermediaId,
): AgentWriteScope {
  let scope: AgentWriteScope = 'none'
  const docPath = docId.path ?? []
  for (const cap of capabilities ?? []) {
    if (!agentAccountIds.includes(cap.accountUid) || cap.grantId.uid !== docId.uid) continue
    if (cap.role !== 'writer' && cap.role !== 'agent') continue
    const capPath = cap.grantId.path ?? []
    if (cap.role === 'agent' || !capPath.length) return 'space'
    if (capPath.length <= docPath.length && capPath.every((segment, index) => docPath[index] === segment))
      scope = 'document'
  }
  return scope
}

/** The agent's current write scope at its document, from the space's capabilities. */
export function useAgentWriteScope(docId: UnpackedHypermediaId | null, agentAccountIds: string[]) {
  const capabilities = useCapabilities(docId)
  return {
    scope: docId ? agentWriteScopeOf(capabilities.data, agentAccountIds, docId) : ('none' as const),
    isLoading: capabilities.isLoading,
  }
}

/**
 * Signs a WRITER capability from `ownerUid` (the space owner) to the agent's account for `scope`
 * and publishes it. `none` grants nothing.
 */
export async function grantAgentWriteAccess({
  client,
  ownerUid,
  agentAccountId,
  docId,
  scope,
}: {
  client: ReturnType<typeof useUniversalClient>
  ownerUid: string
  agentAccountId: string
  docId: UnpackedHypermediaId
  scope: AgentWriteScope
}) {
  if (scope === 'none') return
  if (ownerUid !== docId.uid) throw new Error('Only the owner of this space can give an agent write access here')
  if (!client.getSigner) throw new Error('Signing is unavailable')
  const path = scope === 'document' && docId.path?.length ? '/' + docId.path.join('/') : undefined
  const blob = await createCapability(
    {delegateUid: agentAccountId, role: 'WRITER', path, label: 'Agent write access'},
    client.getSigner(ownerUid),
  )
  await client.publish(blob)
  invalidateQueries([queryKeys.CAPABILITIES, docId.uid])
  invalidateQueries([queryKeys.DOCUMENT_COLLABORATORS, docId.uid])
}

/** Grants the agent a wider write scope, pushing the grant to the space's site. */
export function useGrantAgentWriteAccess(docId: UnpackedHypermediaId | null) {
  const client = useUniversalClient()
  const {onPushPublished} = useUniversalAppContext()
  return useMutation({
    mutationFn: async (input: {ownerUid: string; agentAccountId: string; scope: AgentWriteScope}) => {
      if (!docId) throw new Error('This agent has no document')
      await grantAgentWriteAccess({client, docId, ...input})
      onPushPublished?.(hmId(docId.uid))
      onPushPublished?.(docId)
    },
  })
}

/**
 * A radio list of the three write scopes. `minimum` disables the scopes below the current one
 * (capabilities cannot be revoked); `disabled` locks the whole choice.
 */
export function AgentWriteScopePicker({
  value,
  onChange,
  minimum,
  disabled,
}: {
  value: AgentWriteScope
  onChange: (scope: AgentWriteScope) => void
  minimum?: AgentWriteScope
  disabled?: boolean
}) {
  return (
    <div role="radiogroup" aria-label="What this agent can write" className="flex flex-col gap-1">
      {AGENT_WRITE_SCOPE_OPTIONS.map((option) => {
        const below = minimum ? SCOPE_RANK[option.scope] < SCOPE_RANK[minimum] : false
        const selected = value === option.scope
        const Icon = option.icon
        return (
          <button
            key={option.scope}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={disabled || below}
            onClick={() => onChange(option.scope)}
            className={`flex items-start gap-3 rounded-md border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
              selected ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/60'
            }`}
          >
            <Icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <span className="flex flex-col gap-0.5">
              <SizableText size="sm" weight="medium">
                {option.label}
              </SizableText>
              <SizableText size="xs" color="muted">
                {option.description}
              </SizableText>
            </span>
          </button>
        )
      })}
    </div>
  )
}
