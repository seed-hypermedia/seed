import {type AgentDefinition, type AgentModelRef, type ModelProviderType, type SigningIdentity} from './client'
import {
  getDefaultAgentServerUrl,
  isLocalAgentServer,
  prefetchAgentDetail,
  useAgentServerHealth,
  useCreateAgent,
  useCreateSigningIdentity,
  useDeleteModelProvider,
  useDeleteSigningIdentity,
  useImportSigningIdentity,
  useModelProviders,
  useProviderModels,
  useSaveModelProvider,
  useLocalAgentServerUrl,
  useSigningIdentities,
  useUpdateSigningIdentity,
} from './models'
import {useNavigate} from './navigation'
import {keyfile, markdownBlockNodesToHMBlockNodes, parseMarkdown} from '@seed-hypermedia/client'
import type {HMBlockNode} from '@seed-hypermedia/client/hm-types'
import {hmId} from '@shm/shared'
import {useAccount} from '@shm/shared/models/entity'
import {queryAccount} from '@shm/shared/models/queries'
import {queryClient, useQueryClient} from '@shm/shared/models/query-client'
import {useUniversalClient} from '@shm/shared/routing'
import {Button} from '@shm/ui/button'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogDescription,
  AlertDialogTitle,
} from '@shm/ui/components/alert-dialog'
import {DialogDescription, DialogTitle} from '@shm/ui/components/dialog'
import {ImportKeyDialog} from '@shm/ui/components/import-key-dialog'
import {Input} from '@shm/ui/components/input'
import {Label} from '@shm/ui/components/label'
import {HMIcon} from '@shm/ui/hm-icon'
import {Select, SelectContent, SelectDropdown, SelectItem, SelectTrigger, SelectValue} from '@shm/ui/select-dropdown'
import {Spinner} from '@shm/ui/spinner'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {Camera, Copy, ExternalLink, FileKey, Plus, Trash2} from 'lucide-react'
import {useEffect, useRef, useState} from 'react'
import {generateAgentName} from './agent-name'
import {DEFAULT_AGENT_TOOLS} from './agent-tools'
import {modelReasoningSupport, type ReasoningLevel} from '@seed-hypermedia/agents-protocol'
import {ProviderModelSelect} from './provider-model-select'
import {coerceReasoningLevel, ReasoningSlider} from './reasoning-select'
import {pickDefaultProviderModel} from './model-utils'
import {AgentPromptEditor, promptBlocksForRequest} from './prompt-editor'
import {ProviderIcon} from './provider-icons'
import {SubscriptionSignIn} from './provider-oauth'
import {PROVIDER_METADATA, PROVIDER_TYPE_ORDER, providerLabel} from './provider-registry'

