import {type AgentDefinition, type ModelProviderType, type SigningIdentity} from '@/agents-client'
import {
  DEFAULT_AGENT_SERVER_URL,
  prefetchAgentDetail,
  useCreateAgent,
  useCreateSigningIdentity,
  useDeleteModelProvider,
  useDeleteSigningIdentity,
  useModelProviders,
  useProviderModels,
  useSaveModelProvider,
  useSigningIdentities,
  useUpdateSigningIdentity,
} from '@/models/agents'
import {useNavigate} from '@/utils/useNavigate'
import {markdownBlockNodesToHMBlockNodes, parseMarkdown} from '@seed-hypermedia/client'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {useAccount} from '@shm/shared/models/entity'
import {Button} from '@shm/ui/button'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@shm/ui/components/alert-dialog'
import {DialogDescription, DialogTitle} from '@shm/ui/components/dialog'
import {Input} from '@shm/ui/components/input'
import {HMIcon} from '@shm/ui/hm-icon'
import {SelectDropdown} from '@shm/ui/select-dropdown'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {Camera, ExternalLink, Plus, Trash2} from 'lucide-react'
import {useEffect, useState} from 'react'
import {generateAgentName} from './agent-name'
import {DEFAULT_AGENT_TOOLS} from './agent-tools'
import {ModelSelect} from './model-select'
import {pickDefaultProviderModel} from './model-utils'
import {AgentPromptEditor, promptBlocksToMarkdown} from './prompt-editor'
import {ProviderSelect} from './provider-select'

const PROVIDER_TYPE_OPTIONS: {value: ModelProviderType; label: string}[] = [
  {value: 'openai', label: 'OpenAI'},
  {value: 'anthropic', label: 'Anthropic'},
  {value: 'google', label: 'Google'},
]

function providerTypeLabel(type: ModelProviderType): string {
  return PROVIDER_TYPE_OPTIONS.find((option) => option.value === type)?.label || type
}

export function ModelProvidersDialog({
  input,
}: {
  input: {serverUrl: string; selectedAccountId: string | null | undefined}
  onClose: () => void
}) {
  const providers = useModelProviders(input.serverUrl, input.selectedAccountId)
  const deleteProvider = useDeleteModelProvider(input.serverUrl, input.selectedAccountId)
  const addProviderDialog = useAppDialog(AddModelProviderDialog)

  async function handleDeleteProvider(name: string) {
    try {
      const result = await deleteProvider.mutateAsync(name)
      if (result._ !== 'DeleteModelProviderResponse') throw new Error('Unexpected delete response')
      toast.success('Model provider key deleted')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete model provider key')
    }
  }

  return (
    <div className="flex min-w-[460px] flex-col gap-5">
      <div className="flex flex-col gap-3">
        <DialogTitle>Model providers</DialogTitle>
        <DialogDescription>
          Model providers connect your agents to AI models like Claude, GPT, and Gemini. Add a provider to make its
          models available when configuring agents.
        </DialogDescription>
      </div>
      <div className="grid gap-3">
        {providers.data?.map((provider) => (
          <div
            key={provider.id}
            className="border-border flex items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div className="flex flex-col gap-1.5">
              <SizableText weight="bold">{provider.name}</SizableText>
              <SizableText size="sm" color="muted">
                {provider.type}
              </SizableText>
            </div>
            <Button
              variant="ghost"
              size="icon"
              aria-label={`Delete ${provider.name} provider key`}
              onClick={() => void handleDeleteProvider(provider.name)}
              disabled={deleteProvider.isLoading}
            >
              <Trash2 className="size-4" />
            </Button>
          </div>
        ))}
        {!providers.data?.length ? <SizableText color="muted">No providers configured yet.</SizableText> : null}
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={() => addProviderDialog.open(input)}>
          <Plus className="size-4" />
          Add provider
        </Button>
      </div>
      {addProviderDialog.content}
    </div>
  )
}

