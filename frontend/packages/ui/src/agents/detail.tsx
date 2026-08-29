import {
  type AgentCollaboratorInfo,
  type AgentCollaboratorRole,
  type AgentDefinition,
  type AgentModelRef,
  type AgentToolInfo,
  type AgentToolInput,
  type AgentTriggerInfo,
  type AgentTriggerInput,
  type AgentTriggerSource,
  type SessionInfo,
  type SigningIdentity,
  getAgentWebhookUrl,
} from './client'
import {
  addOptimisticSessionMessage,
  addOptimisticSessionToCaches,
  type AgentSessionDraftMessage,
  getDefaultAgentServerUrl,
  isLocalAgentServer,
  useAgentCollaborators,
  useAgentDetail,
  useAgentList,
  useAgentAccountsSync,
  useAgentServerHealth,
  useAgentServerUrl,
  useLocalAgentServerUrl,
  useAgentTools,
  useAgentTrigger,
  useAgentTriggers,
  useAgentWebSocketSubscription,
  useCreateAgentSession,
  useCreateAgentTrigger,
  useCreateSigningIdentity,
  useDeleteAgent,
  useDeleteAgentTool,
  useDeleteAgentTrigger,
  useInviteAgentCollaborator,
  useMessageAgentSession,
  useModelProviders,
  useProviderModels,
  useRemoveAgentCollaborator,
  useSetAgentPublicChat,
  useSetAgentPublicRead,
  useSaveAgentTool,
  useSigningIdentities,
  useUpdateAgent,
  useUpdateAgentTrigger,
  useUpdateSigningIdentity,
} from './models'
import {SessionStatusDot, SubSessionsDisclosure} from './session-children'
import {useSelectedAccountId} from './account'
import {useClickNavigate, useNavigate} from './navigation'
import {markdownBlockNodesToHMBlockNodes, parseMarkdown} from '@seed-hypermedia/client'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {formattedDateMedium} from '@shm/shared/utils/date'
import {abbreviateUid} from '@shm/shared/utils/abbreviate'
import {useAccount} from '@shm/shared/models/entity'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useRouteLink} from '@shm/shared/routing'
import {Button} from '@shm/ui/button'
import {copyTextToClipboard} from '../copy-to-clipboard'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@shm/ui/components/alert-dialog'
import {DialogDescription, DialogTitle} from '@shm/ui/components/dialog'
import {Input} from '@shm/ui/components/input'
import {Switch} from '@shm/ui/components/switch'
import {Textarea} from '@shm/ui/components/textarea'
import {AccountSearchInput, type SearchResult} from '@shm/ui/collaborators-page'
import {Container, PanelContainer} from '@shm/ui/container'
import {OptionsDropdown} from '@shm/ui/options-dropdown'
import {SizableText} from '@shm/ui/text'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {
  ArrowRight,
  ArrowRightLeft,
  Copy,
  ExternalLink,
  Globe,
  Info,
  KeyRound,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
  X,
} from 'lucide-react'
import {HMIcon} from '@shm/ui/hm-icon'
import React, {useEffect, useMemo, useRef, useState} from 'react'
import {getSeedTool} from '@seed-hypermedia/agents-protocol'
import {
  AGENT_EXECUTE_TOOL,
  AGENT_PUBLISH_GRANT,
  AGENT_SEARCH_TOOL,
  AGENT_WEB_SEARCH_TOOL,
  DEFAULT_AGENT_TOOLS,
  normalizeStoredAgentTools,
  getToolAvailability,
  type AgentServerWebCapabilities,
} from './agent-tools'
import {AgentMemoryTab} from './memory'
import {AgentMcpServersSection} from './mcp-servers'
import {TriggerSourceFields, summarizeTriggerSource} from './trigger-types'
import {
  AddModelProviderDialog,
  EditAgentAccountDialog,
  EditAgentNameDialog,
  EnableWindowsHypervisorDialog,
  type AgentAccountRenameStatus,
} from './dialogs'
import {AgentHeader, AgentSubpageHeader, type AgentPageTab} from './header'
import {MoveAgentDialog} from './move-agent-dialog'
import {modelReasoningSupport, type ReasoningLevel} from '@seed-hypermedia/agents-protocol'
import {ProviderModelSelect} from './provider-model-select'
import {coerceReasoningLevel, ReasoningSlider} from './reasoning-select'
import {pickDefaultProviderModel} from './model-utils'
import {AgentPromptEditor, promptBlocksForRequest, promptBlocksToMarkdown} from './prompt-editor'
import {AgentsNoAccountPage} from './no-account'
import {agentAccessCanChat, agentAccessCanWrite} from './access'
import {AgentRichMessageComposer} from './rich-message-composer'
import {type AgentsRichEditorSubmitHandle} from './platform'

