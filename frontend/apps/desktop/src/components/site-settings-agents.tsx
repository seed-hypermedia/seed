import {useUpdateHomeDocument} from '@/models/site'
import {useNavigate} from '@/utils/useNavigate'
import type {HMMetadata, UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {useIsSiteOwner} from '@shm/shared/models/capabilities'
import {useResource} from '@shm/shared/models/entity'
import {useSelectedAccountId} from '@shm/ui/agents/account'
import {normalizeAgentServerUrl, type AgentInfo} from '@shm/ui/agents/client'
import {
  describeAgentServer,
  isLocalAgentServer,
  useAgentList,
  useAgentServerUrls,
  useLocalAgentServerUrl,
  useSetAgentPublicChat,
  useSetAgentPublicRead,
} from '@shm/ui/agents/models'
import {getAgentsPlatform} from '@shm/ui/agents/platform'
import {
  canPublishAgent,
  makeSpaceAgentDefault,
  parseSpaceAgentIds,
  spaceAgentsMetadata,
} from '@shm/ui/agents/space-agents'
import {Button} from '@shm/ui/button'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@shm/ui/select-dropdown'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {cn} from '@shm/ui/utils'
import {Bot, Plus, Settings, X} from 'lucide-react'
import {useState} from 'react'

/**
 * Space Settings → Agents.
 *
 * Two things a space says about agents, both stored in its home document so every reader of the
 * space — including gateway visitors who have never heard of this space's server — picks them up
 * from the same signed document that names the space: which server hosts them (`agentServerUrl`),
 * and which of that server's agents the space publishes (`spaceAgents`, see @shm/ui/agents/space-agents).
 *
 * Both are chosen from what the app already knows about rather than typed: the server from the list
 * this app talks to, the agent from that server's public agents. Only public agents are offered —
 * opening an agent to the world is a decision made on the agent, not a side effect of listing it
 * here. The published order carries exactly one meaning, the default (the agent a new visitor opens
 * on), so that is all the list offers: a button to promote an agent, not a way to arrange them.
 */
export function SpaceAgentsSettings({siteId}: {siteId: UnpackedHypermediaId}) {
  const resource = useResource(siteId)
  const document = resource.data?.type === 'document' ? resource.data.document : undefined
  const {isSiteOwner, isLoading: isOwnerLoading} = useIsSiteOwner(siteId.uid)
  const updateHome = useUpdateHomeDocument(siteId.uid)
  // Agent-server calls are signed by the person configuring the space, not by the space account:
  // a space can be administered through an agent capability by someone who holds no key for it,
  // and the agents they can publish are the ones their own account administers.
  const accountUid = useSelectedAccountId()
  const knownServers = useAgentServerUrls()
  const localServerUrl = useLocalAgentServerUrl()
  const openServerSettings = (getAgentsPlatform().useOpenServerSettings ?? (() => null))()
  const navigate = useNavigate()

  const [serverDraft, setServerDraft] = useState<string | null>(null)
  const [idsDraft, setIdsDraft] = useState<string[] | null>(null)
  // Remounts the add-an-agent dropdown after each pick, so it returns to its prompt. It is an
  // action, not a value: a Select left holding the agent it just published would read as a setting.
  const [addKey, setAddKey] = useState(0)

  const metadata = document?.metadata
  const publishedServer = safeServerUrl(typeof metadata?.agentServerUrl === 'string' ? metadata.agentServerUrl : '')
  const publishedIds = parseSpaceAgentIds(metadata?.spaceAgents)
  const serverValue = serverDraft ?? publishedServer ?? ''
  const idsValue = idsDraft ?? publishedIds

  // A dropdown choice is committed the moment it is made, so the agent list can follow the draft
  // rather than waiting for a save.
  const agentList = useAgentList(serverValue || undefined, accountUid)
  const serverAgents = agentList.data ?? []
  const setPublicRead = useSetAgentPublicRead(serverValue || undefined, accountUid)
  const setPublicChat = useSetAgentPublicChat(serverValue || undefined, accountUid)

  if (resource.isInitialLoading || isOwnerLoading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    )
  }
  if (!document || !metadata) {
    return <SizableText color="muted">This account doesn't have a space yet.</SizableText>
  }
  if (!isSiteOwner) {
    return (
      <>
        <SizableText size="2xl" weight="bold">
          Agents
        </SizableText>
        <SizableText color="muted">Only the space owner can edit these settings.</SizableText>
      </>
    )
  }

  const isDirty = serverValue !== (publishedServer ?? '') || !sameOrder(idsValue, publishedIds)
  const canSave = isDirty && !updateHome.isPending
  const isLocal = !!serverValue && isLocalAgentServer(serverValue, localServerUrl.data)

  // The desktop's own local server is deliberately absent: it is reachable only from this computer,
  // so advertising it to a space's readers publishes an address none of them can resolve.
  //
  // Whatever the space already advertises stays selectable even if this app has not configured it,
  // so opening the page on another machine can never silently drop the space's server.
  const serverOptions = Array.from(
    new Set([
      ...(publishedServer ? [publishedServer] : []),
      ...(knownServers.data ?? []).filter((serverUrl) => !isLocalAgentServer(serverUrl, localServerUrl.data)),
    ]),
  )

  const publishedRows = idsValue.map((agentId) => ({
    agentId,
    agent: serverAgents.find((agent) => agent.id === agentId),
  }))
  const unpublished = serverAgents.filter((agent) => !idsValue.includes(agent.id))
  const addableAgents = unpublished.filter(canPublishAgent)
  const privateCount = unpublished.length - addableAgents.length

  function chooseServer(next: string) {
    const serverUrl = next === NO_SERVER ? '' : next
    setServerDraft(serverUrl)
    // Published ids name agents on one particular server and mean nothing on another, so switching
    // servers empties the list — and switching back before saving restores what was published.
    setIdsDraft(serverUrl === (publishedServer ?? '') ? null : [])
  }

  async function handleSave() {
    try {
      const nextMetadata: HMMetadata = {
        ...metadata,
        agentServerUrl: serverValue || undefined,
        spaceAgents: spaceAgentsMetadata(idsValue),
      }
      await updateHome.mutateAsync({metadata: nextMetadata})
      toast.success('Space agents updated')
      setServerDraft(null)
      setIdsDraft(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update space agents')
    }
  }

  async function setAccess(agent: AgentInfo, access: AgentAccess) {
    try {
      if (access === 'private') {
        // Turning public read off clears public chat on the server, so this one call is enough.
        await setPublicRead.mutateAsync({agentId: agent.id, publicRead: false})
      } else {
        if (!agent.publicRead) await setPublicRead.mutateAsync({agentId: agent.id, publicRead: true})
        await setPublicChat.mutateAsync({agentId: agent.id, publicChat: access === 'chat'})
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to change who can reach this agent')
    }
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <SizableText size="2xl" weight="bold">
          Agents
        </SizableText>
        <Button variant="default" disabled={!canSave} onClick={handleSave}>
          {updateHome.isPending ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <div className="flex flex-col gap-2">
        <SizableText weight="medium">Agents server</SizableText>
        <div className="flex items-center gap-2">
          <Select value={serverValue || NO_SERVER} onValueChange={chooseServer}>
            <SelectTrigger className="h-9 max-w-md">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_SERVER}>No agents server</SelectItem>
              {serverOptions.map((serverUrl) => (
                <SelectItem key={serverUrl} value={serverUrl}>
                  {describeAgentServer(serverUrl, localServerUrl.data)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {openServerSettings ? (
            <Tooltip content="Add or remove agent servers">
              <Button variant="outline" size="sm" onClick={openServerSettings}>
                <Settings className="size-4" />
                Manage servers
              </Button>
            </Tooltip>
          ) : null}
        </div>
        <SizableText size="xs" color="muted">
          Everyone reading this space connects to this server, alongside their own, to reach the agents you publish.
        </SizableText>
        {isLocal ? (
          // Not offered by the dropdown, but a space that already advertises it needs to be told why
          // that is broken rather than left to wonder where its readers' agents went.
          <SizableText size="xs" className="text-destructive">
            Local Agents runs only on this computer, so visitors to your space cannot reach it. Choose a server they
            can.
          </SizableText>
        ) : null}
      </div>

      {/* Nothing to publish to until a server is chosen: the ids in this list name agents on one
          particular server, so without one the list would be a set of addresses to nowhere. */}
      {serverValue ? (
        <div className="flex flex-col gap-2">
          <SizableText weight="medium">Published agents</SizableText>
          <SizableText size="xs" color="muted">
            These appear in the agents panel for everyone visiting this space. The default is the one a new visitor
            opens on.
          </SizableText>

          {/* One card: the published agents and the control that adds to them are the same list, and
              reading them as two stacked sections made adding look like a separate setting. */}
          <div className="border-border divide-border divide-y overflow-hidden rounded-lg border">
            {publishedRows.map(({agentId, agent}, index) => (
              <PublishedAgentRow
                key={agentId}
                agent={agent}
                isDefault={index === 0}
                onOpen={agent ? () => navigate({key: 'agent', agentId, serverUrl: serverValue}) : undefined}
                onMakeDefault={index === 0 ? undefined : () => setIdsDraft(makeSpaceAgentDefault(idsValue, agentId))}
                onRemove={() => setIdsDraft(idsValue.filter((id) => id !== agentId))}
                onAccessChange={agent ? (access) => setAccess(agent, access) : undefined}
                accessDisabled={setPublicRead.isLoading || setPublicChat.isLoading}
              />
            ))}
            {!publishedRows.length ? (
              <div className="px-3 py-4">
                <SizableText size="xs" color="muted">
                  No agents published yet — visitors to this space find nothing to chat with.
                </SizableText>
              </div>
            ) : null}
            <div className="bg-muted/30 flex items-center gap-2 px-3 py-2">
              <Plus className="text-muted-foreground size-4 flex-none" />
              <AddAgentControl
                key={addKey}
                agents={addableAgents}
                agentList={agentList}
                onAdd={(agent) => {
                  setAddKey((key) => key + 1)
                  setIdsDraft([...idsValue, agent.id])
                }}
              />
            </div>
          </div>

          {privateCount ? (
            <SizableText size="xs" color="muted">
              {privateCount === 1 ? 'One agent on this server is' : `${privateCount} agents on this server are`} private
              and cannot be published. Give an agent public access from its own page first.
            </SizableText>
          ) : null}
        </div>
      ) : null}
    </>
  )
}

/** Sentinel for the "no agents server" choice: a Select item cannot carry an empty value. */
const NO_SERVER = 'none'

function PublishedAgentRow({
  agent,
  isDefault,
  onOpen,
  onMakeDefault,
  onRemove,
  onAccessChange,
  accessDisabled,
}: {
  /** Absent when the published id names no agent this account can see on the selected server. */
  agent: AgentInfo | undefined
  isDefault: boolean
  onOpen?: () => void
  onMakeDefault?: () => void
  onRemove: () => void
  onAccessChange?: (access: AgentAccess) => void
  accessDisabled: boolean
}) {
  return (
    <div
      data-testid="published-agent"
      role={onOpen ? 'button' : undefined}
      tabIndex={onOpen ? 0 : undefined}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (onOpen && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          onOpen()
        }
      }}
      className={cn('flex items-center gap-3 px-3 py-2.5', onOpen && 'hover:bg-muted/50 cursor-pointer')}
    >
      <div className="bg-primary/10 text-primary flex size-9 flex-none items-center justify-center rounded-lg">
        <Bot className="size-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <SizableText weight="bold" className="truncate">
            {agent ? agent.definition.name : 'Unavailable agent'}
          </SizableText>
          {isDefault ? (
            <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[10px] font-bold uppercase">
              Default
            </span>
          ) : null}
        </div>
        {!agent ? (
          <SizableText size="xs" color="muted" className="block">
            Not on this server, or not visible to you
          </SizableText>
        ) : !agent.publicRead ? (
          <SizableText size="xs" className="text-destructive block">
            Private — readers of this space cannot see it
          </SizableText>
        ) : null}
      </div>
      {/* The row opens the agent; its controls act on the space, so they must not also navigate. */}
      <div className="flex items-center gap-2" onClick={(event) => event.stopPropagation()}>
        {onMakeDefault ? (
          <Tooltip content="Open the agents panel on this agent for new visitors">
            <Button variant="outline" size="sm" onClick={onMakeDefault}>
              Make default
            </Button>
          </Tooltip>
        ) : null}
        {agent && onAccessChange ? (
          <AccessSelect agent={agent} disabled={accessDisabled} onChange={onAccessChange} />
        ) : null}
        <Tooltip content="Remove from this space">
          <Button variant="ghost" size="sm" aria-label="Remove from this space" onClick={onRemove}>
            <X className="size-4" />
          </Button>
        </Tooltip>
      </div>
    </div>
  )
}

/** The dropdown that publishes one more agent, plus the states in which there is nothing to offer. */
function AddAgentControl({
  agents,
  agentList,
  onAdd,
}: {
  agents: AgentInfo[]
  agentList: {isInitialLoading: boolean; isError: boolean; error: unknown}
  onAdd: (agent: AgentInfo) => void
}) {
  if (agentList.isInitialLoading) return <Spinner />
  if (agentList.isError) {
    return (
      <SizableText size="xs" className="text-destructive">
        {agentList.error instanceof Error ? agentList.error.message : 'Could not reach the agents server'}
      </SizableText>
    )
  }
  return (
    <Select
      onValueChange={(agentId) => {
        const agent = agents.find((candidate) => candidate.id === agentId)
        if (agent) onAdd(agent)
      }}
    >
      <SelectTrigger className="h-8 max-w-xs border-none bg-transparent shadow-none" size="sm">
        <SelectValue placeholder={agents.length ? 'Add an agent…' : 'No public agents to add'} />
      </SelectTrigger>
      <SelectContent>
        {agents.map((agent) => (
          <SelectItem key={agent.id} value={agent.id}>
            {agent.definition.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** Who, besides the agent's own collaborators, may reach it. */
type AgentAccess = 'private' | 'read' | 'chat'

const ACCESS_OPTIONS: {value: AgentAccess; label: string; hint: string}[] = [
  {value: 'private', label: 'Private', hint: 'Only collaborators. Readers of this space see nothing.'},
  {value: 'read', label: 'Anyone can view', hint: 'Visitors see the agent but cannot start a chat.'},
  {value: 'chat', label: 'Anyone can chat', hint: 'Visitors can open the panel and start chatting.'},
]

/** An absent role comes from the owner's own listing, so it counts as ownership. */
function isAgentOwner(agent: AgentInfo): boolean {
  return agent.accessRole === undefined || agent.accessRole === 'owner'
}

function agentAccess(agent: AgentInfo): AgentAccess {
  if (!agent.publicRead) return 'private'
  return agent.publicChat ? 'chat' : 'read'
}

/**
 * Who can reach one agent, as a single choice rather than two switches: public chat requires public
 * read, and offering them separately invites the state where chat is asked for and silently refused.
 */
function AccessSelect({
  agent,
  disabled,
  onChange,
}: {
  agent: AgentInfo
  disabled: boolean
  onChange: (access: AgentAccess) => void
}) {
  const access = agentAccess(agent)
  if (!isAgentOwner(agent)) {
    return (
      <SizableText size="xs" color="muted">
        {ACCESS_OPTIONS.find((option) => option.value === access)?.label}
      </SizableText>
    )
  }
  return (
    <Tooltip content={ACCESS_OPTIONS.find((option) => option.value === access)?.hint ?? ''}>
      <div>
        <Select value={access} onValueChange={(value) => onChange(value as AgentAccess)} disabled={disabled}>
          <SelectTrigger className="h-8 w-40" size="sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ACCESS_OPTIONS.map((option) => (
              <SelectItem key={option.value} value={option.value}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </Tooltip>
  )
}

/** The server URL to use, or null when the setting is empty or not an http(s) address. */
function safeServerUrl(value: string): string | null {
  if (!value.trim()) return null
  try {
    return normalizeAgentServerUrl(value)
  } catch {
    return null
  }
}

function sameOrder(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index])
}