export function AddModelProviderDialog({
  input,
  onClose,
}: {
  input: {serverUrl: string; selectedAccountId: string | null | undefined}
  onClose: () => void
}) {
  return (
    <div className="flex min-w-[420px] flex-col gap-5">
      <div className="flex flex-col gap-3">
        <DialogTitle>Add model provider</DialogTitle>
        <DialogDescription>Save this API key as an encrypted server-side secret.</DialogDescription>
      </div>
      <AddModelProviderForm
        serverUrl={input.serverUrl}
        selectedAccountId={input.selectedAccountId}
        onSaved={onClose}
        onCancel={onClose}
      />
    </div>
  )
}

/**
 * Provider type/name/API-key fields plus save logic, shared by the standalone
 * "Add model provider" dialog and the inline provider step of agent creation.
 */
function AddModelProviderForm({
  serverUrl,
  selectedAccountId,
  onSaved,
  onCancel,
  submitLabel = 'Save provider',
}: {
  serverUrl: string
  selectedAccountId: string | null | undefined
  onSaved?: () => void
  onCancel?: () => void
  submitLabel?: string
}) {
  const saveProvider = useSaveModelProvider(serverUrl, selectedAccountId)
  const [type, setType] = useState<ModelProviderType>('openai')
  const [name, setName] = useState(providerTypeLabel('openai'))
  const [apiKey, setApiKey] = useState('')

  useEffect(() => {
    setName(providerTypeLabel(type))
  }, [type])

  async function handleSave() {
    try {
      await saveProvider.mutateAsync({type, name, apiKey})
      setApiKey('')
      toast.success('Model provider saved')
      onSaved?.()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save model provider')
    }
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (saveProvider.isLoading || !apiKey.trim()) return
        void handleSave()
      }}
    >
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Provider
        </SizableText>
        <SelectDropdown
          options={PROVIDER_TYPE_OPTIONS}
          value={type}
          onValue={(value) => setType(value as ModelProviderType)}
        />
      </label>
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Provider Label
        </SizableText>
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="OpenAI" />
      </label>
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          API key
        </SizableText>
        <Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
      </label>
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={saveProvider.isLoading || !apiKey.trim()}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