function AgentDetailPage({
  agentId,
  routeServerUrl,
  tab = 'sessions',
  triggerId,
  memoryPath,
}: {
  agentId: string
  routeServerUrl?: string
  tab?: AgentPageTab
  triggerId?: string
  /** Memory file the route asked to open, set when a tool row linked to it. */
  memoryPath?: string
}) {
  const selectedAccountId = useSelectedAccountId()
  const navigate = useNavigate()
  const replaceRoute = useNavigate('replace')
  const clickNavigate = useClickNavigate()
  const serverUrlQuery = useAgentServerUrl()
  const localServerUrl = useLocalAgentServerUrl()
  const serverUrl = routeServerUrl || serverUrlQuery.data || getDefaultAgentServerUrl() || ''
  const serverHealth = useAgentServerHealth(serverUrl)
  const agent = useAgentDetail(serverUrl, selectedAccountId, agentId)
  // GetAgent returns every session including sub-sessions; the tab renders children nested under
  // their parent's disclosure, so the flat list must hold top-level rows only or they show twice.
  const topLevelSessions = useMemo(
    () => (agent.data?.sessions ?? []).filter((session) => !session.parentSessionId),
    [agent.data?.sessions],
  )
  const triggers = useAgentTriggers(serverUrl, selectedAccountId, agentId)
  const createSession = useCreateAgentSession(serverUrl, selectedAccountId)
  const messageSession = useMessageAgentSession(serverUrl, selectedAccountId)
  const updateAgent = useUpdateAgent(serverUrl, selectedAccountId)
  const updateSigningIdentity = useUpdateSigningIdentity(serverUrl, selectedAccountId)
  const deleteAgentDialog = useAppDialog(DeleteAgentDialog, {isAlert: true})
  const moveAgentDialog = useAppDialog(MoveAgentDialog)
  const signingIdentities = useSigningIdentities(serverUrl, selectedAccountId, agentId)
  const createSigningIdentity = useCreateSigningIdentity(serverUrl, selectedAccountId)
  const createTriggerDialog = useAppDialog(CreateAgentTriggerDialog)
  const editNameDialog = useAppDialog(EditAgentNameDialog)
  const modelProviders = useModelProviders(serverUrl, selectedAccountId, agentId)
  const collaborators = useAgentCollaborators(serverUrl, selectedAccountId, agentId)
  const allAgents = useAgentList(serverUrl, selectedAccountId)
  const addProviderDialog = useAppDialog(AddModelProviderDialog)
  useAgentWebSocketSubscription(serverUrl, selectedAccountId, `agents/${agentId}`)
  const accessRole = agent.data?.agent.accessRole ?? 'owner'
  const canWrite = agentAccessCanWrite(accessRole)
  // Chatters (public chat) can start sessions here but cannot edit the agent or run session tools.
  const canChat = agentAccessCanChat(accessRole)
  const isOwner = accessRole === 'owner'
  const [name, setName] = useState('')
  const [modelProvider, setModelProvider] = useState('')
  const [model, setModel] = useState('')
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel | undefined>(undefined)
  const [enabledModels, setEnabledModels] = useState<AgentModelRef[]>([])
  const providerModels = useProviderModels(serverUrl, selectedAccountId, modelProvider, agentId)
  const selectedProviderType = modelProviders.data?.find((provider) => provider.name === modelProvider)?.type
  const [systemPrompt, setSystemPrompt] = useState<HMBlockNode[]>([])
  const [promptEditorKey, setPromptEditorKey] = useState(0)
  const [nameModelDirty, setNameModelDirty] = useState(false)
  const [promptDirty, setPromptDirty] = useState(false)
  const [settingsSaveState, setSettingsSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [promptSaveState, setPromptSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const settingsSaveIdRef = useRef(0)
  const promptSaveIdRef = useRef(0)
  const loadedPromptKeyRef = useRef<string | null>(null)
  const startComposerRef = useRef<AgentsRichEditorSubmitHandle | null>(null)

  useEffect(() => {
    if (!agent.data) return
    if (!nameModelDirty) {
      setName(agent.data.agent.definition.name)
      setModel(agent.data.agent.definition.model)
      setModelProvider(agent.data.agent.definition.modelProvider)
      setReasoningLevel(agent.data.agent.definition.reasoningLevel)
      setEnabledModels(agent.data.agent.definition.enabledModels ?? [])
    }
    if (!promptDirty) {
      const nextPromptKey = agentPromptStableKey(agent.data.agent.definition.systemPrompt)
      if (loadedPromptKeyRef.current !== nextPromptKey) {
        loadedPromptKeyRef.current = nextPromptKey
        setSystemPrompt(agentPromptToBlocks(agent.data.agent.definition.systemPrompt))
        setPromptEditorKey((key) => key + 1)
      }
    }
  }, [agent.data, nameModelDirty, promptDirty])

  // After the user switches provider (which clears the model), pick a sensible
  // default from the new provider's curated list once it loads.
  useEffect(() => {
    if (!nameModelDirty || model || !providerModels.data?.length) return
    const nextModel = pickDefaultProviderModel(providerModels.data, selectedProviderType)?.id
    if (nextModel) setModel(nextModel)
  }, [nameModelDirty, model, providerModels.data, selectedProviderType])

  function handleProviderChange(nextProvider: string) {
    if (nextProvider === modelProvider) return
    setModelProvider(nextProvider)
    setModel('') // belongs to the previous provider; the effect above picks a new default
    setReasoningLevel(undefined)
    // Checked quick-switch models survive provider switches: they carry their own provider.
    setNameModelDirty(true)
  }

  // A provider that disappears (deleted, or the account's provider list changed) must not linger:
  // if it was the active provider, fall back to the empty state — no provider, no model — until
  // the user picks a provider again, and prune checked quick-switch entries that referenced it.
  // Marking the draft dirty keeps background refetches of the stale definition from resurrecting
  // the deleted name, and the autosave effect never submits a draft without a provider and model,
  // so nothing is saved until a real provider is chosen.
  useEffect(() => {
    // While a refetch is in flight the list may be stale — e.g. right after adding a provider that
    // was just auto-selected — so only a settled list is trusted to declare a provider gone.
    // Read-only viewers keep the stale display: they cannot save the cleanup anyway.
    if (!modelProviders.data || modelProviders.isFetching || !canWrite) return
    const providerNames = new Set(modelProviders.data.map((provider) => provider.name))
    const prunedEnabled = enabledModels.filter((entry) => providerNames.has(entry.provider))
    const activeGone = !!modelProvider && !providerNames.has(modelProvider)
    if (!activeGone && prunedEnabled.length === enabledModels.length) return
    if (activeGone) {
      setModelProvider('')
      setModel('')
      setReasoningLevel(undefined)
    }
    if (prunedEnabled.length !== enabledModels.length) setEnabledModels(prunedEnabled)
    setNameModelDirty(true)
  }, [modelProvider, enabledModels, modelProviders.data, modelProviders.isFetching, canWrite])

  // The agent's primary signing account, and whether other agents also use it.
  const agentSigningKey =
    agent.data?.agent.definition.signingKeys?.[0] || agent.data?.agent.definition.signingKey || undefined
  const isAccountShared =
    !!agentSigningKey &&
    (allAgents.data || []).some((other) => {
      if (other.id === agentId) return false
      const otherKeys =
        other.definition.signingKeys || (other.definition.signingKey ? [other.definition.signingKey] : [])
      return otherKeys.includes(agentSigningKey)
    })
  const agentAccountStatus: AgentAccountRenameStatus = !agentSigningKey
    ? {kind: 'none'}
    : isAccountShared
      ? {kind: 'shared'}
      : {kind: 'own'}

  async function handleRenameAgent(nextName: string) {
    if (!agent.data) throw new Error('Agent not loaded')
    const trimmed = nextName.trim()
    if (!trimmed) throw new Error('Agent name is required')
    const definition = agent.data.agent.definition
    const result = await updateAgent.mutateAsync({agentId, definition: {...definition, name: trimmed}})
    if (result._ !== 'GetAgentResponse') throw new Error('Unexpected update response')
    // Keep the dedicated account's profile name in sync; leave shared accounts alone.
    if (isOwner && agentSigningKey && !isAccountShared) {
      await updateSigningIdentity.mutateAsync({name: agentSigningKey, label: trimmed})
    }
    if (!nameModelDirty) setName(trimmed)
  }

  // The session only exists once the user actually does something: the bottom composer drafts
  // against no session, and the first send — or the first user tool run — creates one and
  // delivers that action in the same motion, so abandoning the draft leaves no empty session
  // behind.
  async function startDraftSession(): Promise<string> {
    if (!selectedAccountId) throw new Error('Select an account first')
    // No title at creation: the agent names the session, with a server-side fallback from the
    // first user message — 'Untitled session' is a display placeholder, never data.
    const result = await createSession.mutateAsync({agentId})
    if (result._ !== 'CreateSessionResponse') throw new Error('Unexpected session response')
    // Seed the caches before navigating so the session page renders the optimistic first
    // message immediately instead of an empty transcript while the real fetch lands.
    const now = Date.now()
    addOptimisticSessionToCaches(serverUrl, selectedAccountId, {
      id: result.sessionId,
      account: selectedAccountId,
      agentId,
      status: 'idle',
      createdAt: now,
      updatedAt: now,
    })
    return result.sessionId
  }

  const startSessionSendingRef = useRef(false)
  async function handleStartSession(message: AgentSessionDraftMessage) {
    // The composer already cleared itself; a second send racing the create must not open a second
    // session.
    if (!selectedAccountId || startSessionSendingRef.current) return
    startSessionSendingRef.current = true
    try {
      const sessionId = await startDraftSession()
      // Send the stamped drafts, so the durable echo replaces the optimistic row by identity.
      const messages = addOptimisticSessionMessage(serverUrl, selectedAccountId, sessionId, [message])
      messageSession.mutate({sessionId, message: messages})
      navigate({key: 'agent-session', agentId, sessionId, serverUrl})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create session')
    } finally {
      startSessionSendingRef.current = false
    }
  }

  useEffect(() => {
    if (!agent.data) return
    const draftName = name.trim()
    if (!draftName || !model || !modelProvider) return
    const currentDefinition = agent.data.agent.definition
    const persistedName = currentDefinition.name
    const persistedModel = currentDefinition.model
    const persistedProvider = currentDefinition.modelProvider
    const draftReasoningLevel = coerceReasoningLevel(selectedProviderType, model, reasoningLevel)
    if (
      draftName === persistedName &&
      model === persistedModel &&
      modelProvider === persistedProvider &&
      draftReasoningLevel === currentDefinition.reasoningLevel &&
      sameModelRefs(enabledModels, currentDefinition.enabledModels ?? [])
    ) {
      setSettingsSaveState('idle')
      return
    }

    const saveId = settingsSaveIdRef.current + 1
    settingsSaveIdRef.current = saveId
    const timer = setTimeout(
      () => {
        setSettingsSaveState('saving')
        const nextDefinition = {...currentDefinition, name: draftName, model, modelProvider}
        // Avoid an explicit-undefined key: CBOR-encoding it would not equal an absent field.
        if (draftReasoningLevel) nextDefinition.reasoningLevel = draftReasoningLevel
        else delete nextDefinition.reasoningLevel
        if (enabledModels.length) nextDefinition.enabledModels = enabledModels
        else delete nextDefinition.enabledModels
        void updateAgent
          .mutateAsync({
            agentId,
            definition: nextDefinition,
          })
          .then((result) => {
            if (settingsSaveIdRef.current !== saveId) return
            if (result._ !== 'GetAgentResponse') throw new Error('Unexpected update response')
            setName(result.agent.definition.name)
            setModel(result.agent.definition.model)
            setModelProvider(result.agent.definition.modelProvider)
            setReasoningLevel(result.agent.definition.reasoningLevel)
            setEnabledModels(result.agent.definition.enabledModels ?? [])
            if (!promptDirty) {
              loadedPromptKeyRef.current = agentPromptStableKey(result.agent.definition.systemPrompt)
              setSystemPrompt(agentPromptToBlocks(result.agent.definition.systemPrompt))
              setPromptEditorKey((key) => key + 1)
            }
            setNameModelDirty(false)
            setSettingsSaveState('saved')
            setTimeout(() => {
              if (settingsSaveIdRef.current === saveId) setSettingsSaveState('idle')
            }, 1800)
          })
          .catch((error) => {
            if (settingsSaveIdRef.current !== saveId) return
            setSettingsSaveState('error')
            toast.error(error instanceof Error ? error.message : 'Could not update agent')
          })
      },
      model === persistedModel ? 600 : 0,
    )
    return () => clearTimeout(timer)
  }, [
    agent.data,
    agentId,
    model,
    modelProvider,
    name,
    reasoningLevel,
    enabledModels,
    selectedProviderType,
    promptDirty,
    updateAgent.mutateAsync,
  ])

  const promptEditorDisabled = !selectedAccountId || serverHealth.isError || agent.isError || !canWrite

  useEffect(() => {
    if (!agent.data || !promptDirty || promptEditorDisabled) return
    if (!hasPromptContent(systemPrompt)) {
      setPromptSaveState('error')
      return
    }

    const currentDefinition = agent.data.agent.definition
    const nextPromptKey = agentPromptStableKey(systemPrompt)
    if (nextPromptKey === agentPromptStableKey(currentDefinition.systemPrompt)) {
      setPromptDirty(false)
      setPromptSaveState('idle')
      return
    }

    const saveId = promptSaveIdRef.current + 1
    promptSaveIdRef.current = saveId
    const timer = setTimeout(() => {
      setPromptSaveState('saving')
      void updateAgent
        .mutateAsync({
          agentId,
          definition: {...currentDefinition, systemPrompt: promptBlocksForRequest(systemPrompt)},
        })
        .then((result) => {
          if (promptSaveIdRef.current !== saveId) return
          if (result._ !== 'GetAgentResponse') throw new Error('Unexpected update response')
          loadedPromptKeyRef.current = agentPromptStableKey(result.agent.definition.systemPrompt)
          setPromptDirty(false)
          setPromptSaveState('saved')
          setTimeout(() => {
            if (promptSaveIdRef.current === saveId) setPromptSaveState('idle')
          }, 1800)
        })
        .catch((error) => {
          if (promptSaveIdRef.current !== saveId) return
          setPromptSaveState('error')
          const message = error instanceof Error ? error.message : 'Could not save prompt'
          if (message !== 'System prompt is required') toast.error(message)
        })
    }, 800)
    return () => clearTimeout(timer)
  }, [agent.data, agentId, promptDirty, promptEditorDisabled, systemPrompt, updateAgent.mutateAsync])

  const selectedTriggerName = triggerId ? triggers.data?.find((trigger) => trigger.id === triggerId)?.name : undefined
  const isTriggerDetail = tab === 'triggers' && !!triggerId
  const breadcrumbItems = isTriggerDetail
    ? [
        {label: 'Triggers', route: {key: 'agent' as const, agentId, serverUrl, tab: 'triggers' as const}},
        {label: selectedTriggerName || 'Trigger'},
      ]
    : undefined

  return (
    <PanelContainer className="flex flex-col overflow-hidden">
      <div className={isTriggerDetail ? 'border-border flex-none border-b' : 'contents'}>
        <Container
          className={isTriggerDetail ? 'max-w-4xl gap-4 pt-4 pb-4' : 'min-h-0 max-w-4xl flex-1 gap-4 pt-4 pb-0'}
        >
          {agent.isLoading ? (
            <div className="flex flex-1 items-center justify-center py-12">
              <Spinner size="large" className="text-muted-foreground" />
            </div>
          ) : null}
          {agent.isError ? (
            <SizableText className="text-destructive">
              {agent.error instanceof Error ? agent.error.message : 'Could not load agent'}
            </SizableText>
          ) : null}
          {agent.data ? (
            <>
              <AgentHeader
                agent={agent.data.agent}
                agentName={name}
                onEditName={
                  canWrite
                    ? () =>
                        editNameDialog.open({
                          currentName: name,
                          accountStatus: agentAccountStatus,
                          onRename: handleRenameAgent,
                        })
                    : undefined
                }
                agentId={agentId}
                serverUrl={serverUrl}
                activeTab={tab}
                sessionsCount={topLevelSessions.length}
                triggersCount={triggers.data?.length}
                // The session is only created when the first message is sent, so "New session"
                // just puts the cursor in the composer that will do it.
                onCreateSession={canChat ? () => startComposerRef.current?.focus({moveCursorToEnd: true}) : undefined}
                creatingSession={createSession.isLoading}
                onCreateTrigger={
                  canWrite ? () => createTriggerDialog.open({serverUrl, selectedAccountId, agentId}) : undefined
                }
                canCreateTrigger={!!selectedAccountId && canWrite}
                menuItems={
                  isOwner
                    ? [
                        {
                          key: 'move-server',
                          label: 'Move to another server…',
                          icon: <ArrowRightLeft className="size-4" />,
                          disabled: !selectedAccountId,
                          onClick: () =>
                            moveAgentDialog.open({
                              sourceServerUrl: serverUrl,
                              selectedAccountId,
                              agentId,
                              agentName: name,
                              modelProvider: agent.data?.agent.definition.modelProvider ?? '',
                              sessionsCount: topLevelSessions.length,
                              onMoved: ({serverUrl: movedServerUrl, agentId: movedAgentId}) =>
                                navigate({key: 'agent', agentId: movedAgentId, serverUrl: movedServerUrl}),
                            }),
                        },
                        {
                          key: 'delete-agent',
                          label: 'Delete agent…',
                          icon: <Trash2 className="size-4" />,
                          variant: 'destructive' as const,
                          disabled: !selectedAccountId,
                          onClick: () =>
                            deleteAgentDialog.open({
                              serverUrl,
                              selectedAccountId: selectedAccountId ?? null,
                              agentId,
                              agentName: name,
                              onDeleted: () => navigate({key: 'agents'}),
                            }),
                        },
                      ]
                    : undefined
                }
                breadcrumbItems={breadcrumbItems}
              />

              {createTriggerDialog.content}
              {deleteAgentDialog.content}
              {moveAgentDialog.content}
              {addProviderDialog.content}
              {editNameDialog.content}

              {tab === 'sessions' ? (
                <section className="flex min-h-0 flex-1 flex-col">
                  <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                    {!topLevelSessions.length ? <SizableText color="muted">No sessions yet.</SizableText> : null}
                    {topLevelSessions.map((session) => (
                      <SessionListItem
                        key={session.id}
                        session={session}
                        serverUrl={serverUrl}
                        accountUid={selectedAccountId}
                        onOpen={(event) =>
                          clickNavigate({key: 'agent-session', agentId, sessionId: session.id, serverUrl}, event)
                        }
                        onOpenSession={(child, event) =>
                          clickNavigate(
                            {key: 'agent-session', agentId: child.agentId, sessionId: child.id, serverUrl},
                            event,
                          )
                        }
                        onOpenTrigger={() =>
                          session.startedByTrigger
                            ? navigate({
                                key: 'agent',
                                agentId,
                                serverUrl,
                                tab: 'triggers',
                                triggerId: session.startedByTrigger.triggerId,
                              })
                            : undefined
                        }
                      />
                    ))}
                  </div>
                  {canChat ? (
                    // No sessionId: this is a draft composer — the first send creates the session
                    // and delivers the message in one motion (see handleStartSession).
                    <AgentRichMessageComposer
                      isBusy={createSession.isLoading || messageSession.isLoading}
                      isStreaming={false}
                      stopPending={false}
                      disabledMessage={!selectedAccountId ? 'Select an account to start a session.' : undefined}
                      serverUrl={serverUrl}
                      accountId={selectedAccountId ?? null}
                      agentTools={agent.data.agent.definition.tools}
                      agentToolsLoading={agent.isLoading}
                      focusOnMount={false}
                      canInvokeTools={canWrite}
                      composerHandleRef={startComposerRef}
                      onToolStartSession={startDraftSession}
                      onToolSessionStarted={(sessionId) =>
                        navigate({key: 'agent-session', agentId, sessionId, serverUrl})
                      }
                      onSend={(message) => void handleStartSession(message)}
                      onStop={() => {}}
                    />
                  ) : null}
                </section>
              ) : null}

              {tab === 'triggers' && !isTriggerDetail ? (
                <AgentTriggersTab
                  agentId={agentId}
                  serverUrl={serverUrl}
                  selectedAccountId={selectedAccountId}
                  selectedTriggerId={triggerId}
                  triggers={triggers.data || []}
                  isLoading={triggers.isLoading}
                  readOnly={!canWrite}
                />
              ) : null}

              {tab === 'memory' ? (
                <AgentMemoryTab
                  serverUrl={serverUrl}
                  accountUid={selectedAccountId ?? null}
                  agentId={agentId}
                  openPath={memoryPath}
                  onOpenPathChange={(path) =>
                    replaceRoute({key: 'agent', agentId, serverUrl, tab: 'memory', memoryPath: path})
                  }
                  readOnly={!canWrite}
                />
              ) : null}

              {tab === 'tools' ? (
                <AgentToolsTab
                  serverUrl={serverUrl}
                  accountUid={selectedAccountId ?? null}
                  agentId={agentId}
                  definition={agent.data.agent.definition}
                  identities={signingIdentities.data || []}
                  identitiesLoading={signingIdentities.isLoading}
                  webCapabilities={
                    serverHealth.data
                      ? {
                          ...(serverHealth.data.webTools ?? {search: true, readBrowser: true}),
                          codeExec: serverHealth.data.codeExec,
                          codeExecReason: serverHealth.data.codeExecReason,
                          codeExecReasonCode: serverHealth.data.codeExecReasonCode,
                          local: isLocalAgentServer(serverUrl, localServerUrl.data),
                        }
                      : undefined
                  }
                  onSave={(definition) => updateAgent.mutateAsync({agentId, definition})}
                  onCreateIdentity={(label) => createSigningIdentity.mutateAsync(label)}
                  saving={updateAgent.isLoading || createSigningIdentity.isLoading}
                  readOnly={!canWrite}
                  canManageIdentities={isOwner}
                />
              ) : null}

              {tab === 'prompt' ? (
                <section className="flex min-h-0 flex-1 flex-col gap-3">
                  <div>
                    <SizableText weight="bold">System prompt</SizableText>
                    <SizableText size="sm" color="muted" className="block">
                      Use the rich editor for formatting, links, embeds, lists, media, and code. The server converts
                      these blocks to markdown before sending them to the model. Changes autosave.
                      {promptSaveState === 'saving'
                        ? ' Saving…'
                        : promptSaveState === 'saved'
                          ? ' Saved.'
                          : promptSaveState === 'error'
                            ? hasPromptContent(systemPrompt)
                              ? ' Save failed.'
                              : ' System prompt is required.'
                            : ''}
                    </SizableText>
                  </div>
                  {promptEditorDisabled ? (
                    <pre className="border-input bg-muted/40 text-muted-foreground min-h-80 rounded-lg border p-4 text-sm whitespace-pre-wrap">
                      {!canWrite
                        ? promptBlocksToMarkdown(systemPrompt) || 'No system prompt configured.'
                        : 'Connect to the agent server to edit this prompt.'}
                    </pre>
                  ) : (
                    <div className="min-h-0 flex-1 overflow-y-auto pr-1 pb-4">
                      <AgentPromptEditor
                        key={promptEditorKey}
                        initialBlocks={systemPrompt}
                        onChange={(blocks) => {
                          setSystemPrompt(blocks)
                          setPromptDirty(true)
                        }}
                      />
                    </div>
                  )}
                </section>
              ) : null}

              {tab === 'collaborators' ? (
                <AgentCollaboratorsTab
                  serverUrl={serverUrl}
                  accountUid={selectedAccountId ?? null}
                  agentId={agentId}
                  ownerAccountId={agent.data.agent.account}
                  collaborators={collaborators.data?.collaborators || []}
                  publicRead={collaborators.data?.publicRead ?? agent.data.agent.publicRead ?? false}
                  publicChat={collaborators.data?.publicChat ?? agent.data.agent.publicChat ?? false}
                  loading={collaborators.isLoading}
                  isOwner={isOwner}
                />
              ) : null}

              {tab === 'settings' ? (
                <section className="flex max-w-2xl flex-col gap-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <SizableText size="sm" weight="bold">
                        Model
                      </SizableText>
                      <ProviderModelSelect
                        serverUrl={serverUrl}
                        accountUid={selectedAccountId}
                        agentId={agentId}
                        disabled={!canWrite}
                        value={{provider: modelProvider, model}}
                        onChange={(entry) => {
                          setModelProvider(entry.provider)
                          setModel(entry.model)
                          // Selecting implicitly checks the model, so anything the agent has
                          // used stays in the header switcher until explicitly unchecked.
                          setEnabledModels((current) =>
                            current.some((item) => item.provider === entry.provider && item.model === entry.model)
                              ? current
                              : [...current, entry],
                          )
                          const nextType = modelProviders.data?.find((provider) => provider.name === entry.provider)
                            ?.type
                          setReasoningLevel((level) => coerceReasoningLevel(nextType, entry.model, level))
                          setNameModelDirty(true)
                        }}
                        enabledModels={enabledModels}
                        onToggleModel={(entry, enabled) => {
                          setEnabledModels((current) => [
                            ...current.filter(
                              (item) => !(item.provider === entry.provider && item.model === entry.model),
                            ),
                            ...(enabled ? [entry] : []),
                          ])
                          setNameModelDirty(true)
                        }}
                        onAddProvider={
                          isOwner
                            ? () =>
                                addProviderDialog.open({serverUrl, selectedAccountId, onSaved: handleProviderChange})
                            : undefined
                        }
                      />
                    </label>
                    {selectedProviderType && model && modelReasoningSupport(selectedProviderType, model) ? (
                      <div className="flex flex-col justify-end gap-1">
                        <ReasoningSlider
                          providerType={selectedProviderType}
                          disabled={!canWrite}
                          model={model}
                          value={reasoningLevel}
                          onChange={(level) => {
                            setReasoningLevel(level)
                            setNameModelDirty(true)
                          }}
                        />
                      </div>
                    ) : null}
                  </div>
                  <div className="flex flex-col gap-2">
                    <SizableText
                      size="xs"
                      className={`h-4 ${settingsSaveState === 'error' ? 'text-destructive' : ''}`}
                      color={settingsSaveState === 'error' ? undefined : 'muted'}
                    >
                      {settingsSaveState === 'saving'
                        ? 'Saving settings…'
                        : settingsSaveState === 'saved'
                          ? 'Settings saved'
                          : settingsSaveState === 'error'
                            ? 'Settings save failed'
                            : ''}
                    </SizableText>
                  </div>
                </section>
              ) : null}
            </>
          ) : null}
        </Container>
      </div>
      {isTriggerDetail && agent.data ? (
        <AgentTriggersTab
          agentId={agentId}
          serverUrl={serverUrl}
          selectedAccountId={selectedAccountId}
          selectedTriggerId={triggerId}
          triggers={triggers.data || []}
          isLoading={triggers.isLoading}
          readOnly={!canWrite}
        />
      ) : null}
    </PanelContainer>
  )
}

function sameModelRefs(a: AgentModelRef[], b: AgentModelRef[]): boolean {
  return (
    a.length === b.length &&
    a.every((entry, index) => entry.provider === b[index]?.provider && entry.model === b[index]?.model)
  )
}

function agentPromptToBlocks(prompt: AgentDefinition['systemPrompt']): HMBlockNode[] {
  if (Array.isArray(prompt)) return prompt as HMBlockNode[]
  return markdownBlockNodesToHMBlockNodes(parseMarkdown(prompt || '').tree)
}

function agentPromptStableKey(prompt: AgentDefinition['systemPrompt']): string {
  return typeof prompt === 'string' ? prompt : JSON.stringify(prompt)
}

function hasPromptContent(blocks: HMBlockNode[]): boolean {
  return blocks.some((node) => {
    const block = node.block as {text?: unknown; type?: unknown; link?: unknown; url?: unknown}
    const type = typeof block.type === 'string' ? block.type.toLowerCase() : ''
    if (typeof block.text === 'string' && block.text.trim()) return true
    if (typeof block.link === 'string' && block.link.trim()) return true
    if (typeof block.url === 'string' && block.url.trim()) return true
    if (type && type !== 'paragraph' && type !== 'heading' && type !== 'code' && type !== 'math') return true
    return node.children ? hasPromptContent(node.children) : false
  })
}

/**
 * The Collaborators tab, mirroring the document collaborators page: an invite row on top, then
 * the owner and members as one flat list with the role reading quietly on the right. The agent
 * API keeps roles explicit (reader/writer), so the invite row carries a role select the document
 * page does not need.
 */
function AgentCollaboratorsTab({
  serverUrl,
  accountUid,
  agentId,
  ownerAccountId,
  collaborators,
  publicRead,
  publicChat,
  loading,
  isOwner,
}: {
  serverUrl: string
  accountUid: string | null
  agentId: string
  ownerAccountId: string
  collaborators: AgentCollaboratorInfo[]
  publicRead: boolean
  publicChat: boolean
  loading: boolean
  isOwner: boolean
}) {
  const invite = useInviteAgentCollaborator(serverUrl, accountUid)
  const remove = useRemoveAgentCollaborator(serverUrl, accountUid)
  const setPublicRead = useSetAgentPublicRead(serverUrl, accountUid)
  const setPublicChat = useSetAgentPublicChat(serverUrl, accountUid)
  const [selected, setSelected] = useState<SearchResult[]>([])
  const [role, setRole] = useState<AgentCollaboratorRole>('writer')
  const excludedAccountIds = [ownerAccountId, ...collaborators.map((member) => member.accountId)]

  async function handleInvite() {
    if (!selected.length) return
    try {
      await Promise.all(
        selected.map((member) => invite.mutateAsync({agentId, collaboratorAccountId: member.id.uid, role})),
      )
      toast.success(selected.length === 1 ? 'Invitation sent' : `${selected.length} invitations sent`)
      setSelected([])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not invite collaborator')
    }
  }

  return (
    <section className="flex max-w-2xl flex-col gap-4">
      {isOwner ? (
        <div className="flex flex-col gap-2">
          <div className="border-border flex overflow-hidden rounded-md border">
            <AccountSearchInput
              label="Collaborators"
              placeholder="Invite collaborators"
              values={selected}
              onValuesChange={setSelected}
              excludeUids={excludedAccountIds}
            />
            <select
              aria-label="Collaborator role"
              value={role}
              onChange={(event) => setRole(event.currentTarget.value as AgentCollaboratorRole)}
              className="border-border bg-background text-foreground border-l px-3 text-sm outline-none"
            >
              <option value="reader">Can read</option>
              <option value="writer">Can write</option>
            </select>
            {selected.length ? (
              <Button
                size="sm"
                className="h-auto rounded-tl-none rounded-bl-none"
                onClick={() => void handleInvite()}
                disabled={invite.isLoading}
                aria-label="Send collaborator invitation"
              >
                <ArrowRight className="size-4" />
              </Button>
            ) : null}
          </div>
          <SizableText size="xs" color="muted">
            Readers can view everything. Writers can also change settings, memory, tools, triggers, and sessions.
          </SizableText>
        </div>
      ) : null}

      <div className="border-border flex flex-col gap-3 rounded-md border p-3">
        <div className="flex items-center gap-3">
          <Globe className="text-muted-foreground size-5 shrink-0" />
          <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
            <SizableText size="sm" weight="medium">
              Public access
            </SizableText>
            <SizableText size="xs" color="muted">
              {publicRead
                ? 'This agent is public: anyone with a link can view its settings, memory, tools, and sessions.'
                : 'This agent is private: only the owner and collaborators can view it.'}
            </SizableText>
          </div>
          {isOwner ? (
            <Switch
              aria-label="Public access"
              checked={publicRead}
              disabled={setPublicRead.isLoading}
              onCheckedChange={(checked) =>
                setPublicRead.mutate(
                  {agentId, publicRead: checked},
                  {
                    onError: (error) =>
                      toast.error(error instanceof Error ? error.message : 'Could not change public access'),
                  },
                )
              }
            />
          ) : publicRead ? (
            <SizableText size="xs" color="muted" className="shrink-0">
              Public
            </SizableText>
          ) : null}
        </div>
        {/* Public chat only exists on top of public read: the server clears it when read is turned
            off, and the row is hidden with it. Chat is narrower than collaborator "write" access —
            it covers creating and messaging sessions, nothing that edits the agent. */}
        {publicRead ? (
          <div className="border-border flex items-center gap-3 border-t pt-3">
            <MessageSquare className="text-muted-foreground size-5 shrink-0" />
            <div className="flex flex-1 flex-col gap-0.5 overflow-hidden">
              <SizableText size="sm" weight="medium">
                Public chat
              </SizableText>
              <SizableText size="xs" color="muted">
                {publicChat
                  ? 'Anyone signed in can start sessions and send messages. Only collaborators can change settings, memory, tools, or triggers.'
                  : 'Only the owner and collaborators can start sessions or send messages.'}
              </SizableText>
            </div>
            {isOwner ? (
              <Switch
                aria-label="Public chat"
                checked={publicChat}
                disabled={setPublicChat.isLoading}
                onCheckedChange={(checked) =>
                  setPublicChat.mutate(
                    {agentId, publicChat: checked},
                    {
                      onError: (error) =>
                        toast.error(error instanceof Error ? error.message : 'Could not change public chat'),
                    },
                  )
                }
              />
            ) : publicChat ? (
              <SizableText size="xs" color="muted" className="shrink-0">
                Open
              </SizableText>
            ) : null}
          </div>
        ) : null}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-8">
          <Spinner className="size-8" />
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {collaborators.map((member) => (
            <AgentCollaboratorRow
              key={member.accountId}
              member={member}
              isOwner={isOwner}
              changing={invite.isLoading || remove.isLoading}
              onRoleChange={(nextRole) =>
                invite.mutate(
                  {agentId, collaboratorAccountId: member.accountId, role: nextRole},
                  {onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not change role')},
                )
              }
              onRemove={() =>
                remove.mutate(
                  {agentId, collaboratorAccountId: member.accountId},
                  {onError: (error) => toast.error(error instanceof Error ? error.message : 'Could not remove member')},
                )
              }
            />
          ))}
        </div>
      )}
    </section>
  )
}

function AgentCollaboratorRow({
  member,
  isOwner,
  changing,
  onRoleChange,
  onRemove,
}: {
  member: AgentCollaboratorInfo
  isOwner: boolean
  changing: boolean
  onRoleChange: (role: AgentCollaboratorRole) => void
  onRemove: () => void
}) {
  const account = useAccount(member.accountId, {subscribe: true})
  const metadata = account.data?.metadata
  const canManage = isOwner && member.role !== 'owner'

  return (
    <div className="flex items-center gap-3 rounded-md p-3">
      <HMIcon id={hmId(member.accountId)} name={metadata?.name} icon={metadata?.icon} size={32} />
      <div className="flex flex-1 items-center gap-2 overflow-hidden">
        <SizableText size="sm" className={`truncate ${metadata?.name ? '' : 'text-muted-foreground'}`}>
          {metadata?.name || abbreviateUid(member.accountId)}
        </SizableText>
        {member.status === 'pending' ? (
          <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
            Pending
          </span>
        ) : null}
        {canManage ? (
          <span className="ml-auto flex shrink-0 items-center gap-1">
            <select
              aria-label={`Role for ${metadata?.name || member.accountId}`}
              value={member.role}
              onChange={(event) => onRoleChange(event.currentTarget.value as AgentCollaboratorRole)}
              disabled={changing}
              className="border-border bg-background text-foreground rounded-md border px-2 py-1.5 text-xs"
            >
              <option value="reader">Can read</option>
              <option value="writer">Can write</option>
            </select>
            <Button
              variant="ghost"
              size="iconSm"
              onClick={onRemove}
              disabled={changing}
              aria-label={member.status === 'pending' ? 'Cancel invitation' : 'Remove collaborator'}
            >
              <X className="size-4" />
            </Button>
          </span>
        ) : (
          <SizableText size="xs" color="muted" className="ml-auto shrink-0 capitalize">
            {member.role}
          </SizableText>
        )}
      </div>
    </div>
  )
}

function DeleteAgentDialog({
  input,
  onClose,
}: {
  input: {
    serverUrl: string
    selectedAccountId: string | null
    agentId: string
    agentName: string
    onDeleted: () => void
  }
  onClose: () => void
}) {
  const deleteAgent = useDeleteAgent(input.serverUrl, input.selectedAccountId)

  async function handleDelete(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    try {
      const result = await deleteAgent.mutateAsync(input.agentId)
      if (result._ !== 'DeleteAgentResponse') throw new Error('Unexpected delete response')
      toast.success('Agent deleted')
      onClose()
      input.onDeleted()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete agent')
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg p-4">
      <AlertDialogTitle>Delete agent?</AlertDialogTitle>
      <AlertDialogDescription>
        This will permanently delete “{input.agentName}” and its sessions, triggers, and drafts from the agent server.
        This action cannot be undone.
      </AlertDialogDescription>
      <AlertDialogFooter>
        <AlertDialogCancel asChild>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </AlertDialogCancel>
        <AlertDialogAction asChild>
          <Button variant="destructive" onClick={(event) => void handleDelete(event)} disabled={deleteAgent.isLoading}>
            <Trash2 className="size-4" />
            Delete agent
          </Button>
        </AlertDialogAction>
      </AlertDialogFooter>
    </div>
  )
}

/** One create/edit surface for every authored-tool document field. */
function AuthoredToolDialog({
  input,
  onClose,
}: {
  input: {
    serverUrl?: string
    accountUid: string | null
    agentId: string
    tool?: AgentToolInfo
    readOnly?: boolean
  }
  onClose: () => void
}) {
  const {tool, readOnly = false} = input
  const saveTool = useSaveAgentTool(input.serverUrl, input.accountUid)
  const [name, setName] = useState(tool?.name ?? '')
  const [summary, setSummary] = useState(tool?.summary ?? '')
  const [description, setDescription] = useState(tool?.description ?? '')
  const [runtime, setRuntime] = useState<'typescript' | 'python'>(tool?.runtime ?? 'typescript')
  const [source, setSource] = useState(tool?.source ?? 'export default async function (input) {\n  return {}\n}\n')
  const [inputSchema, setInputSchema] = useState(
    JSON.stringify(tool?.input ?? {type: 'object', properties: {}}, null, 2),
  )
  const [outputSchema, setOutputSchema] = useState(tool?.output ? JSON.stringify(tool.output, null, 2) : '')

  async function handleSave(event: React.FormEvent) {
    event.preventDefault()
    try {
      const parsedInput = JSON.parse(inputSchema) as unknown
      const parsedOutput = outputSchema.trim() ? (JSON.parse(outputSchema) as unknown) : undefined
      if (!parsedInput || typeof parsedInput !== 'object' || Array.isArray(parsedInput)) {
        throw new Error('Input schema must be a JSON object')
      }
      if (
        parsedOutput !== undefined &&
        (!parsedOutput || typeof parsedOutput !== 'object' || Array.isArray(parsedOutput))
      ) {
        throw new Error('Output schema must be a JSON object or left blank')
      }
      const nextTool: AgentToolInput = {
        name: name.trim(),
        ...(summary.trim() ? {summary: summary.trim()} : {}),
        description,
        input: parsedInput as Record<string, unknown>,
        ...(parsedOutput ? {output: parsedOutput as Record<string, unknown>} : {}),
        source,
        runtime,
      }
      await saveTool.mutateAsync({agentId: input.agentId, tool: nextTool, previousName: tool?.name})
      toast.success(tool ? 'Tool updated' : 'Tool created')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save tool')
    }
  }

  return (
    <form className="flex max-h-[78vh] w-full max-w-3xl min-w-0 flex-col gap-4 overflow-y-auto" onSubmit={handleSave}>
      <div className="flex flex-col gap-1">
        <DialogTitle>{tool ? 'Edit authored tool' : 'Add authored tool'}</DialogTitle>
        <DialogDescription>
          Define the name, model-facing contract, runtime, and executable source. Tool names use lowercase letters,
          numbers, underscores, and hyphens.
        </DialogDescription>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <SizableText size="sm" weight="bold">
            Name
          </SizableText>
          <Input
            className="font-mono"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="weather_lookup"
            pattern="[a-z][a-z0-9_-]{1,63}"
            minLength={2}
            maxLength={64}
            required
            disabled={readOnly || saveTool.isLoading}
            autoFocus={!tool}
          />
        </label>
        <label className="flex flex-col gap-1.5 sm:w-40">
          <SizableText size="sm" weight="bold">
            Runtime
          </SizableText>
          <select
            className="border-input bg-background h-9 rounded-md border px-3 text-sm"
            value={runtime}
            onChange={(event) => setRuntime(event.target.value === 'python' ? 'python' : 'typescript')}
            disabled={readOnly || saveTool.isLoading}
          >
            <option value="typescript">TypeScript</option>
            <option value="python">Python</option>
          </select>
        </label>
      </div>

      <label className="flex flex-col gap-1.5">
        <SizableText size="sm" weight="bold">
          List summary
        </SizableText>
        <Input
          value={summary}
          onChange={(event) => setSummary(event.target.value)}
          placeholder="One short sentence; derived from the description when blank"
          maxLength={140}
          disabled={readOnly || saveTool.isLoading}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <SizableText size="sm" weight="bold">
          Description sent to the model
        </SizableText>
        <Textarea
          className="min-h-24 resize-y"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="Explain what the tool does and when to call it."
          required
          disabled={readOnly || saveTool.isLoading}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <SizableText size="sm" weight="bold">
          Source
        </SizableText>
        <Textarea
          className="min-h-56 resize-y font-mono text-xs"
          value={source}
          onChange={(event) => setSource(event.target.value)}
          spellCheck={false}
          required
          disabled={readOnly || saveTool.isLoading}
        />
      </label>

      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex min-w-0 flex-col gap-1.5">
          <SizableText size="sm" weight="bold">
            Input schema
          </SizableText>
          <Textarea
            className="min-h-48 resize-y font-mono text-xs"
            value={inputSchema}
            onChange={(event) => setInputSchema(event.target.value)}
            spellCheck={false}
            required
            disabled={readOnly || saveTool.isLoading}
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5">
          <SizableText size="sm" weight="bold">
            Output schema <span className="text-muted-foreground font-normal">(optional)</span>
          </SizableText>
          <Textarea
            className="min-h-48 resize-y font-mono text-xs"
            value={outputSchema}
            onChange={(event) => setOutputSchema(event.target.value)}
            placeholder="Leave blank for any output"
            spellCheck={false}
            disabled={readOnly || saveTool.isLoading}
          />
        </label>
      </div>

      {tool ? (
        <div className="border-border flex min-w-0 flex-col gap-1 border-t pt-3">
          <SizableText size="xs" color="muted">
            Current version
          </SizableText>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground truncate text-left font-mono text-xs"
            title="Copy content address"
            onClick={() => {
              copyTextToClipboard(tool.cid)
              toast.success('Content address copied')
            }}
          >
            {tool.cid}
          </button>
        </div>
      ) : null}

      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          {readOnly ? 'Close' : 'Cancel'}
        </Button>
        {!readOnly ? (
          <Button type="submit" disabled={saveTool.isLoading}>
            {saveTool.isLoading ? <Spinner /> : null}
            {tool ? 'Save changes' : 'Create tool'}
          </Button>
        ) : null}
      </div>
    </form>
  )
}

function DeleteAuthoredToolDialog({
  input,
  onClose,
}: {
  input: {serverUrl?: string; accountUid: string | null; agentId: string; tool: AgentToolInfo}
  onClose: () => void
}) {
  const deleteTool = useDeleteAgentTool(input.serverUrl, input.accountUid)

  async function handleDelete(event: React.MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    try {
      await deleteTool.mutateAsync({agentId: input.agentId, name: input.tool.name})
      toast.success('Tool deleted')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete tool')
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg p-4">
      <AlertDialogTitle>Delete authored tool?</AlertDialogTitle>
      <AlertDialogDescription>
        This permanently deletes <span className="font-mono">{input.tool.name}</span>. Calls and workflows that refer to
        this name will stop working. This action cannot be undone.
      </AlertDialogDescription>
      <AlertDialogFooter>
        <AlertDialogCancel asChild>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </AlertDialogCancel>
        <AlertDialogAction asChild>
          <Button variant="destructive" onClick={(event) => void handleDelete(event)} disabled={deleteTool.isLoading}>
            <Trash2 className="size-4" />
            Delete tool
          </Button>
        </AlertDialogAction>
      </AlertDialogFooter>
    </div>
  )
}

/** Shows the exact model-facing prompt and JSON schemas for a single tool, for agent-owner transparency. */
function ToolInfoDialog({input, onClose}: {input: {toolName: string}; onClose: () => void}) {
  const meta = getSeedTool(input.toolName)
  if (!meta) {
    return (
      <div className="flex flex-col gap-3">
        <DialogTitle>Unknown tool</DialogTitle>
        <SizableText size="sm" color="muted">
          No metadata is registered for "{input.toolName}".
        </SizableText>
      </div>
    )
  }
  return (
    <div className="flex max-h-[70vh] min-w-0 flex-col gap-4 overflow-y-auto">
      <div className="flex flex-col gap-1">
        <DialogTitle>{meta.label}</DialogTitle>
        <SizableText size="xs" color="muted" className="font-mono">
          {meta.name}
        </SizableText>
      </div>
      <div className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Description sent to the model
        </SizableText>
        <SizableText size="sm" color="muted">
          {meta.description}
        </SizableText>
      </div>
      <div className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Input schema
        </SizableText>
        <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-xs whitespace-pre">
          {JSON.stringify(meta.inputSchema, null, 2)}
        </pre>
      </div>
      {meta.outputSchema ? (
        <div className="flex flex-col gap-1">
          <SizableText size="sm" weight="bold">
            Output schema
          </SizableText>
          <pre className="bg-muted overflow-x-auto rounded-lg p-3 text-xs whitespace-pre">
            {JSON.stringify(meta.outputSchema, null, 2)}
          </pre>
        </div>
      ) : null}
      <div className="flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
      </div>
    </div>
  )
}

// Reading, memory, publishing, delegation, and plans are verbs — always on, not configuration.
// What the user toggles here is the CALLABLE tool set dispatched through the call verb.
const AGENT_TOOL_OPTIONS: {names: string[]; title: string; infoTool?: string}[] = [
  {names: [AGENT_SEARCH_TOOL], title: 'Search Seed content'},
  {names: [AGENT_WEB_SEARCH_TOOL], title: 'Search the web'},
  {names: [AGENT_EXECUTE_TOOL], title: 'Execute code'},
  // The publish grant is not a registry tool — publishing runs through the always-on `write`
  // verb, so its info dialog shows the write verb's model-facing contract.
  {names: [AGENT_PUBLISH_GRANT], title: 'Publish Seed content', infoTool: 'write'},
]

const AUTHOR_CHIP_CLASS =
  'hover:bg-accent/40 flex min-w-0 cursor-pointer items-center gap-1.5 rounded-full py-0.5 pr-2 pl-0.5 disabled:cursor-default disabled:hover:bg-transparent'

/** One "Author as" identity chip. Owners get a dropdown (open / edit profile); everyone else gets a
 * plain profile link. Key-only identities with no account have no profile to open. */
function AuthorIdentityChip({
  identity,
  displayName,
  canEdit,
  onEdit,
}: {
  identity: SigningIdentity
  displayName: string
  canEdit: boolean
  onEdit: () => void
}) {
  const profileRoute = identity.accountId
    ? ({key: 'site-profile', id: hmId(identity.accountId), tab: 'profile'} as const)
    : null
  const linkProps = useRouteLink(profileRoute)
  const content = (
    <>
      {identity.accountId ? (
        <HMIcon id={hmId(identity.accountId)} name={displayName} icon={identity.icon} size={24} />
      ) : (
        <KeyRound className="text-muted-foreground size-4" />
      )}
      <SizableText size="sm" weight="bold" className="truncate">
        {displayName}
      </SizableText>
    </>
  )

  if (canEdit) {
    return (
      <OptionsDropdown
        ariaLabel={`Options for ${displayName}`}
        button={
          <button type="button" className={AUTHOR_CHIP_CLASS}>
            {content}
          </button>
        }
        menuItems={[
          profileRoute
            ? {
                key: 'open',
                label: 'Open profile',
                icon: <ExternalLink className="size-4" />,
                onClick: (e) => linkProps.onClick?.(e),
              }
            : null,
          {key: 'edit', label: 'Edit profile', icon: <Pencil className="size-4" />, onClick: onEdit},
        ]}
      />
    )
  }

  if (!profileRoute) {
    return (
      <div className="flex min-w-0 items-center gap-1.5 py-0.5 pr-2 pl-0.5" title={displayName}>
        {content}
      </div>
    )
  }

  return (
    <a {...linkProps} className={AUTHOR_CHIP_CLASS} aria-label={`Open ${displayName}'s profile`}>
      {content}
    </a>
  )
}

function AgentToolsTab({
  serverUrl,
  accountUid,
  agentId,
  definition,
  identities,
  identitiesLoading,
  webCapabilities,
  onSave,
  onCreateIdentity,
  saving,
  readOnly = false,
  canManageIdentities = false,
}: {
  serverUrl: string | undefined
  accountUid: string | null
  agentId: string
  definition: AgentDefinition
  identities: SigningIdentity[]
  identitiesLoading: boolean
  webCapabilities: AgentServerWebCapabilities | undefined
  onSave: (definition: AgentDefinition) => Promise<unknown>
  onCreateIdentity: (label: string) => Promise<unknown>
  saving: boolean
  readOnly?: boolean
  /** Owner-only: granting/removing signing accounts and creating new ones. Writers can toggle
   * tools but must never see or manage the owner's identity list. */
  canManageIdentities?: boolean
}) {
  const toolInfoDialog = useAppDialog(ToolInfoDialog)
  const authoredToolDialog = useAppDialog(AuthoredToolDialog, {className: 'w-full max-w-3xl'})
  const deleteAuthoredToolDialog = useAppDialog(DeleteAuthoredToolDialog, {isAlert: true})
  const editAccountDialog = useAppDialog(EditAgentAccountDialog)
  const agentTools = useAgentTools(serverUrl, accountUid, agentId)
  const authoredTools = (agentTools.data?.tools ?? []).filter((tool) => tool.kind === 'lambda')
  const enableWhpDialog = useAppDialog(EnableWindowsHypervisorDialog)
  const definitionSigningKeys = definition.signingKeys || (definition.signingKey ? [definition.signingKey] : [])
  const defaultTools = [...DEFAULT_AGENT_TOOLS]
  const [enabledTools, setEnabledTools] = useState<string[]>(
    definition.tools ? normalizeStoredAgentTools(definition.tools) : defaultTools,
  )
  const [signingKeys, setSigningKeys] = useState<string[]>(definitionSigningKeys)
  const [mcpServers, setMcpServers] = useState<string[]>(definition.mcpServers ?? [])
  const [showNewIdentityPanel, setShowNewIdentityPanel] = useState(false)
  const [newIdentityName, setNewIdentityName] = useState('Agent publisher')

  useEffect(() => {
    setEnabledTools(definition.tools ? normalizeStoredAgentTools(definition.tools) : defaultTools)
    setSigningKeys(definition.signingKeys || (definition.signingKey ? [definition.signingKey] : []))
    setMcpServers(definition.mcpServers ?? [])
  }, [definition])

  /** Which of the account's MCP servers this agent may call; the server re-projects their tools. */
  async function saveMcpServers(next: string[]) {
    setMcpServers(next)
    try {
      await onSave({...definition, mcpServers: next})
    } catch (error) {
      setMcpServers(definition.mcpServers ?? [])
      toast.error(error instanceof Error ? error.message : 'Could not update MCP servers')
    }
  }

  async function saveTools(nextTools: string[], nextSigningKeys: string[]) {
    setEnabledTools(nextTools)
    setSigningKeys(nextSigningKeys)
    try {
      const nextDefinition: AgentDefinition = {
        ...definition,
        tools: nextTools,
        signingKeys: nextSigningKeys,
        signingKey: nextSigningKeys[0],
      }
      await onSave(nextDefinition)
    } catch (error) {
      setEnabledTools(definition.tools ? normalizeStoredAgentTools(definition.tools) : defaultTools)
      setSigningKeys(definition.signingKeys || (definition.signingKey ? [definition.signingKey] : []))
      toast.error(error instanceof Error ? error.message : 'Could not update agent tools')
    }
  }

  async function handleCreateIdentity() {
    try {
      const label = newIdentityName.trim()
      if (!label) throw new Error('Account name is required')
      const response = await onCreateIdentity(label)
      if (
        response &&
        typeof response === 'object' &&
        '_' in response &&
        response._ === 'CreateSigningIdentityResponse'
      ) {
        const identityName = (response as unknown as {identity: SigningIdentity}).identity.name
        await saveTools(enabledTools, Array.from(new Set([...signingKeys, identityName])))
      }
      setNewIdentityName('Agent publisher')
      setShowNewIdentityPanel(false)
      toast.success('Agent account created')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create agent account')
    }
  }

  const grantedIdentities = identities.filter((identity) => signingKeys.includes(identity.name))
  const ungrantedIdentities = identities.filter((identity) => !signingKeys.includes(identity.name))

  return (
    <section className="flex min-h-0 max-w-3xl flex-1 flex-col gap-4 overflow-y-auto pr-1">
      <div>
        <SizableText weight="bold">Tools</SizableText>
      </div>

      <div className="grid gap-2">
        {AGENT_TOOL_OPTIONS.map((group) => {
          const availability = group.names.map((name) => getToolAvailability(name, webCapabilities))
          const groupAvailable = availability.some((entry) => entry.available)
          // Unavailability the user can fix locally (e.g. turn on a Windows feature): keep the
          // checkbox clickable and answer the click with setup instructions instead of a save.
          const setupAction = availability.find((entry) => entry.action)?.action
          const note = availability.find((entry) => entry.note)?.note
          const checked = group.names.some((name) => enabledTools.includes(name))
          const isPublishGroup = group.names.includes(AGENT_PUBLISH_GRANT)
          return (
            <div
              key={group.names.join('|')}
              className={`group/tool border-border bg-card flex flex-col gap-3 rounded-xl border px-4 py-3 ${
                groupAvailable || setupAction ? '' : 'opacity-60'
              }`}
            >
              <div className="flex items-center gap-3">
                <label className="flex min-w-0 flex-1 items-center gap-3">
                  <input
                    type="checkbox"
                    className="size-4"
                    checked={checked}
                    disabled={readOnly || (!groupAvailable && !setupAction)}
                    onChange={(event) => {
                      // Enabling an unavailable-but-fixable tool answers with setup help instead of
                      // a save; disabling always saves so users can still remove the tool.
                      if (!groupAvailable && event.target.checked) {
                        if (setupAction === 'enable-whp') enableWhpDialog.open({})
                        return
                      }
                      const nextTools = event.target.checked
                        ? Array.from(new Set([...enabledTools, ...group.names]))
                        : enabledTools.filter((item) => !group.names.includes(item))
                      void saveTools(nextTools, signingKeys)
                    }}
                  />
                  <SizableText size="sm" weight="bold" className="truncate">
                    {group.title}
                  </SizableText>
                  {!groupAvailable ? (
                    <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
                      {setupAction ? 'Setup required' : 'Unavailable'}
                    </span>
                  ) : null}
                </label>
                <Button
                  variant="ghost"
                  size="iconSm"
                  className="opacity-0 group-hover/tool:opacity-100 max-sm:size-10 max-sm:opacity-100"
                  aria-label={`About ${group.title}`}
                  onClick={() => toolInfoDialog.open({toolName: group.infoTool ?? group.names[0]!})}
                >
                  <Info className="size-3.5" />
                </Button>
              </div>
              {!groupAvailable && note ? (
                <SizableText size="xs" color="muted" className="pl-7">
                  {note}{' '}
                  {setupAction === 'enable-whp' ? (
                    <button
                      type="button"
                      className="text-primary cursor-pointer underline underline-offset-2"
                      onClick={() => enableWhpDialog.open({})}
                    >
                      Show me how
                    </button>
                  ) : null}
                </SizableText>
              ) : null}
              {isPublishGroup && checked ? (
                <div className="border-border/60 flex flex-col gap-2 border-t pt-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <KeyRound className="text-muted-foreground size-4 shrink-0" />
                    <SizableText size="sm" weight="bold" className="shrink-0">
                      Author as:
                    </SizableText>
                    <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1 pl-1">
                      {grantedIdentities.map((identity) => {
                        const displayName = identity.label || identity.accountId || identity.name
                        return (
                          <div key={identity.id} className="group/identity flex min-w-0 items-center gap-1.5">
                            <AuthorIdentityChip
                              identity={identity}
                              displayName={displayName}
                              canEdit={canManageIdentities}
                              onEdit={() =>
                                editAccountDialog.open({serverUrl, selectedAccountId: accountUid, identity})
                              }
                            />
                            {canManageIdentities ? (
                              <Button
                                variant="ghost"
                                size="iconSm"
                                className="text-muted-foreground hover:text-destructive opacity-0 group-hover/identity:opacity-100"
                                aria-label={`Remove ${displayName}`}
                                disabled={saving || identitiesLoading}
                                onClick={() =>
                                  void saveTools(
                                    enabledTools,
                                    signingKeys.filter((name) => name !== identity.name),
                                  )
                                }
                              >
                                <X className="size-3.5" />
                              </Button>
                            ) : null}
                          </div>
                        )
                      })}
                      {grantedIdentities.length === 0 ? (
                        <SizableText size="sm" color="muted">
                          None
                        </SizableText>
                      ) : null}
                    </div>
                    {canManageIdentities ? (
                      <div className="flex shrink-0 items-center gap-1">
                        {ungrantedIdentities.length > 0 ? (
                          <OptionsDropdown
                            ariaLabel="Grant a signing identity"
                            button={
                              <Button variant="outline" size="xs" disabled={saving || identitiesLoading}>
                                Grant
                              </Button>
                            }
                            menuItems={ungrantedIdentities.map((identity) => ({
                              key: identity.id,
                              label: identity.label || identity.accountId || identity.name,
                              icon: identity.accountId ? (
                                <HMIcon
                                  id={hmId(identity.accountId)}
                                  name={identity.label}
                                  icon={identity.icon}
                                  size={20}
                                />
                              ) : (
                                <KeyRound className="size-4" />
                              ),
                              onClick: () =>
                                void saveTools(enabledTools, Array.from(new Set([...signingKeys, identity.name]))),
                            }))}
                          />
                        ) : null}
                        {!showNewIdentityPanel && identities.length > 0 ? (
                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setShowNewIdentityPanel(true)}
                            disabled={saving}
                          >
                            <Plus className="size-3.5" />
                            New Account
                          </Button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                  {canManageIdentities && !identitiesLoading && identities.length === 0 ? (
                    <div className="border-border bg-background flex flex-col gap-3 rounded-lg border border-dashed p-3">
                      <SizableText size="sm" color="muted">
                        No agent accounts are available on this server yet. Create a new server-side HM account key,
                        then enable it for this agent.
                      </SizableText>
                      <NewAgentAccountPanel
                        name={newIdentityName}
                        onNameChange={setNewIdentityName}
                        onCreate={() => void handleCreateIdentity()}
                        disabled={saving}
                      />
                    </div>
                  ) : canManageIdentities && showNewIdentityPanel ? (
                    <NewAgentAccountPanel
                      name={newIdentityName}
                      onNameChange={setNewIdentityName}
                      onCreate={() => void handleCreateIdentity()}
                      onCancel={() => setShowNewIdentityPanel(false)}
                      disabled={saving}
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
        {authoredTools.map((tool) => (
          <div
            key={tool.name}
            className={`group/tool border-border bg-card hover:bg-accent/20 flex items-center gap-2 rounded-xl border px-4 py-2 ${
              tool.enabled ? '' : 'opacity-60'
            }`}
          >
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left"
              onClick={() => authoredToolDialog.open({serverUrl, accountUid, agentId, tool, readOnly})}
            >
              <SizableText size="sm" weight="bold" className="shrink-0 font-mono">
                {tool.name}
              </SizableText>
              <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
                {tool.runtime === 'python' ? 'Python' : 'TypeScript'}
              </span>
              {!tool.enabled ? (
                <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
                  Disabled
                </span>
              ) : null}
              <SizableText size="sm" color="muted" className="truncate">
                {tool.summary}
              </SizableText>
            </button>
            {!readOnly ? (
              <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover/tool:opacity-100">
                <Button
                  variant="ghost"
                  size="iconSm"
                  aria-label={`Edit ${tool.name}`}
                  onClick={() => authoredToolDialog.open({serverUrl, accountUid, agentId, tool})}
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="iconSm"
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Delete ${tool.name}`}
                  onClick={() => deleteAuthoredToolDialog.open({serverUrl, accountUid, agentId, tool})}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ) : null}
          </div>
        ))}
        <div className="flex items-center justify-between gap-3 px-1">
          {agentTools.isLoading && authoredTools.length === 0 ? (
            <SizableText size="sm" color="muted">
              Loading custom tools…
            </SizableText>
          ) : authoredTools.length === 0 ? (
            <SizableText size="sm" color="muted">
              No custom tools yet — add one here or ask the agent to write one for itself.
            </SizableText>
          ) : (
            <span />
          )}
          {!readOnly ? (
            <Button
              variant="ghost"
              size="sm"
              className="shrink-0"
              onClick={() => authoredToolDialog.open({serverUrl, accountUid, agentId})}
            >
              <Plus className="size-4" />
              Add tool
            </Button>
          ) : null}
        </div>
      </div>

      <AgentMcpServersSection
        serverUrl={serverUrl}
        accountUid={accountUid}
        enabledServers={mcpServers}
        onToggleServer={(name, enabled) =>
          void saveMcpServers(
            enabled ? Array.from(new Set([...mcpServers, name])) : mcpServers.filter((n) => n !== name),
          )
        }
        readOnly={readOnly}
        saving={saving}
      />

      {toolInfoDialog.content}
      {authoredToolDialog.content}
      {deleteAuthoredToolDialog.content}
      {enableWhpDialog.content}
      {editAccountDialog.content}

      {saving ? (
        <SizableText size="xs" color="muted">
          Saving changes…
        </SizableText>
      ) : null}
    </section>
  )
}

function NewAgentAccountPanel({
  name,
  onNameChange,
  onCreate,
  onCancel,
  disabled,
}: {
  name: string
  onNameChange: (name: string) => void
  onCreate: () => void
  onCancel?: () => void
  disabled: boolean
}) {
  return (
    <div className="border-border bg-background flex flex-col gap-3 rounded-lg border p-3">
      <div>
        <SizableText size="sm" weight="bold">
          New agent account
        </SizableText>
        <SizableText size="xs" color="muted">
          This profile name is published to the HM server with the generated public key.
        </SizableText>
      </div>
      <Input value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="Profile name" />
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button variant="ghost" onClick={onCancel} disabled={disabled}>
            Cancel
          </Button>
        ) : null}
        <Button onClick={onCreate} disabled={disabled || !name.trim()}>
          Create account
        </Button>
      </div>
    </div>
  )
}

function AgentTriggersTab({
  agentId,
  serverUrl,
  selectedAccountId,
  selectedTriggerId,
  triggers,
  isLoading,
  readOnly = false,
}: {
  agentId: string
  serverUrl: string
  selectedAccountId: string | null | undefined
  selectedTriggerId?: string
  triggers: AgentTriggerInfo[]
  isLoading: boolean
  readOnly?: boolean
}) {
  const navigate = useNavigate()
  const trigger = useAgentTrigger(serverUrl, selectedAccountId, selectedTriggerId)
  const updateTrigger = useUpdateAgentTrigger(serverUrl, selectedAccountId)
  const deleteTrigger = useDeleteAgentTrigger(serverUrl, selectedAccountId)
  const selected = trigger.data?.trigger
  const [name, setName] = useState('')
  const [nameDirty, setNameDirty] = useState(false)
  const [nameSaveState, setNameSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const nameSaveIdRef = useRef(0)
  const [enabled, setEnabled] = useState(true)
  const [prompt, setPrompt] = useState<HMBlockNode[]>([])
  const [source, setSource] = useState<AgentTriggerSource>({type: 'document-comment', resource: ''})
  const [detailsDirty, setDetailsDirty] = useState(false)
  const [detailsSaveState, setDetailsSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const detailsSaveIdRef = useRef(0)
  const selectedTriggerRef = useRef<string | null>(null)
  const lastSavedDetailsKeyRef = useRef('')
  const currentDetailsKey = useMemo(() => {
    return JSON.stringify({prompt, source})
  }, [prompt, source])
  const currentDetailsKeyRef = useRef(currentDetailsKey)
  currentDetailsKeyRef.current = currentDetailsKey
  const nextScheduledFire = useMemo(
    () =>
      selected
        ? nextScheduleFire({source, createdAt: selected.createdAt, lastFiredAt: selected.lastFiredAt, enabled})
        : null,
    [enabled, selected, source],
  )

  useEffect(() => {
    if (!selected) return
    const triggerChanged = selectedTriggerRef.current !== selected.id
    selectedTriggerRef.current = selected.id
    if (triggerChanged || !nameDirty) setName(selected.name)
    if (!triggerChanged) return
    const nextPrompt = agentPromptToBlocks(selected.prompt)
    const nextSource = selected.source
    setEnabled(selected.enabled)
    setPrompt(nextPrompt)
    setSource(nextSource)
    lastSavedDetailsKeyRef.current = JSON.stringify({
      prompt: nextPrompt,
      source: nextSource,
    })
    setDetailsDirty(false)
    setDetailsSaveState('idle')
  }, [nameDirty, selected])

  useEffect(() => {
    if (readOnly || !selectedTriggerId || !selected || !nameDirty) return
    const draftName = name.trim()
    if (!draftName) return
    if (draftName === selected.name) {
      setNameSaveState('idle')
      setNameDirty(false)
      return
    }
    const saveId = nameSaveIdRef.current + 1
    nameSaveIdRef.current = saveId
    const timer = setTimeout(() => {
      setNameSaveState('saving')
      void updateTrigger
        .mutateAsync({triggerId: selectedTriggerId, patch: {name: draftName}})
        .then((result) => {
          if (nameSaveIdRef.current !== saveId) return
          if (result._ !== 'UpdateAgentTriggerResponse') throw new Error('Unexpected trigger update response')
          setName(draftName)
          setNameDirty(false)
          setNameSaveState('saved')
          setTimeout(() => {
            if (nameSaveIdRef.current === saveId) setNameSaveState('idle')
          }, 1800)
        })
        .catch((error) => {
          if (nameSaveIdRef.current !== saveId) return
          setNameSaveState('error')
          toast.error(error instanceof Error ? error.message : 'Could not rename trigger')
        })
    }, 600)
    return () => clearTimeout(timer)
  }, [name, nameDirty, readOnly, selected, selectedTriggerId, updateTrigger])

  async function handleEnabledChange(nextEnabled: boolean) {
    if (!selectedTriggerId || !selected) return
    const previousEnabled = enabled
    setEnabled(nextEnabled)
    try {
      const result = await updateTrigger.mutateAsync({triggerId: selectedTriggerId, patch: {enabled: nextEnabled}})
      if (result._ !== 'UpdateAgentTriggerResponse') throw new Error('Unexpected trigger update response')
    } catch (error) {
      setEnabled(previousEnabled)
      toast.error(error instanceof Error ? error.message : 'Could not update trigger enabled state')
    }
  }

  useEffect(() => {
    if (readOnly || !selectedTriggerId || !selected || !detailsDirty || detailsSaveState === 'saving') return
    const detailsKey = currentDetailsKey
    if (detailsKey === lastSavedDetailsKeyRef.current) {
      setDetailsDirty(false)
      setDetailsSaveState('idle')
      return
    }
    const saveId = detailsSaveIdRef.current + 1
    detailsSaveIdRef.current = saveId
    const timer = setTimeout(() => {
      setDetailsSaveState('saving')
      void updateTrigger
        .mutateAsync({
          triggerId: selectedTriggerId,
          patch: {prompt: promptBlocksForRequest(prompt), source},
        })
        .then((result) => {
          if (detailsSaveIdRef.current !== saveId) return
          if (result._ !== 'UpdateAgentTriggerResponse') throw new Error('Unexpected trigger update response')
          lastSavedDetailsKeyRef.current = detailsKey
          if (currentDetailsKeyRef.current === detailsKey) {
            setDetailsDirty(false)
            setDetailsSaveState('saved')
            setTimeout(() => {
              if (detailsSaveIdRef.current === saveId) setDetailsSaveState('idle')
            }, 1800)
          } else {
            setDetailsDirty(true)
            setDetailsSaveState('idle')
          }
        })
        .catch((error) => {
          if (detailsSaveIdRef.current !== saveId) return
          setDetailsSaveState('error')
          toast.error(error instanceof Error ? error.message : 'Could not save trigger')
        })
    }, 800)
    return () => clearTimeout(timer)
  }, [currentDetailsKey, detailsDirty, detailsSaveState, prompt, readOnly, selected, selectedTriggerId, source])

  async function handleDeleteTrigger() {
    if (!selectedTriggerId) return
    try {
      const result = await deleteTrigger.mutateAsync(selectedTriggerId)
      if (result._ !== 'DeleteAgentTriggerResponse') throw new Error('Unexpected trigger delete response')
      toast.success('Trigger deleted')
      navigate({key: 'agent', agentId, serverUrl, tab: 'triggers'})
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete trigger')
    }
  }

  if (selectedTriggerId) {
    return (
      <>
        <AgentSubpageHeader
          title={name}
          placeholder="Untitled trigger"
          onTitleChange={(value) => {
            setName(value)
            setNameDirty(true)
          }}
          saveState={nameSaveState}
          disabled={!selected || readOnly}
          backLabel="Back to agent triggers"
          onBack={() => navigate({key: 'agent', agentId, serverUrl, tab: 'triggers'})}
          actions={
            !readOnly ? (
              <OptionsDropdown
                align="end"
                menuItems={[
                  {
                    key: 'delete-trigger',
                    icon: <Trash2 className="size-4" />,
                    label: 'Delete trigger',
                    variant: 'destructive',
                    onClick: () => void handleDeleteTrigger(),
                  },
                ]}
              />
            ) : null
          }
        />
        <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
          {trigger.isLoading ? <SizableText color="muted">Loading trigger…</SizableText> : null}
          {trigger.isError ? (
            <SizableText className="text-destructive">
              {trigger.error instanceof Error ? trigger.error.message : 'Could not load trigger'}
            </SizableText>
          ) : null}
          {selected ? (
            <>
              {readOnly ? (
                <div className="grid gap-4">
                  <div className="border-border bg-muted/40 rounded-lg border p-3">
                    <SizableText size="sm" weight="bold" className="block">
                      Source
                    </SizableText>
                    <SizableText size="sm" color="muted">
                      {summarizeTriggerSource(source)}
                    </SizableText>
                  </div>
                  <div className="flex flex-col gap-1">
                    <SizableText size="sm" weight="bold">
                      Prompt
                    </SizableText>
                    <pre className="border-border bg-muted/40 min-h-40 rounded-lg border p-3 text-sm whitespace-pre-wrap">
                      {promptBlocksToMarkdown(prompt) || 'No prompt configured.'}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="grid gap-4">
                  <TriggerSourceFields
                    source={source}
                    lockSourceType={source.type === 'webhook'}
                    onChange={(nextSource) => {
                      setSource(nextSource)
                      setDetailsDirty(true)
                    }}
                    trailing={
                      <label className="flex h-9 items-center gap-2 text-base">
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={updateTrigger.isLoading}
                          onChange={(event) => void handleEnabledChange(event.target.checked)}
                        />
                        Enable Trigger
                      </label>
                    }
                  />
                  <div className="flex flex-col gap-1">
                    <SizableText size="sm" weight="bold">
                      Prompt
                    </SizableText>
                    <AgentPromptEditor
                      key={selected.id}
                      initialBlocks={prompt}
                      onChange={(blocks) => {
                        setPrompt(blocks)
                        setDetailsDirty(true)
                      }}
                    />
                    <SizableText size="xs" color={detailsSaveState === 'error' ? undefined : 'muted'}>
                      {detailsSaveState === 'saving'
                        ? 'Saving…'
                        : detailsSaveState === 'saved'
                          ? 'Saved.'
                          : detailsSaveState === 'error'
                            ? 'Save failed.'
                            : ''}
                    </SizableText>
                  </div>
                </div>
              )}
              <div className="border-border flex flex-col gap-2 border-t pt-5">
                <SizableText weight="bold">Sessions created by this trigger</SizableText>
                {!trigger.data?.sessions.length ? (
                  <SizableText color="muted">No sessions created yet.</SizableText>
                ) : null}
                {trigger.data?.sessions.map((session) => (
                  <SessionListItem
                    key={session.id}
                    session={session}
                    serverUrl={serverUrl}
                    accountUid={selectedAccountId}
                    onOpen={() => navigate({key: 'agent-session', agentId, sessionId: session.id, serverUrl})}
                    onOpenSession={(child) =>
                      navigate({key: 'agent-session', agentId: child.agentId, sessionId: child.id, serverUrl})
                    }
                    onOpenTrigger={() =>
                      navigate({key: 'agent', agentId, serverUrl, tab: 'triggers', triggerId: selected.id})
                    }
                  />
                ))}
              </div>
              <div className="border-border grid gap-3 border-t pt-5 text-sm md:grid-cols-3">
                <TriggerMeta label="Last checked" value={selected.lastCheckedAt} />
                <TriggerMeta label="Last fired" value={selected.lastFiredAt} />
                {source.type === 'schedule' ? <TriggerMeta label="Next fire" value={nextScheduledFire} /> : null}
                <div className="flex flex-col gap-1">
                  <SizableText size="sm" weight="bold">
                    Last error
                  </SizableText>
                  <SizableText size="sm" color={selected.lastError ? undefined : 'muted'}>
                    {selected.lastError || 'None'}
                  </SizableText>
                </div>
              </div>
            </>
          ) : null}
        </div>
      </>
    )
  }

  return (
    <section className="flex flex-col gap-2">
      {isLoading ? <SizableText color="muted">Loading triggers…</SizableText> : null}
      {!isLoading && !triggers.length ? (
        <div className="border-border flex flex-col gap-2 rounded-xl border border-dashed p-6">
          <SizableText weight="bold">No triggers yet.</SizableText>
          <SizableText size="sm" color="muted">
            Create a trigger to start sessions when matching Seed activity appears.
          </SizableText>
        </div>
      ) : null}
      {triggers.map((item) => (
        <button
          key={item.id}
          className="hover:bg-muted/60 flex cursor-pointer flex-col items-start rounded-lg px-3 py-2 text-left transition-colors"
          onClick={() => navigate({key: 'agent', agentId, serverUrl, tab: 'triggers', triggerId: item.id})}
        >
          <div className="flex w-full items-center justify-between gap-3">
            <SizableText weight="bold">{item.name}</SizableText>
            <SizableText size="xs" color={item.enabled ? undefined : 'muted'}>
              {item.enabled ? 'Enabled' : 'Disabled'}
            </SizableText>
          </div>
          <SizableText size="sm" color="muted">
            {summarizeTriggerSource(item.source)}
          </SizableText>
          <SizableText size="xs" color="muted">
            Updated {new Date(item.updatedAt).toLocaleString()}
          </SizableText>
        </button>
      ))}
    </section>
  )
}

function TriggerMeta({label, value}: {label: string; value?: number | string | null}) {
  return (
    <div className="flex flex-col gap-1">
      <SizableText size="sm" weight="bold">
        {label}
      </SizableText>
      <SizableText size="sm" color="muted">
        {typeof value === 'number' ? new Date(value).toLocaleString() : value || 'Never'}
      </SizableText>
    </div>
  )
}

function CreateAgentTriggerDialog({
  input,
  onClose,
}: {
  input: {serverUrl: string; selectedAccountId: string | null | undefined; agentId: string}
  onClose: () => void
}) {
  const createTrigger = useCreateAgentTrigger(input.serverUrl, input.selectedAccountId)
  const [name, setName] = useState('New activity trigger')
  const [source, setSource] = useState<AgentTriggerSource>({type: 'document-comment', resource: ''})
  const [prompt, setPrompt] = useState<HMBlockNode[]>(() =>
    agentPromptToBlocks('Respond to the event, performing the action requested.'),
  )
  const [createdWebhook, setCreatedWebhook] = useState<{endpoint: string; secret: string; curl: string} | null>(null)
  const createRequestId = useRef(crypto.randomUUID())

  async function handleCreateTrigger() {
    try {
      const trigger: AgentTriggerInput = {
        name,
        enabled: true,
        source,
        prompt: promptBlocksForRequest(prompt),
      }
      const result = await createTrigger.mutateAsync({
        agentId: input.agentId,
        trigger,
        clientRequestId: createRequestId.current,
      })
      if (result._ !== 'CreateAgentTriggerResponse') throw new Error('Unexpected trigger create response')
      if (source.type === 'webhook') {
        if (!result.webhookSecret) throw new Error('Webhook secret was not returned')
        const endpoint = getAgentWebhookUrl(input.serverUrl, result.trigger.id)
        const secret = result.webhookSecret
        setCreatedWebhook({
          endpoint,
          secret,
          curl: [
            `curl -X POST "${endpoint}" \\`,
            `  -H "Authorization: Bearer ${secret}" \\`,
            '  -H "Content-Type: application/json" \\',
            `  -H "Idempotency-Key: test-${crypto.randomUUID()}" \\`,
            `  -d '{"message":"hello"}'`,
          ].join('\n'),
        })
        return
      }
      toast.success('Trigger created')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create trigger')
    }
  }

  if (createdWebhook) {
    const copy = (value: string, label: string) => {
      toast.promise(copyTextToClipboard(value), {
        loading: '',
        success: `${label} copied`,
        error: `Could not copy ${label.toLowerCase()}`,
      })
    }
    return (
      <div className="flex w-full min-w-0 max-w-full flex-col gap-5">
        <div>
          <DialogTitle>Webhook trigger created</DialogTitle>
          <DialogDescription>
            Save the bearer secret now. It is not stored in plaintext and cannot be shown again.
          </DialogDescription>
        </div>
        <WebhookCredential
          label="Endpoint"
          value={createdWebhook.endpoint}
          onCopy={() => copy(createdWebhook.endpoint, 'Endpoint')}
        />
        <WebhookCredential
          label="Bearer secret"
          value={createdWebhook.secret}
          onCopy={() => copy(createdWebhook.secret, 'Bearer secret')}
        />
        <div className="flex flex-col gap-1">
          <div className="flex items-center justify-between gap-2">
            <SizableText size="sm" weight="bold">
              Test request
            </SizableText>
            <Button type="button" size="sm" variant="ghost" onClick={() => copy(createdWebhook.curl, 'cURL command')}>
              <Copy className="size-4" /> Copy cURL
            </Button>
          </div>
          <pre className="border-border bg-muted/40 overflow-x-auto whitespace-pre-wrap rounded-lg border p-3 font-mono text-xs">
            {createdWebhook.curl}
          </pre>
        </div>
        <div className="border-border bg-muted/40 rounded-lg border p-3">
          <SizableText size="xs" color="muted">
            Send JSON with <code>Authorization: Bearer &lt;secret&gt;</code> and a unique <code>Idempotency-Key</code>
            header. Reusing a key with a different body is rejected.
          </SizableText>
        </div>
        <div className="flex justify-end">
          <Button onClick={onClose}>Done</Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex w-full min-w-0 max-w-full flex-col gap-5">
      <div>
        <DialogTitle>New trigger</DialogTitle>
        <DialogDescription>Start a new agent session when the selected event occurs.</DialogDescription>
      </div>
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Name
        </SizableText>
        <Input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <TriggerSourceFields source={source} onChange={setSource} />
      <div className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Prompt
        </SizableText>
        <AgentPromptEditor initialBlocks={prompt} onChange={setPrompt} />
        {source.type === 'webhook' ? (
          <SizableText size="xs" color="muted">
            This prompt tells the agent how to handle each delivery. The posted JSON is supplied separately as untrusted
            trigger data.
          </SizableText>
        ) : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void handleCreateTrigger()} disabled={createTrigger.isLoading}>
          Create trigger
        </Button>
      </div>
    </div>
  )
}

function WebhookCredential({label, value, onCopy}: {label: string; value: string; onCopy: () => void}) {
  return (
    <label className="flex flex-col gap-1">
      <SizableText size="sm" weight="bold">
        {label}
      </SizableText>
      <div className="flex min-w-0 gap-2">
        <Input className="min-w-0 flex-1 font-mono" value={value} readOnly />
        <Button type="button" variant="outline" onClick={onCopy} aria-label={`Copy ${label.toLowerCase()}`}>
          <Copy className="size-4" /> Copy
        </Button>
      </div>
    </label>
  )
}

function nextScheduleFire(input: {
  source: AgentTriggerSource
  createdAt: number
  lastFiredAt?: number
  enabled: boolean
}): number | string | null {
  if (!input.enabled) return 'Disabled'
  if (input.source.type !== 'schedule') return null
  const schedule = input.source.schedule
  const now = Date.now()
  const after = input.lastFiredAt ?? input.createdAt
  if (schedule.kind === 'interval') {
    const intervalMs = schedule.every * (schedule.unit === 'hours' ? 60 * 60_000 : 60_000)
    return after + intervalMs
  }
  if (schedule.kind === 'once') return input.lastFiredAt ? 'Already fired' : schedule.runAt
  return nextWeeklyScheduleFire(schedule, now, after)
}

function nextWeeklyScheduleFire(
  schedule: Extract<Extract<AgentTriggerSource, {type: 'schedule'}>['schedule'], {kind: 'weekly'}>,
  now: number,
  after: number,
): number | null {
  const nowParts = zonedParts(now, schedule.timezone)
  const [hourRaw, minuteRaw] = schedule.timeOfDay.split(':')
  const hour = Number(hourRaw)
  const minute = Number(minuteRaw)
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !schedule.daysOfWeek.length) return null
  let next: number | null = null
  for (let offset = 0; offset <= 14; offset += 1) {
    const utcNoon = Date.UTC(nowParts.year, nowParts.month - 1, nowParts.day + offset, 12, 0)
    const parts = zonedParts(utcNoon, schedule.timezone)
    if (!schedule.daysOfWeek.includes(parts.weekday)) continue
    const candidate = zonedTimeToUtcMs(parts.year, parts.month, parts.day, hour, minute, schedule.timezone)
    if (candidate <= now || candidate <= after) continue
    if (next === null || candidate < next) next = candidate
  }
  return next
}

function zonedTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): number {
  let guess = Date.UTC(year, month - 1, day, hour, minute)
  for (let i = 0; i < 3; i += 1) {
    const parts = zonedParts(guess, timeZone)
    const desired = Date.UTC(year, month - 1, day, hour, minute)
    const actual = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute)
    const diff = desired - actual
    if (diff === 0) break
    guess += diff
  }
  return guess
}

function zonedParts(
  ms: number,
  timeZone: string,
): {year: number; month: number; day: number; hour: number; minute: number; weekday: number} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
  const values = Object.fromEntries(formatter.formatToParts(new Date(ms)).map((part) => [part.type, part.value]))
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf((values.weekday || 'Sun').slice(0, 3)),
  }
}

function SessionListItem({
  session,
  serverUrl,
  accountUid,
  onOpen,
  onOpenSession,
  onOpenTrigger,
}: {
  session: SessionInfo
  serverUrl: string
  accountUid: string | null | undefined
  onOpen: (event: React.MouseEvent<HTMLButtonElement>) => void
  /** Opens a sub-session listed under this one. */
  onOpenSession?: (session: SessionInfo, event: React.MouseEvent<HTMLButtonElement>) => void
  onOpenTrigger?: () => void
}) {
  return (
    <div className="hover:bg-muted flex flex-col items-start rounded-lg px-3 py-2 transition-colors">
      <button type="button" className="flex w-full flex-col gap-0.5 text-left max-sm:min-h-10" onClick={onOpen}>
        <span className="flex w-full items-center gap-3">
          <SessionStatusDot status={session.status} />
          <SizableText weight="bold" className="min-w-0 flex-1 truncate">
            {session.title || 'Untitled session'}
          </SizableText>
          <SizableText size="sm" color="muted" className="flex-none whitespace-nowrap">
            {formattedDateMedium(new Date(session.updatedAt))}
          </SizableText>
        </span>
        {session.description ? (
          <SizableText size="sm" color="muted" className="line-clamp-3 w-full pl-5">
            {session.description}
          </SizableText>
        ) : null}
      </button>
      {session.startedByTrigger ? (
        <button
          type="button"
          className="bg-primary/10 text-primary mt-2 rounded-full px-2 py-0.5 text-xs font-bold"
          onClick={(event) => {
            event.stopPropagation()
            onOpenTrigger?.()
          }}
        >
          Triggered by {session.startedByTrigger.triggerName}
        </button>
      ) : null}
      {session.childSessionCount && onOpenSession ? (
        <div className="mt-1 w-full pl-5">
          <SubSessionsDisclosure
            serverUrl={serverUrl}
            accountUid={accountUid}
            parentSessionId={session.id}
            childSessionCount={session.childSessionCount}
            onOpenSession={onOpenSession}
          />
        </div>
      ) : null}
    </div>
  )
}

export default function AgentDetailRoutePage() {
  const route = useNavRoute()
  const selectedAccountId = useSelectedAccountId()
  // Keep every account this account's agents can author as synced locally, so they are
  // immediately mentionable and openable elsewhere in the app.
  useAgentAccountsSync()
  if (route.key !== 'agent') return null
  // Agent servers reject unauthenticated requests, so without an active account this page cannot
  // load the agent — gate it entirely (the back stack can land here after a sign-out).
  if (!selectedAccountId) return <AgentsNoAccountPage />
  return (
    <AgentDetailPage
      agentId={route.agentId}
      routeServerUrl={route.serverUrl}
      tab={route.tab}
      triggerId={route.triggerId}
      memoryPath={route.memoryPath}
    />
  )
}
