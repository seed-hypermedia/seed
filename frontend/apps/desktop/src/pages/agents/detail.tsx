import {
  type AgentDefinition,
  type AgentTriggerInfo,
  type AgentTriggerInput,
  type AgentTriggerSource,
  type SessionInfo,
  type SigningIdentity,
} from '@/agents-client'
import {
  DEFAULT_AGENT_SERVER_URL,
  useAgentDetail,
  useAgentList,
  useAgentServerHealth,
  useAgentServerUrl,
  useAgentTrigger,
  useAgentTriggers,
  useAgentWebSocketSubscription,
  useCreateAgentSession,
  useCreateAgentTrigger,
  useCreateSigningIdentity,
  useDeleteAgent,
  useDeleteAgentTrigger,
  useModelProviders,
  useProviderModels,
  useSigningIdentities,
  useUpdateAgent,
  useUpdateAgentTrigger,
  useUpdateSigningIdentity,
} from '@/models/agents'
import {useSelectedAccountId} from '@/selected-account'
import {useClickNavigate, useNavigate} from '@/utils/useNavigate'
import {markdownBlockNodesToHMBlockNodes, parseMarkdown} from '@seed-hypermedia/client'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {useSearch} from '@shm/shared/models/search'
import {formattedDateMedium} from '@shm/shared/utils/date'
import {packHmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogTitle,
} from '@shm/ui/components/alert-dialog'
import {DialogDescription, DialogTitle} from '@shm/ui/components/dialog'
import {Input} from '@shm/ui/components/input'
import {Container, PanelContainer} from '@shm/ui/container'
import {OptionsDropdown} from '@shm/ui/options-dropdown'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {Info, KeyRound, Plus, Trash2} from 'lucide-react'
import React, {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {getSeedToolMetadata, seedToolRegistry} from '../../../../../../agents/protocol/src/tool-registry'
import {
  AGENT_READ_TOOL_GROUP,
  AGENT_WEB_TOOL_GROUP,
  getToolAvailability,
  type AgentServerWebCapabilities,
} from './agent-tools'
import {AddModelProviderDialog, EditAgentNameDialog, type AgentAccountRenameStatus} from './dialogs'
import {AgentHeader, AgentSubpageHeader, type AgentPageTab} from './header'
import {ModelSelect} from './model-select'
import {curateProviderModels} from './model-utils'
import {AgentPromptEditor, promptBlocksToMarkdown} from './prompt-editor'
import {ProviderSelect} from './provider-select'

function AgentDetailPage({
  agentId,
  routeServerUrl,
  tab = 'sessions',
  triggerId,
}: {
  agentId: string
  routeServerUrl?: string
  tab?: AgentPageTab
  triggerId?: string
}) {
  const selectedAccountId = useSelectedAccountId()
  const navigate = useNavigate()
  const clickNavigate = useClickNavigate()
  const serverUrlQuery = useAgentServerUrl()
  const serverUrl = routeServerUrl || serverUrlQuery.data || DEFAULT_AGENT_SERVER_URL
  const serverHealth = useAgentServerHealth(serverUrl)
  const agent = useAgentDetail(serverUrl, selectedAccountId, agentId)
  const triggers = useAgentTriggers(serverUrl, selectedAccountId, agentId)
  const createSession = useCreateAgentSession(serverUrl, selectedAccountId)
  const updateAgent = useUpdateAgent(serverUrl, selectedAccountId)
  const updateSigningIdentity = useUpdateSigningIdentity(serverUrl, selectedAccountId)
  const deleteAgentDialog = useAppDialog(DeleteAgentDialog, {isAlert: true})
  const signingIdentities = useSigningIdentities(serverUrl, selectedAccountId)
  const createSigningIdentity = useCreateSigningIdentity(serverUrl, selectedAccountId)
  const createTriggerDialog = useAppDialog(CreateAgentTriggerDialog)
  const editNameDialog = useAppDialog(EditAgentNameDialog)
  const modelProviders = useModelProviders(serverUrl, selectedAccountId)
  const allAgents = useAgentList(serverUrl, selectedAccountId)
  const addProviderDialog = useAppDialog(AddModelProviderDialog)
  useAgentWebSocketSubscription(serverUrl, selectedAccountId, `agents/${agentId}`)
  const [name, setName] = useState('')
  const [modelProvider, setModelProvider] = useState('')
  const [model, setModel] = useState('')
  const providerModels = useProviderModels(serverUrl, selectedAccountId, modelProvider)
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

  useEffect(() => {
    if (!agent.data) return
    if (!nameModelDirty) {
      setName(agent.data.agent.definition.name)
      setModel(agent.data.agent.definition.model)
      setModelProvider(agent.data.agent.definition.modelProvider)
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
    const {recommended, all} = curateProviderModels(providerModels.data, selectedProviderType)
    const nextModel = recommended[0]?.id || all[0]?.id
    if (nextModel) setModel(nextModel)
  }, [nameModelDirty, model, providerModels.data, selectedProviderType])

  function handleProviderChange(nextProvider: string) {
    if (nextProvider === modelProvider) return
    setModelProvider(nextProvider)
    setModel('') // belongs to the previous provider; the effect above picks a new default
    setNameModelDirty(true)
  }

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
    if (agentSigningKey && !isAccountShared) {
      await updateSigningIdentity.mutateAsync({name: agentSigningKey, label: trimmed})
    }
    if (!nameModelDirty) setName(trimmed)
  }

  async function handleCreateSession() {
    try {
      const result = await createSession.mutateAsync({agentId, title: 'Untitled session'})
      if (result._ !== 'CreateSessionResponse') throw new Error('Unexpected session response')
      navigate({key: 'agent-session', agentId, sessionId: result.sessionId, serverUrl})
      // toast.success('Session created')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create session')
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
    if (draftName === persistedName && model === persistedModel && modelProvider === persistedProvider) {
      setSettingsSaveState('idle')
      return
    }

    const saveId = settingsSaveIdRef.current + 1
    settingsSaveIdRef.current = saveId
    const timer = setTimeout(
      () => {
        setSettingsSaveState('saving')
        void updateAgent
          .mutateAsync({
            agentId,
            definition: {...currentDefinition, name: draftName, model, modelProvider},
          })
          .then((result) => {
            if (settingsSaveIdRef.current !== saveId) return
            if (result._ !== 'GetAgentResponse') throw new Error('Unexpected update response')
            setName(result.agent.definition.name)
            setModel(result.agent.definition.model)
            setModelProvider(result.agent.definition.modelProvider)
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
  }, [agent.data, agentId, model, modelProvider, name, promptDirty, updateAgent.mutateAsync])

  const promptEditorDisabled = !selectedAccountId || serverHealth.isError || agent.isError

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
          definition: {...currentDefinition, systemPrompt: promptBlocksToMarkdown(systemPrompt)},
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
          {agent.isLoading ? <SizableText color="muted">Loading agent…</SizableText> : null}
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
                onEditName={() =>
                  editNameDialog.open({
                    currentName: name,
                    accountStatus: agentAccountStatus,
                    onRename: handleRenameAgent,
                  })
                }
                agentId={agentId}
                serverUrl={serverUrl}
                activeTab={tab}
                sessionsCount={agent.data.sessions.length}
                triggersCount={triggers.data?.length}
                onCreateSession={() => void handleCreateSession()}
                creatingSession={createSession.isLoading}
                onCreateTrigger={() => createTriggerDialog.open({serverUrl, selectedAccountId, agentId})}
                canCreateTrigger={!!selectedAccountId}
                breadcrumbItems={breadcrumbItems}
              />

              {createTriggerDialog.content}
              {deleteAgentDialog.content}
              {addProviderDialog.content}
              {editNameDialog.content}

              {tab === 'sessions' ? (
                <section className="flex min-h-0 flex-1 flex-col">
                  <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                    {!agent.data.sessions.length ? <SizableText color="muted">No sessions yet.</SizableText> : null}
                    {agent.data.sessions.map((session) => (
                      <SessionListItem
                        key={session.id}
                        session={session}
                        serverUrl={serverUrl}
                        onOpen={(event) =>
                          clickNavigate({key: 'agent-session', agentId, sessionId: session.id, serverUrl}, event)
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
                  <StartSessionInput
                    creating={createSession.isLoading}
                    disabled={!selectedAccountId}
                    onCreate={() => void handleCreateSession()}
                  />
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
                />
              ) : null}

              {tab === 'tools' ? (
                <AgentToolsTab
                  definition={agent.data.agent.definition}
                  identities={signingIdentities.data || []}
                  identitiesLoading={signingIdentities.isLoading}
                  webCapabilities={serverHealth.data?.webTools}
                  onSave={(definition) => updateAgent.mutateAsync({agentId, definition})}
                  onCreateIdentity={(label) => createSigningIdentity.mutateAsync(label)}
                  saving={updateAgent.isLoading || createSigningIdentity.isLoading}
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
                    <div className="border-input bg-muted/40 text-muted-foreground min-h-80 rounded-lg border p-4 text-sm">
                      Connect to the agent server to edit this prompt.
                    </div>
                  ) : (
                    <AgentPromptEditor
                      key={promptEditorKey}
                      initialBlocks={systemPrompt}
                      onChange={(blocks) => {
                        setSystemPrompt(blocks)
                        setPromptDirty(true)
                      }}
                    />
                  )}
                </section>
              ) : null}

              {tab === 'settings' ? (
                <section className="flex max-w-2xl flex-col gap-4">
                  <div className="grid gap-3 md:grid-cols-2">
                    <label className="flex flex-col gap-1">
                      <SizableText size="sm" weight="bold">
                        Provider
                      </SizableText>
                      <ProviderSelect
                        providers={modelProviders.data}
                        value={modelProvider}
                        onChange={handleProviderChange}
                        onAddProvider={() => addProviderDialog.open({serverUrl, selectedAccountId})}
                      />
                    </label>
                    <label className="flex flex-col gap-1">
                      <SizableText size="sm" weight="bold">
                        Model
                      </SizableText>
                      <ModelSelect
                        models={providerModels.data}
                        providerType={selectedProviderType}
                        value={model}
                        onChange={(nextModel) => {
                          setModel(nextModel)
                          setNameModelDirty(true)
                        }}
                        isLoading={providerModels.isLoading}
                        isError={providerModels.isError}
                        error={providerModels.error}
                      />
                    </label>
                  </div>
                  <div className="grid gap-3 text-sm md:grid-cols-2">
                    <div>
                      <SizableText size="sm" weight="bold">
                        Status
                      </SizableText>
                      <SizableText size="sm" color="muted">
                        {agent.data.agent.status}
                      </SizableText>
                    </div>
                  </div>
                  <SizableText size="xs" color="muted" className="font-mono">
                    {agent.data.agent.id}
                  </SizableText>
                  <div className="flex flex-wrap items-center gap-2">
                    {settingsSaveState !== 'idle' ? (
                      <SizableText
                        size="xs"
                        className={settingsSaveState === 'error' ? 'text-destructive' : undefined}
                        color={settingsSaveState === 'error' ? undefined : 'muted'}
                      >
                        {settingsSaveState === 'saving'
                          ? 'Saving settings…'
                          : settingsSaveState === 'saved'
                            ? 'Settings saved'
                            : 'Settings save failed'}
                      </SizableText>
                    ) : null}
                    <Button
                      className="w-fit"
                      variant="destructive"
                      onClick={() =>
                        deleteAgentDialog.open({
                          serverUrl,
                          selectedAccountId: selectedAccountId ?? null,
                          agentId,
                          agentName: name,
                          onDeleted: () => navigate({key: 'agents'}),
                        })
                      }
                      disabled={!selectedAccountId}
                    >
                      <Trash2 className="size-4" />
                      Delete agent
                    </Button>
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
        />
      ) : null}
    </PanelContainer>
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

/** Shows the exact model-facing prompt and JSON schemas for a single tool, for agent-owner transparency. */
function ToolInfoDialog({input, onClose}: {input: {toolName: string}; onClose: () => void}) {
  const meta = getSeedToolMetadata(input.toolName)
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
    <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto">
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

const AGENT_TOOL_OPTIONS = [
  {
    names: AGENT_READ_TOOL_GROUP,
    title: 'Read, search, and browse activity',
    description: 'Find and read Seed content.',
  },
  {
    names: AGENT_WEB_TOOL_GROUP,
    title: 'Search and read the web',
    description: 'Search the public web and read web pages as markdown. Requires server web backends.',
  },
  {
    names: [seedToolRegistry.write.name],
    title: seedToolRegistry.write.label,
    description: 'Create and publish Seed content.',
  },
]

function AgentToolsTab({
  definition,
  identities,
  identitiesLoading,
  webCapabilities,
  onSave,
  onCreateIdentity,
  saving,
}: {
  definition: AgentDefinition
  identities: SigningIdentity[]
  identitiesLoading: boolean
  webCapabilities: AgentServerWebCapabilities | undefined
  onSave: (definition: AgentDefinition) => Promise<unknown>
  onCreateIdentity: (label: string) => Promise<unknown>
  saving: boolean
}) {
  const toolInfoDialog = useAppDialog(ToolInfoDialog)
  const definitionSigningKeys = definition.signingKeys || (definition.signingKey ? [definition.signingKey] : [])
  const defaultTools = AGENT_READ_TOOL_GROUP
  const [enabledTools, setEnabledTools] = useState<string[]>(definition.tools || defaultTools)
  const [signingKeys, setSigningKeys] = useState<string[]>(definitionSigningKeys)
  const [showNewIdentityPanel, setShowNewIdentityPanel] = useState(false)
  const [newIdentityName, setNewIdentityName] = useState('Agent publisher')

  useEffect(() => {
    setEnabledTools(definition.tools || defaultTools)
    setSigningKeys(definition.signingKeys || (definition.signingKey ? [definition.signingKey] : []))
  }, [definition])

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
      setEnabledTools(definition.tools || defaultTools)
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

  const writeEnabled = enabledTools.includes(seedToolRegistry.write.name)

  return (
    <section className="flex min-h-0 max-w-3xl flex-1 flex-col gap-5 overflow-y-auto pr-1">
      <div>
        <SizableText weight="bold">Tools</SizableText>
      </div>

      <div className="grid gap-3">
        {AGENT_TOOL_OPTIONS.map((group) => {
          const members = group.names.map((name) => ({
            name,
            label: getSeedToolMetadata(name)?.label ?? name,
            ...getToolAvailability(name, webCapabilities),
          }))
          const groupAvailable = members.some((member) => member.available)
          const checked = group.names.some((name) => enabledTools.includes(name))
          return (
            <div
              key={group.names.join('|')}
              className={`border-border bg-card flex flex-col gap-3 rounded-xl border p-4 ${
                groupAvailable ? '' : 'opacity-60'
              }`}
            >
              <label className="flex items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 size-4"
                  checked={checked}
                  disabled={!groupAvailable}
                  onChange={(event) => {
                    const nextTools = event.target.checked
                      ? Array.from(new Set([...enabledTools, ...group.names]))
                      : enabledTools.filter((item) => !group.names.includes(item))
                    void saveTools(nextTools, signingKeys)
                  }}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <SizableText size="sm" weight="bold">
                      {group.title}
                    </SizableText>
                    {!groupAvailable ? (
                      <span className="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
                        Unavailable
                      </span>
                    ) : null}
                  </div>
                  <SizableText size="sm" color="muted">
                    {group.description}
                  </SizableText>
                </div>
              </label>

              <div className="border-border/60 ml-7 flex flex-col gap-1.5 border-l pl-3">
                {members.map((member) => (
                  <div key={member.name} className={`flex items-start gap-2 ${member.available ? '' : 'opacity-60'}`}>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="flex items-center gap-2">
                        <SizableText size="xs" weight="bold" className="font-mono">
                          {member.name}
                        </SizableText>
                        {!member.available ? (
                          <span className="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px] font-medium tracking-wide uppercase">
                            Unavailable
                          </span>
                        ) : null}
                      </div>
                      {member.note ? (
                        <SizableText size="xs" color="muted">
                          {member.note}
                        </SizableText>
                      ) : null}
                    </div>
                    <Button
                      variant="ghost"
                      size="iconSm"
                      aria-label={`About the ${member.label} tool`}
                      onClick={() => toolInfoDialog.open({toolName: member.name})}
                    >
                      <Info className="size-3.5" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )
        })}
      </div>
      {toolInfoDialog.content}

      {writeEnabled ? (
        <div className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4">
          <div className="flex items-start gap-3">
            <div className="bg-primary/10 text-primary flex size-9 items-center justify-center rounded-lg">
              <KeyRound className="size-5" />
            </div>
            <div className="min-w-0 flex-1">
              <SizableText size="sm" weight="bold">
                Signing identity
              </SizableText>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            {identities.map((identity) => {
              const checked = signingKeys.includes(identity.name)
              return (
                <label
                  key={identity.id}
                  className="border-border bg-background flex items-start gap-3 rounded-lg border px-3 py-2"
                >
                  <input
                    type="checkbox"
                    className="mt-1 size-4"
                    checked={checked}
                    disabled={saving || identitiesLoading}
                    onChange={(event) => {
                      const nextSigningKeys = event.target.checked
                        ? Array.from(new Set([...signingKeys, identity.name]))
                        : signingKeys.filter((name) => name !== identity.name)
                      void saveTools(enabledTools, nextSigningKeys)
                    }}
                  />
                  <div className="min-w-0 flex-1">
                    <SizableText size="sm" weight="bold" className="block truncate">
                      {identity.label || identity.accountId || identity.name}
                    </SizableText>
                  </div>
                </label>
              )
            })}
          </div>
          {!identitiesLoading && identities.length === 0 ? (
            <div className="border-border bg-background flex flex-col gap-3 rounded-lg border border-dashed p-3">
              <SizableText size="sm" color="muted">
                No agent accounts are available on this server yet. Create a new server-side HM account key, then enable
                it for this agent.
              </SizableText>
              <NewAgentAccountPanel
                name={newIdentityName}
                onNameChange={setNewIdentityName}
                onCreate={() => void handleCreateIdentity()}
                disabled={saving}
              />
            </div>
          ) : showNewIdentityPanel ? (
            <NewAgentAccountPanel
              name={newIdentityName}
              onNameChange={setNewIdentityName}
              onCreate={() => void handleCreateIdentity()}
              onCancel={() => setShowNewIdentityPanel(false)}
              disabled={saving}
            />
          ) : (
            <Button className="w-fit" variant="ghost" onClick={() => setShowNewIdentityPanel(true)} disabled={saving}>
              <Plus className="size-4" />
              New Agent Account
            </Button>
          )}
        </div>
      ) : null}

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
}: {
  agentId: string
  serverUrl: string
  selectedAccountId: string | null | undefined
  selectedTriggerId?: string
  triggers: AgentTriggerInfo[]
  isLoading: boolean
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
    if (!selectedTriggerId || !selected || !nameDirty) return
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
  }, [name, nameDirty, selected, selectedTriggerId, updateTrigger])

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
    if (!selectedTriggerId || !selected || !detailsDirty || detailsSaveState === 'saving') return
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
          patch: {prompt: promptBlocksToMarkdown(prompt), source},
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
  }, [currentDetailsKey, detailsDirty, detailsSaveState, prompt, selected, selectedTriggerId, source])

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
          disabled={!selected}
          backLabel="Back to agent triggers"
          onBack={() => navigate({key: 'agent', agentId, serverUrl, tab: 'triggers'})}
          actions={
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
              <div className="border-border grid gap-4 rounded-xl border p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <SizableText weight="bold">Trigger details</SizableText>
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={enabled}
                      disabled={updateTrigger.isLoading}
                      onChange={(event) => void handleEnabledChange(event.target.checked)}
                    />
                    Enabled
                  </label>
                </div>
                <TriggerSourceFields
                  source={source}
                  onChange={(nextSource) => {
                    setSource(nextSource)
                    setDetailsDirty(true)
                  }}
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
                <div className="grid gap-3 text-sm md:grid-cols-3">
                  <TriggerMeta label="Last checked" value={selected.lastCheckedAt} />
                  <TriggerMeta label="Last fired" value={selected.lastFiredAt} />
                  {source.type === 'schedule' ? <TriggerMeta label="Next fire" value={nextScheduledFire} /> : null}
                  <div>
                    <SizableText size="sm" weight="bold">
                      Last error
                    </SizableText>
                    <SizableText size="sm" color={selected.lastError ? undefined : 'muted'}>
                      {selected.lastError || 'None'}
                    </SizableText>
                  </div>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                <SizableText weight="bold">Sessions created by this trigger</SizableText>
                {!trigger.data?.sessions.length ? (
                  <SizableText color="muted">No sessions created yet.</SizableText>
                ) : null}
                {trigger.data?.sessions.map((session) => (
                  <SessionListItem
                    key={session.id}
                    session={session}
                    serverUrl={serverUrl}
                    onOpen={() => navigate({key: 'agent-session', agentId, sessionId: session.id, serverUrl})}
                    onOpenTrigger={() =>
                      navigate({key: 'agent', agentId, serverUrl, tab: 'triggers', triggerId: selected.id})
                    }
                  />
                ))}
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
            {triggerSourceSummary(item.source)}
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
    <div>
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
  const [enabled, setEnabled] = useState(true)
  const [source, setSource] = useState<AgentTriggerSource>({type: 'document-comment', resource: ''})
  const [prompt, setPrompt] = useState<HMBlockNode[]>(() =>
    agentPromptToBlocks('Read the related Seed context and summarize what needs attention.'),
  )

  async function handleCreateTrigger() {
    try {
      const trigger: AgentTriggerInput = {
        name,
        enabled,
        source,
        prompt: promptBlocksToMarkdown(prompt),
      }
      const result = await createTrigger.mutateAsync({agentId: input.agentId, trigger})
      if (result._ !== 'CreateAgentTriggerResponse') throw new Error('Unexpected trigger create response')
      toast.success('Trigger created')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create trigger')
    }
  }

  return (
    <div className="flex min-w-[560px] flex-col gap-5">
      <div>
        <DialogTitle>New trigger</DialogTitle>
        <DialogDescription>Start a new agent session when matching Seed activity appears.</DialogDescription>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        Enabled
      </label>
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

function TriggerSourceFields({
  source,
  onChange,
}: {
  source: AgentTriggerSource
  onChange: (source: AgentTriggerSource) => void
}) {
  return (
    <div className="grid gap-3">
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Trigger Session on:
        </SizableText>
        <select
          className="border-input bg-background rounded-md border px-3 py-2 text-sm"
          value={source.type}
          onChange={(event) => onChange(defaultSourceForType(event.target.value as AgentTriggerSource['type']))}
        >
          <option value="document-comment">Comment in a document</option>
          <option value="user-mention">User mention</option>
          <option value="site-update">Site update</option>
          <option value="schedule">Schedule</option>
        </select>
      </label>
      {source.type === 'document-comment' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <DocumentAutocompleteField
            label="Document"
            value={source.resource}
            onChange={(value) => onChange({...source, resource: value})}
            placeholder="Search documents or enter hm:// URL"
          />
          <label className="flex flex-col gap-1">
            <SizableText size="sm" weight="bold">
              Author filter
            </SizableText>
            <Input
              value={source.author || ''}
              onChange={(event) => onChange({...source, author: event.target.value || undefined})}
              placeholder="optional account ID"
            />
          </label>
        </div>
      ) : null}
      {source.type === 'user-mention' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <AccountAutocompleteField
            label="Mentioned account"
            value={source.mentionedAccount}
            onChange={(value) => onChange({...source, mentionedAccount: value})}
            placeholder="Search users or enter account ID"
            valueFormat="uid"
          />
          <AccountAutocompleteField
            label="Resource/site prefix"
            value={source.resourcePrefix || ''}
            onChange={(value) => onChange({...source, resourcePrefix: value || undefined})}
            placeholder="Search site/account or enter hm:// prefix"
            valueFormat="hm-url"
          />
        </div>
      ) : null}
      {source.type === 'site-update' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <AccountAutocompleteField
            label="Resource/site prefix"
            value={source.resourcePrefix}
            onChange={(value) => onChange({...source, resourcePrefix: value})}
            placeholder="Search site/account or enter hm:// prefix"
            valueFormat="hm-url"
          />
          <label className="flex flex-col gap-1">
            <SizableText size="sm" weight="bold">
              Event types
            </SizableText>
            <Input
              value={(source.eventTypes || []).join(', ')}
              onChange={(event) =>
                onChange({
                  ...source,
                  eventTypes: event.target.value
                    .split(',')
                    .map((value) => value.trim())
                    .filter(Boolean),
                })
              }
              placeholder="doc-update, comment"
            />
          </label>
        </div>
      ) : null}
      {source.type === 'schedule' ? <ScheduleTriggerFields source={source} onChange={onChange} /> : null}
    </div>
  )
}

function ScheduleTriggerFields({
  source,
  onChange,
}: {
  source: Extract<AgentTriggerSource, {type: 'schedule'}>
  onChange: (source: AgentTriggerSource) => void
}) {
  const schedule = source.schedule
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const setSchedule = (next: Extract<AgentTriggerSource, {type: 'schedule'}>['schedule']) =>
    onChange({type: 'schedule', schedule: next})
  return (
    <div className="grid gap-3">
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Schedule mode
        </SizableText>
        <select
          className="border-input bg-background rounded-md border px-3 py-2 text-sm"
          value={schedule.kind}
          onChange={(event) => {
            const kind = event.target.value
            if (kind === 'weekly') setSchedule({kind, daysOfWeek: [1, 2, 3, 4, 5], timeOfDay: '09:00', timezone})
            else if (kind === 'once') setSchedule({kind, runAt: Date.now() + 60 * 60 * 1000, timezone})
            else setSchedule({kind: 'interval', every: 1, unit: 'hours'})
          }}
        >
          <option value="interval">Every interval</option>
          <option value="weekly">Days of week</option>
          <option value="once">One time</option>
        </select>
      </label>
      {schedule.kind === 'interval' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <SizableText size="sm" weight="bold">
              Every
            </SizableText>
            <Input
              type="number"
              min={1}
              value={schedule.every}
              onChange={(event) => setSchedule({...schedule, every: Number(event.target.value) || 1})}
            />
          </label>
          <label className="flex flex-col gap-1">
            <SizableText size="sm" weight="bold">
              Unit
            </SizableText>
            <select
              className="border-input bg-background rounded-md border px-3 py-2 text-sm"
              value={schedule.unit}
              onChange={(event) => setSchedule({...schedule, unit: event.target.value as 'minutes' | 'hours'})}
            >
              <option value="minutes">Minutes</option>
              <option value="hours">Hours</option>
            </select>
          </label>
        </div>
      ) : null}
      {schedule.kind === 'weekly' ? (
        <div className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            {[
              ['Mon', 1],
              ['Tue', 2],
              ['Wed', 3],
              ['Thu', 4],
              ['Fri', 5],
              ['Sat', 6],
              ['Sun', 0],
            ].map(([day, dayIndex]) => (
              <label key={day} className="border-border flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                <input
                  type="checkbox"
                  checked={schedule.daysOfWeek.includes(dayIndex as number)}
                  onChange={(event) => {
                    const dayNumber = dayIndex as number
                    const daysOfWeek = event.target.checked
                      ? [...schedule.daysOfWeek, dayNumber].sort()
                      : schedule.daysOfWeek.filter((item) => item !== dayNumber)
                    setSchedule({...schedule, daysOfWeek})
                  }}
                />
                {day}
              </label>
            ))}
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            <label className="flex flex-col gap-1">
              <SizableText size="sm" weight="bold">
                Time of day
              </SizableText>
              <Input
                type="time"
                value={schedule.timeOfDay}
                onChange={(event) => setSchedule({...schedule, timeOfDay: event.target.value})}
              />
            </label>
            <label className="flex flex-col gap-1">
              <SizableText size="sm" weight="bold">
                Timezone
              </SizableText>
              <Input
                value={schedule.timezone}
                onChange={(event) => setSchedule({...schedule, timezone: event.target.value})}
              />
            </label>
          </div>
        </div>
      ) : null}
      {schedule.kind === 'once' ? (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="flex flex-col gap-1">
            <SizableText size="sm" weight="bold">
              Date and time
            </SizableText>
            <Input
              type="datetime-local"
              value={dateTimeLocalValue(schedule.runAt)}
              onChange={(event) => setSchedule({...schedule, runAt: new Date(event.target.value).getTime(), timezone})}
            />
          </label>
          <label className="flex flex-col gap-1">
            <SizableText size="sm" weight="bold">
              Timezone
            </SizableText>
            <Input
              value={schedule.timezone || timezone}
              onChange={(event) => setSchedule({...schedule, timezone: event.target.value})}
            />
          </label>
        </div>
      ) : null}
    </div>
  )
}

function DocumentAutocompleteField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  const [focused, setFocused] = useState(false)
  const search = useSearch(value, {
    enabled: focused && value.trim().length > 0,
    pageSize: 12,
  })
  const documents = useMemo(
    () => (search.data?.entities || []).filter((item) => item.type === 'document').slice(0, 8),
    [search.data?.entities],
  )

  return (
    <label className="relative flex flex-col gap-1">
      <SizableText size="sm" weight="bold">
        {label}
      </SizableText>
      <Input
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      {focused && documents.length ? (
        <div className="border-border bg-popover absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border p-1 shadow-lg">
          {documents.map((document) => {
            const nextValue = packHmId(document.id)
            return (
              <button
                key={document.id.id}
                type="button"
                className="hover:bg-muted flex w-full flex-col rounded px-2 py-2 text-left"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(nextValue)
                  setFocused(false)
                }}
              >
                <SizableText size="sm" weight="bold" className="truncate">
                  {document.title || nextValue}
                </SizableText>
                <SizableText size="xs" color="muted" className="truncate font-mono">
                  {nextValue}
                </SizableText>
              </button>
            )
          })}
        </div>
      ) : null}
    </label>
  )
}

function AccountAutocompleteField({
  label,
  value,
  onChange,
  placeholder,
  valueFormat,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder: string
  valueFormat: 'uid' | 'hm-url'
}) {
  const [focused, setFocused] = useState(false)
  const search = useSearch(value, {
    enabled: focused && value.trim().length > 0,
    pageSize: 12,
  })
  const accounts = useMemo(
    () => (search.data?.entities || []).filter((item) => item.type === 'contact' || !item.id.path?.length).slice(0, 8),
    [search.data?.entities],
  )

  return (
    <label className="relative flex flex-col gap-1">
      <SizableText size="sm" weight="bold">
        {label}
      </SizableText>
      <Input
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => window.setTimeout(() => setFocused(false), 120)}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
      {focused && accounts.length ? (
        <div className="border-border bg-popover absolute top-full right-0 left-0 z-20 mt-1 max-h-64 overflow-auto rounded-md border p-1 shadow-lg">
          {accounts.map((account) => {
            const nextValue = valueFormat === 'hm-url' ? `hm://${account.id.uid}` : account.id.uid
            return (
              <button
                key={`${account.id.id}:${account.type}`}
                type="button"
                className="hover:bg-muted flex w-full flex-col rounded px-2 py-2 text-left"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(nextValue)
                  setFocused(false)
                }}
              >
                <SizableText size="sm" weight="bold" className="truncate">
                  {account.title || account.id.uid}
                </SizableText>
                <SizableText size="xs" color="muted" className="truncate font-mono">
                  {nextValue}
                </SizableText>
              </button>
            )
          })}
        </div>
      ) : null}
    </label>
  )
}

function defaultSourceForType(type: AgentTriggerSource['type']): AgentTriggerSource {
  if (type === 'user-mention') return {type, mentionedAccount: ''}
  if (type === 'site-update') return {type, resourcePrefix: '', eventTypes: ['doc-update', 'comment']}
  if (type === 'schedule') return {type, schedule: {kind: 'interval', every: 1, unit: 'hours'}}
  return {type: 'document-comment', resource: ''}
}

function triggerSourceSummary(source: AgentTriggerSource): string {
  if (source.type === 'document-comment') {
    return `Comment in ${source.resource}${source.author ? ` by ${source.author}` : ''}`
  }
  if (source.type === 'user-mention') {
    return `Mention of ${source.mentionedAccount}${source.resourcePrefix ? ` in ${source.resourcePrefix}` : ''}`
  }
  if (source.type === 'site-update') {
    return `Update in ${source.resourcePrefix}${source.eventTypes?.length ? ` (${source.eventTypes.join(', ')})` : ''}`
  }
  if (source.schedule.kind === 'interval') return `Every ${source.schedule.every} ${source.schedule.unit}`
  if (source.schedule.kind === 'once') return `Once at ${formattedDateMedium(new Date(source.schedule.runAt))}`
  return `${source.schedule.daysOfWeek.map(dayName).join(', ')} at ${source.schedule.timeOfDay} ${
    source.schedule.timezone
  }`
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

function dateTimeLocalValue(ms: number): string {
  if (!Number.isFinite(ms)) return ''
  const date = new Date(ms)
  const offsetMs = date.getTimezoneOffset() * 60 * 1000
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16)
}

function dayName(day: number): string {
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][day] || String(day)
}

function StartSessionInput({
  creating,
  disabled,
  onCreate,
}: {
  creating: boolean
  disabled: boolean
  onCreate: () => void
}) {
  const creatingRef = useRef(false)

  useEffect(() => {
    creatingRef.current = creating
  }, [creating])

  const startSession = useCallback(() => {
    if (disabled || creatingRef.current) return
    creatingRef.current = true
    onCreate()
  }, [disabled, onCreate])

  return (
    <div
      className="border-border placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 mb-3 max-h-48 min-h-10 w-full resize-none overflow-hidden rounded-md border bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50"
      onClick={startSession}
    >
      Type a message to start a new session…
    </div>
  )
}

function SessionListItem({
  session,
  onOpen,
  onOpenTrigger,
}: {
  session: SessionInfo
  serverUrl: string
  onOpen: (event: React.MouseEvent<HTMLButtonElement>) => void
  onOpenTrigger?: () => void
}) {
  return (
    <div className="hover:bg-muted flex flex-col items-start rounded-lg px-3 py-2 transition-colors">
      <button type="button" className="flex w-full items-center gap-3 text-left" onClick={onOpen}>
        <SessionStatusDot status={session.status} />
        <SizableText weight="bold" className="min-w-0 flex-1 truncate">
          {session.title || 'Untitled session'}
        </SizableText>
        <SizableText size="sm" color="muted" className="flex-none whitespace-nowrap">
          {formattedDateMedium(new Date(session.updatedAt))}
        </SizableText>
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
    </div>
  )
}

function SessionStatusDot({status}: {status: SessionInfo['status']}) {
  const className =
    status === 'error'
      ? 'bg-destructive'
      : status === 'streaming'
        ? 'bg-muted-foreground animate-pulse'
        : 'bg-green-500'
  return <span className={`${className} size-2.5 flex-none rounded-full`} aria-label={status} title={status} />
}

export default function AgentDetailRoutePage() {
  const route = useNavRoute()
  if (route.key !== 'agent') return null
  return (
    <AgentDetailPage
      agentId={route.agentId}
      routeServerUrl={route.serverUrl}
      tab={route.tab}
      triggerId={route.triggerId}
    />
  )
}