export function ManageAgentAccountsDialog({
  input,
  onClose,
}: {
  input: {serverUrl: string; selectedAccountId: string | null | undefined}
  onClose: () => void
}) {
  const identities = useSigningIdentities(input.serverUrl, input.selectedAccountId)
  const updateIdentity = useUpdateSigningIdentity(input.serverUrl, input.selectedAccountId)
  const newAccountDialog = useAppDialog(NewAgentAccountDialog)
  const deleteAccountDialog = useAppDialog(DeleteAgentAccountDialog, {isAlert: true})
  const [names, setNames] = useState<Record<string, string>>({})
  const [saveStates, setSaveStates] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({})

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const identity of identities.data || [])
      next[identity.name] = identity.label || identity.accountId || identity.name
    setNames(next)
  }, [identities.data])

  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = []
    for (const identity of identities.data || []) {
      const label = names[identity.name]?.trim()
      const persisted = identity.label || identity.accountId || identity.name
      if (!label || label === persisted) continue
      timers.push(
        setTimeout(() => {
          setSaveStates((current) => ({...current, [identity.name]: 'saving'}))
          void updateIdentity
            .mutateAsync({name: identity.name, label})
            .then((result) => {
              if (result._ !== 'UpdateSigningIdentityResponse') throw new Error('Unexpected update response')
              setSaveStates((current) => ({...current, [identity.name]: 'saved'}))
              setTimeout(() => {
                setSaveStates((current) =>
                  current[identity.name] === 'saved' ? {...current, [identity.name]: 'idle'} : current,
                )
              }, 1800)
            })
            .catch((error) => {
              setSaveStates((current) => ({...current, [identity.name]: 'error'}))
              toast.error(error instanceof Error ? error.message : 'Could not rename agent account')
            })
        }, 1200),
      )
    }
    return () => timers.forEach((timer) => clearTimeout(timer))
  }, [identities.data, names, updateIdentity])

  async function handleIconSelect(identity: SigningIdentity, file: File) {
    const label = names[identity.name]?.trim() || identity.label || identity.accountId || identity.name
    setSaveStates((current) => ({...current, [identity.name]: 'saving'}))
    try {
      const data = new Uint8Array(await file.arrayBuffer())
      const result = await updateIdentity.mutateAsync({
        name: identity.name,
        label,
        icon: {data, mimeType: file.type || undefined, fileName: file.name},
      })
      if (result._ !== 'UpdateSigningIdentityResponse') throw new Error('Unexpected update response')
      setSaveStates((current) => ({...current, [identity.name]: 'saved'}))
      setTimeout(() => {
        setSaveStates((current) =>
          current[identity.name] === 'saved' ? {...current, [identity.name]: 'idle'} : current,
        )
      }, 1800)
    } catch (error) {
      setSaveStates((current) => ({...current, [identity.name]: 'error'}))
      toast.error(error instanceof Error ? error.message : 'Could not update agent account icon')
    }
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-5">
      <div className="flex flex-col gap-3">
        <DialogTitle>Agent Server Accounts</DialogTitle>
        <DialogDescription>
          Hypermedia accounts that can be used by your agents on this server to write content.
        </DialogDescription>
        <DialogDescription>
          To give an agent access to write content, invite these accounts as collaborators on your sites or documents.
        </DialogDescription>
      </div>
      <div className="grid gap-3">
        {identities.data?.map((identity) => (
          <AgentAccountRow
            key={identity.id}
            identity={identity}
            name={names[identity.name] || ''}
            saveState={saveStates[identity.name] || 'idle'}
            onNameChange={(value) => setNames((current) => ({...current, [identity.name]: value}))}
            onIconSelect={(file) => void handleIconSelect(identity, file)}
            onDelete={() =>
              deleteAccountDialog.open({
                serverUrl: input.serverUrl,
                selectedAccountId: input.selectedAccountId,
                name: identity.name,
                label: names[identity.name]?.trim() || identity.label || identity.accountId || identity.name,
              })
            }
          />
        ))}
        {!identities.isLoading && !identities.data?.length ? (
          <SizableText color="muted">No agent accounts exist on this server yet.</SizableText>
        ) : null}
      </div>
      <div className="flex justify-end">
        <Button
          onClick={() =>
            newAccountDialog.open({serverUrl: input.serverUrl, selectedAccountId: input.selectedAccountId})
          }
        >
          <Plus className="size-4" />
          New account
        </Button>
      </div>
      {newAccountDialog.content}
      {deleteAccountDialog.content}
    </div>
  )
}

function NewAgentAccountDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {serverUrl: string; selectedAccountId: string | null | undefined}
}) {
  const createIdentity = useCreateSigningIdentity(input.serverUrl, input.selectedAccountId)
  const [name, setName] = useState('Agent publisher')

  async function handleCreate() {
    const label = name.trim()
    if (!label) {
      toast.error('Account name is required')
      return
    }
    try {
      const result = await createIdentity.mutateAsync(label)
      if (result._ !== 'CreateSigningIdentityResponse') throw new Error('Unexpected create response')
      toast.success('Agent account created')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create agent account')
    }
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <DialogTitle>New agent account</DialogTitle>
      <DialogDescription>
        Create a new server-side HM account key. You can rename it and set up its profile afterward.
      </DialogDescription>
      <Input
        autoFocus
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="Account name"
        onKeyDown={(event) => {
          if (event.key === 'Enter') void handleCreate()
        }}
      />
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void handleCreate()} disabled={createIdentity.isLoading || !name.trim()}>
          Create account
        </Button>
      </div>
    </div>
  )
}

function DeleteAgentAccountDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {serverUrl: string; selectedAccountId: string | null | undefined; name: string; label: string}
}) {
  const deleteIdentity = useDeleteSigningIdentity(input.serverUrl, input.selectedAccountId)

  async function handleConfirm() {
    try {
      const result = await deleteIdentity.mutateAsync(input.name)
      if (result._ !== 'DeleteSigningIdentityResponse') throw new Error('Unexpected delete response')
      toast.success('Agent account deleted')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete agent account')
    }
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <AlertDialogTitle>Delete “{input.label}”?</AlertDialogTitle>
      <AlertDialogDescription>
        This agent account will be permanently deleted from this server. This action cannot be undone, and may prevent
        any agent that signs with this account from writing.
      </AlertDialogDescription>
      <div className="flex justify-end gap-2">
        <AlertDialogCancel asChild>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          disabled={deleteIdentity.isLoading}
          onClick={() => void handleConfirm()}
        >
          Delete account
        </AlertDialogAction>
      </div>
    </div>
  )
}

function AgentAccountRow({
  identity,
  name,
  saveState,
  onNameChange,
  onIconSelect,
  onDelete,
}: {
  identity: SigningIdentity
  name: string
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  onNameChange: (value: string) => void
  onIconSelect: (file: File) => void
  onDelete: () => void
}) {
  const spawn = useNavigate('spawn')
  const accountId = identity.accountId
  const account = useAccount(accountId, {subscribe: true, enabled: !!accountId})
  const profileId = accountId ? hmId(accountId) : undefined
  const metadata = account.data
  // Optimistic local preview of a just-picked image so the new icon shows instantly while the
  // server uploads, publishes, and the account metadata round-trips back.
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const uploading = saveState === 'saving'

  // Drop the optimistic preview if the upload failed, reverting to the published icon.
  useEffect(() => {
    if (saveState === 'error') setPreviewUrl(null)
  }, [saveState])

  // Release the object URL when this row unmounts or the preview is replaced.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  function handleFile(file: File) {
    setPreviewUrl(URL.createObjectURL(file))
    onIconSelect(file)
  }

  return (
    <div className="border-border flex min-w-0 items-center gap-3 rounded-lg border p-3">
      <label
        className="group/icon relative shrink-0 cursor-pointer overflow-hidden rounded-full"
        style={{width: 36, height: 36}}
        aria-label="Upload account icon"
      >
        <input
          type="file"
          accept="image/*"
          disabled={uploading}
          className="absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-default"
          onChange={(event) => {
            const file = event.target.files?.[0]
            event.target.value = ''
            if (file) handleFile(file)
          }}
        />
        {uploading ? (
          <div className="pointer-events-none absolute inset-0 z-[6] flex items-center justify-center bg-black/40">
            <Spinner className="text-white" />
          </div>
        ) : (
          <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center bg-black/40 opacity-0 group-hover/icon:opacity-100">
            <Camera className="size-4 text-white" />
          </div>
        )}
        {previewUrl ? (
          <img src={previewUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <HMIcon id={profileId} name={metadata?.metadata?.name || name} icon={metadata?.metadata?.icon} size={36} />
        )}
      </label>
      <div className="min-w-0 flex-1">
        <Input value={name} onChange={(event) => onNameChange(event.target.value)} />
      </div>
      <div className="flex min-w-0 flex-none items-center gap-1">
        {saveState !== 'idle' ? (
          <SizableText
            size="xs"
            color={saveState === 'error' ? undefined : 'muted'}
            className={saveState === 'error' ? 'text-destructive whitespace-nowrap' : 'whitespace-nowrap'}
          >
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? 'Saved' : 'Save failed'}
          </SizableText>
        ) : null}
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open profile in new window"
          onClick={() => {
            if (profileId) spawn({key: 'profile', id: profileId})
          }}
          disabled={!profileId}
        >
          <ExternalLink className="size-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Delete account" onClick={onDelete}>
          <Trash2 className="size-4" />
        </Button>
      </div>
    </div>
  )
}