export function ModelProvidersDialog({
  input,
}: {
  input: {serverUrl: string; selectedAccountId: string | null | undefined}
  onClose: () => void
}) {
  const providers = useModelProviders(input.serverUrl, input.selectedAccountId)
  const deleteProvider = useDeleteModelProvider(input.serverUrl, input.selectedAccountId)
  const health = useAgentServerHealth(input.serverUrl)
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
    <div className="flex flex-col gap-5 sm:min-w-[460px]">
      <div className="flex flex-col gap-3">
        <DialogTitle>Model providers</DialogTitle>
        <DialogDescription>
          Model providers connect your agents to AI models like Claude, GPT, and Gemini. Add a provider to make its
          models available when configuring agents.
        </DialogDescription>
      </div>
      <div className="grid gap-3">
        {providers.data?.map((provider) => (
          <div key={provider.id} className="border-border flex flex-col gap-2 rounded-lg border p-3">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <ProviderIcon type={provider.type as ModelProviderType} className="text-muted-foreground size-5" />
                <div className="flex flex-col gap-1.5">
                  <SizableText weight="bold">{provider.name}</SizableText>
                  <SizableText size="sm" color="muted">
                    {provider.authMode === 'subscription'
                      ? `${provider.type} · ${
                          PROVIDER_METADATA[provider.type as ModelProviderType]?.subscription?.label ?? 'subscription'
                        }`
                      : provider.type}
                  </SizableText>
                </div>
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
            {provider.authMode === 'subscription' && provider.authStatus === 'needs-login' ? (
              <div className="flex flex-col gap-2">
                <SizableText size="sm" className="text-destructive">
                  Sign-in expired — sign in again to keep using this provider.
                </SizableText>
                {health.data?.subscriptionAuth === true ? (
                  <SubscriptionSignIn
                    serverUrl={input.serverUrl}
                    selectedAccountId={input.selectedAccountId}
                    providerType={provider.type as ModelProviderType}
                    onConnected={() => toast.success('Signed in again')}
                  />
                ) : (
                  <SizableText size="sm" color="muted">
                    This server no longer offers subscription sign-in. Delete this provider and use an API key instead.
                  </SizableText>
                )}
              </div>
            ) : null}
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
  input: {
    serverUrl: string
    selectedAccountId: string | null | undefined
    /** Called with the saved provider's name so openers (e.g. a provider dropdown) can auto-select it. */
    onSaved?: (providerName: string) => void
  }
  onClose: () => void
}) {
  return (
    <div className="flex flex-col gap-5 sm:min-w-[420px]">
      <div className="flex flex-col gap-3">
        <DialogTitle>Add model provider</DialogTitle>
        <DialogDescription>
          Connect with an API key (stored as an encrypted server-side secret) or a provider subscription sign-in.
        </DialogDescription>
      </div>
      <AddModelProviderForm
        serverUrl={input.serverUrl}
        selectedAccountId={input.selectedAccountId}
        onSaved={(providerName) => {
          input.onSaved?.(providerName)
          onClose()
        }}
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
  /** Called with the saved provider's name (as stored, i.e. trimmed). */
  onSaved?: (providerName: string) => void
  onCancel?: () => void
  submitLabel?: string
}) {
  const activeQueryClient = useQueryClient()
  const saveProvider = useSaveModelProvider(serverUrl, selectedAccountId)
  const health = useAgentServerHealth(serverUrl)
  const [type, setType] = useState<ModelProviderType>('openai')
  const [name, setName] = useState(providerLabel('openai'))
  const [apiKey, setApiKey] = useState('')
  const [baseUrl, setBaseUrl] = useState(PROVIDER_METADATA.openai.defaultBaseUrl)
  const [authMode, setAuthMode] = useState<'api-key' | 'subscription'>('api-key')
  const [oauthSecretName, setOauthSecretName] = useState<string | null>(null)

  const metadata = PROVIDER_METADATA[type]
  // Subscription sign-in is offered only when this server has explicitly
  // enabled it (health.subscriptionAuth) — the flow needs this desktop app to
  // catch the provider's localhost redirect on the server's behalf.
  const subscriptionAvailable = Boolean(metadata.subscription) && health.data?.subscriptionAuth === true
  const subscriptionMode = authMode === 'subscription' && subscriptionAvailable

  useEffect(() => {
    setName(providerLabel(type))
    setBaseUrl(PROVIDER_METADATA[type].defaultBaseUrl)
    setAuthMode('api-key')
    setOauthSecretName(null)
  }, [type])

  // Self-hosted/custom providers may run without a key; a custom endpoint must still
  // supply a base URL since it has no sensible default. Subscription mode needs a
  // completed sign-in instead of a key.
  const apiKeyOk = subscriptionMode ? Boolean(oauthSecretName) : !metadata.requiresApiKey || apiKey.trim().length > 0
  const baseUrlOk = subscriptionMode || !metadata.showBaseUrlField || baseUrl.trim().length > 0
  const canSubmit = !saveProvider.isLoading && apiKeyOk && baseUrlOk

  async function handleSave() {
    const providerName = name.trim()
    try {
      await saveProvider.mutateAsync({
        type,
        name,
        apiKey: subscriptionMode ? '' : apiKey,
        baseUrl: !subscriptionMode && metadata.showBaseUrlField ? baseUrl.trim() : undefined,
        oauthSecretName: subscriptionMode && oauthSecretName ? oauthSecretName : undefined,
      })
      setApiKey('')
      // Refetch provider lists before reporting the save: callers auto-select the
      // new provider, and their stale-selection resets would otherwise clobber a
      // name the (still stale) list doesn't contain yet.
      await activeQueryClient.refetchQueries({queryKey: ['agents', 'providers']}).catch(() => {})
      toast.success('Model provider saved')
      onSaved?.(providerName)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save model provider')
    }
  }

  return (
    <form
      className="flex flex-col gap-5"
      onSubmit={(event) => {
        event.preventDefault()
        if (!canSubmit) return
        void handleSave()
      }}
    >
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Provider
        </SizableText>
        <Select value={type} onValueChange={(value) => setType(value as ModelProviderType)}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_TYPE_ORDER.map((providerType) => (
              <SelectItem key={providerType} value={providerType}>
                <span className="flex items-center gap-2">
                  <ProviderIcon type={providerType} className="size-4" />
                  {PROVIDER_METADATA[providerType].label}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>
      <label className="flex flex-col gap-1">
        <SizableText size="sm" weight="bold">
          Provider Label
        </SizableText>
        <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={metadata.label} />
      </label>
      {metadata.subscription && subscriptionAvailable ? (
        <div className="flex flex-col gap-1">
          <SizableText size="sm" weight="bold">
            Authentication
          </SizableText>
          <div className="border-border flex gap-1 self-start rounded-lg border p-1" role="radiogroup">
            <Button
              type="button"
              size="sm"
              variant={authMode === 'api-key' ? 'secondary' : 'ghost'}
              aria-checked={authMode === 'api-key'}
              role="radio"
              onClick={() => setAuthMode('api-key')}
            >
              API key
            </Button>
            <Button
              type="button"
              size="sm"
              variant={authMode === 'subscription' ? 'secondary' : 'ghost'}
              aria-checked={authMode === 'subscription'}
              role="radio"
              onClick={() => setAuthMode('subscription')}
            >
              {metadata.subscription.label}
            </Button>
          </div>
        </div>
      ) : null}
      {!subscriptionMode && metadata.showBaseUrlField ? (
        <label className="flex flex-col gap-1">
          <SizableText size="sm" weight="bold">
            Base URL
          </SizableText>
          <Input
            value={baseUrl}
            onChange={(event) => setBaseUrl(event.target.value)}
            placeholder={metadata.defaultBaseUrl || 'https://my-llm.example.com/v1'}
          />
        </label>
      ) : null}
      {subscriptionMode ? (
        <SubscriptionSignIn
          serverUrl={serverUrl}
          selectedAccountId={selectedAccountId}
          providerType={type}
          connectedSecretName={oauthSecretName ?? undefined}
          onConnected={setOauthSecretName}
        />
      ) : (
        <label className="flex flex-col gap-1">
          <SizableText size="sm" weight="bold">
            {metadata.requiresApiKey ? 'API key' : 'API key (optional)'}
          </SizableText>
          <Input type="password" value={apiKey} onChange={(event) => setApiKey(event.target.value)} />
        </label>
      )}
      <div className="flex justify-end gap-2">
        {onCancel ? (
          <Button type="button" variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        ) : null}
        <Button type="submit" disabled={!canSubmit}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}

/** Hostname shown in the remote-import warning; falls back to the raw URL when unparseable. */
function describeServerHost(serverUrl: string): string {
  try {
    return new URL(serverUrl).host
  } catch {
    return serverUrl
  }
}

export function ManageAgentAccountsDialog({
  input,
}: {
  input: {serverUrl: string; selectedAccountId: string | null | undefined}
  onClose: () => void
}) {
  const identities = useSigningIdentities(input.serverUrl, input.selectedAccountId)
  const updateIdentity = useUpdateSigningIdentity(input.serverUrl, input.selectedAccountId)
  const importIdentity = useImportSigningIdentity(input.serverUrl, input.selectedAccountId)
  const universalClient = useUniversalClient()
  const localServerUrl = useLocalAgentServerUrl()
  const isLocalServer = isLocalAgentServer(input.serverUrl, localServerUrl.data)
  const newAccountDialog = useAppDialog(NewAgentAccountDialog)
  const deleteAccountDialog = useAppDialog(DeleteAgentAccountDialog, {isAlert: true})
  const [names, setNames] = useState<Record<string, string>>({})
  const [saveStates, setSaveStates] = useState<Record<string, 'idle' | 'saving' | 'saved' | 'error'>>({})
  const [importOpen, setImportOpen] = useState(false)
  const [importFile, setImportFile] = useState<File | null>(null)
  const importFileInputRef = useRef<HTMLInputElement>(null)

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

  /** Imports the chosen `.hmkey.json`: decrypts client-side, ships only the raw seed. */
  async function handleImportKey(password: string | undefined) {
    if (!importFile) throw new Error('Key file is required')
    if (!importFile.name.endsWith('.hmkey.json')) throw new Error('Key file must end with .hmkey.json')
    const loaded = await keyfile.load(await importFile.text(), password)
    // The stored label is a snapshot of the account's REAL profile name, never an invention: the
    // import publishes nothing, so a made-up label would contradict what the profile actually
    // says. The key file may carry the name; otherwise the local node usually knows the account
    // (it is typically the user's own identity being handed to the server). If neither does, the
    // label stays unset and the row shows the account id until the profile resolves.
    let label = loaded.payload.profile?.name
    if (!label) {
      try {
        const profile = await queryClient.fetchQuery(queryAccount(universalClient, loaded.publicKey))
        label = profile?.metadata?.name || undefined
      } catch {
        // Unresolvable profile — import without a label rather than storing a fake name.
      }
    }
    const identity = await importIdentity.mutateAsync({seed: loaded.seed, label})
    toast.success(`Imported ${identity.label || identity.accountId}`)
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
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => setImportOpen(true)}>
          <FileKey className="size-4" />
          Import key
        </Button>
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
      <ImportKeyDialog
        open={importOpen}
        onOpenChange={(open) => {
          setImportOpen(open)
          if (!open) setImportFile(null)
        }}
        title="Import Account Key"
        description="Choose an exported `.hmkey.json` file for this server to sign with. Enter a password only if the key file was exported with encryption."
        hasFile={!!importFile}
        renderFileField={({clearError}) => (
          <div className="flex flex-col gap-2">
            <Label htmlFor="agent-import-key-file">Key file</Label>
            <input
              ref={importFileInputRef}
              id="agent-import-key-file"
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={(event) => {
                const file = event.currentTarget.files?.[0] ?? null
                setImportFile(file)
                if (file) clearError()
              }}
            />
            <Button type="button" variant="outline" onClick={() => importFileInputRef.current?.click()}>
              <FileKey className="size-4" />
              <span className="min-w-0 truncate">{importFile ? importFile.name : 'Choose key file…'}</span>
            </Button>
          </div>
        )}
        warning={
          // The key is decrypted locally either way; what differs is where the seed then goes. On
          // the local server it stays on this machine — a remote server is a trust decision.
          isLocalServer ? undefined : (
            <>
              This will send the account's secret key to <b>{describeServerHost(input.serverUrl)}</b>. That server
              stores the key and can sign as this account — anyone who controls the server gains full control of the
              account. Only import a key you are willing to entrust to it.
            </>
          )
        }
        onImport={handleImportKey}
      />
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

/** Renames a single agent account and/or uploads a new profile photo. */
export function EditAgentAccountDialog({
  onClose,
  input,
}: {
  onClose: () => void
  input: {serverUrl: string | undefined; selectedAccountId: string | null | undefined; identity: SigningIdentity}
}) {
  const {identity} = input
  const updateIdentity = useUpdateSigningIdentity(input.serverUrl, input.selectedAccountId)
  const [label, setLabel] = useState(identity.label || identity.accountId || identity.name)
  const [iconFile, setIconFile] = useState<File | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const profileId = identity.accountId ? hmId(identity.accountId) : undefined

  // Release the object URL when the dialog unmounts or the preview is replaced.
  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl)
    }
  }, [previewUrl])

  async function handleSave() {
    const nextLabel = label.trim()
    if (!nextLabel) {
      toast.error('Account name is required')
      return
    }
    try {
      const icon = iconFile
        ? {
            data: new Uint8Array(await iconFile.arrayBuffer()),
            mimeType: iconFile.type || undefined,
            fileName: iconFile.name,
          }
        : undefined
      const result = await updateIdentity.mutateAsync({name: identity.name, label: nextLabel, icon})
      if (result._ !== 'UpdateSigningIdentityResponse') throw new Error('Unexpected update response')
      toast.success('Agent account updated')
      onClose()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not update agent account')
    }
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-4">
      <DialogTitle>Edit agent account</DialogTitle>
      <div className="flex items-center gap-3">
        <label
          className="group/icon relative shrink-0 cursor-pointer overflow-hidden rounded-full"
          style={{width: 48, height: 48}}
          aria-label="Upload account photo"
        >
          <input
            type="file"
            accept="image/*"
            disabled={updateIdentity.isLoading}
            className="absolute inset-0 z-10 cursor-pointer opacity-0 disabled:cursor-default"
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                setIconFile(file)
                setPreviewUrl(URL.createObjectURL(file))
              }
            }}
          />
          <div className="pointer-events-none absolute inset-0 z-[5] flex items-center justify-center bg-black/40 opacity-0 group-hover/icon:opacity-100">
            <Camera className="size-4 text-white" />
          </div>
          {previewUrl ? (
            <img src={previewUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <HMIcon id={profileId} name={label} icon={identity.icon} size={48} />
          )}
        </label>
        <Input
          autoFocus
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          placeholder="Account name"
          onKeyDown={(event) => {
            if (event.key === 'Enter') void handleSave()
          }}
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button onClick={() => void handleSave()} disabled={updateIdentity.isLoading || !label.trim()}>
          {updateIdentity.isLoading ? <Spinner /> : null}
          Save
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
  input: {
    serverUrls: string[]
    selectedAccountId: string | null | undefined
    /**
     * Where to land after creation. The default navigates to the new agent's full page; the
     * assistant sidebar passes a handler that selects the agent in place instead, so creating an
     * agent from the sidebar keeps the user in the sidebar.
     */
    onCreated?: (created: {serverUrl: string; agentId: string}) => void
  }
  onClose: () => void
}) {
  const [selectedServerUrl, setSelectedServerUrl] = useState(input.serverUrls[0] || getDefaultAgentServerUrl() || '')
  const localServerUrl = useLocalAgentServerUrl()
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
  const [reasoningLevel, setReasoningLevel] = useState<ReasoningLevel | undefined>(undefined)
  const [enabledModels, setEnabledModels] = useState<AgentModelRef[]>([])
  const [systemPrompt, setSystemPrompt] = useState<HMBlockNode[]>(() =>
    markdownBlockNodesToHMBlockNodes(parseMarkdown('You are a helpful agent.').tree),
  )
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    setSelectedServerUrl(input.serverUrls[0] || getDefaultAgentServerUrl() || '')
  }, [input.serverUrls])

  // Checked quick-switch entries name providers on one server; a server switch drops them.
  useEffect(() => {
    setEnabledModels([])
  }, [selectedServerUrl])

  useEffect(() => {
    // A refetching list may be stale (e.g. right after adding a provider that was just
    // auto-selected), so only a settled list may override the current selection.
    if (providers.isFetching) return
    const firstProvider = providers.data?.[0]?.name || ''
    if (!providers.data?.some((provider) => provider.name === providerName)) setProviderName(firstProvider)
  }, [providerName, providers.data, providers.isFetching])

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
        systemPrompt: promptBlocksForRequest(systemPrompt),
        modelProvider: providerName,
        model,
        reasoningLevel: coerceReasoningLevel(selectedProviderType, model, reasoningLevel),
        ...(enabledModels.length ? {enabledModels} : {}),
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
      if (input.onCreated) input.onCreated({serverUrl: selectedServerUrl, agentId: result.agentId})
      else navigate({key: 'agent', agentId: result.agentId, serverUrl: selectedServerUrl})
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
        Agent Home
      </SizableText>
      <SelectDropdown
        options={input.serverUrls.map((serverUrl) => ({
          value: serverUrl,
          // The desktop-managed server is a named place; its localhost address is an
          // implementation detail whose port moves between launches.
          label: isLocalAgentServer(serverUrl, localServerUrl.data) ? 'Local' : serverUrl.replace(/^https?:\/\//, ''),
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
      <div className="flex flex-col gap-5 sm:min-w-[520px]">
        <DialogTitle>Create Agent</DialogTitle>
        {serverSelector}
        <div className="border-border bg-muted flex flex-col gap-4 rounded-lg border p-4">
          <DialogDescription>Add a model provider on this server before creating an agent.</DialogDescription>
          <AddModelProviderForm
            serverUrl={selectedServerUrl}
            selectedAccountId={input.selectedAccountId}
            onSaved={setProviderName}
            submitLabel="Add provider"
          />
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 sm:min-w-[520px]">
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
            Model
          </SizableText>
          <ProviderModelSelect
            serverUrl={selectedServerUrl}
            accountUid={input.selectedAccountId}
            value={{provider: providerName, model}}
            onChange={(entry) => {
              setProviderName(entry.provider)
              setModel(entry.model)
              const nextType = providers.data?.find((provider) => provider.name === entry.provider)?.type
              setReasoningLevel((level) => coerceReasoningLevel(nextType, entry.model, level))
            }}
            enabledModels={enabledModels}
            onToggleModel={(entry, enabled) =>
              setEnabledModels((current) => [
                ...current.filter((item) => !(item.provider === entry.provider && item.model === entry.model)),
                ...(enabled ? [entry] : []),
              ])
            }
            onAddProvider={() =>
              addProviderDialog.open({
                serverUrl: selectedServerUrl,
                selectedAccountId: input.selectedAccountId,
                onSaved: setProviderName,
              })
            }
          />
        </label>
        {selectedProviderType && model && modelReasoningSupport(selectedProviderType, model) ? (
          <div className="flex flex-col justify-end gap-1">
            <ReasoningSlider
              providerType={selectedProviderType}
              model={model}
              value={reasoningLevel}
              onChange={setReasoningLevel}
            />
          </div>
        ) : null}
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
      className="flex flex-col gap-5 sm:min-w-[420px]"
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

const WHP_ENABLE_COMMAND = 'Enable-WindowsOptionalFeature -Online -FeatureName HypervisorPlatform'

/**
 * Shown when a Windows user tries to enable execute_code while the Windows Hypervisor Platform
 * feature is off (health codeExecReasonCode 'whp-disabled' from the local server). Explains the
 * one-time setup; after the required restart the tool unlocks on its own, so there is no
 * recheck button.
 */
export function EnableWindowsHypervisorDialog({onClose}: {input: Record<string, never>; onClose: () => void}) {
  async function copyCommand() {
    await navigator.clipboard.writeText(WHP_ENABLE_COMMAND)
    toast.success('Command copied')
  }

  return (
    <div className="flex max-w-lg flex-col gap-4">
      <div className="flex flex-col gap-2">
        <DialogTitle>Turn on Windows Hypervisor Platform</DialogTitle>
        <DialogDescription>
          Code execution runs this agent’s code inside an isolated virtual machine. That needs a built-in Windows
          feature that is currently turned off. Enabling it takes about two minutes and one restart.
        </DialogDescription>
      </div>

      <ol className="flex list-decimal flex-col gap-2 pl-5">
        <li>
          <SizableText size="sm">
            Press the Windows key and search for{' '}
            <SizableText size="sm" weight="bold" asChild>
              <span>Turn Windows features on or off</span>
            </SizableText>
            .
          </SizableText>
        </li>
        <li>
          <SizableText size="sm">
            Check{' '}
            <SizableText size="sm" weight="bold" asChild>
              <span>Windows Hypervisor Platform</span>
            </SizableText>{' '}
            in the list and click OK.
          </SizableText>
        </li>
        <li>
          <SizableText size="sm">Restart your PC — code execution unlocks automatically afterwards.</SizableText>
        </li>
      </ol>

      <div className="flex flex-col gap-1.5">
        <SizableText size="sm" color="muted">
          Prefer the terminal? Run this in PowerShell as Administrator, then restart:
        </SizableText>
        <div className="border-border bg-muted/40 flex items-center gap-2 rounded-lg border px-3 py-2">
          <code className="min-w-0 flex-1 truncate font-mono text-xs">{WHP_ENABLE_COMMAND}</code>
          <Button variant="ghost" size="iconSm" aria-label="Copy command" onClick={() => void copyCommand()}>
            <Copy className="size-3.5" />
          </Button>
        </div>
      </div>

      <SizableText size="xs" color="muted">
        If the feature is greyed out or missing, first enable hardware virtualization (Intel VT-x or AMD-V) in your PC’s
        BIOS/UEFI settings.
      </SizableText>

      <div className="flex justify-end">
        <Button onClick={onClose}>Got it</Button>
      </div>
    </div>
  )
}
