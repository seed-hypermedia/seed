import type {AgentInfo, SessionModelOverride, Thoroughness} from '@seed-hypermedia/agents-protocol'
import {agentAccessCanChat, agentAccessCanWrite} from './access'
import {errorMessage} from './errors'
import {SessionModelBadge, type SessionModelPatch} from './header'
import {
  addOptimisticSessionMessage,
  addOptimisticSessionToCaches,
  describeAgentServer,
  useCreateAgentSessionOnServer,
  useMessageAgentSession,
  type AgentSessionDraftMessage,
} from './models'
import {useNavigate} from './navigation'
import type {AgentsRichEditorSubmitHandle} from './platform'
import {AgentRichMessageComposer} from './rich-message-composer'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Bot, Check, ChevronDown} from 'lucide-react'
import {useMemo, useRef, useState} from 'react'

/** One agent a new session can be started with. */
export type NewSessionAgent = {serverUrl: string; agent: AgentInfo}

/** Identity of a chosen agent; session and agent ids are only unique per server. */
export type NewSessionAgentKey = {serverUrl: string; agentId: string}

/** The model and delegation budget a draft session will start with. Empty means the agent's own. */
export type DraftModelChoice = {modelOverride?: SessionModelOverride; thoroughness?: Thoroughness}

/**
 * Keeps only what `agent` can run: an override survives when it is the agent's own pair or one of
 * its enabled models, so a choice made for another agent can never start a session here.
 */
export function choiceForAgent(choice: DraftModelChoice, agent: AgentInfo): DraftModelChoice {
  const {modelOverride, thoroughness} = choice
  const {definition} = agent
  const allowed = [{provider: definition.modelProvider, model: definition.model}, ...(definition.enabledModels ?? [])]
  const keep =
    !!modelOverride &&
    allowed.some((entry) => entry.provider === modelOverride.provider && entry.model === modelOverride.model)
  return {...(keep ? {modelOverride} : {}), ...(thoroughness ? {thoroughness} : {})}
}

/**
 * The draft composer shared by the Agents home page and an agent's Sessions tab: a message typed
 * here starts a session with the agent and opens it. Under the editor sit the agent slot — a
 * picker across `agents` on the home page, the fixed agent on its own page — and the model badge.
 * The model choice is held locally until the first send creates the session (nothing exists to
 * save it to before then), exactly as the sidebar's draft chat does. A user tool run from the
 * palette creates the session the same way the first send would.
 */