export function CreateAgentDialog({
  input,
  onClose,
}: {
  input: {serverUrls: string[]; selectedAccountId: string | null | undefined}
  onClose: () => void
}) {
  const [selectedServerUrl, setSelectedServerUrl] = useState(input.serverUrls[0] || DEFAULT_AGENT_SERVER_URL)
  const providers = useModelProviders(selectedServerUrl, input.selectedAccountId)
  const createAgent = useCreateAgent(selectedServerUrl, input.selectedAccountId)
  const createSigningIdentity = useCreateSigningIdentity(selectedServerUrl, input.selectedAccountId)
  const deleteSigningIdentity = useDeleteSigningIdentity(selectedServerUrl, input.selectedAccountId)
  const navigate = useNavigate()
  const [providerName, setProviderName] = useState('')
  const providerModels = useProviderModels(selectedServerUrl, input.selectedAccountId, providerName)
  const selectedProviderType = providers.data?.find((provider) => provider.name === providerName)?.type
  const addProviderDialog = useAppDialog(AddModelProviderDialog)
  const [name, setName] = useState(generateAgentName)
  const [model, setModel] = useState('')
  const [systemPrompt, setSystemPrompt] = useState<HMBlockNode[]>(() =>
    markdownBlockNodesToHMBlockNodes(parseMarkdown('You are a helpful agent.').tree),
  )
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    setSelectedServerUrl(input.serverUrls[0] || DEFAULT_AGENT_SERVER_URL)
  }, [input.serverUrls])

  useEffect(() => {
    const firstProvider = providers.data?.[0]?.name || ''
    if (!providers.data?.some((provider) => provider.name === providerName)) setProviderName(firstProvider)
  }, [providerName, providers.data])

  useEffect(() => {
    const defaultModel = pickDefaultProviderModel(providerModels.data, selectedProviderType)?.id || ''
    if (!providerModels.data?.some((providerModel) => providerModel.id === model)) setModel(defaultModel)
  }, [model, providerModels.data, selectedProviderType])

  async function handleCreateAgent() {
    const agentName = name.trim()
    if (!agentName) {
      toast.error('Agent name is required')
      return
    }
    // Auto-create a dedicated account for the agent so it can publish without the
    // user setting up a signing identity by hand. The account is named after the
    // agent and wired in as its signing key with write tooling enabled.
    setCreating(true)
    let signingKeyName: string | undefined
    try {
      const identityResult = await createSigningIdentity.mutateAsync(agentName)
      if (identityResult._ !== 'CreateSigningIdentityResponse') throw new Error('Unexpected account response')
      signingKeyName = identityResult.identity.name
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create the agent account')
      setCreating(false)
      return
    }
    try {
      const definition: AgentDefinition = {
        name: agentName,
        systemPrompt: promptBlocksToMarkdown(systemPrompt),
        modelProvider: providerName,
        model,
        tools: DEFAULT_AGENT_TOOLS,
        signingKey: signingKeyName,
        signingKeys: [signingKeyName],
        metadata: {createdFrom: 'desktop-agents-page'},
      }
      const result = await createAgent.mutateAsync(definition)
      if (result._ !== 'CreateAgentResponse') throw new Error('Unexpected create response')
      // Pre-load the agent detail into the query cache so the agent page renders
      // immediately instead of flashing a loading state after navigation.
      await prefetchAgentDetail(selectedServerUrl, input.selectedAccountId, result.agentId).catch(() => {})
      toast.success('Agent created')
      onClose()
      navigate({key: 'agent', agentId: result.agentId, serverUrl: selectedServerUrl})
    } catch (error) {
      // Roll back the just-created account so a failed agent create doesn't leave an orphan.
      void deleteSigningIdentity.mutateAsync(signingKeyName).catch(() => {})
      toast.error(error instanceof Error ? error.message : 'Could not create agent')
      setCreating(false)
    }
  }

  const serverSelector = (
    <label className="flex flex-col gap-1">
      <SizableText size="sm" weight="bold">
        Agent server
      </SizableText>
      <SelectDropdown
        options={input.serverUrls.map((serverUrl) => ({
          value: serverUrl,
          label: serverUrl.replace(/^https?:\/\//, ''),
        }))}
        value={selectedServerUrl}
        onValue={setSelectedServerUrl}
      />
    </label>
  )

  // Force provider setup before agent creation when the selected server has
  // none configured. Saving one refetches `providers`, which transitions this
  // dialog to the regular agent creation form automatically.
  const needsProvider = !providers.isLoading && !providers.data?.length

  if (needsProvider) {
    return (
      <div className="flex min-w-[520px] flex-col gap-5">
        <DialogTitle>Create Agent</DialogTitle>
        {serverSelector}
        <div className="border-border bg-muted flex flex-col gap-4 rounded-lg border p-4">
          <DialogDescription>Add a model provider on this server before creating an agent.</DialogDescription>
          <AddModelProviderForm
            serverUrl={selectedServerUrl}
            selectedAccountId={input.selectedAccountId}
            submitLabel="Add provider"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-w-[520px] flex-col gap-5">
      <div className="flex flex-col gap-3">
        <DialogTitle>Create Agent</DialogTitle>
        <DialogDescription>
          Choose a model provider, model, and system prompt. An account named after the agent is created automatically
          so it can publish Seed content.
        </DialogDescription>
      </div>
      {serverSelector}
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Name
        </SizableText>
        <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <SizableText size="sm" weight="bold">
            Model provider
          </SizableText>
          <ProviderSelect
            providers={providers.data}
            value={providerName}
            onChange={setProviderName}
            onAddProvider={() =>
              addProviderDialog.open({serverUrl: selectedServerUrl, selectedAccountId: input.selectedAccountId})
            }
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
            onChange={setModel}
            isLoading={providerModels.isLoading}
            isError={providerModels.isError}
            error={providerModels.error}
            disabled={!providerName}
          />
        </label>
      </div>
      {addProviderDialog.content}
      <div className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          System prompt
        </SizableText>
        <AgentPromptEditor initialBlocks={systemPrompt} onChange={setSystemPrompt} focusOnMount={false} />
      </div>
      <div className="flex justify-end gap-2">
        <Button onClick={() => void handleCreateAgent()} disabled={creating || !providerName || !model}>
          {creating ? <Spinner /> : null}
          Create Agent
        </Button>
      </div>
    </div>
  )
}

/** Describes how the agent's account relates to the rename so the dialog can explain what happens. */
export type AgentAccountRenameStatus =
  | {kind: 'own'} // a dedicated account that will be renamed alongside the agent
  | {kind: 'shared'} // an account used by other agents, left untouched
  | {kind: 'none'} // no signing account linked

export function EditAgentNameDialog({
  input,
  onClose,
}: {
  input: {currentName: string; accountStatus: AgentAccountRenameStatus; onRename: (name: string) => Promise<void>}
  onClose: () => void
}) {
  const [name, setName] = useState(input.currentName)
  const [saving, setSaving] = useState(false)

  async function handleSave() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('Agent name is required')
      return
    }
    setSaving(true)
    try {
      await input.onRename(trimmed)
      toast.success('Agent renamed')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not rename agent')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="flex min-w-[420px] flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (saving) return
        void handleSave()
      }}
    >
      <div className="flex flex-col gap-3">
        <DialogTitle>Rename agent</DialogTitle>
        <DialogDescription>
          {input.accountStatus.kind === 'own'
            ? "The agent's account is renamed to match."
            : input.accountStatus.kind === 'shared'
              ? 'This agent shares its account with other agents, so the account keeps its name. Rename it separately from Manage accounts.'
              : 'This agent has no linked account to rename.'}
        </DialogDescription>
      </div>
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Name
        </SizableText>
        <Input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Agent" />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={saving || !name.trim()}>
          Save
        </Button>
      </div>
    </form>
  )
}
