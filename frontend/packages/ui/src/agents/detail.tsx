import {
  type AgentCollaboratorInfo,
  type AgentCollaboratorRole,
  type AgentDefinition,
  type AgentModelRef,
  type AgentTriggerInfo,
  type AgentTriggerInput,
  type AgentTriggerSource,
  type TriggerContinuation,
  type TriggerFiringInfo,
  type SessionInfo,
  type SigningIdentity,
  getAgentWebhookUrl,
} from './client'
import {
  getDefaultAgentServerUrl,
  isLocalAgentServer,
  useAgentCollaborators,
  useAgentDetail,
  useAgentSessions,
  useAgentList,
  useAgentAccountsSync,
  useAgentServerHealth,
  useAgentServerUrl,
  describeAgentServer,
  useLocalAgentServerUrl,
  useAgentTools,
  useAgentTrigger,
  useAgentTriggers,
  useAgentWebSocketSubscription,
  useCreateAgentTrigger,
  useCombineAgentTriggers,
  useCreateSigningIdentity,
  useDeleteAgent,
  useDeleteAgentTrigger,
  useInviteAgentCollaborator,
  useModelProviders,
  useProviderModels,
  useRemoveAgentCollaborator,
  useSetAgentPublicChat,
  useSetAgentPublicRead,
  useSigningIdentities,
  useUpdateAgent,
  useUpdateAgentTrigger,
  useUpdateSigningIdentity,
} from './models'
import {describeAgentError} from './errors'
import {SessionListItem} from './session-list-item'
import {useSelectedAccountId} from './account'
import {useClickNavigate, useNavigate} from './navigation'
import {markdownBlockNodesToHMBlockNodes, parseMarkdown} from '@seed-hypermedia/client'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {formattedDateMedium} from '@shm/shared/utils/date'
import {abbreviateUid} from '@shm/shared/utils/abbreviate'
import {useAccount, useCollaborators, useResource} from '@shm/shared/models/entity'
import {useAddCapabilities, useSelectedAccountCapability} from '@shm/shared/models/capabilities'
import type {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {
  AGENT_WRITE_SCOPE_OPTIONS,
  AgentWriteScopePicker,
  useAgentWriteScope,
  useGrantAgentWriteAccess,
  widensAgentWriteScope,
  type AgentWriteScope,
} from './write-access'
import {useAppsPublisher} from '../apps/publish'
import {CreateTriggerDialog} from '../apps/create-dialogs'
import {AgentTriggerDocumentsTab} from '../apps/app-view'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {agentSigningKeys, primaryAgentSigningKey} from './primary-identity'
import {type NavRoute} from '@shm/shared/routes'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {hmId, unpackHmId} from '@shm/shared/utils/entity-id-url'
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
import {SelectDropdown} from '@shm/ui/select-dropdown'
import {Switch} from '@shm/ui/components/switch'
import {AccountSearchInput, type SearchResult} from '@shm/ui/collaborators-page'
import {Container} from '@shm/ui/container'
import {AgentPane} from './pane'
import {OptionsDropdown} from '@shm/ui/options-dropdown'
import {Notice} from '@shm/ui/notice'
import {SizableText} from '@shm/ui/text'
import {Spinner} from '@shm/ui/spinner'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {
  ArrowRight,
  ArrowRightLeft,
  CircleUserRound,
  Copy,
  ExternalLink,
  Globe,
  Info,
  KeyRound,
  Link2,
  MessageSquare,
  Pencil,
  Plug,
  Plus,
  ScrollText,
  Settings,
  Shield,
  Trash2,
  X,
} from 'lucide-react'
import {AccountAvatar} from '@shm/ui/account-avatar'
import {SigningIdentityIcon} from './signing-identity-icon'
import React, {useEffect, useMemo, useRef, useState, type ReactNode} from 'react'
import {activityConditions, getSeedTool} from '@seed-hypermedia/apps-protocol'
import {
  AGENT_PUBLISH_GRANT,
  DEFAULT_AGENT_TOOLS,
  normalizeStoredAgentTools,
  getToolAvailability,
  type AgentServerWebCapabilities,
} from './agent-tools'
import {AgentMemoryTab} from './memory'
import {
  AGENT_TOOL_OPTIONS,
  describeAgentIdentities,
  describeAgentMcpServers,
  describeAgentPermissions,
} from './settings-summaries'
import {AgentMcpServersSection} from './mcp-servers'
import {
  TriggerContinuationFields,
  TriggerSourceFields,
  isTriggerSourceReady,
  isHeadlessContinuation,
  triggerUsesPrompt,
  summarizeTriggerContinuation,
  TriggerSourceSummary,
} from './trigger-types'
import {getAgentsPlatform} from './platform'
import {routeToHref} from '@shm/shared/routing'
import {
  AddModelProviderDialog,
  EditAgentAccountDialog,
  EditAgentNameDialog,
  EnableWindowsHypervisorDialog,
  ManageAgentAccountsDialog,
  ModelProvidersDialog,
  type AgentAccountRenameStatus,
} from './dialogs'
import {AgentHeader, AgentSubpageHeader, type AgentPageTab} from './header'
import {ServerHostSection} from '../server-host-card'
import {writeStickyAgentSession} from './sticky-session'
import {MoveAgentDialog} from './move-agent-dialog'
import {modelReasoningSupport, type ReasoningLevel, type Thoroughness} from '@seed-hypermedia/apps-protocol'
import {ProviderModelSelect} from './provider-model-select'
import {coerceReasoningLevel, ReasoningSlider} from './reasoning-select'
import {ThoroughnessPicker} from './thoroughness-select'
import {pickDefaultProviderModel} from './model-utils'
import {AgentPromptEditor, promptBlocksForRequest, promptBlocksToMarkdown} from './prompt-editor'
import {AgentsNoAccountPage} from './no-account'
import {agentAccessCanChat, agentAccessCanWrite} from './access'
import {NewSessionComposer} from './new-session-composer'
import {randomUUID} from './random-id'
import {AgentMountBanner} from './mount'

/** Agent controls, optionally embedded below a mounted document's tabs. */
export function AgentDetailPage({
  agentId,
  routeServerUrl,
  tab: routeTab = 'sessions',
  triggerId,
  memoryPath,
  embedded = false,
  documentName,
}: {
  agentId: string
  routeServerUrl?: string
  tab?: AgentPageTab
  triggerId?: string
  /** Memory file the route asked to open, set when a tool row linked to it. */
  memoryPath?: string
  embedded?: boolean
  /**
   * The mount document's name attribute. It names a mounted agent: the server copies it onto the
   * definition, and the page shows it right away rather than waiting for that sync. Renaming
   * happens on the document, so the rename dialog stays out when it is given.
   */
  documentName?: string
}) {
  // The Tools tab became the Permissions page under Settings; older routes still land there.
  const tab: AgentPageTab = routeTab === 'tools' ? 'permissions' : routeTab
  const selectedAccountId = useSelectedAccountId()
  const navigate = useNavigate()
  const replaceRoute = useNavigate('replace')
  const clickNavigate = useClickNavigate()
  const serverUrlQuery = useAgentServerUrl()
  const localServerUrl = useLocalAgentServerUrl()
  const serverUrl = routeServerUrl || serverUrlQuery.data || getDefaultAgentServerUrl() || ''
  const serverHealth = useAgentServerHealth(serverUrl)
  const agent = useAgentDetail(serverUrl, selectedAccountId, agentId)
  useEffect(() => {
    if (!embedded && agent.data?.agent.id.startsWith('hm://'))
      replaceRoute({key: 'agent', agentId: agent.data.agent.id, serverUrl, tab, triggerId, memoryPath})
  }, [embedded, agent.data?.agent.id, replaceRoute, serverUrl, tab, triggerId, memoryPath])
  // Top-level sessions only, a page at a time; children nest under their parent's disclosure.
  const sessionPages = useAgentSessions(serverUrl, selectedAccountId, agentId)
  const topLevelSessions = useMemo(
    () => sessionPages.data?.pages.flatMap((page) => page.sessions) ?? [],
    [sessionPages.data],
  )
  // The header count comes from the agent, not from however many pages happen to be loaded.
  const sessionCount = agent.data?.sessionCount ?? topLevelSessions.length
  const triggers = useAgentTriggers(serverUrl, selectedAccountId, agentId)
  const updateAgent = useUpdateAgent(serverUrl, selectedAccountId)
  const updateSigningIdentity = useUpdateSigningIdentity(serverUrl, selectedAccountId)
  const deleteAgentDialog = useAppDialog(DeleteAgentDialog, {isAlert: true})
  const moveAgentDialog = useAppDialog(MoveAgentDialog)
  const signingIdentities = useSigningIdentities(serverUrl, selectedAccountId, agentId)
  const createSigningIdentity = useCreateSigningIdentity(serverUrl, selectedAccountId)
  const createTriggerDialog = useAppDialog(CreateAgentTriggerDialog)
  const agentDocId = useMemo(() => (agentId.startsWith('hm://') ? unpackHmId(agentId) : null), [agentId])
  const agentDocument = useResource(agentDocId)
  const agentHost =
    agentDocId && agentDocument.data?.type === 'document'
      ? {id: agentDocId, document: agentDocument.data.document}
      : null
  const createTriggerDocumentDialog = useAppDialog(CreateTriggerDialog)
  const editNameDialog = useAppDialog(EditAgentNameDialog)
  const publisher = useAppsPublisher()
  const modelProviders = useModelProviders(serverUrl, selectedAccountId, agentId)
  const collaborators = useAgentCollaborators(serverUrl, selectedAccountId, agentId)
  const allAgents = useAgentList(serverUrl, selectedAccountId)
  const addProviderDialog = useAppDialog(AddModelProviderDialog)
  // The server's provider and account lists are reached from the agent that runs on it.
  const providersDialog = useAppDialog(ModelProvidersDialog)
  const manageAccountsDialog = useAppDialog(ManageAgentAccountsDialog)
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
  const [thoroughness, setThoroughness] = useState<Thoroughness | undefined>(undefined)
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
  /** Request-shaped key of the last prompt this page saved successfully; see the prompt autosave effect. */
  const lastSavedPromptKeyRef = useRef<string | null>(null)

  // Showing the list is what closes the open session: back from a transcript, or Sessions clicked
  // while already active, both land here and the tab goes back to leading to the list.
  useEffect(() => {
    if (tab !== 'sessions' || !serverUrl) return
    writeStickyAgentSession(serverUrl, agentId, null)
  }, [tab, serverUrl, agentId])

  useEffect(() => {
    if (!agent.data) return
    if (!nameModelDirty) {
      setName(agent.data.agent.definition.name)
      setModel(agent.data.agent.definition.model)
      setModelProvider(agent.data.agent.definition.modelProvider)
      setReasoningLevel(agent.data.agent.definition.reasoningLevel)
      setThoroughness(agent.data.agent.definition.thoroughness)
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
  const agentSigningKey = primaryAgentSigningKey(agent.data?.agent.definition)
  const isAccountShared =
    !!agentSigningKey &&
    (allAgents.data || []).some((other) => {
      if (other.id === agentId) return false
      const otherKeys =
        other.definition.signingKeys || (other.definition.signingKey ? [other.definition.signingKey] : [])
      return otherKeys.includes(agentSigningKey)
    })
  // The accounts the agent signs as (its primary key first), for its write access.
  const agentAccountIds = agentSigningKeys(agent.data?.agent.definition).flatMap((name) => {
    const accountId = signingIdentities.data?.find((identity) => identity.name === name)?.accountId
    return accountId ? [accountId] : []
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
    const mountId = agentId.startsWith('hm://') ? unpackHmId(agentId) : null
    if (mountId) {
      // A mounted agent is named by its document: publishing the new title renames the agent (its
      // server copies the document's name onto it).
      await publisher.update(mountId, [{type: 'SetAttributes', attrs: [{key: ['name'], value: trimmed}]}])
      invalidateQueries([queryKeys.ENTITY, mountId.id])
    } else {
      const definition = agent.data.agent.definition
      const result = await updateAgent.mutateAsync({agentId, definition: {...definition, name: trimmed}})
      if (result._ !== 'GetAgentResponse') throw new Error('Unexpected update response')
    }
    // Keep the dedicated account's profile name in sync; leave shared accounts alone.
    if (isOwner && agentSigningKey && !isAccountShared) {
      await updateSigningIdentity.mutateAsync({name: agentSigningKey, label: trimmed})
    }
    if (!nameModelDirty) setName(trimmed)
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
      thoroughness === currentDefinition.thoroughness &&
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
        if (thoroughness) nextDefinition.thoroughness = thoroughness
        else delete nextDefinition.thoroughness
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
            setThoroughness(result.agent.definition.thoroughness)
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

  // Prompt autosave. Never schedules while a save is in flight: the mutation's optimistic cache
  // write (and later the server's response) both change `agent.data`, and re-scheduling on those
  // re-runs used to supersede the in-flight save so its completion was ignored, the dirty flag was
  // never cleared, and the same prompt saved again every 800ms with "Saving…" shown forever.
  // Once the save lands the effect re-runs (state leaves 'saving') and compares the latest editor
  // blocks in request shape, so edits typed during the save get their own follow-up save.
  useEffect(() => {
    if (!agent.data || !promptDirty || promptEditorDisabled || promptSaveState === 'saving') return
    if (!hasPromptContent(systemPrompt)) {
      setPromptSaveState('error')
      return
    }

    const currentDefinition = agent.data.agent.definition
    // Compare what would actually be sent: the request trims trailing empty blocks, and the editor
    // keeps them, so the raw editor blocks never equal a saved prompt that ended with a blank line.
    const nextPromptBlocks = promptBlocksForRequest(systemPrompt)
    const nextPromptKey = agentPromptStableKey(nextPromptBlocks)
    if (
      nextPromptKey === agentPromptStableKey(currentDefinition.systemPrompt) ||
      nextPromptKey === lastSavedPromptKeyRef.current
    ) {
      setPromptDirty(false)
      if (promptSaveState === 'error') setPromptSaveState('idle')
      return
    }

    const saveId = promptSaveIdRef.current + 1
    promptSaveIdRef.current = saveId
    const timer = setTimeout(() => {
      setPromptSaveState('saving')
      void updateAgent
        .mutateAsync({
          agentId,
          definition: {...currentDefinition, systemPrompt: nextPromptBlocks},
        })
        .then((result) => {
          if (result._ !== 'GetAgentResponse') throw new Error('Unexpected update response')
          loadedPromptKeyRef.current = agentPromptStableKey(result.agent.definition.systemPrompt)
          lastSavedPromptKeyRef.current = nextPromptKey
          setPromptSaveState('saved')
          setTimeout(() => {
            if (promptSaveIdRef.current === saveId) setPromptSaveState('idle')
          }, 1800)
        })
        .catch((error) => {
          setPromptSaveState('error')
          const message = error instanceof Error ? error.message : 'Could not save prompt'
          if (message !== 'System prompt is required') toast.error(message)
        })
    }, 800)
    return () => clearTimeout(timer)
  }, [agent.data, agentId, promptDirty, promptEditorDisabled, promptSaveState, systemPrompt, updateAgent.mutateAsync])

  const selectedTriggerName = triggerId ? triggers.data?.find((trigger) => trigger.id === triggerId)?.name : undefined
  const isTriggerDetail = tab === 'triggers' && !!triggerId
  const settingsPage = tab === 'permissions' || tab === 'identities' || tab === 'mcp' ? tab : null
  const settingsPageTitle =
    settingsPage === 'permissions'
      ? 'Permissions'
      : settingsPage === 'identities'
        ? 'Authorship identities'
        : 'MCP servers'
  const webCapabilities = serverHealth.data
    ? {
        ...(serverHealth.data.webTools ?? {search: true, readBrowser: true}),
        codeExec: serverHealth.data.codeExec,
        codeExecReason: serverHealth.data.codeExecReason,
        codeExecReasonCode: serverHealth.data.codeExecReasonCode,
        local: isLocalAgentServer(serverUrl, localServerUrl.data),
      }
    : undefined
  // A subpage (one trigger, the system prompt) replaces the agent header and the tabs' Container
  // with its own back bar and scrolling body, the way a session does.
  const promptStatus =
    promptSaveState === 'saving'
      ? 'Saving…'
      : promptSaveState === 'saved'
        ? 'Saved'
        : promptSaveState === 'error'
          ? hasPromptContent(systemPrompt)
            ? 'Save failed'
            : 'System prompt is required'
          : null
  const breadcrumbItems = isTriggerDetail
    ? [
        {label: 'Triggers', route: {key: 'agent' as const, agentId, serverUrl, tab: 'triggers' as const}},
        {label: selectedTriggerName || 'Trigger'},
      ]
    : undefined

  const displayName = documentName?.trim() || name
  function openRename() {
    editNameDialog.open({currentName: displayName, accountStatus: agentAccountStatus, onRename: handleRenameAgent})
  }

  // Built only once the agent has loaded; the render below shows a spinner or notice before then.
  const header = agent.data ? (
    <AgentHeader
      embedded={embedded}
      agent={agent.data.agent}
      agentName={displayName}
      onEditName={canWrite ? openRename : undefined}
      agentId={agentId}
      serverUrl={serverUrl}
      activeTab={tab}
      sessionsCount={sessionCount}
      triggersCount={triggers.data?.length}
      onCreateTrigger={
        canWrite
          ? () =>
              // A mounted agent's triggers are documents under it.
              agentHost
                ? createTriggerDocumentDialog.open({host: agentHost})
                : createTriggerDialog.open({serverUrl, selectedAccountId, agentId})
          : undefined
      }
      canCreateTrigger={!!selectedAccountId && canWrite}
      // A mounted agent (embedded in its document) has no menu of its own: deleting the document
      // deletes the agent, and moving happens through the document.
      menuItems={
        isOwner && !embedded
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
                    sessionsCount: sessionCount,
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
                    onDeleted: () => {
                      // The agent's document goes with it; land on the space that held it.
                      const mount = unpackHmId(agentId)
                      const spaceUid = mount?.uid ?? selectedAccountId
                      if (spaceUid) navigate({key: 'document', id: hmId(spaceUid)})
                    },
                  }),
              },
            ]
          : undefined
      }
      breadcrumbItems={breadcrumbItems}
    />
  ) : null

  return (
    <AgentPane embedded={embedded} className="flex flex-col overflow-hidden">
      {agent.data && !embedded && <AgentMountBanner agent={agent.data.agent} serverUrl={serverUrl} />}
      {agent.data ? (
        <>
          {createTriggerDialog.content}
          {deleteAgentDialog.content}
          {moveAgentDialog.content}
          {addProviderDialog.content}
          {providersDialog.content}
          {manageAccountsDialog.content}
          {editNameDialog.content}
          {createTriggerDocumentDialog.content}
        </>
      ) : null}
      {agent.data && isTriggerDetail ? (
        <AgentTriggersTab
          agentId={agentId}
          serverUrl={serverUrl}
          selectedAccountId={selectedAccountId}
          selectedTriggerId={triggerId}
          triggers={triggers.data || []}
          isLoading={triggers.isLoading}
          readOnly={!canWrite}
        />
      ) : agent.data && tab === 'prompt' ? (
        // Like a session: the back bar sits flush under the tabs and the editor scrolls below it.
        <>
          <AgentSubpageHeader
            title="System prompt"
            placeholder="System prompt"
            backLabel="Back to agent settings"
            onBack={() => navigate({key: 'agent', agentId, serverUrl, tab: 'settings'})}
            actions={
              promptStatus ? (
                <SizableText size="sm" color={promptSaveState === 'error' ? 'destructive' : 'muted'} role="status">
                  {promptStatus}
                </SizableText>
              ) : undefined
            }
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-4xl px-4 py-4">
              {agentId.startsWith('hm://') ? (
                // A mounted agent's instructions are its document, read at the start of each turn.
                <div className="border-border bg-muted/40 flex flex-col items-start gap-3 rounded-lg border p-6">
                  <SizableText>
                    This agent’s system prompt is its document. Edit it on the Home tab like any document; tools are the
                    card embeds in it.
                  </SizableText>
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => {
                      const id = unpackHmId(agentId)
                      if (id) navigate({key: 'document', id})
                    }}
                  >
                    Open Home
                  </Button>
                </div>
              ) : promptEditorDisabled ? (
                <pre className="border-input bg-muted/40 text-muted-foreground min-h-80 rounded-lg border p-4 text-sm break-words whitespace-pre-wrap">
                  {!canWrite
                    ? promptBlocksToMarkdown(systemPrompt) || 'No system prompt configured.'
                    : 'Connect to the app environment to edit this prompt.'}
                </pre>
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
            </div>
          </div>
        </>
      ) : agent.data && settingsPage ? (
        <>
          <AgentSubpageHeader
            title={settingsPageTitle}
            placeholder={settingsPageTitle}
            backLabel="Back to agent settings"
            onBack={() => navigate({key: 'agent', agentId, serverUrl, tab: 'settings'})}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            <div className="mx-auto w-full max-w-4xl px-4 py-4">
              {settingsPage === 'permissions' ? (
                <AgentPermissionsPage
                  serverUrl={serverUrl}
                  accountUid={selectedAccountId ?? null}
                  agentId={agentId}
                  definition={agent.data.agent.definition}
                  identities={signingIdentities.data || []}
                  webCapabilities={webCapabilities}
                  onSave={(definition) => updateAgent.mutateAsync({agentId, definition})}
                  saving={updateAgent.isLoading}
                  readOnly={!canWrite}
                  onOpenIdentities={() => navigate({key: 'agent', agentId, serverUrl, tab: 'identities'})}
                />
              ) : settingsPage === 'identities' ? (
                <AgentIdentitiesPage
                  serverUrl={serverUrl}
                  accountUid={selectedAccountId ?? null}
                  definition={agent.data.agent.definition}
                  identities={signingIdentities.data || []}
                  identitiesLoading={signingIdentities.isLoading}
                  onSave={(definition) => updateAgent.mutateAsync({agentId, definition})}
                  onCreateIdentity={(label) => createSigningIdentity.mutateAsync(label)}
                  saving={updateAgent.isLoading || createSigningIdentity.isLoading}
                  canManageIdentities={isOwner}
                  onOpenPermissions={() => navigate({key: 'agent', agentId, serverUrl, tab: 'permissions'})}
                />
              ) : (
                <AgentMcpPage
                  serverUrl={serverUrl}
                  accountUid={selectedAccountId ?? null}
                  definition={agent.data.agent.definition}
                  onSave={(definition) => updateAgent.mutateAsync({agentId, definition})}
                  saving={updateAgent.isLoading}
                  readOnly={!canWrite}
                />
              )}
            </div>
          </div>
        </>
      ) : (
        <Container
          // The memory browser is a two-pane file explorer: reading width limits do not apply,
          // so it takes the whole window. The side padding moves inside the header's own
          // 4xl cap (and onto the browser) so the header's box matches the other tabs exactly.
          className={`min-h-0 flex-1 gap-4 pt-4 pb-0 ${tab === 'memory' ? 'px-0' : 'max-w-4xl'}`}
        >
          {agent.isLoading ? (
            <div className="flex flex-1 items-center justify-center py-12">
              <Spinner size="large" className="text-muted-foreground" />
            </div>
          ) : null}
          {agent.isError ? (
            <AgentQueryNotice
              error={agent.error}
              failed="Couldn’t load this agent"
              serverLabel={describeAgentServer(serverUrl, localServerUrl.data)}
              onRetry={() => void agent.refetch()}
              retryPending={agent.isFetching}
            />
          ) : null}
          {agent.data ? (
            <>
              {tab === 'memory' ? (
                // The browser below spans the window; the header keeps the reading width of every other tab.
                <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 px-4">{header}</div>
              ) : (
                header
              )}

              {tab === 'sessions' ? (
                <section className="flex min-h-0 flex-1 flex-col">
                  <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
                    {!topLevelSessions.length && !sessionPages.isLoading ? (
                      <SizableText color="muted">No sessions yet.</SizableText>
                    ) : null}
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
                    {sessionPages.hasNextPage ? (
                      <Button
                        className="w-full"
                        variant="outline"
                        disabled={sessionPages.isFetchingNextPage}
                        onClick={() => void sessionPages.fetchNextPage()}
                      >
                        {sessionPages.isFetchingNextPage ? 'Loading…' : 'Load more'}
                      </Button>
                    ) : null}
                  </div>
                </section>
              ) : null}

              {tab === 'triggers' && !isTriggerDetail ? (
                agentHost ? (
                  // A mounted agent's triggers are documents under it, listed like an app's; any still
                  // stored only on the server follow, until they move into documents.
                  <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                    <AgentTriggerDocumentsTab host={agentHost} canEdit={canWrite} />
                    {(triggers.data || []).some((item) => !item.documentId) ? (
                      <div className="mx-auto flex w-full max-w-3xl flex-col gap-2 px-4 pb-4">
                        <SizableText size="sm" weight="bold" color="muted" className="px-3">
                          On the server
                        </SizableText>
                        <AgentTriggersTab
                          agentId={agentId}
                          serverUrl={serverUrl}
                          selectedAccountId={selectedAccountId}
                          selectedTriggerId={triggerId}
                          triggers={(triggers.data || []).filter((item) => !item.documentId)}
                          isLoading={triggers.isLoading}
                          readOnly={!canWrite}
                        />
                      </div>
                    ) : null}
                  </div>
                ) : (
                  <AgentTriggersTab
                    agentId={agentId}
                    serverUrl={serverUrl}
                    selectedAccountId={selectedAccountId}
                    selectedTriggerId={triggerId}
                    triggers={triggers.data || []}
                    isLoading={triggers.isLoading}
                    readOnly={!canWrite}
                  />
                )
              ) : null}

              {tab === 'memory' ? (
                <div className="flex min-h-0 flex-1 flex-col px-4">
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
                </div>
              ) : null}

              {tab === 'collaborators' ? (
                <AgentCollaboratorsTab
                  serverUrl={serverUrl}
                  accountUid={selectedAccountId ?? null}
                  agentId={agentId}
                  ownerAccountId={agent.data.agent.account}
                  agentAccountIds={agentAccountIds}
                  collaborators={collaborators.data?.collaborators || []}
                  publicRead={collaborators.data?.publicRead ?? agent.data.agent.publicRead ?? false}
                  publicChat={collaborators.data?.publicChat ?? agent.data.agent.publicChat ?? false}
                  loading={collaborators.isLoading}
                  isOwner={isOwner}
                />
              ) : null}

              {tab === 'settings' ? (
                <section className="flex max-w-2xl flex-col gap-4">
                  <div className="border-border flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                    <div className="min-w-0">
                      <SizableText size="sm" weight="bold" className="block">
                        Name
                      </SizableText>
                      <SizableText size="xs" color="muted" className="block truncate">
                        {displayName}
                        {agentAccountStatus.kind === 'own' ? ' · also the name of its account' : ''}
                      </SizableText>
                    </div>
                    {canWrite ? (
                      <Button variant="outline" size="sm" onClick={openRename}>
                        <Pencil className="size-4" />
                        Rename
                      </Button>
                    ) : null}
                  </div>
                  <AgentServerHostSection
                    serverUrl={serverUrl}
                    localServerUrl={localServerUrl.data}
                    health={serverHealth}
                    onMove={
                      isOwner && !embedded && selectedAccountId
                        ? () =>
                            moveAgentDialog.open({
                              sourceServerUrl: serverUrl,
                              selectedAccountId,
                              agentId,
                              agentName: name,
                              modelProvider: agent.data?.agent.definition.modelProvider ?? '',
                              sessionsCount: sessionCount,
                              onMoved: ({serverUrl: movedServerUrl, agentId: movedAgentId}) =>
                                navigate({key: 'agent', agentId: movedAgentId, serverUrl: movedServerUrl}),
                            })
                        : undefined
                    }
                  />
                  <div className="border-border flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
                    <div className="min-w-0">
                      <SizableText size="sm" weight="bold" className="block">
                        Instructions
                      </SizableText>
                      <SizableText size="xs" color="muted" className="block truncate">
                        {agentDocId
                          ? 'Its document, on the Home tab: read at the start of every turn.'
                          : hasPromptContent(systemPrompt)
                            ? 'Instructions the agent starts every session with.'
                            : 'Not set yet.'}
                      </SizableText>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        // A mounted agent's instructions are its document: open it, to edit like any document.
                        agentDocId
                          ? navigate({key: 'document', id: agentDocId})
                          : navigate({key: 'agent', agentId, serverUrl, tab: 'prompt'})
                      }
                    >
                      <ScrollText className="size-4" />
                      {agentDocId ? 'Open Home' : canWrite ? 'Edit prompt' : 'View prompt'}
                    </Button>
                  </div>
                  <AgentSettingsPageRow
                    title="Permissions"
                    description={describeAgentPermissions(agent.data.agent.definition)}
                    icon={<Shield className="size-4" />}
                    actionLabel={canWrite ? 'Edit permissions' : 'View permissions'}
                    onOpen={() => navigate({key: 'agent', agentId, serverUrl, tab: 'permissions'})}
                  />
                  <AgentSettingsPageRow
                    title="Authorship identities"
                    description={describeAgentIdentities(agent.data.agent.definition, signingIdentities.data || [])}
                    icon={<KeyRound className="size-4" />}
                    actionLabel={isOwner ? 'Manage identities' : 'View identities'}
                    onOpen={() => navigate({key: 'agent', agentId, serverUrl, tab: 'identities'})}
                  />
                  {isOwner ? (
                    <>
                      <AgentSettingsPageRow
                        title="Model providers"
                        description={`The providers on ${describeAgentServer(
                          serverUrl,
                          localServerUrl.data,
                        )}, where this agent runs.`}
                        icon={<Settings className="size-4" />}
                        actionLabel="Manage providers"
                        onOpen={() => providersDialog.open({serverUrl, selectedAccountId})}
                      />
                      <AgentSettingsPageRow
                        title="Server accounts"
                        description={`The publishing accounts kept on ${describeAgentServer(
                          serverUrl,
                          localServerUrl.data,
                        )}.`}
                        icon={<CircleUserRound className="size-4" />}
                        actionLabel="Manage accounts"
                        onOpen={() => manageAccountsDialog.open({serverUrl, selectedAccountId})}
                      />
                    </>
                  ) : null}
                  <AgentSettingsPageRow
                    title="MCP servers"
                    description={describeAgentMcpServers(agent.data.agent.definition)}
                    icon={<Plug className="size-4" />}
                    actionLabel={canWrite ? 'Edit MCP servers' : 'View MCP servers'}
                    onOpen={() => navigate({key: 'agent', agentId, serverUrl, tab: 'mcp'})}
                  />
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
                    <div className="flex flex-col justify-end gap-1">
                      <ThoroughnessPicker
                        value={thoroughness ?? 'normal'}
                        disabled={!canWrite}
                        onChange={(next) => {
                          setThoroughness(next)
                          setNameModelDirty(true)
                        }}
                      />
                    </div>
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
      )}
      {tab === 'sessions' && agent.data && canChat ? (
        // The same draft composer as the home page, in the same full-width footer, pinned to this
        // agent: the first send (or tool run) creates the session and opens it.
        <div className="border-border bg-panel flex-none border-t">
          <Container className="max-w-4xl gap-0 py-2">
            <NewSessionComposer
              fixedAgent={{serverUrl, agent: agent.data.agent}}
              accountUid={selectedAccountId}
              localServerUrl={localServerUrl.data}
              agentToolsLoading={agent.isLoading}
            />
          </Container>
        </div>
      ) : null}
    </AgentPane>
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
  // Display path: a prompt that happens to start with a broken `---` block still has to render.
  return markdownBlockNodesToHMBlockNodes(parseMarkdown(prompt || '', {strictFrontmatter: false}).tree)
}

/**
 * Identity of a prompt for change detection. Blocks go to the server and come back through CBOR,
 * which re-sorts object keys, so the comparison must not depend on key order.
 */
function agentPromptStableKey(prompt: AgentDefinition['systemPrompt']): string {
  return typeof prompt === 'string' ? prompt : stableStringify(prompt)
}

function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return entry
    const record = entry as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(record)
        .sort()
        .map((key) => [key, record[key]]),
    )
  })
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
 * The People tab: one page for who can use the agent and what the agent itself can write. People
 * merges the agent's collaborators with the writers of its document (the document's own People
 * list): "Can edit" means both, so inviting an editor also lets them edit the agent's
 * instructions. The agent's own write access in the space is shown, and widened, here too.
 */
function AgentCollaboratorsTab({
  serverUrl,
  accountUid,
  agentId,
  ownerAccountId,
  agentAccountIds,
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
  /** The accounts the agent signs as; its primary key first. */
  agentAccountIds: string[]
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
  // A mounted agent's id is its document: its writers and the agent's own grants live in that space.
  const docId = agentId.startsWith('hm://') ? unpackHmId(agentId) : null
  const documentPeople = useCollaborators(docId ?? hmId(ownerAccountId))
  const myDocCapability = useSelectedAccountCapability(docId ?? undefined, 'owner')
  const addDocWriters = useAddCapabilities(docId ?? hmId(ownerAccountId))
  const [selected, setSelected] = useState<SearchResult[]>([])
  const [role, setRole] = useState<AgentCollaboratorRole>('writer')
  const collaboratorIds = new Set(collaborators.map((member) => member.accountId))
  // Writers of the document who are not (yet) collaborators of the agent, nor the agent itself.
  const documentWriters = docId
    ? uniqueBy(
        [...documentPeople.parentCapabilities, ...documentPeople.grantedCapabilities],
        (capability) => capability.accountUid,
      ).filter(
        (capability) =>
          capability.accountUid !== ownerAccountId &&
          !collaboratorIds.has(capability.accountUid) &&
          !agentAccountIds.includes(capability.accountUid),
      )
    : []
  const documentWriterIds = new Set(
    [...documentPeople.parentCapabilities, ...documentPeople.grantedCapabilities].map((cap) => cap.accountUid),
  )
  const excludedAccountIds = [ownerAccountId, ...collaborators.map((member) => member.accountId), ...agentAccountIds]

  /** Lets editors edit the agent's document (its instructions) too, when this account can grant that. */
  async function grantDocumentWrite(accountIds: string[]) {
    const missing = accountIds.filter((id) => !documentWriterIds.has(id) && id !== docId?.uid)
    if (!docId || !missing.length) return
    if (!myDocCapability) {
      toast.info('Only the owner of this space can let them edit the agent’s document; ask them to add a writer there.')
      return
    }
    await addDocWriters.mutateAsync({myCapability: myDocCapability, collaboratorAccountIds: missing, role: 'WRITER'})
  }

  async function inviteAccounts(accountIds: string[], nextRole: AgentCollaboratorRole) {
    await Promise.all(
      accountIds.map((collaboratorAccountId) => invite.mutateAsync({agentId, collaboratorAccountId, role: nextRole})),
    )
    if (nextRole === 'writer') await grantDocumentWrite(accountIds)
  }

  async function handleInvite() {
    if (!selected.length) return
    try {
      await inviteAccounts(
        selected.map((member) => member.id.uid),
        role,
      )
      toast.success(selected.length === 1 ? 'Invitation sent' : `${selected.length} invitations sent`)
      setSelected([])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not invite collaborator')
    }
  }

  return (
    <section className="flex max-w-2xl flex-col gap-6">
      <div className="flex flex-col gap-3">
        {isOwner ? (
          <div className="flex flex-col gap-2">
            <div className="border-border flex overflow-hidden rounded-md border">
              <AccountSearchInput
                label="People"
                placeholder="Invite people"
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
                <option value="reader">Can view</option>
                <option value="writer">Can edit</option>
              </select>
              {selected.length ? (
                <Button
                  size="sm"
                  className="h-auto rounded-tl-none rounded-bl-none"
                  onClick={() => void handleInvite()}
                  disabled={invite.isLoading || addDocWriters.isLoading}
                  aria-label="Send collaborator invitation"
                >
                  <ArrowRight className="size-4" />
                </Button>
              ) : null}
            </div>
            <SizableText size="xs" color="muted">
              Viewers can see everything. Editors can also chat with it and change its instructions, settings, memory,
              tools and triggers.
            </SizableText>
          </div>
        ) : null}
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
                  inviteAccounts([member.accountId], nextRole).catch((error) =>
                    toast.error(error instanceof Error ? error.message : 'Could not change role'),
                  )
                }
                onRemove={() =>
                  remove.mutate(
                    {agentId, collaboratorAccountId: member.accountId},
                    {
                      onError: (error) =>
                        toast.error(error instanceof Error ? error.message : 'Could not remove member'),
                    },
                  )
                }
              />
            ))}
            {documentWriters.map((capability) => (
              <AgentDocumentWriterRow
                key={capability.accountUid}
                accountId={capability.accountUid}
                inherited={!sameIdPath(capability.grantId.path, docId?.path)}
                canAdd={isOwner}
                adding={invite.isLoading}
                onAdd={() =>
                  invite
                    .mutateAsync({agentId, collaboratorAccountId: capability.accountUid, role: 'writer'})
                    .then(() => toast.success('Invitation sent'))
                    .catch((error) =>
                      toast.error(error instanceof Error ? error.message : 'Could not invite collaborator'),
                    )
                }
              />
            ))}
          </div>
        )}
      </div>
      {docId ? (
        <AgentWriteAccessSection docId={docId} agentAccountIds={agentAccountIds} accountUid={accountUid} />
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
    </section>
  )
}