export function NewSessionComposer({
  agents,
  fixedAgent,
  accountUid,
  localServerUrl,
  defaultAgent,
  composerHandleRef,
  agentToolsLoading,
  disabledMessage,
}: {
  /** Agents the picker offers. Ignored when `fixedAgent` is set. */
  agents?: NewSessionAgent[]
  /** The one agent this composer addresses: the slot shows it and offers no picker. */
  fixedAgent?: NewSessionAgent
  accountUid: string | null | undefined
  localServerUrl: string | null | undefined
  /** Preselected agent, typically the one behind the most recent session; may arrive late. */
  defaultAgent?: NewSessionAgentKey
  /** External handle for imperative focus (e.g. the page's "New session" button). */
  composerHandleRef?: React.MutableRefObject<AgentsRichEditorSubmitHandle | null>
  /** True while the agent definition is still loading, for the tool palette's loading state. */
  agentToolsLoading?: boolean
  /** When set, the editor is replaced by this explanation. */
  disabledMessage?: React.ReactNode
}) {
  const navigate = useNavigate()
  // Only agents the account may actually chat with are offered.
  const chattable = useMemo(
    () => (fixedAgent ? [fixedAgent] : (agents ?? []).filter(({agent}) => agentAccessCanChat(agent.accessRole))),
    [agents, fixedAgent],
  )
  const [chosen, setChosen] = useState<NewSessionAgentKey | null>(null)
  // The first default that arrives is kept. It follows the most recent session, which changes as
  // activity lands, and the agent (and with it the model) must not change under someone typing.
  const [latchedDefault, setLatchedDefault] = useState<NewSessionAgentKey | undefined>(undefined)
  if (!latchedDefault && defaultAgent) setLatchedDefault(defaultAgent)
  const selected = useMemo(() => {
    if (fixedAgent) return fixedAgent
    const wanted = chosen ?? latchedDefault
    const match = wanted
      ? chattable.find(({serverUrl, agent}) => serverUrl === wanted.serverUrl && agent.id === wanted.agentId)
      : undefined
    return match ?? chattable[0]
  }, [fixedAgent, chosen, latchedDefault, chattable])

  const createSession = useCreateAgentSessionOnServer(accountUid)
  const messageSession = useMessageAgentSession(selected?.serverUrl, accountUid)
  // The choice is tagged with the agent it was made for. Only a choice made for the selected agent
  // is shown or sent, and it is re-checked against that agent's own models, so no render and no
  // send can pair one agent with another's model. Picking a different agent clears it outright.
  const [modelChoice, setModelChoice] = useState<{agentKey: string} & DraftModelChoice>({agentKey: ''})
  const selectedKey = selected ? `${selected.serverUrl}:${selected.agent.id}` : ''
  const activeChoice = useMemo<DraftModelChoice>(
    () => (selected && modelChoice.agentKey === selectedKey ? choiceForAgent(modelChoice, selected.agent) : {}),
    [modelChoice, selected, selectedKey],
  )
  const modelChoiceRef = useRef(activeChoice)
  modelChoiceRef.current = activeChoice

  // The session only exists once the user actually does something: the first send — or the first
  // user tool run — creates one and delivers that action in the same motion, so an abandoned draft
  // leaves no empty session behind.
  async function startDraftSession(): Promise<string> {
    if (!accountUid) throw new Error('Select an account first')
    if (!selected) throw new Error('Choose an agent first')
    const {serverUrl, agent} = selected
    // No title at creation: the agent names its session, with the server's fallback behind it.
    const result = await createSession.mutateAsync({serverUrl, agentId: agent.id, ...modelChoiceRef.current})
    if (result._ !== 'CreateSessionResponse') throw new Error('Unexpected CreateSession response')
    // Seed the caches before navigating so the session page shows the first message at once
    // instead of an empty transcript while the real fetch lands.
    const now = Date.now()
    addOptimisticSessionToCaches(serverUrl, accountUid, {
      id: result.sessionId,
      account: accountUid,
      agentId: agent.id,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
      ...modelChoiceRef.current,
    })
    return result.sessionId
  }

  const isSendingRef = useRef(false)
  async function handleSend(message: AgentSessionDraftMessage) {
    // The composer already cleared itself; a second send racing the create must not open a second
    // session.
    if (!accountUid || !selected || isSendingRef.current) return
    isSendingRef.current = true
    const {serverUrl, agent} = selected
    try {
      const sessionId = await startDraftSession()
      // Send the stamped drafts, so the durable echo replaces the optimistic row by identity.
      const messages = addOptimisticSessionMessage(serverUrl, accountUid, sessionId, [message])
      messageSession.mutate({sessionId, message: messages})
      navigate({key: 'agent-session', agentId: agent.id, sessionId, serverUrl})
    } catch (caught) {
      toast.error(errorMessage(caught, 'Could not start the session'))
    } finally {
      isSendingRef.current = false
    }
  }

  if (!selected) {
    return (
      <SizableText size="sm" color="muted" className="block px-3 py-3 text-center">
        {agents?.length ? 'None of your agents accept chat.' : 'Create an agent to start a session.'}
      </SizableText>
    )
  }

  const canWrite = agentAccessCanWrite(selected.agent.accessRole)
  const showServer = new Set(chattable.map((option) => option.serverUrl)).size > 1

  return (
    <div className="flex flex-col">
      <AgentRichMessageComposer
        // Keyed by agent so the editor's captured callbacks never send to the previous choice.
        key={selectedKey}
        isBusy={createSession.isLoading || messageSession.isLoading}
        isStreaming={false}
        stopPending={false}
        serverUrl={selected.serverUrl}
        accountId={accountUid ?? null}
        disabledMessage={disabledMessage}
        agentTools={selected.agent.definition.tools}
        agentToolsLoading={agentToolsLoading}
        focusOnMount={false}
        canInvokeTools={canWrite}
        composerHandleRef={composerHandleRef}
        onToolStartSession={startDraftSession}
        onToolSessionStarted={(sessionId) =>
          navigate({key: 'agent-session', agentId: selected.agent.id, sessionId, serverUrl: selected.serverUrl})
        }
        bordered={false}
        onSend={(message) => void handleSend(message)}
        onStop={() => {}}
      />
      <div className="flex flex-none flex-wrap items-center justify-between gap-2 px-3 pb-2">
        {fixedAgent ? (
          <div className="flex max-w-72 min-w-0 items-center gap-1.5 px-1.5 py-1">
            <Bot className="text-muted-foreground size-4 flex-none" />
            <SizableText size="sm" className="min-w-0 truncate font-medium">
              {selected.agent.definition.name || 'Agent'}
            </SizableText>
          </div>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Choose the agent for the new session"
                className="hover:bg-muted flex max-w-72 min-w-0 items-center gap-1.5 rounded-md px-1.5 py-1 text-left"
              >
                <Bot className="text-muted-foreground size-4 flex-none" />
                <SizableText size="sm" className="min-w-0 truncate font-medium">
                  {selected.agent.definition.name || 'Agent'}
                </SizableText>
                {showServer ? (
                  <SizableText size="xs" color="muted" className="truncate">
                    {describeAgentServer(selected.serverUrl, localServerUrl)}
                  </SizableText>
                ) : null}
                <ChevronDown className="text-muted-foreground size-3 flex-none" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-[60vh] min-w-64 overflow-y-auto">
              <DropdownMenuLabel className="text-muted-foreground text-xs font-medium">
                Start a session with
              </DropdownMenuLabel>
              {chattable.map(({serverUrl, agent}) => {
                const isActive = serverUrl === selected.serverUrl && agent.id === selected.agent.id
                return (
                  <DropdownMenuItem
                    key={`${serverUrl}:${agent.id}`}
                    onClick={() => {
                      if (isActive) return
                      // A new agent starts from its own default model settings.
                      setChosen({serverUrl, agentId: agent.id})
                      setModelChoice({agentKey: ''})
                    }}
                  >
                    <Bot />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="truncate">{agent.definition.name || 'Agent'}</span>
                      {showServer ? (
                        <span className="text-muted-foreground truncate text-xs">
                          {describeAgentServer(serverUrl, localServerUrl)}
                        </span>
                      ) : null}
                    </span>
                    {isActive ? <Check className="ml-auto" /> : null}
                  </DropdownMenuItem>
                )
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {/* The same per-session model switcher a live session shows, so the first turn already
            runs on the chosen model rather than the user fixing it after the fact. */}
        <SessionModelBadge
          // Remounted per agent, so a pending reasoning commit from the last agent dies with it.
          key={selectedKey}
          agent={selected.agent}
          agentId={selected.agent.id}
          serverUrl={selected.serverUrl}
          modelOverride={activeChoice.modelOverride}
          thoroughness={activeChoice.thoroughness}
          canWrite={canWrite}
          draft={{
            onChange: (patch: SessionModelPatch) =>
              setModelChoice((current) => ({
                ...(current.agentKey === selectedKey ? current : {}),
                agentKey: selectedKey,
                ...(patch.modelOverride !== undefined ? {modelOverride: patch.modelOverride ?? undefined} : {}),
                ...(patch.thoroughness !== undefined ? {thoroughness: patch.thoroughness ?? undefined} : {}),
              })),
          }}
        />
      </div>
    </div>
  )
}
