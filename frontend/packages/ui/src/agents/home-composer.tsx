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
import {useEffect, useMemo, useRef, useState} from 'react'

/** One agent the home composer can start a session with. */
export type HomeComposerAgent = {serverUrl: string; agent: AgentInfo}

/** Identity of a chosen agent; session and agent ids are only unique per server. */
export type HomeComposerAgentKey = {serverUrl: string; agentId: string}

/**
 * The composer at the foot of the Agents home page: a message typed here starts a session with
 * the chosen agent and opens it. The agent picker and the model badge sit under the editor; the
 * model choice is held locally until the first send creates the session (nothing exists to save
 * it to before then), exactly as the sidebar's draft chat does.
 */
export function HomeSessionComposer({
  agents,
  accountUid,
  localServerUrl,
  defaultAgent,
}: {
  agents: HomeComposerAgent[]
  accountUid: string | null | undefined
  localServerUrl: string | null | undefined
  /** Preselected agent, typically the one behind the most recent session; may arrive late. */
  defaultAgent?: HomeComposerAgentKey
}) {
  const navigate = useNavigate()
  // Only agents the account may actually chat with are offered.
  const chattable = useMemo(() => agents.filter(({agent}) => agentAccessCanChat(agent.accessRole)), [agents])
  const [chosen, setChosen] = useState<HomeComposerAgentKey | null>(null)
  const selected = useMemo(() => {
    const wanted = chosen ?? defaultAgent
    const match = wanted
      ? chattable.find(({serverUrl, agent}) => serverUrl === wanted.serverUrl && agent.id === wanted.agentId)
      : undefined
    return match ?? chattable[0]
  }, [chosen, defaultAgent, chattable])

  const createSession = useCreateAgentSessionOnServer(accountUid)
  const messageSession = useMessageAgentSession(selected?.serverUrl, accountUid)
  const [modelChoice, setModelChoice] = useState<{modelOverride?: SessionModelOverride; thoroughness?: Thoroughness}>(
    {},
  )
  const modelChoiceRef = useRef(modelChoice)
  modelChoiceRef.current = modelChoice
  // A model chosen for one agent means nothing to another: switching agents starts from its default.
  const selectedKey = selected ? `${selected.serverUrl}:${selected.agent.id}` : ''
  useEffect(() => {
    setModelChoice({})
  }, [selectedKey])

  const isSendingRef = useRef(false)
  async function handleSend(message: AgentSessionDraftMessage) {
    // The composer already cleared itself; a second send racing the create must not open a second
    // session.
    if (!accountUid || !selected || isSendingRef.current) return
    isSendingRef.current = true
    const {serverUrl, agent} = selected
    try {
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
      const messages = addOptimisticSessionMessage(serverUrl, accountUid, result.sessionId, [message])
      messageSession.mutate({sessionId: result.sessionId, message: messages})
      navigate({key: 'agent-session', agentId: agent.id, sessionId: result.sessionId, serverUrl})
    } catch (caught) {
      toast.error(errorMessage(caught, 'Could not start the session'))
    } finally {
      isSendingRef.current = false
    }
  }

  if (!selected) {
    return (
      <SizableText size="sm" color="muted" className="block px-3 py-3 text-center">
        {agents.length ? 'None of your agents accept chat.' : 'Create an agent to start a session.'}
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
        agentTools={selected.agent.definition.tools}
        focusOnMount={false}
        canInvokeTools={canWrite}
        bordered={false}
        onSend={(message) => void handleSend(message)}
        onStop={() => {}}
      />
      <div className="flex flex-none flex-wrap items-center justify-between gap-2 px-3 pb-2">
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
                  onClick={() => setChosen({serverUrl, agentId: agent.id})}
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
        {/* The same per-session model switcher a live session shows, so the first turn already
            runs on the chosen model rather than the user fixing it after the fact. */}
        <SessionModelBadge
          agent={selected.agent}
          agentId={selected.agent.id}
          serverUrl={selected.serverUrl}
          modelOverride={modelChoice.modelOverride}
          thoroughness={modelChoice.thoroughness}
          canWrite={canWrite}
          draft={{
            onChange: (patch: SessionModelPatch) =>
              setModelChoice((current) => ({
                ...current,
                ...(patch.modelOverride !== undefined ? {modelOverride: patch.modelOverride ?? undefined} : {}),
                ...(patch.thoroughness !== undefined ? {thoroughness: patch.thoroughness ?? undefined} : {}),
              })),
          }}
        />
      </div>
    </div>
  )
}
