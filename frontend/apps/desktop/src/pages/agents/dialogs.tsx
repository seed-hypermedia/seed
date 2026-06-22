import {type AgentDefinition, type ModelProviderType, type SigningIdentity} from '@/agents-client'
import {
  DEFAULT_AGENT_SERVER_URL,
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
import {DialogDescription, DialogTitle} from '@shm/ui/components/dialog'
import {Input} from '@shm/ui/components/input'
import {HMIcon} from '@shm/ui/hm-icon'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {ExternalLink, Trash2} from 'lucide-react'
import {useEffect, useState} from 'react'
import {ModelSelect} from './model-select'
import {AgentPromptEditor, promptBlocksToMarkdown} from './prompt-editor'

export function ModelProvidersDialog({
  input,
  onClose,
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
      <div>
        <DialogTitle>Model providers</DialogTitle>
        <DialogDescription>Save API keys as encrypted server-side secrets for reusable providers.</DialogDescription>
      </div>
      <div className="grid gap-3">
        {providers.data?.map((provider) => (
          <div
            key={provider.id}
            className="border-border flex items-center justify-between gap-3 rounded-lg border p-3"
          >
            <div>
              <SizableText weight="bold">{provider.name}</SizableText>
              <SizableText size="sm" color="muted">
                {provider.type} · {provider.hasSecrets ? 'secret saved' : 'no secret'}
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
        <Button variant="ghost" onClick={onClose}>
          Close
        </Button>
        <Button onClick={() => addProviderDialog.open(input)}>Add provider</Button>
      </div>
      {addProviderDialog.content}
    </div>
  )
}

function AddModelProviderDialog({
  input,
  onClose,
}: {
  input: {serverUrl: string; selectedAccountId: string | null | undefined}
  onClose: () => void
}) {
  return (
    <div className="flex min-w-[420px] flex-col gap-5">
      <div>
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
  onCancel: () => void
  submitLabel?: string
}) {
  const saveProvider = useSaveModelProvider(serverUrl, selectedAccountId)
  const [type, setType] = useState<ModelProviderType>('openai')
  const [name, setName] = useState('openai')
  const [apiKey, setApiKey] = useState('')

  useEffect(() => {
    setName(type)
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
          Provider type
        </SizableText>
        <select
          className="border-input bg-background rounded-md border px-3 py-2 text-sm"
          value={type}
          onChange={(event) => setType(event.target.value as ModelProviderType)}
        >
          <option value="openai">OpenAI</option>
          <option value="anthropic">Anthropic</option>
          <option value="google">Google</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Provider name
        </SizableText>
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="openai" />
      </label>
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          API key
        </SizableText>
        <Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
      </label>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
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
  const createIdentity = useCreateSigningIdentity(input.serverUrl, input.selectedAccountId)
  const updateIdentity = useUpdateSigningIdentity(input.serverUrl, input.selectedAccountId)
  const deleteIdentity = useDeleteSigningIdentity(input.serverUrl, input.selectedAccountId)
  const [newName, setNewName] = useState('Agent publisher')
  const [showNewAccountForm, setShowNewAccountForm] = useState(false)
  const [names, setNames] = useState<Record<string, string>>({})
  const [saveStates, setSaveStates] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({})

  useEffect(() => {
    const next: Record<string, string> = {}
    for (const identity of identities.data || [])
      next[identity.name] = identity.label || identity.accountId || identity.name
    setNames(next)
  }, [identities.data])

  async function handleCreateAccount() {
    try {
      const label = newName.trim()
      if (!label) throw new Error('Account name is required')
      const result = await createIdentity.mutateAsync(label)
      if (result._ !== 'CreateSigningIdentityResponse') throw new Error('Unexpected create response')
      setNewName('Agent publisher')
      setShowNewAccountForm(false)
      toast.success('Agent account created')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create agent account')
    }
  }

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

  async function handleDeleteAccount(name: string) {
    try {
      const result = await deleteIdentity.mutateAsync(name)
      if (result._ !== 'DeleteSigningIdentityResponse') throw new Error('Unexpected delete response')
      toast.success('Agent account deleted')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not delete agent account')
    }
  }

  return (
    <div className="flex min-w-[560px] flex-col gap-5">
      <div>
        <DialogTitle>Manage agent accounts</DialogTitle>
        <DialogDescription>
          Create server-side HM account keys, publish profile names, and initialize home documents for agents on this
          server.
        </DialogDescription>
      </div>
      <div className="grid gap-3">
        {identities.data?.map((identity) => (
          <AgentAccountRow
            key={identity.id}
            identity={identity}
            name={names[identity.name] || ''}
            saveState={saveStates[identity.name] || 'idle'}
            deleting={deleteIdentity.isLoading}
            onNameChange={(value) => setNames((current) => ({...current, [identity.name]: value}))}
            onDelete={() => void handleDeleteAccount(identity.name)}
          />
        ))}
        {!identities.isLoading && !identities.data?.length ? (
          <SizableText color="muted">No agent accounts exist on this server yet.</SizableText>
        ) : null}
      </div>
      {showNewAccountForm ? (
        <div className="border-border grid gap-3 rounded-lg border p-3">
          <SizableText weight="bold">New account</SizableText>
          <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Account name" />
          <div className="flex justify-end gap-2">
            <Button onClick={() => void handleCreateAccount()} disabled={createIdentity.isLoading || !newName.trim()}>
              Create account
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex justify-end">
          <Button onClick={() => setShowNewAccountForm(true)}>New account</Button>
        </div>
      )}
    </div>
  )
}

function AgentAccountRow({
  identity,
  name,
  saveState,
  deleting,
  onNameChange,
  onDelete,
}: {
  identity: SigningIdentity
  name: string
  saveState: 'idle' | 'saving' | 'saved' | 'error'
  deleting: boolean
  onNameChange: (value: string) => void
  onDelete: () => void
}) {
  const spawn = useNavigate('spawn')
  const accountId = identity.accountId
  const account = useAccount(accountId, {subscribe: true, enabled: !!accountId})
  const profileId = accountId ? hmId(accountId) : undefined
  const metadata = account.data

  return (
    <div className="border-border flex min-w-0 items-center gap-3 rounded-lg border p-3">
      <HMIcon id={profileId} name={metadata?.metadata?.name || name} icon={metadata?.metadata?.icon} size={36} />
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
        <Button variant="ghost" size="icon" aria-label="Delete account" onClick={onDelete} disabled={deleting}>
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
  const [providerName, setProviderName] = useState('')
  const providerModels = useProviderModels(selectedServerUrl, input.selectedAccountId, providerName)
  const selectedProviderType = providers.data?.find((provider) => provider.name === providerName)?.type
  const [name, setName] = useState('Desktop Test Agent')
  const [model, setModel] = useState('')
  const [systemPrompt, setSystemPrompt] = useState<HMBlockNode[]>(() =>
    markdownBlockNodesToHMBlockNodes(parseMarkdown('You are a helpful agent.').tree),
  )

  useEffect(() => {
    setSelectedServerUrl(input.serverUrls[0] || DEFAULT_AGENT_SERVER_URL)
  }, [input.serverUrls])

  useEffect(() => {
    const firstProvider = providers.data?.[0]?.name || ''
    if (!providers.data?.some((provider) => provider.name === providerName)) setProviderName(firstProvider)
  }, [providerName, providers.data])

  useEffect(() => {
    const firstModel = providerModels.data?.[0]?.id || ''
    if (!providerModels.data?.some((providerModel) => providerModel.id === model)) setModel(firstModel)
  }, [model, providerModels.data])

  async function handleCreateAgent() {
    try {
      const definition: AgentDefinition = {
        name,
        systemPrompt: promptBlocksToMarkdown(systemPrompt),
        modelProvider: providerName,
        model,
        tools: ['read'],
        metadata: {createdFrom: 'desktop-agents-page'},
      }
      const result = await createAgent.mutateAsync(definition)
      if (result._ !== 'CreateAgentResponse') throw new Error('Unexpected create response')
      toast.success('Agent created')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create agent')
    }
  }

  const serverSelector = (
    <label className="flex flex-col gap-1">
      <SizableText size="sm" weight="bold">
        Agent server
      </SizableText>
      <select
        className="border-input bg-background rounded-md border px-3 py-2 text-sm"
        value={selectedServerUrl}
        onChange={(event) => setSelectedServerUrl(event.target.value)}
      >
        {input.serverUrls.map((serverUrl) => (
          <option key={serverUrl} value={serverUrl}>
            {serverUrl}
          </option>
        ))}
      </select>
    </label>
  )

  // Force provider setup before agent creation when the selected server has
  // none configured. Saving one refetches `providers`, which transitions this
  // dialog to the regular agent creation form automatically.
  const needsProvider = !providers.isLoading && !providers.data?.length

  if (needsProvider) {
    return (
      <div className="flex min-w-[520px] flex-col gap-5">
        <div>
          <DialogTitle>Create Agent</DialogTitle>
          <DialogDescription>Add a model provider on this server before creating an agent.</DialogDescription>
        </div>
        {serverSelector}
        <AddModelProviderForm
          serverUrl={selectedServerUrl}
          selectedAccountId={input.selectedAccountId}
          onCancel={onClose}
          submitLabel="Add provider"
        />
      </div>
    )
  }

  return (
    <div className="flex min-w-[520px] flex-col gap-5">
      <div>
        <DialogTitle>Create Agent</DialogTitle>
        <DialogDescription>Choose a model provider, model, and system prompt for the new agent.</DialogDescription>
      </div>
      {serverSelector}
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Model provider
        </SizableText>
        <select
          className="border-input bg-background rounded-md border px-3 py-2 text-sm"
          value={providerName}
          onChange={(event) => setProviderName(event.target.value)}
        >
          {(providers.data || []).map((provider) => (
            <option key={provider.id} value={provider.name}>
              {provider.name} ({provider.type})
            </option>
          ))}
        </select>
      </label>
      <div className="grid gap-3 md:grid-cols-2">
        <label className="flex flex-col gap-1">
          <SizableText size="sm" weight="bold">
            Name
          </SizableText>
          <Input value={name} onChange={(event) => setName(event.target.value)} />
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
      <div className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          System prompt
        </SizableText>
        <AgentPromptEditor initialBlocks={systemPrompt} onChange={setSystemPrompt} />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void handleCreateAgent()} disabled={createAgent.isLoading || !providerName || !model}>
          Create Agent
        </Button>
      </div>
    </div>
  )
}