function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => (seen.has(key(item)) ? false : (seen.add(key(item)), true)))
}

function sameIdPath(a: string[] | null | undefined, b: string[] | null | undefined) {
  return (a ?? []).join('/') === (b ?? []).join('/')
}

/** Someone who can edit the agent's document (from its space) but has not been added to the agent. */
function AgentDocumentWriterRow({
  accountId,
  inherited,
  canAdd,
  adding,
  onAdd,
}: {
  accountId: string
  inherited: boolean
  canAdd: boolean
  adding: boolean
  onAdd: () => void
}) {
  const account = useAccount(accountId, {subscribe: true})
  const metadata = account.data?.metadata
  return (
    <div className="group flex items-center gap-3 rounded-md p-3">
      <AccountAvatar id={hmId(accountId)} name={metadata?.name} icon={metadata?.icon} size={32} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <SizableText size="sm" className={`truncate ${metadata?.name ? '' : 'text-muted-foreground'}`}>
          {metadata?.name || abbreviateUid(accountId)}
        </SizableText>
        <SizableText size="xs" color="muted">
          {inherited ? 'Writer in this space: can edit its instructions' : 'Can edit its instructions'}
        </SizableText>
      </div>
      {canAdd ? (
        <Button size="xs" variant="outline" disabled={adding} onClick={onAdd}>
          Add as editor
        </Button>
      ) : null}
    </div>
  )
}

/**
 * What the agent's own key may publish in the space its document lives in. Capabilities cannot be
 * revoked, so the space owner can widen it here but never narrow it.
 */
function AgentWriteAccessSection({
  docId,
  agentAccountIds,
  accountUid,
}: {
  docId: UnpackedHypermediaId
  agentAccountIds: string[]
  accountUid: string | null
}) {
  const {scope, isLoading} = useAgentWriteScope(docId, agentAccountIds)
  const grant = useGrantAgentWriteAccess(docId)
  const [choice, setChoice] = useState<AgentWriteScope | null>(null)
  const canGrant = !!accountUid && accountUid === docId.uid && !!agentAccountIds[0]
  const current = AGENT_WRITE_SCOPE_OPTIONS.find((option) => option.scope === scope)!
  const pending = choice && widensAgentWriteScope(scope, choice) ? choice : null
  return (
    <div className="flex flex-col gap-2">
      <SizableText size="sm" weight="bold">
        What this agent can write
      </SizableText>
      {isLoading ? (
        <Spinner className="size-5" />
      ) : canGrant ? (
        <>
          <AgentWriteScopePicker
            value={choice ?? scope}
            onChange={setChoice}
            minimum={scope}
            disabled={grant.isLoading}
          />
          <div className="flex items-center gap-2">
            <SizableText size="xs" color="muted" className="flex-1">
              Access can be widened but not taken back: to narrow it, give the agent a new account.
            </SizableText>
            {pending ? (
              <Button
                size="sm"
                disabled={grant.isLoading}
                onClick={() =>
                  grant.mutate(
                    {ownerUid: accountUid!, agentAccountId: agentAccountIds[0]!, scope: pending},
                    {
                      onSuccess: () => {
                        setChoice(null)
                        toast.success('Write access granted')
                      },
                      onError: (error) =>
                        toast.error(error instanceof Error ? error.message : 'Could not grant write access'),
                    },
                  )
                }
              >
                {grant.isLoading ? <Spinner /> : null}
                Grant access
              </Button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="border-border flex items-start gap-3 rounded-md border p-3">
          <current.icon className="text-muted-foreground mt-0.5 size-4 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <SizableText size="sm" weight="medium">
              {current.label}
            </SizableText>
            <SizableText size="xs" color="muted">
              {current.description} Only the owner of this space can change this.
            </SizableText>
          </div>
        </div>
      )}
    </div>
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
      <AccountAvatar id={hmId(member.accountId)} name={metadata?.name} icon={metadata?.icon} size={32} />
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
        This will permanently delete “{input.agentName}” and its sessions, triggers, and drafts from the app
        environment. This action cannot be undone.
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
        <SigningIdentityIcon identity={identity} name={displayName} size={24} />
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

/** Editing state shared by the settings pages that save parts of the agent definition: the tool
 * grants, the signing identities, and the enabled MCP servers. Each save is optimistic and rolls
 * back to the definition on failure. */
function useAgentDefinitionPatch(
  definition: AgentDefinition,
  onSave: (definition: AgentDefinition) => Promise<unknown>,
) {
  const storedTools = () => (definition.tools ? normalizeStoredAgentTools(definition.tools) : [...DEFAULT_AGENT_TOOLS])
  // Primary first: saving keeps `signingKey` equal to the first entry.
  const storedSigningKeys = () => agentSigningKeys(definition)
  const [enabledTools, setEnabledTools] = useState<string[]>(storedTools)
  const [signingKeys, setSigningKeys] = useState<string[]>(storedSigningKeys)
  const [mcpServers, setMcpServers] = useState<string[]>(definition.mcpServers ?? [])

  useEffect(() => {
    setEnabledTools(storedTools())
    setSigningKeys(storedSigningKeys())
    setMcpServers(definition.mcpServers ?? [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      setEnabledTools(storedTools())
      setSigningKeys(storedSigningKeys())
      toast.error(error instanceof Error ? error.message : 'Could not update agent tools')
    }
  }

  return {enabledTools, signingKeys, mcpServers, saveTools, saveMcpServers}
}

/** Settings > Permissions: the grant toggles. */
function AgentPermissionsPage({
  definition,
  identities,
  webCapabilities,
  onSave,
  saving,
  readOnly = false,
  onOpenIdentities,
}: {
  serverUrl: string | undefined
  accountUid: string | null
  agentId: string
  definition: AgentDefinition
  identities: SigningIdentity[]
  webCapabilities: AgentServerWebCapabilities | undefined
  onSave: (definition: AgentDefinition) => Promise<unknown>
  saving: boolean
  readOnly?: boolean
  onOpenIdentities: () => void
}) {
  const toolInfoDialog = useAppDialog(ToolInfoDialog)
  const enableWhpDialog = useAppDialog(EnableWindowsHypervisorDialog)
  const {enabledTools, signingKeys, saveTools} = useAgentDefinitionPatch(definition, onSave)
  const grantedIdentities = identities.filter((identity) => signingKeys.includes(identity.name))

  return (
    <section className="flex max-w-3xl flex-col gap-4">
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
              {group.description ? (
                <SizableText size="xs" color="muted" className="pl-7">
                  {group.description}
                </SizableText>
              ) : null}
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
                // The identities themselves are managed on their own settings page.
                <div className="border-border/60 flex min-w-0 items-center gap-2 border-t pt-3">
                  <KeyRound className="text-muted-foreground size-4 shrink-0" />
                  <SizableText size="sm" color="muted" className="min-w-0 flex-1 truncate">
                    {grantedIdentities.length
                      ? `Authors as ${grantedIdentities
                          .map((identity) => identity.label || identity.accountId || identity.name)
                          .join(', ')}`
                      : 'No authorship identity granted yet'}
                  </SizableText>
                  <Button variant="outline" size="xs" className="shrink-0" onClick={onOpenIdentities}>
                    Authorship identities
                    <ArrowRight className="size-3.5" />
                  </Button>
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {toolInfoDialog.content}
      {enableWhpDialog.content}

      {saving ? (
        <SizableText size="xs" color="muted">
          Saving changes…
        </SizableText>
      ) : null}
    </section>
  )
}

/** Settings > Authorship identities: the signing identities the agent may publish as. Owners grant,
 * remove and create them; writers only see the list. */
function AgentIdentitiesPage({
  serverUrl,
  accountUid,
  definition,
  identities,
  identitiesLoading,
  onSave,
  onCreateIdentity,
  saving,
  canManageIdentities = false,
  onOpenPermissions,
}: {
  serverUrl: string | undefined
  accountUid: string | null
  definition: AgentDefinition
  identities: SigningIdentity[]
  identitiesLoading: boolean
  onSave: (definition: AgentDefinition) => Promise<unknown>
  onCreateIdentity: (label: string) => Promise<unknown>
  saving: boolean
  /** Owner-only: granting/removing signing accounts and creating new ones. Writers can toggle
   * tools but must never see or manage the owner's identity list. */
  canManageIdentities?: boolean
  onOpenPermissions: () => void
}) {
  const editAccountDialog = useAppDialog(EditAgentAccountDialog)
  const {enabledTools, signingKeys, saveTools} = useAgentDefinitionPatch(definition, onSave)
  const [showNewIdentityPanel, setShowNewIdentityPanel] = useState(false)
  const [newIdentityName, setNewIdentityName] = useState('Agent publisher')
  const publishEnabled = enabledTools.includes(AGENT_PUBLISH_GRANT)

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

  // In the agent's order, so the primary account leads the list.
  const grantedIdentities = signingKeys.flatMap((name) => identities.filter((identity) => identity.name === name))
  const ungrantedIdentities = identities.filter((identity) => !signingKeys.includes(identity.name))
  const primaryKey = signingKeys[0]

  return (
    <section className="flex max-w-3xl flex-col gap-4">
      <SizableText size="sm" color="muted">
        The accounts this agent signs and publishes as. The primary account is the agent: it publishes by default,
        others mention it, and it holds the agent’s write access. The others are accounts it can also sign as when
        asked.
      </SizableText>
      {!publishEnabled ? (
        <div className="border-border bg-muted/40 flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
          <SizableText size="sm" color="muted" className="min-w-0">
            Publishing is off for this agent, so these identities are not used yet.
          </SizableText>
          <Button variant="outline" size="xs" className="shrink-0" onClick={onOpenPermissions}>
            Permissions
            <ArrowRight className="size-3.5" />
          </Button>
        </div>
      ) : null}
      <div className="grid gap-2">
        {grantedIdentities.map((identity) => {
          const displayName = identity.label || identity.accountId || identity.name
          return (
            <div
              key={identity.id}
              className="group/identity border-border bg-card flex items-center gap-3 rounded-xl border px-4 py-3"
            >
              <div className="min-w-0 flex-1">
                <AuthorIdentityChip
                  identity={identity}
                  displayName={displayName}
                  canEdit={canManageIdentities}
                  onEdit={() => editAccountDialog.open({serverUrl, selectedAccountId: accountUid, identity})}
                />
              </div>
              {identity.name === primaryKey ? (
                <span className="bg-primary/10 text-primary shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
                  Primary
                </span>
              ) : canManageIdentities ? (
                <Button
                  variant="outline"
                  size="xs"
                  className="shrink-0 opacity-0 group-hover/identity:opacity-100 max-sm:opacity-100"
                  disabled={saving || identitiesLoading}
                  onClick={() =>
                    void saveTools(enabledTools, [
                      identity.name,
                      ...signingKeys.filter((name) => name !== identity.name),
                    ])
                  }
                >
                  Make primary
                </Button>
              ) : null}
              {canManageIdentities ? (
                <Button
                  variant="ghost"
                  size="iconSm"
                  className="text-muted-foreground hover:text-destructive opacity-0 group-hover/identity:opacity-100 max-sm:opacity-100"
                  aria-label={`Remove ${displayName}`}
                  // The primary account is the agent; another one has to become primary first.
                  disabled={saving || identitiesLoading || (identity.name === primaryKey && signingKeys.length > 1)}
                  title={
                    identity.name === primaryKey && signingKeys.length > 1
                      ? 'Make another account primary before removing this one'
                      : undefined
                  }
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
        {grantedIdentities.length === 0 && !identitiesLoading ? (
          <SizableText size="sm" color="muted" className="px-1">
            {identities.length === 0 && canManageIdentities
              ? 'No agent accounts are available on this server yet. Create a new server-side HM account key, then enable it for this agent.'
              : 'No identity granted yet.'}
          </SizableText>
        ) : null}
      </div>
      {canManageIdentities ? (
        <div className="flex flex-wrap items-center gap-2 px-1">
          {ungrantedIdentities.length > 0 ? (
            <OptionsDropdown
              ariaLabel="Grant a signing identity"
              button={
                <Button variant="outline" size="sm" disabled={saving || identitiesLoading}>
                  <KeyRound className="size-4" />
                  Grant
                </Button>
              }
              menuItems={ungrantedIdentities.map((identity) => ({
                key: identity.id,
                label: identity.label || identity.accountId || identity.name,
                icon: identity.accountId ? (
                  <SigningIdentityIcon identity={identity} name={identity.label} size={20} />
                ) : (
                  <KeyRound className="size-4" />
                ),
                onClick: () => void saveTools(enabledTools, Array.from(new Set([...signingKeys, identity.name]))),
              }))}
            />
          ) : null}
          {!showNewIdentityPanel && (identities.length > 0 || identitiesLoading) ? (
            <Button variant="ghost" size="sm" onClick={() => setShowNewIdentityPanel(true)} disabled={saving}>
              <Plus className="size-4" />
              New Account
            </Button>
          ) : null}
        </div>
      ) : null}
      {canManageIdentities && (showNewIdentityPanel || (!identitiesLoading && identities.length === 0)) ? (
        <NewAgentAccountPanel
          name={newIdentityName}
          onNameChange={setNewIdentityName}
          onCreate={() => void handleCreateIdentity()}
          onCancel={identities.length > 0 ? () => setShowNewIdentityPanel(false) : undefined}
          disabled={saving}
        />
      ) : null}

      {editAccountDialog.content}

      {saving ? (
        <SizableText size="xs" color="muted">
          Saving changes…
        </SizableText>
      ) : null}
    </section>
  )
}

/** Settings > MCP servers: which of the account's MCP servers this agent may call. */
function AgentMcpPage({
  serverUrl,
  accountUid,
  definition,
  onSave,
  saving,
  readOnly = false,
}: {
  serverUrl: string | undefined
  accountUid: string | null
  definition: AgentDefinition
  onSave: (definition: AgentDefinition) => Promise<unknown>
  saving: boolean
  readOnly?: boolean
}) {
  const {mcpServers, saveMcpServers} = useAgentDefinitionPatch(definition, onSave)
  return (
    <section className="flex max-w-3xl flex-col gap-4">
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
        showTitle={false}
      />
      {saving ? (
        <SizableText size="xs" color="muted">
          Saving changes…
        </SizableText>
      ) : null}
    </section>
  )
}

/** One row on the Settings tab that opens a settings page. */
function AgentSettingsPageRow({
  title,
  description,
  icon,
  actionLabel,
  onOpen,
}: {
  title: string
  description: string
  icon: ReactNode
  actionLabel: string
  onOpen: () => void
}) {
  return (
    <div className="border-border flex items-center justify-between gap-3 rounded-lg border px-3 py-2">
      <div className="min-w-0">
        <SizableText size="sm" weight="bold" className="block">
          {title}
        </SizableText>
        <SizableText size="xs" color="muted" className="block truncate">
          {description}
        </SizableText>
      </div>
      <Button variant="outline" size="sm" className="shrink-0" onClick={onOpen}>
        {icon}
        {actionLabel}
      </Button>
    </div>
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
  const gatewayUrl = useAgentsGatewayUrl()
  const updateTrigger = useUpdateAgentTrigger(serverUrl, selectedAccountId)
  const deleteTrigger = useDeleteAgentTrigger(serverUrl, selectedAccountId)
  const selected = trigger.data?.trigger
  const archived = Boolean(selected?.mergedInto)
  const combineDialog = useAppDialog(CombineAgentTriggersDialog)
  const [name, setName] = useState('')
  const [nameDirty, setNameDirty] = useState(false)
  const [nameSaveState, setNameSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const nameSaveIdRef = useRef(0)
  const [enabled, setEnabled] = useState(true)
  const [prompt, setPrompt] = useState<HMBlockNode[]>([])
  const [source, setSource] = useState<AgentTriggerSource>({type: 'document-comment', resource: ''})
  const [continuation, setContinuation] = useState<TriggerContinuation>({kind: 'newThread'})
  const agentTools = useAgentTools(serverUrl, selectedAccountId, agentId)
  const [detailsDirty, setDetailsDirty] = useState(false)
  const [sourceDraftOpen, setSourceDraftOpen] = useState(false)
  const [sourceEditorRevision, setSourceEditorRevision] = useState(0)
  const [detailsSaveState, setDetailsSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const detailsSaveIdRef = useRef(0)
  const selectedTriggerRef = useRef<string | null>(null)
  const editRevisionRef = useRef<number>()
  const lastSavedDetailsKeyRef = useRef('')
  const currentDetailsKey = useMemo(() => {
    return JSON.stringify({prompt, source, continuation})
  }, [prompt, source, continuation])
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
    if (!triggerChanged && (detailsDirty || nameDirty || sourceDraftOpen)) return
    editRevisionRef.current = selected.updatedAt
    const nextPrompt = agentPromptToBlocks(selected.prompt)
    const nextSource = selected.source
    const nextContinuation: TriggerContinuation = selected.continuation ?? {kind: 'newThread'}
    setEnabled(selected.enabled)
    setPrompt(nextPrompt)
    setSource(nextSource)
    setContinuation(nextContinuation)
    lastSavedDetailsKeyRef.current = JSON.stringify({
      prompt: nextPrompt,
      source: nextSource,
      continuation: nextContinuation,
    })
    setDetailsDirty(false)
    setDetailsSaveState('idle')
  }, [detailsDirty, nameDirty, selected, sourceDraftOpen])

  useEffect(() => {
    if (readOnly || archived || !selectedTriggerId || !selected || !nameDirty || nameSaveState === 'error') return
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
        .mutateAsync({
          triggerId: selectedTriggerId,
          patch: {name: draftName},
          expectedUpdatedAt: editRevisionRef.current,
        })
        .then((result) => {
          if (nameSaveIdRef.current !== saveId) return
          if (result._ !== 'UpdateAgentTriggerResponse') throw new Error('Unexpected trigger update response')
          editRevisionRef.current = result.trigger.updatedAt
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
      const result = await updateTrigger.mutateAsync({
        triggerId: selectedTriggerId,
        patch: {enabled: nextEnabled},
        expectedUpdatedAt: editRevisionRef.current,
      })
      if (result._ !== 'UpdateAgentTriggerResponse') throw new Error('Unexpected trigger update response')
      editRevisionRef.current = result.trigger.updatedAt
    } catch (error) {
      setEnabled(previousEnabled)
      toast.error(error instanceof Error ? error.message : 'Could not update trigger enabled state')
    }
  }

  useEffect(() => {
    if (
      readOnly ||
      archived ||
      !selectedTriggerId ||
      !selected ||
      !detailsDirty ||
      detailsSaveState === 'saving' ||
      detailsSaveState === 'error' ||
      !isTriggerSourceReady(source)
    )
      return
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
          patch: {prompt: promptBlocksForRequest(prompt), source, continuation},
          expectedUpdatedAt: editRevisionRef.current,
        })
        .then((result) => {
          if (detailsSaveIdRef.current !== saveId) return
          if (result._ !== 'UpdateAgentTriggerResponse') throw new Error('Unexpected trigger update response')
          editRevisionRef.current = result.trigger.updatedAt
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
  }, [
    continuation,
    currentDetailsKey,
    detailsDirty,
    detailsSaveState,
    prompt,
    readOnly,
    selected,
    selectedTriggerId,
    source,
  ])

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
          disabled={!selected || readOnly || archived}
          backLabel="Back to agent triggers"
          onBack={() => navigate({key: 'agent', agentId, serverUrl, tab: 'triggers'})}
          actions={
            <OptionsDropdown
              align="end"
              menuItems={[
                {
                  key: 'copy-trigger-link',
                  icon: <Link2 className="size-4" />,
                  label: 'Copy trigger link',
                  onClick: () =>
                    copyWithToast(
                      agentsPageUrl(gatewayUrl, {
                        key: 'agent',
                        agentId,
                        serverUrl,
                        tab: 'triggers',
                        triggerId: selectedTriggerId,
                      }),
                      'Trigger link',
                    ),
                },
                ...(!readOnly
                  ? [
                      {
                        key: 'delete-trigger',
                        icon: <Trash2 className="size-4" />,
                        label: 'Delete trigger',
                        variant: 'destructive' as const,
                        onClick: () => void handleDeleteTrigger(),
                      },
                    ]
                  : []),
                ...(!readOnly &&
                !archived &&
                selected &&
                activityConditions(selected.source).length &&
                triggers.some(
                  (item) => item.id !== selected.id && !item.mergedInto && activityConditions(item.source).length,
                )
                  ? [
                      {
                        key: 'combine-triggers',
                        icon: <Plus className="size-4" />,
                        label: 'Combine with another trigger',
                        disabled: detailsDirty || nameDirty || sourceDraftOpen,
                        onClick: () =>
                          combineDialog.open({
                            serverUrl,
                            selectedAccountId,
                            target: selected,
                            others: triggers.filter(
                              (item) =>
                                item.id !== selected.id && !item.mergedInto && activityConditions(item.source).length,
                            ),
                          }),
                      },
                    ]
                  : []),
              ]}
            />
          }
        />
        {combineDialog.content}
        <div className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col gap-5 overflow-y-auto px-4 py-4">
          {trigger.isLoading ? <SizableText color="muted">Loading trigger…</SizableText> : null}
          {trigger.isError ? (
            <AgentQueryNotice
              error={trigger.error}
              failed="Couldn’t load this trigger"
              onRetry={() => void trigger.refetch()}
              retryPending={trigger.isFetching}
            />
          ) : null}
          {selected ? (
            <>
              {selected.mergedInto ? (
                <Notice title="Combined trigger">
                  <p>This trigger is retired. Its original history is retained.</p>
                  <Button
                    variant="link"
                    onClick={() =>
                      navigate({key: 'agent', agentId, serverUrl, tab: 'triggers', triggerId: selected.mergedInto})
                    }
                  >
                    Open the combined trigger
                  </Button>
                </Notice>
              ) : null}
              {detailsSaveState === 'error' || nameSaveState === 'error' ? (
                <Notice title="Changes could not be saved">
                  <p>Your draft is still here. Reload the saved version to resolve a conflicting edit.</p>
                  <Button
                    variant="outline"
                    onClick={async () => {
                      const result = await trigger.refetch()
                      if (result.data?.trigger) {
                        selectedTriggerRef.current = null
                        setSourceDraftOpen(false)
                        setSourceEditorRevision((revision) => revision + 1)
                        setDetailsDirty(false)
                        setNameDirty(false)
                        setNameSaveState('idle')
                        setDetailsSaveState('idle')
                      }
                    }}
                  >
                    Reload saved version
                  </Button>
                </Notice>
              ) : null}
              {readOnly || archived ? (
                <div className="grid gap-4">
                  <div className="border-border bg-muted/40 rounded-lg border p-3">
                    <SizableText size="sm" weight="bold" className="block">
                      Source
                    </SizableText>
                    <SizableText size="sm" color="muted">
                      {<TriggerSourceSummary source={source} />}
                    </SizableText>
                  </div>
                  <div className="border-border bg-muted/40 rounded-lg border p-3">
                    <SizableText size="sm" weight="bold" className="block">
                      Then
                    </SizableText>
                    <SizableText size="sm" color="muted">
                      {summarizeTriggerContinuation(continuation)}
                    </SizableText>
                  </div>
                  {source.type === 'webhook' ? (
                    <WebhookEndpointSection
                      serverUrl={serverUrl}
                      triggerId={selected.id}
                      secret={trigger.data?.webhookSecret}
                    />
                  ) : null}
                  {triggerUsesPrompt(continuation) ? (
                    <div className="flex flex-col gap-1">
                      <SizableText size="sm" weight="bold">
                        {isHeadlessContinuation(continuation) ? 'Recovery prompt' : 'Prompt'}
                      </SizableText>
                      <pre className="border-border bg-muted/40 min-h-40 rounded-lg border p-3 text-sm break-words whitespace-pre-wrap">
                        {promptBlocksToMarkdown(prompt) || 'No prompt configured.'}
                      </pre>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="grid gap-4">
                  <TriggerSourceFields
                    key={`${selected.id}:${sourceEditorRevision}`}
                    onDraftChange={setSourceDraftOpen}
                    source={source}
                    lockSourceType={source.type === 'webhook'}
                    allowWebhook={false}
                    onChange={(nextSource) => {
                      setSource(nextSource)
                      setDetailsDirty(true)
                      setDetailsSaveState('idle')
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
                  {source.type === 'webhook' ? (
                    <WebhookEndpointSection
                      serverUrl={serverUrl}
                      triggerId={selected.id}
                      secret={trigger.data?.webhookSecret}
                    />
                  ) : null}
                  <TriggerContinuationFields
                    continuation={continuation}
                    tools={agentTools.data?.tools}
                    onChange={(next) => {
                      setContinuation(next)
                      setDetailsDirty(true)
                      setDetailsSaveState('idle')
                    }}
                  />
                  {triggerUsesPrompt(continuation) ? (
                    <div className="flex flex-col gap-1">
                      <SizableText size="sm" weight="bold">
                        {isHeadlessContinuation(continuation) ? 'Recovery prompt' : 'Prompt'}
                      </SizableText>
                      {isHeadlessContinuation(continuation) ? (
                        <SizableText size="xs" color="muted">
                          Starts the session a model gets when the tool or script fails; the failure and the run are
                          attached as context.
                        </SizableText>
                      ) : null}
                      <AgentPromptEditor
                        key={selected.id}
                        initialBlocks={prompt}
                        onChange={(blocks) => {
                          setPrompt(blocks)
                          setDetailsDirty(true)
                          setDetailsSaveState('idle')
                        }}
                      />
                    </div>
                  ) : null}
                  <div className="flex flex-col gap-1">
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
              <TriggerFiringsSection
                firings={trigger.data?.firings ?? []}
                sessions={trigger.data?.sessions ?? []}
                agentId={agentId}
                serverUrl={serverUrl}
              />
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

  // A mounted agent's triggers are documents under it; any still stored only on the server are
  // published as documents once the agent can write its document.
  const mounted = agentId.startsWith('hm://')
  const stored = triggers.filter((item) => !item.documentId)
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1 pb-4">
      {isLoading ? <SizableText color="muted">Loading triggers…</SizableText> : null}
      {!isLoading && !triggers.length ? (
        <div className="border-border flex flex-col gap-2 rounded-xl border border-dashed p-6">
          <SizableText weight="bold">No triggers yet.</SizableText>
          <SizableText size="sm" color="muted">
            A trigger starts a session, or calls one of the agent’s tools, when something happens: on a schedule, when a
            webhook is posted, or on activity in Hypermedia.
          </SizableText>
        </div>
      ) : null}
      {mounted && stored.length ? (
        <SizableText size="xs" color="muted" className="px-3">
          Triggers marked “On the server” are not documents yet. They move under this agent’s document once the agent
          can write it (People tab).
        </SizableText>
      ) : null}
      {triggers.map((item) => (
        <button
          key={item.id}
          className="hover:bg-muted/60 flex cursor-pointer flex-col items-start rounded-lg px-3 py-2 text-left transition-colors"
          onClick={() => {
            const documentId = item.documentId ? unpackHmId(item.documentId) : null
            if (documentId) navigate({key: 'document', id: documentId})
            else navigate({key: 'agent', agentId, serverUrl, tab: 'triggers', triggerId: item.id})
          }}
        >
          <div className="flex w-full items-center justify-between gap-3">
            <SizableText weight="bold">
              {item.name}
              {mounted && !item.documentId ? (
                <span className="bg-muted text-muted-foreground ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium tracking-wide uppercase">
                  On the server
                </span>
              ) : null}
            </SizableText>
            <SizableText size="xs" color={item.enabled ? undefined : 'muted'}>
              {item.mergedInto ? 'Combined' : item.enabled ? 'Enabled' : 'Disabled'}
            </SizableText>
          </div>
          <SizableText size="sm" color="muted">
            {<TriggerSourceSummary source={item.source} />}
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

function CombineAgentTriggersDialog({
  input,
  onClose,
}: {
  input: {
    serverUrl: string
    selectedAccountId: string | null | undefined
    target: AgentTriggerInfo
    others: AgentTriggerInfo[]
  }
  onClose: () => void
}) {
  const combine = useCombineAgentTriggers(input.serverUrl, input.selectedAccountId)
  const [otherId, setOtherId] = useState(input.others[0]?.id ?? '')
  const [useOtherAction, setUseOtherAction] = useState(false)
  const [error, setError] = useState<string>()
  const other = input.others.find(({id}) => id === otherId)
  const action = useOtherAction && other ? other : input.target
  return (
    <div className="grid gap-4">
      <DialogTitle>Combine activity triggers</DialogTitle>
      <DialogDescription>
        Conditions will share one action in “{input.target.name}”. The other trigger will be retired, with its history
        retained. Existing runs continue.
      </DialogDescription>
      <label className="grid gap-1">
        <SizableText size="sm" weight="bold">
          Combine with
        </SizableText>
        <SelectDropdown
          value={otherId}
          options={input.others.map(({id, name}) => ({value: id, label: name}))}
          onValue={setOtherId}
          disabled={combine.isLoading}
        />
      </label>
      <div className="bg-muted/40 border-border grid gap-2 rounded-lg border p-3">
        <SizableText size="sm">{<TriggerSourceSummary source={input.target.source} />}</SizableText>
        <SizableText size="xs" color="muted">
          OR
        </SizableText>
        {other ? <SizableText size="sm">{<TriggerSourceSummary source={other.source} />}</SizableText> : null}
      </div>
      <label className="grid gap-1">
        <SizableText size="sm" weight="bold">
          Use the action and instructions from
        </SizableText>
        <SelectDropdown
          value={useOtherAction ? 'other' : 'target'}
          options={[
            {value: 'target', label: input.target.name},
            ...(other ? [{value: 'other', label: other.name}] : []),
          ]}
          onValue={(value) => setUseOtherAction(value === 'other')}
          disabled={combine.isLoading}
        />
      </label>
      <SizableText size="sm">{summarizeTriggerContinuation(action.continuation)}</SizableText>
      <pre className="bg-muted/40 max-h-48 overflow-auto rounded-lg p-3 text-sm whitespace-pre-wrap">
        {promptBlocksToMarkdown(agentPromptToBlocks(action.prompt))}
      </pre>
      <SizableText size="sm" color="muted">
        Previously handled events stay handled. The combined trigger will be{' '}
        {input.target.enabled ? 'enabled' : 'disabled'}.
      </SizableText>
      {error ? <Notice title="Could not combine triggers">{error}</Notice> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose} disabled={combine.isLoading}>
          Cancel
        </Button>
        <Button
          disabled={!other || combine.isLoading}
          onClick={async () => {
            if (!other) return
            try {
              await combine.mutateAsync({
                triggerId: input.target.id,
                otherTriggerId: other.id,
                expectedUpdatedAt: input.target.updatedAt,
                otherExpectedUpdatedAt: other.updatedAt,
                useOtherAction,
              })
              toast.success('Triggers combined')
              onClose()
            } catch (error) {
              setError(error instanceof Error ? error.message : 'Could not combine triggers')
            }
          }}
        >
          {combine.isLoading ? 'Combining…' : 'Combine triggers'}
        </Button>
      </div>
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
  const navigate = useNavigate()
  const createTrigger = useCreateAgentTrigger(input.serverUrl, input.selectedAccountId)
  const [sourceDraftOpen, setSourceDraftOpen] = useState(false)
  const [source, setSource] = useState<AgentTriggerSource>({type: 'document-comment', resource: ''})
  const [name, setName] = useState(() => defaultTriggerName(source.type))
  const nameEdited = useRef(false)
  const [prompt, setPrompt] = useState<HMBlockNode[]>(() =>
    agentPromptToBlocks('Respond to the event, performing the action requested.'),
  )
  const [continuation, setContinuation] = useState<TriggerContinuation>({kind: 'newThread'})
  const agentTools = useAgentTools(input.serverUrl, input.selectedAccountId, input.agentId)
  const createRequestId = useRef(randomUUID())
  const createRequestKey = useRef('')

  async function handleCreateTrigger() {
    try {
      const trigger: AgentTriggerInput = {
        name,
        enabled: true,
        source,
        // A headless trigger that does not escalate has no use for a prompt, and the field is not
        // shown for it; leaving it out lets the server store its default recovery prompt.
        ...(triggerUsesPrompt(continuation) ? {prompt: promptBlocksForRequest(prompt)} : {}),
        ...(continuation.kind === 'newThread' ? {} : {continuation}),
      }
      const requestKey = JSON.stringify(trigger)
      if (createRequestKey.current && createRequestKey.current !== requestKey) {
        createRequestId.current = randomUUID()
      }
      createRequestKey.current = requestKey
      const result = await createTrigger.mutateAsync({
        agentId: input.agentId,
        trigger,
        clientRequestId: createRequestId.current,
      })
      if (result._ !== 'CreateAgentTriggerResponse') throw new Error('Unexpected trigger create response')
      toast.success('Trigger created')
      onClose()
      // A webhook's page is where its delivery URL lives, and a headless trigger's page is where its
      // runs show up, so land there straight away.
      if (source.type === 'webhook' || isHeadlessContinuation(continuation)) {
        navigate({
          key: 'agent',
          agentId: input.agentId,
          serverUrl: input.serverUrl,
          tab: 'triggers',
          triggerId: result.trigger.id,
        })
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create trigger')
    }
  }

  return (
    <div className="flex w-full max-w-full min-w-0 flex-col gap-5">
      <div>
        <DialogTitle>New trigger</DialogTitle>
        <DialogDescription>
          When the selected event occurs, start a session for the agent — or run a tool or script with no model
          involved.
        </DialogDescription>
      </div>
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Name
        </SizableText>
        <Input
          value={name}
          onChange={(event) => {
            nameEdited.current = true
            setName(event.target.value)
          }}
        />
      </label>
      <TriggerSourceFields
        source={source}
        onDraftChange={setSourceDraftOpen}
        onChange={(nextSource) => {
          setSource(nextSource)
          if (!nameEdited.current) setName(defaultTriggerName(nextSource.type))
        }}
      />
      <TriggerContinuationFields
        continuation={continuation}
        tools={agentTools.data?.tools}
        onChange={setContinuation}
      />
      {triggerUsesPrompt(continuation) ? (
        <div className="flex flex-col gap-1">
          <SizableText size="sm" weight="bold">
            {isHeadlessContinuation(continuation) ? 'Recovery prompt' : 'Prompt'}
          </SizableText>
          <AgentPromptEditor initialBlocks={prompt} onChange={setPrompt} />
          {isHeadlessContinuation(continuation) ? (
            <SizableText size="xs" color="muted">
              Starts the session a model gets when the tool or script fails; the failure and the run are attached as
              context.
            </SizableText>
          ) : null}
          {source.type === 'webhook' && !isHeadlessContinuation(continuation) ? (
            <SizableText size="xs" color="muted">
              This prompt tells the agent how to handle each delivery. The posted JSON is supplied separately as
              untrusted trigger data.
            </SizableText>
          ) : null}
        </div>
      ) : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button
          onClick={() => void handleCreateTrigger()}
          disabled={createTrigger.isLoading || sourceDraftOpen || !isTriggerSourceReady(source) || !name.trim()}
        >
          Create trigger
        </Button>
      </div>
    </div>
  )
}

/** The name a new trigger starts with; the user replaces it, but it should already say what it is. */
function defaultTriggerName(sourceType: AgentTriggerSource['type']): string {
  if (sourceType === 'webhook') return 'New webhook trigger'
  if (sourceType === 'schedule') return 'New scheduled trigger'
  return 'New activity trigger'
}

/** The gateway the platform shares links through; the web UI's own origin when it has none. */
function useAgentsGatewayUrl(): string | undefined {
  const useGatewayUrl = getAgentsPlatform().useGatewayUrl ?? (() => undefined)
  return useGatewayUrl()
}

/** An absolute link to a page of the web agents UI, which the desktop also opens in-app. */
function agentsPageUrl(gatewayUrl: string | undefined, route: Parameters<typeof routeToHref>[0]): string {
  const base = (gatewayUrl || (typeof window !== 'undefined' ? window.location.origin : '')).replace(/\/+$/, '')
  return `${base}${routeToHref(route)}`
}

function copyWithToast(value: string, label: string) {
  toast.promise(copyTextToClipboard(value), {
    loading: '',
    success: `${label} copied`,
    error: `Could not copy ${label.toLowerCase()}`,
  })
}

const FIRING_STATUS_LABELS: Record<string, {label: string; className: string}> = {
  created: {label: 'Session started', className: 'text-muted-foreground'},
  running: {label: 'Running', className: 'text-blue-600 dark:text-blue-400'},
  succeeded: {label: 'Succeeded', className: 'text-green-700 dark:text-green-400'},
  delivered: {label: 'Delivered', className: 'text-green-700 dark:text-green-400'},
  'no-listener': {label: 'Nobody listening', className: 'text-muted-foreground'},
  error: {label: 'Failed', className: 'text-destructive'},
  escalated: {label: 'Failed → session', className: 'text-amber-700 dark:text-amber-400'},
}

/**
 * Every time the trigger fired, newest first — one list, whatever each firing produced. A firing
 * that started (or escalated into) a session opens that session; a headless one opens its run
 * page. The row itself is the link: what a firing produced is a property of the trigger's type,
 * not a choice the reader should have to make per row.
 */
function TriggerFiringsSection({
  firings,
  sessions,
  agentId,
  serverUrl,
}: {
  firings: TriggerFiringInfo[]
  /** The sessions those firings created, for naming rows by what came of them. */
  sessions: SessionInfo[]
  agentId: string
  serverUrl: string
}) {
  const clickNavigate = useClickNavigate()
  const sessionsById = useMemo(() => new Map(sessions.map((session) => [session.id, session])), [sessions])
  return (
    <div className="border-border flex flex-col gap-2 border-t pt-5">
      <SizableText weight="bold">Firings</SizableText>
      {!firings.length ? <SizableText color="muted">This trigger has not fired yet.</SizableText> : null}
      {firings.map((firing) => {
        const status = FIRING_STATUS_LABELS[firing.status] ?? {label: firing.status, className: 'text-muted-foreground'}
        const session = firing.sessionId ? sessionsById.get(firing.sessionId) : undefined
        // The session is the richer destination when both exist: an escalated firing's session is
        // where the failure got handled, and its run is one click away inside it.
        const route: NavRoute | null = firing.sessionId
          ? {key: 'agent-session', agentId, sessionId: firing.sessionId, serverUrl}
          : firing.runId
            ? {key: 'agent-run', runId: firing.runId, agentId, serverUrl}
            : null
        const body = (
          <>
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <SizableText size="xs" weight="bold" className={`flex-none ${status.className}`}>
                {status.label}
              </SizableText>
              <SizableText size="sm" className="min-w-0 flex-1 truncate">
                {session?.title || firing.activitySummary}
              </SizableText>
              <SizableText size="xs" color="muted" className="flex-none">
                {formattedDateMedium(new Date(firing.createdAt))}
              </SizableText>
            </div>
            {firing.matchedConditions?.length ? (
              <SizableText size="xs" color="muted">
                Matched:{' '}
                {firing.matchedConditions.map(({id, source}, index) => (
                  <React.Fragment key={id}>
                    {index ? ' · ' : null}
                    <TriggerSourceSummary source={source} />
                  </React.Fragment>
                ))}
              </SizableText>
            ) : null}
            {firing.error ? (
              <SizableText size="xs" className="text-destructive break-words">
                {firing.error}
              </SizableText>
            ) : null}
          </>
        )
        if (!route) {
          return (
            <div key={firing.id} className="border-border flex flex-col gap-1 rounded-lg border p-2.5">
              {body}
            </div>
          )
        }
        return (
          <button
            key={firing.id}
            type="button"
            className="border-border hover:bg-muted/50 flex cursor-pointer flex-col gap-1 rounded-lg border p-2.5 text-left transition-colors"
            onClick={(event) => clickNavigate(route, event)}
          >
            {body}
          </button>
        )
      })}
    </div>
  )
}

/** The delivery URL of an existing webhook trigger, shown on its detail page. */
function WebhookEndpointSection({
  serverUrl,
  triggerId,
  secret,
}: {
  serverUrl: string
  triggerId: string
  secret: string | undefined
}) {
  if (!secret) {
    return (
      <div className="border-border bg-muted/40 flex flex-col gap-1 rounded-lg border p-3">
        <SizableText size="sm" weight="bold">
          Webhook URL
        </SizableText>
        <SizableText size="sm" className="font-mono break-all">
          {getAgentWebhookUrl(serverUrl, triggerId)}/&lt;secret&gt;
        </SizableText>
        <SizableText size="xs" color="muted">
          The secret is only shown to accounts that can edit this agent. If you are an editor and still see this, the
          trigger predates secret storage; delete it and create a new webhook trigger.
        </SizableText>
      </div>
    )
  }
  const url = getAgentWebhookUrl(serverUrl, triggerId, secret)
  return (
    <div className="flex flex-col gap-2">
      <WebhookCredential label="Webhook URL" value={url} onCopy={() => copyWithToast(url, 'Webhook URL')} />
      <SizableText size="xs" color="muted">
        POST JSON to this URL. Senders that cannot use a secret URL may instead post to the URL without the last segment
        and send <code>Authorization: Bearer &lt;secret&gt;</code>. An optional <code>Idempotency-Key</code> header
        deduplicates retries.
      </SizableText>
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

/** A failed load of the page's subject, with the server named when it is not obvious from context. */
function AgentQueryNotice({
  error,
  failed,
  serverLabel,
  onRetry,
  retryPending,
}: {
  error: unknown
  failed: string
  serverLabel?: string
  onRetry: () => void
  retryPending: boolean
}) {
  const notice = describeAgentError(error, {failed, serverLabel})
  return (
    <Notice tone={notice.tone} title={notice.title} onRetry={onRetry} retryPending={retryPending}>
      {notice.detail}
    </Notice>
  )
}

export default function AgentDetailRoutePage() {
  const route = useNavRoute()
  const selectedAccountId = useSelectedAccountId()
  // Keep every account this account's agents can author as synced locally, so they are
  // immediately mentionable and openable elsewhere in the app.
  useAgentAccountsSync()
  if (route.key !== 'agent') return null
  // App environments reject unauthenticated requests, so without an active account this page cannot
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

/** The server an agent runs on, first in its settings (shared with app settings). Every agent has one. */
function AgentServerHostSection({
  serverUrl,
  localServerUrl,
  health,
  onMove,
}: {
  serverUrl: string
  localServerUrl?: string | null
  health: {isLoading: boolean; isError: boolean; data?: unknown}
  onMove?: () => void
}) {
  return (
    <ServerHostSection
      serverUrl={serverUrl}
      localServerUrl={localServerUrl}
      detail={health.isLoading ? 'Checking…' : health.isError ? 'Not reachable' : 'Connected'}
      action={
        onMove ? (
          <Button size="sm" variant="outline" onClick={onMove}>
            <ArrowRightLeft className="size-4" /> Move…
          </Button>
        ) : null
      }
    />
  )
}
