import {useAppContext, useIPC} from '@/app-context'
import {LinkDeviceDialog} from '@/components/link-device-dialog'
import {AccountWallet, WalletPage} from '@/components/payment-settings'
import {
  useAddProvider,
  useAIProviders,
  useAnthropicModels,
  useDeleteProvider,
  useDuplicateProvider,
  useOllamaModels,
  useOpenaiLoginStatus,
  useOpenAIModels,
  useOpenAIModelsForProvider,
  useSelectedProvider,
  useSetSelectedProvider,
  useStartOpenaiLogin,
  useUpdateProvider,
} from '@/models/ai-config'
import {useAutoUpdatePreference} from '@/models/app-settings'
import {useDaemonInfo, useDeleteKey, useExportKey, useListKeys, useSavedMnemonics} from '@/models/daemon'
import {useWriteExperiments} from '@/models/experiments'
import {
  useGatewayUrl,
  useNotifyServiceHost,
  usePushOnCopy,
  usePushOnPublish,
  useSetGatewayUrl,
  useSetNotifyServiceHost,
  useSetPushOnCopy,
  useSetPushOnPublish,
} from '@/models/gateway-settings'
import {usePeerInfo} from '@/models/networking'
import {useSystemThemeWriter} from '@/models/settings'
import {useOpenUrl} from '@/open-url'
import {
  DEFAULT_OPENAI_LOGIN_MODEL,
  getDefaultOpenAIModel,
  normalizeOpenAILoginModel,
  OPENAI_API_KEY_FALLBACK_MODELS,
  OPENAI_LOGIN_MODELS,
} from '@/openai-models'
import {client} from '@/trpc'
import {useUniversalAppContext} from '@shm/shared'
import {COMMIT_HASH, LIGHTNING_API_URL, SEED_HOST_URL, VERSION} from '@shm/shared/constants'
import {getMetadataName} from '@shm/shared/content'
import {useCapabilities, useResource} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {formattedDateLong} from '@shm/shared/utils/date'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Button} from '@shm/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogPortal,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@shm/ui/components/alert-dialog'
import {Badge} from '@shm/ui/components/badge'
import {Checkbox} from '@shm/ui/components/checkbox'
import {Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle} from '@shm/ui/components/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@shm/ui/components/dropdown-menu'
import {Input} from '@shm/ui/components/input'
import {Label} from '@shm/ui/components/label'
import {RadioGroup, RadioGroupItem} from '@shm/ui/components/radio-group'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {Tabs, TabsContent, TabsList, TabsTrigger} from '@shm/ui/components/tabs'
import {Textarea} from '@shm/ui/components/textarea'
import {panelContainerStyles, windowContainerStyles} from '@shm/ui/container'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {Field} from '@shm/ui/form-fields'
import {HMIcon} from '@shm/ui/hm-icon'
import {Copy, ExternalLink, Undo} from '@shm/ui/icons'
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue} from '@shm/ui/select-dropdown'
import {Separator} from '@shm/ui/separator'
import {Spinner} from '@shm/ui/spinner'
import {InfoListHeader, InfoListItem, TableList} from '@shm/ui/table-list'
import {SizableText} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {useAppDialog} from '@shm/ui/universal-dialog'
import {cn} from '@shm/ui/utils'
import {useMutation, useQuery} from '@tanstack/react-query'
import {
  AtSign,
  Bot,
  Check,
  Code2,
  Cog,
  Copy as CopyIcon,
  Download,
  Eye,
  EyeOff,
  Info,
  MoreHorizontal,
  Pencil,
  Plus,
  RadioTower,
  Trash,
  UserRoundPlus,
} from 'lucide-react'
import React, {useEffect, useId, useMemo, useRef, useState} from 'react'

// Fallback model lists when a live model list is not yet available.
const ANTHROPIC_MODELS_FALLBACK = ['claude-opus-4-20250514', 'claude-sonnet-4-20250514', 'claude-haiku-4-20250414']

export default function Settings() {
  const [activeTab, setActiveTab] = useState('accounts')
  return (
    <div className={cn(windowContainerStyles, 'h-full max-h-full min-h-0 w-full overflow-hidden pt-0')}>
      <div className={panelContainerStyles}>
        <Tabs
          onValueChange={(v) => setActiveTab(v)}
          defaultValue="accounts"
          className="flex flex-1 flex-col overflow-hidden"
        >
          <TabsList
            aria-label="Manage your account"
            className="flex h-auto w-full flex-none shrink-0 items-center justify-center rounded-none bg-transparent p-0"
          >
            <Tab value="accounts" active={activeTab === 'accounts'} icon={AtSign} label="Accounts" />
            <Tab value="general" active={activeTab === 'general'} icon={Cog} label="General" />
            <Tab value="gateway" active={activeTab === 'gateway'} icon={RadioTower} label="Gateway" />
            <Tab value="ai-providers" active={activeTab === 'ai-providers'} icon={Bot} label="Assistant" />
            <Tab value="app-info" active={activeTab === 'app-info'} icon={Info} label="App Info" />
            <Tab value="developer" active={activeTab === 'developer'} icon={Code2} label="Developers" />
          </TabsList>
          <Separator />
          <CustomTabsContent value="accounts">
            <AccountKeys />
          </CustomTabsContent>
          <CustomTabsContent value="general">
            <GeneralSettings />
          </CustomTabsContent>
          <CustomTabsContent value="gateway">
            <GatewaySettings />
          </CustomTabsContent>
          <CustomTabsContent value="ai-providers">
            <AIProvidersSettings />
          </CustomTabsContent>
          <CustomTabsContent value="app-info">
            <AppSettings />
          </CustomTabsContent>
          <CustomTabsContent value="developer">
            <DeveloperSettings />
          </CustomTabsContent>
        </Tabs>
      </div>
    </div>
  )
}

export function DeleteDraftLogs() {
  const [isConfirming, setIsConfirming] = useState(false)
  const destroyDraftLogs = useMutation({
    mutationFn: () => client.diagnosis.destroyDraftLogFolder.mutate(),
  })

  if (isConfirming) {
    return (
      <Button
        variant="destructive"
        onClick={() => {
          destroyDraftLogs.mutateAsync().then(() => {
            toast.success('Cleaned up Draft Logs')
            setIsConfirming(false)
          })
        }}
      >
        <Trash className="mr-2 h-4 w-4" />
        Confirm Delete Draft Log Folder?
      </Button>
    )
  }
  return (
    <Button
      variant="destructive"
      onClick={() => {
        setIsConfirming(true)
      }}
    >
      <Trash className="mr-2 h-4 w-4" />
      Delete All Draft Logs
    </Button>
  )
}

export function DeleteAllRecents() {
  const [isConfirming, setIsConfirming] = useState(false)
  const clearAllRecents = useMutation({
    mutationFn: () => client.recents.clearAllRecents.mutate(),
  })

  if (isConfirming) {
    return (
      <Button
        variant="destructive"
        onClick={() => {
          clearAllRecents.mutateAsync().then(() => {
            toast.success('All recent items cleared')
            setIsConfirming(false)
          })
        }}
      >
        <Trash className="mr-2 h-4 w-4" />
        Confirm Delete All Recents?
      </Button>
    )
  }
  return (
    <Button
      variant="destructive"
      onClick={() => {
        setIsConfirming(true)
      }}
    >
      <Trash className="mr-2 h-4 w-4" />
      Delete All Recent Items
    </Button>
  )
}

function GeneralSettings() {
  const [theme, setTheme, isInitialLoading] = useSystemThemeWriter()
  return (
    <div className="flex flex-col gap-4">
      <SizableText size="2xl">General Settings</SizableText>
      {!isInitialLoading && (
        <div className="flex gap-4">
          <Label size="sm">Theme</Label>
          <Select value={theme || 'system'} onValueChange={setTheme}>
            <SelectTrigger className="w-[200px]">
              <SelectValue placeholder="Select a theme" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="system">System Default</SelectItem>
              <SelectItem value="light">Light</SelectItem>
              <SelectItem value="dark">Dark</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}
      <SettingsSection title="Recent Items">
        <SizableText>Clear all recent documents from your search history. This action cannot be undone.</SizableText>
        <div className="flex justify-end">
          <DeleteAllRecents />
        </div>
      </SettingsSection>
    </div>
  )
}

export function DeveloperSettings() {
  const experiments = useUniversalAppContext().experiments
  const writeExperiments = useWriteExperiments()
  const enabledDevTools = experiments?.developerTools
  const enabledPubContentDevMenu = experiments?.pubContentDevMenu
  const embeddingEnabled = experiments?.embeddingEnabled
  const [showEmbeddingConfirm, setShowEmbeddingConfirm] = useState(false)
  const [pendingEmbeddingState, setPendingEmbeddingState] = useState(false)
  const restartDaemon = useMutation({
    mutationFn: (enabled: boolean) => client.restartDaemonWithEmbedding.mutate({embeddingEnabled: enabled}),
    onSuccess: () => {
      toast.success(
        pendingEmbeddingState ? 'Embedding enabled. Daemon restarted.' : 'Embedding disabled. Daemon restarted.',
      )
    },
    onError: (error: unknown) => {
      toast.error('Failed to restart daemon: ' + String(error))
    },
  })
  const openDraftLogs = useMutation({
    mutationFn: () => client.diagnosis.openDraftLogFolder.mutate(),
  })

  function handleEmbeddingToggle() {
    const newState = !embeddingEnabled
    setPendingEmbeddingState(newState)
    setShowEmbeddingConfirm(true)
  }

  function confirmEmbeddingChange() {
    setShowEmbeddingConfirm(false)
    writeExperiments.mutate({embeddingEnabled: pendingEmbeddingState})
    restartDaemon.mutate(pendingEmbeddingState)
  }

  return (
    <>
      <SettingsSection title="Embedding / AI Features">
        <SizableText>
          Enable AI-powered document embeddings for semantic search and related content features. This will restart the
          background service.
        </SizableText>
        <div className="flex justify-between">
          {embeddingEnabled ? <EnabledTag /> : <div />}
          <Button
            size="sm"
            variant={embeddingEnabled ? 'destructive' : 'default'}
            onClick={handleEmbeddingToggle}
            disabled={restartDaemon.isLoading}
          >
            {restartDaemon.isLoading ? (
              <>
                <Spinner size="small" className="mr-2" />
                Restarting...
              </>
            ) : embeddingEnabled ? (
              'Disable Embedding'
            ) : (
              'Enable Embedding'
            )}
          </Button>
        </div>
      </SettingsSection>
      <AlertDialog open={showEmbeddingConfirm} onOpenChange={setShowEmbeddingConfirm}>
        <AlertDialogPortal>
          <AlertDialogContent className="max-w-[500px] gap-4">
            <AlertDialogTitle className="text-xl font-bold">
              {pendingEmbeddingState ? 'Enable Embedding?' : 'Disable Embedding?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {pendingEmbeddingState
                ? 'This will restart the background service with AI embedding features enabled. The app may be briefly unresponsive during restart.'
                : 'This will restart the background service with AI embedding features disabled. The app may be briefly unresponsive during restart.'}
            </AlertDialogDescription>
            <div className="flex justify-end gap-3">
              <AlertDialogCancel asChild>
                <Button variant="ghost">Cancel</Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button variant={pendingEmbeddingState ? 'default' : 'destructive'} onClick={confirmEmbeddingChange}>
                  {pendingEmbeddingState ? 'Enable & Restart' : 'Disable & Restart'}
                </Button>
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialogPortal>
      </AlertDialog>
      <SettingsSection title="Developer Tools">
        <SizableText>
          Adds features across the app for helping diagnose issues. Mostly useful for Seed Developers.
        </SizableText>
        <div className="flex justify-between">
          {enabledDevTools ? <EnabledTag /> : <div />}
          <Button
            size="sm"
            variant={enabledDevTools ? 'destructive' : 'default'}
            onClick={() => {
              writeExperiments.mutate({developerTools: !enabledDevTools})
            }}
          >
            {enabledDevTools ? 'Disable Debug Tools' : `Enable Debug Tools`}
          </Button>
        </div>
      </SettingsSection>
      <SettingsSection title="Publication Content Dev Tools">
        <SizableText>Debug options for the formatting of all publication content</SizableText>
        <div className="flex justify-between">
          {enabledPubContentDevMenu ? <EnabledTag /> : <div />}
          <Button
            size="sm"
            variant={enabledPubContentDevMenu ? 'destructive' : 'default'}
            onClick={() => {
              writeExperiments.mutate({
                pubContentDevMenu: !enabledPubContentDevMenu,
              })
            }}
          >
            {enabledPubContentDevMenu ? 'Disable Publication Debug Panel' : `Enable Publication Debug Panel`}
          </Button>
        </div>
      </SettingsSection>
      <SettingsSection title="Draft Logs">
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => {
              openDraftLogs.mutate()
            }}
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Open Draft Log Folder
          </Button>
          <DeleteDraftLogs />
        </div>
      </SettingsSection>
      {/* <TestURLCheck /> */}
    </>
  )
}

function AccountKeys() {
  const {pickKeyExportFile} = useAppContext()
  const deleteKey = useDeleteKey()
  const exportKey = useExportKey()
  const keys = useListKeys()
  const deleteWords = useMutation({
    mutationFn: (name: string) => client.secureStorage.delete.mutate(name),
  })
  const [walletId, setWalletId] = useState<string | undefined>(undefined)
  const [selectedAccount, setSelectedAccount] = useState<undefined | string>(undefined)
  const [isExportDialogOpen, setIsExportDialogOpen] = useState(false)
  const [exportPassword, setExportPassword] = useState('')
  const [exportError, setExportError] = useState<string | null>(null)

  const selectedKey = keys.data?.find((key) => key.publicKey === selectedAccount)

  const {data: mnemonics, refetch: mnemonicsRefetch} = useSavedMnemonics(selectedKey?.name)

  const selectedAccountId = selectedAccount ? hmId(selectedAccount) : undefined

  const {data: profile} = useResource(selectedAccountId)
  const profileDocument = profile?.type === 'document' ? profile.document : undefined

  const [showWords, setShowWords] = useState<boolean>(false)

  useEffect(() => {
    if (keys.data && keys.data.length) {
      setSelectedAccount((current) => {
        if (current && keys.data.some((key) => key.publicKey === current)) {
          return current
        }
        return keys.data[0].publicKey
      })
    }
  }, [keys.data])

  useEffect(() => {
    if (selectedKey?.name) {
      mnemonicsRefetch()
    }
  }, [mnemonicsRefetch, selectedKey?.name])

  function handleDeleteCurrentAccount() {
    if (!selectedAccount) return
    deleteKey.mutateAsync({accountId: selectedAccount}).then(() => {
      setSelectedAccount(undefined)
      toast.success('Profile removed correctly')
    })
  }

  async function handleExportCurrentAccount(e?: React.FormEvent) {
    e?.preventDefault()
    if (!selectedAccount || !selectedKey) return

    setExportError(null)

    try {
      const filePath = await pickKeyExportFile(`${selectedAccount}.hmkey.json`)
      if (!filePath) return

      await exportKey.mutateAsync({
        name: selectedKey.name,
        filePath,
        password: exportPassword.length > 0 ? exportPassword : undefined,
      })

      setIsExportDialogOpen(false)
      setExportPassword('')
      toast.success(`Key exported to ${filePath}`)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown export error'
      setExportError(message)
      toast.error('Failed to export key: ' + message)
    }
  }

  if (walletId && selectedAccount)
    return (
      <WalletPage
        walletId={walletId}
        accountUid={selectedAccount}
        onClose={() => {
          setWalletId(undefined)
        }}
      />
    )
  return keys.data?.length && selectedAccount ? (
    <div className="flex flex-1 gap-3">
      <div className="flex max-w-[25%] flex-1 flex-col gap-2">
        <div className="flex flex-1 flex-col">
          {keys.data?.map((key) => (
            <KeyItem
              key={key.publicKey}
              item={key.publicKey}
              isActive={key.publicKey == selectedAccount}
              onSelect={() => setSelectedAccount(key.publicKey)}
            />
          ))}
        </div>
      </div>
      <div className={cn('border-border dark:bg-background bg-muted flex flex-[3] flex-col rounded-lg border')}>
        <div className="flex flex-col gap-4 p-4">
          <div className="mb-4 flex flex-col gap-4">
            <div className="grid grid-cols-[96px_minmax(0,1fr)] items-start gap-x-4 gap-y-4">
              <div className="flex w-24 justify-center pt-1">
                {selectedAccountId ? (
                  <HMIcon
                    id={selectedAccountId}
                    name={profileDocument?.metadata?.name}
                    icon={profileDocument?.metadata?.icon}
                    size={80}
                  />
                ) : null}
              </div>
              <div className="flex flex-1 flex-col gap-3">
                <Field id="username" label="Profile Name">
                  <Input disabled value={getMetadataName(profileDocument?.metadata)} />
                </Field>
                <Field id="accountid" label="Account ID">
                  <Input disabled value={selectedAccount} />
                </Field>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 px-3">
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setExportPassword('')
                  setExportError(null)
                  setIsExportDialogOpen(true)
                }}
              >
                <Download className="mr-2 h-4 w-4" />
                Export Key
              </Button>
              <AlertDialog>
                <Tooltip content="Delete account from device">
                  <AlertDialogTrigger asChild>
                    <Button size="sm" variant="destructive">
                      <Trash className="mr-2 h-4 w-4" />
                      Delete Account
                    </Button>
                  </AlertDialogTrigger>
                </Tooltip>
                <AlertDialogPortal>
                  <AlertDialogContent className="max-w-[600px] gap-4">
                    <AlertDialogTitle className="text-2xl font-bold">Delete Account</AlertDialogTitle>
                    <AlertDialogDescription>
                      Are you sure? This account will be removed. Make sure you have saved the Secret Recovery Phrase
                      for this account if you want to recover it later.
                    </AlertDialogDescription>
                    <div className="flex justify-end gap-3">
                      <AlertDialogCancel asChild>
                        <Button variant="ghost">Cancel</Button>
                      </AlertDialogCancel>
                      <AlertDialogAction asChild>
                        <Button variant="destructive" onClick={handleDeleteCurrentAccount}>
                          Delete Permanently
                        </Button>
                      </AlertDialogAction>
                    </div>
                  </AlertDialogContent>
                </AlertDialogPortal>
              </AlertDialog>
            </div>
          </div>
          {mnemonics ? (
            <div className="flex flex-col gap-2">
              <Field label="Secret Recovery Phrase" id="words">
                <div className="flex gap-3">
                  <Textarea
                    className="border-border flex-1 border"
                    rows={4}
                    disabled
                    value={
                      showWords
                        ? Array.isArray(mnemonics)
                          ? mnemonics.join(', ')
                          : mnemonics
                        : '**** **** **** **** **** **** **** **** **** **** **** ****'
                    }
                  />
                  <div className="flex flex-col gap-2">
                    <Button size="sm" variant="outline" onClick={() => setShowWords((v) => !v)}>
                      {showWords ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        console.log('mnemonics', mnemonics)
                        copyTextToClipboard(mnemonics.join(', '))
                        toast.success('Words copied to clipboard')
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </Button>

                    <AlertDialog>
                      <Tooltip content="Delete words from device">
                        <AlertDialogTrigger asChild>
                          <Button size="sm" variant="destructive">
                            <Trash className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                      </Tooltip>
                      <AlertDialogPortal>
                        <AlertDialogContent className="max-w-[600px] gap-4">
                          <AlertDialogTitle className="text-2xl font-bold">Delete Words</AlertDialogTitle>
                          <AlertDialogDescription>
                            Are you really sure? you cant recover the secret words after you delete them. please save
                            them securely in another place before you delete
                          </AlertDialogDescription>
                          <div className="flex justify-end gap-3">
                            <AlertDialogCancel asChild>
                              <Button variant="ghost">Cancel</Button>
                            </AlertDialogCancel>
                            <AlertDialogAction asChild>
                              <Button
                                variant="destructive"
                                onClick={() =>
                                  deleteWords.mutateAsync(selectedKey?.name || selectedAccount).then(() => {
                                    toast.success('Words deleted!')
                                    invalidateQueries([queryKeys.SECURE_STORAGE])
                                  })
                                }
                              >
                                Delete Permanently
                              </Button>
                            </AlertDialogAction>
                          </div>
                        </AlertDialogContent>
                      </AlertDialogPortal>
                    </AlertDialog>
                  </div>
                </div>
              </Field>
            </div>
          ) : null}
          <SettingsSection title="Wallets">
            <AccountWallet accountUid={selectedAccount} onOpenWallet={(walletId) => setWalletId(walletId)} />
          </SettingsSection>
          <SettingsSection title="Linked Devices">
            <LinkedDevices accountUid={selectedAccount} accountName={getMetadataName(profileDocument?.metadata)} />
          </SettingsSection>
        </div>
      </div>
      <Dialog open={isExportDialogOpen} onOpenChange={setIsExportDialogOpen}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader>
            <DialogTitle>Export Key File</DialogTitle>
            <DialogDescription>
              Choose whether to protect the exported `.hmkey.json` file with a password.
            </DialogDescription>
          </DialogHeader>
          <form className="flex flex-col gap-4" onSubmit={handleExportCurrentAccount}>
            <div className="text-muted-foreground rounded-lg border p-3 text-sm">
              Exported key files can grant full account control. Use a password whenever possible and store the file
              securely.
            </div>
            {exportError ? <p className="text-destructive text-sm">{exportError}</p> : null}
            <div className="flex flex-col gap-2">
              <Label htmlFor="export-key-password">Password (optional)</Label>
              <Input
                id="export-key-password"
                type="password"
                value={exportPassword}
                onChange={(event) => setExportPassword(event.currentTarget.value)}
                autoComplete="off"
                placeholder="Only needed for encrypted exports"
              />
            </div>
            <div className="flex justify-end gap-3">
              <Button type="button" variant="ghost" onClick={() => setIsExportDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={exportKey.isPending}>
                {exportKey.isPending ? 'Exporting...' : 'Export Key'}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  ) : (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-4 p-6">
      <div className="bg-muted flex h-20 w-20 items-center justify-center rounded-lg">
        <UserRoundPlus size={50} className="text-muted-foreground" />
      </div>
      <SizableText size="xl">No Accounts Found</SizableText>
      <p className="text-muted-foreground max-w-lg text-center">
        Create a new profile to get started with Seed. You'll need to create a profile to use all the features.
      </p>
      <Button
        className="mt-4"
        size="lg"
        onClick={() => {
          // TODO: Implement wizard event dispatch
          console.log('Create new profile clicked')
        }}
      >
        <Plus className="mr-2 h-4 w-4" />
        Create a new Profile
      </Button>
    </div>
  )
}

function LinkedDevices({accountUid, accountName}: {accountUid: string; accountName: string}) {
  const linkDevice = useAppDialog(LinkDeviceDialog)
  const {data: capabilities} = useCapabilities(hmId(accountUid))
  const devices = capabilities?.filter((c) => c.role === 'agent')
  return (
    <div className="flex flex-col gap-3">
      {devices?.length ? (
        <div className="flex flex-col gap-2">
          {devices.map((d) => (
            <div key={d.accountUid} className="flex flex-row items-center gap-2">
              <Tooltip side="left" content={`Copy Account ID of ${d.label}`}>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    copyTextToClipboard(d.accountUid)
                    toast('Device ID copied to clipboard')
                  }}
                  className="justify-start"
                >
                  <SizableText>{d.label}</SizableText>
                </Button>
              </Tooltip>
              <p className="text-muted-foreground text-sm">
                {/* Removing the timezone name in the timestamp. */}
                {formattedDateLong(d.createTime).replace(/\s+[A-Z]{2,4}[+-]?\d*$/, '')}
              </p>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex">
        <Button
          onClick={() => linkDevice.open({accountUid, accountName})}
          variant="default"
          className="bg-primary text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="mr-2 h-4 w-4" />
          Link Web Session
        </Button>
      </div>
      {linkDevice.content}
    </div>
  )
}

function KeyItem({item, isActive, onSelect}: {item: string; isActive: boolean; onSelect: () => void}) {
  const id = hmId(item)
  const entity = useResource(id)
  const document = entity.data?.type === 'document' ? entity.data.document : undefined
  return (
    <Button variant={isActive ? 'secondary' : 'ghost'} onClick={onSelect} className="h-auto w-full items-start">
      <HMIcon id={id} name={document?.metadata?.name} icon={document?.metadata?.icon} size={24} />
      <div className="flex flex-1 flex-col overflow-hidden">
        <SizableText weight={isActive ? 'bold' : 'normal'} className="h-6 truncate text-left">
          {document?.metadata.name || item}
        </SizableText>
        <SizableText color="muted" size="xs" className="text-left">
          {item.substring(item.length - 8)}
        </SizableText>
      </div>
    </Button>
  )
}

export function ExperimentSection({
  experiment,
  onValue,
  value,
}: {
  id: string
  experiment: ExperimentType
  onValue: (v: boolean) => void
  value: boolean
}) {
  return (
    <div className={cn('dark:bg-background bg-muted flex items-center gap-6 rounded border p-3 px-6')}>
      <SizableText size="2xl">{experiment.emoji}</SizableText>
      <div className="flex flex-1 flex-col gap-3">
        <div className="flex flex-1 gap-3">
          <SizableText size="xl">{experiment.label}</SizableText>
        </div>
        <SizableText>{experiment.description}</SizableText>
        <div className="flex items-center justify-between">
          {value ? <EnabledTag /> : <div />}
          <Button
            variant={value ? 'destructive' : 'default'}
            onClick={() => {
              onValue(!value)
            }}
          >
            {value ? 'Disable Feature' : `Enable Feature`}
          </Button>
        </div>
      </div>
    </div>
  )
}

function EnabledTag() {
  return (
    <div className="flex items-center gap-3 rounded-sm px-3 py-1">
      <Check className="text-brand size-4" />
      <SizableText size="sm" className="text-brand" weight="bold">
        Enabled
      </SizableText>
    </div>
  )
}

type ExperimentType = {
  key: keyof NonNullable<ReturnType<typeof useUniversalAppContext>['experiments']>
  label: string
  emoji: string
  description: string
}
const EXPERIMENTS: ExperimentType[] = []

function GatewaySettings({}: {}) {
  const gatewayUrl = useGatewayUrl()
  const notifyServiceHost = useNotifyServiceHost()

  const setGatewayUrl = useSetGatewayUrl()
  const setNotifyServiceHost = useSetNotifyServiceHost()
  const [gwUrl, setGWUrl] = useState('')
  const [notifyHost, setNotifyHost] = useState('')

  useEffect(() => {
    if (gatewayUrl.data) {
      setGWUrl(gatewayUrl.data)
    }
  }, [gatewayUrl.data])

  useEffect(() => {
    if (notifyServiceHost !== undefined) {
      setNotifyHost(notifyServiceHost)
    }
  }, [notifyServiceHost])

  return (
    <div className="flex flex-col gap-3">
      <TableList>
        <InfoListHeader title="Gateway URL" />
        <TableList.Item>
          <div className="flex w-full gap-3">
            <Input className="flex-1" value={gwUrl} onChangeText={setGWUrl} />
            <Button
              size="sm"
              onClick={() => {
                setGatewayUrl.mutate(gwUrl)
                toast.success('Public Gateway URL changed!')
              }}
            >
              Save
            </Button>
          </div>
        </TableList.Item>
      </TableList>

      <TableList>
        <InfoListHeader title="Notify Service Host" />
        <TableList.Item>
          <div className="flex w-full gap-3">
            <Input className="flex-1" value={notifyHost} onChangeText={setNotifyHost} />
            <Button
              size="sm"
              onClick={() => {
                setNotifyServiceHost.mutate(notifyHost)
                toast.success('Notify Service Host changed!')
              }}
            >
              Save
            </Button>
          </div>
        </TableList.Item>
      </TableList>

      <PushOnPublishSetting />
      <PushOnCopySetting />
    </div>
  )
}

function PushOnCopySetting({}: {}) {
  const pushOnCopy = usePushOnCopy()
  const id = useId()
  const setPushOnCopy = useSetPushOnCopy()

  // Handle loading and error states
  const isLoading = pushOnCopy.isLoading
  const hasError = pushOnCopy.isError
  const currentValue = pushOnCopy.data || 'always' // Default to 'always' if data is undefined

  // Return a loading state instead of null
  if (isLoading) {
    return (
      <TableList>
        <InfoListHeader title="Push on Copy" />
        <TableList.Item>
          <Spinner size="small" />
        </TableList.Item>
      </TableList>
    )
  }

  // Show error state
  if (hasError) {
    return (
      <TableList>
        <InfoListHeader title="Push on Copy" />
        <TableList.Item>
          <div className="flex flex-col">
            <p className="text-destructive">Error loading settings.</p>
            <Button variant="destructive" size="sm" onClick={() => pushOnCopy.refetch()}>
              Retry
            </Button>
          </div>
        </TableList.Item>
      </TableList>
    )
  }

  return (
    <TableList>
      <InfoListHeader title="Push on Copy" />
      <TableList.Item>
        <RadioGroup
          value={currentValue}
          onValueChange={(value) => {
            try {
              // Type guard to ensure we only pass valid values
              const validValue = value === 'always' || value === 'never' || value === 'ask' ? value : 'always'

              setPushOnCopy.mutate(validValue, {
                onSuccess: () => {
                  toast.success('Push on copy changed!')
                },
                onError: (error) => {
                  console.error('Failed to update push on copy setting:', error)
                  toast.error('Failed to update setting. Please try again.')
                },
              })
            } catch (error) {
              console.error('Error updating push on copy setting:', error)
              toast.error('An error occurred while updating the setting.')
            }
          }}
        >
          {[
            {value: 'always', label: 'Always'},
            {value: 'never', label: 'Never'},
            // {value: 'ask', label: 'Ask'},
          ].map((option) => {
            return (
              <div className="flex items-center gap-2" key={option.value}>
                <RadioGroupItem value={option.value} id={`${id}-${option.value}`} />

                <Label htmlFor={`${id}-${option.value}`}>{option.label}</Label>
              </div>
            )
          })}
        </RadioGroup>
      </TableList.Item>
    </TableList>
  )
}

function PushOnPublishSetting({}: {}) {
  const pushOnPublish = usePushOnPublish()
  const id = useId()
  const setPushOnPublish = useSetPushOnPublish()

  // Handle loading and error states
  const isLoading = pushOnPublish.isLoading
  const hasError = pushOnPublish.isError
  const currentValue = pushOnPublish.data || 'always' // Default to 'always' if data is undefined

  // Return a loading state instead of null
  if (isLoading) {
    return (
      <TableList>
        <InfoListHeader title="Push on Publish" />
        <TableList.Item>
          <Spinner size="small" />
        </TableList.Item>
      </TableList>
    )
  }

  // Show error state
  if (hasError) {
    return (
      <TableList>
        <InfoListHeader title="Push on Publish" />
        <TableList.Item>
          <div className="flex flex-col">
            <p className="text-destructive">Error loading settings.</p>
            <Button variant="destructive" size="sm" onClick={() => pushOnPublish.refetch()}>
              Retry
            </Button>
          </div>
        </TableList.Item>
      </TableList>
    )
  }

  return (
    <TableList>
      <InfoListHeader title="Push on Publish" />
      <TableList.Item>
        <RadioGroup
          value={currentValue}
          onValueChange={(value) => {
            try {
              // Type guard to ensure we only pass valid values
              const validValue = value === 'always' || value === 'never' || value === 'ask' ? value : 'always'

              setPushOnPublish.mutate(validValue, {
                onSuccess: () => {
                  toast.success('Push on publish changed!')
                },
                onError: (error) => {
                  console.error('Failed to update push on publish setting:', error)
                  toast.error('Failed to update setting. Please try again.')
                },
              })
            } catch (error) {
              console.error('Error updating push on publish setting:', error)
              toast.error('An error occurred while updating the setting.')
            }
          }}
        >
          {[
            {value: 'always', label: 'Always'},
            {value: 'never', label: 'Never'},
            // {value: 'ask', label: 'Ask'},
          ].map((option) => {
            return (
              <div className="flex items-center gap-2" key={option.value}>
                <RadioGroupItem value={option.value} id={`${id}-${option.value}`} />

                <Label htmlFor={`${id}-${option.value}`}>{option.label}</Label>
              </div>
            )
          })}
        </RadioGroup>
      </TableList.Item>
    </TableList>
  )
}

function DeviceItem({id}: {id: string}) {
  let {data} = usePeerInfo(id)
  let {data: current} = useDaemonInfo()

  let isCurrent = useMemo(() => {
    if (!current?.peerId) return false

    return current.peerId == id
  }, [id, current])

  return (
    <TableList>
      <InfoListHeader
        title={id.substring(id.length - 10)}
        right={
          isCurrent && (
            <Button size="xs" className="font-bold" disabled>
              current device
            </Button>
          )
        }
      />

      <InfoListItem
        label="Peer ID"
        value={id}
        onCopy={() => {
          copyTextToClipboard(id)
          toast.success('Copied peerID successfully')
        }}
      />

      <Separator />

      <InfoListItem
        label="Device Address"
        value={data?.addrs.sort().join(', ')}
        onCopy={() => {
          data?.addrs && copyTextToClipboard(data.addrs.sort().join(', '))
          toast.success('Copied device address successfully')
        }}
      />
    </TableList>
  )
}

function AppSettings() {
  const ipc = useIPC()
  // @ts-expect-error versions is not typed
  const versions = useMemo(() => ipc.versions(), [ipc])
  const appInfo = useQuery({
    queryKey: ['app-info'],
    queryFn: () => client.getAppInfo.query(),
  }).data
  const openUrl = useOpenUrl()
  const {value: autoUpdate, setAutoUpdate} = useAutoUpdatePreference()
  const daemonInfo = useQuery({
    queryKey: ['daemon-info'],
    queryFn: () => client.getDaemonInfo.query(),
  }).data
  let goBuildInfo = ''
  if (daemonInfo?.errors.length) {
    goBuildInfo = daemonInfo.errors.join('\n')
  } else if (daemonInfo?.daemonVersion) {
    goBuildInfo = daemonInfo.daemonVersion
  }
  const {data: deviceInfo} = useDaemonInfo()
  const peer = usePeerInfo(deviceInfo?.peerId)
  const addrs = peer.data?.addrs?.join('\n')

  return (
    <div className="flex flex-col gap-3">
      <TableList>
        <InfoListHeader title="Auto Update" />
        <TableList.Item className="items-center">
          <SizableText size="sm" className="w-[140px] min-w-[140px] flex-none">
            Check for updates?
          </SizableText>
          <div className="flex flex-1">
            <div className="flex flex-1">
              <Checkbox
                id="auto-update"
                checked={autoUpdate.data == 'true'}
                onCheckedChange={(newVal) => {
                  setAutoUpdate(newVal ? 'true' : 'false')
                }}
              />
            </div>
            <Tooltip content="Check for app updates automatically on Launch">
              <Button size="sm" variant="ghost" className="bg-transparent">
                <Info className="h-4 w-4" />
              </Button>
            </Tooltip>
          </div>
        </TableList.Item>
      </TableList>
      <TableList>
        <InfoListHeader
          title="Peer Info"
          right={
            addrs ? (
              <Tooltip content="Copy routing info so others can connect to you">
                <Button
                  size="sm"
                  onClick={() => {
                    navigator.clipboard.writeText(addrs)
                    toast.success('Copied Routing Address successfully')
                  }}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Addresses
                </Button>
              </Tooltip>
            ) : null
          }
        />
        <InfoListItem label="Peer ID" value={deviceInfo?.peerId} />
        <InfoListItem label="Protocol ID" value={deviceInfo?.protocolId} />
        <InfoListItem label="Addresses" value={addrs?.split('\n')} />
      </TableList>

      <TableList>
        <InfoListHeader title="User Data" />
        <InfoListItem
          label="Data Directory"
          value={appInfo?.dataDir}
          onCopy={() => {
            if (appInfo?.dataDir) {
              copyTextToClipboard(appInfo?.dataDir)
              toast.success('Copied path successfully')
            }
          }}
          onOpen={() => {
            if (appInfo?.dataDir) {
              ipc.send('open_path', appInfo?.dataDir)
              // openUrl(`file://${appInfo?.dataDir}`)
            }
          }}
        />
        <Separator />
        <InfoListItem
          label="Log Directory"
          value={appInfo?.loggingDir}
          onCopy={() => {
            if (appInfo?.loggingDir) {
              copyTextToClipboard(appInfo?.loggingDir)
              toast.success('Copied path successfully')
            }
          }}
          onOpen={() => {
            if (appInfo?.loggingDir) {
              ipc.send('open_path', appInfo?.loggingDir)
              // openUrl(`file://${appInfo?.loggingDir}`)
            }
          }}
        />
      </TableList>
      <TableList>
        <InfoListHeader
          title="Bundle Information"
          right={
            <Tooltip content="Copy App Info for Developers">
              <Button
                size="sm"
                onClick={() => {
                  copyTextToClipboard(`
                    App Version: ${VERSION}
                    Electron Version: ${versions.electron}
                    Chrome Version: ${versions.chrome}
                    Node Version: ${versions.node}
                    Commit Hash: ${COMMIT_HASH.slice(0, 8)}
                    Go Build: ${goBuildInfo}
                    `)
                  toast.success('Copied Build Info successfully')
                }}
              >
                <Copy className="mr-2 h-4 w-4" />
                Copy Debug Info
              </Button>
            </Tooltip>
          }
        />
        <InfoListItem label="App Version" value={VERSION} />
        <Separator />
        <InfoListItem label="Electron Version" value={versions.electron} />
        <Separator />
        <InfoListItem label="Chrome Version" value={versions.chrome} />
        <Separator />
        <InfoListItem label="Node Version" value={versions.node} />
        <Separator />
        <InfoListItem
          label="Commit Hash"
          value={COMMIT_HASH}
          onOpen={() => {
            openUrl(`https://github.com/seed-hypermedia/seed/commit/${COMMIT_HASH}`)
          }}
        />
        <Separator />
        <InfoListItem label="Go Build Info" value={goBuildInfo?.split('\n')} />
        <Separator />
        <InfoListItem label="Seed Host URL" value={SEED_HOST_URL} />
        <Separator />
        <InfoListItem label="Lightning URL" value={LIGHTNING_API_URL} />
      </TableList>
    </div>
  )
}

const CustomTabsContent = (props: React.ComponentProps<typeof TabsContent>) => {
  return (
    <TabsContent className="flex flex-1 flex-col gap-3 overflow-hidden" {...props}>
      <ScrollArea>
        <div className="flex flex-1 flex-col gap-4 p-4 pb-5">{props.children}</div>
      </ScrollArea>
    </TabsContent>
  )
}

function Tab(
  props: React.ComponentProps<typeof TabsTrigger> & {
    icon: any
    label: string
    active: boolean
  },
) {
  const {icon: Icon, label, active, ...rest} = props
  return (
    <TabsTrigger
      data-testid={`tab-${props.value}`}
      className="flex h-auto cursor-default flex-col items-center justify-center gap-2 rounded-none border-0 bg-transparent p-4 pb-3 text-sm font-medium hover:bg-black/5 data-[state=active]:shadow-none dark:hover:bg-white/10"
      {...rest}
    >
      <Icon className={cn('size-5', active ? 'text-brand-2' : 'text-muted-foreground')} />
      <SizableText size="xs" className={cn('flex-1', active ? 'text-brand-2' : 'text-muted-foreground')}>
        {label}
      </SizableText>
    </TabsTrigger>
  )
}

function SettingsSection({title, children}: React.PropsWithChildren<{title: string}>) {
  return (
    <div className={cn('dark:bg-background bg-muted flex flex-col gap-3 rounded p-3')}>
      <SizableText size="2xl">{title}</SizableText>
      {children}
    </div>
  )
}

// AI Providers Settings

type ProviderFormData = {
  label: string
  type: 'openai' | 'anthropic' | 'ollama'
  model: string
  authMode: 'apiKey' | 'login'
  apiKey: string
  baseUrl: string
  openaiAuth?: {
    email?: string
    chatgptAccountId?: string
    chatgptPlanType?: string
    lastRefreshAt?: string
  }
}

type ProviderListItem = {
  id: string
  label: string
  type: ProviderFormData['type']
  model: string
  authMode?: ProviderFormData['authMode']
  apiKey?: string
  baseUrl?: string
  openaiAuth?: ProviderFormData['openaiAuth']
}

const PROVIDER_TYPE_META: Record<
  ProviderFormData['type'],
  {
    label: string
    description: string
    model: string
    baseUrl: string
  }
> = {
  openai: {
    label: 'OpenAI',
    description: 'ChatGPT Pro sign-in or OpenAI API keys.',
    model: DEFAULT_OPENAI_LOGIN_MODEL,
    baseUrl: '',
  },
  anthropic: {
    label: 'Anthropic',
    description: 'Claude models over the Anthropic API.',
    model: 'claude-sonnet-4-20250514',
    baseUrl: '',
  },
  ollama: {
    label: 'Ollama',
    description: 'Local models from an Ollama server.',
    model: 'llama3',
    baseUrl: 'http://localhost:11434',
  },
}

function createProviderForm(type: ProviderFormData['type'] = 'openai'): ProviderFormData {
  const preset = PROVIDER_TYPE_META[type]
  return {
    label: preset.label,
    type,
    model: preset.model,
    authMode: type === 'openai' ? 'login' : 'apiKey',
    apiKey: '',
    baseUrl: preset.baseUrl,
    openaiAuth: undefined,
  }
}

function getGeneratedProviderLabel(type: ProviderFormData['type'], model: string) {
  const label = PROVIDER_TYPE_META[type].label
  const normalizedModel = model.trim() || PROVIDER_TYPE_META[type].model
  return `${label} - ${normalizedModel}`
}

function buildProviderMutationInput(providerId: string, form: ProviderFormData) {
  return {
    id: providerId,
    label: form.label.trim() || getGeneratedProviderLabel(form.type, form.model),
    type: form.type,
    model: form.model,
    apiKey: form.type === 'openai' && form.authMode === 'login' ? undefined : form.apiKey || undefined,
    baseUrl: form.baseUrl || undefined,
    authMode: form.type === 'openai' ? form.authMode : undefined,
  }
}

function getProviderConnectionSummary(provider: ProviderListItem) {
  if (provider.type === 'openai' && provider.authMode === 'login') {
    if (provider.openaiAuth?.email) return `Connected as ${provider.openaiAuth.email}`
    if (provider.openaiAuth?.chatgptPlanType) return `Connected (${provider.openaiAuth.chatgptPlanType})`
    if (provider.openaiAuth) return 'Connected with ChatGPT Pro'
    return 'ChatGPT Pro sign-in required'
  }
  if (provider.type === 'ollama') {
    return provider.baseUrl ? `Endpoint ${provider.baseUrl}` : 'Local Ollama endpoint'
  }
  return provider.apiKey ? 'API key configured' : 'API key required'
}

function ProviderTypeCard({
  label,
  description,
  active,
  onClick,
  badge,
}: {
  label: string
  description: string
  active?: boolean
  onClick: () => void
  badge?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex min-h-[108px] flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors',
        active ? 'border-primary bg-background shadow-sm' : 'bg-background/60 hover:border-border hover:bg-background',
      )}
    >
      <div className="flex w-full items-center justify-between gap-2">
        <SizableText size="sm" weight="bold">
          {label}
        </SizableText>
        {badge ? <Badge variant={active ? 'secondary' : 'outline'}>{badge}</Badge> : null}
      </div>
      <SizableText size="xs" className="text-muted-foreground">
        {description}
      </SizableText>
    </button>
  )
}

function ProviderFormSection({
  title,
  description,
  action,
  children,
}: React.PropsWithChildren<{title: string; description?: string | null; action?: React.ReactNode}>) {
  return (
    <div className="bg-background/70 flex flex-col gap-4 rounded-lg border p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <SizableText size="sm" weight="bold">
            {title}
          </SizableText>
          {description ? (
            <SizableText size="xs" className="text-muted-foreground">
              {description}
            </SizableText>
          ) : null}
        </div>
        {action}
      </div>
      {children}
    </div>
  )
}

type AddProviderDialogInput = ProviderFormData['type'] | 'choose'

function AddProviderDialog({input, onClose}: {input: AddProviderDialogInput; onClose: () => void}) {
  const isSpecificProvider = input !== 'choose'
  const initialType = input === 'choose' ? 'openai' : input

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <DialogTitle>
          {isSpecificProvider ? `Add ${PROVIDER_TYPE_META[input].label} Provider` : 'Add Provider'}
        </DialogTitle>
        <DialogDescription>
          {isSpecificProvider
            ? 'Complete the remaining provider details here.'
            : 'Choose a provider and complete the remaining details here.'}
        </DialogDescription>
      </div>

      <ProviderForm
        initialType={initialType}
        onSave={onClose}
        onCancel={onClose}
        showTypeSelector={!isSpecificProvider}
        requireExplicitOpenAIAuthModeSelection
      />
    </div>
  )
}

function ProviderSetupOverview({
  providers,
  selectedProviderLabel,
  onCreate,
}: {
  providers: ProviderListItem[]
  selectedProviderLabel: string | null
  onCreate: (type: ProviderFormData['type']) => void
}) {
  return (
    <div className="flex h-full flex-col gap-4">
      <div className="flex flex-col gap-2">
        <SizableText size="2xl">
          {providers.length
            ? 'Select a provider to edit or start a new one.'
            : 'Set up the assistant with a model provider.'}
        </SizableText>
        <SizableText size="sm" className="text-muted-foreground max-w-[720px]">
          OpenAI supports ChatGPT Pro sign-in or API keys. Anthropic uses API keys. Ollama connects to a local server
          running on this machine or your network.
        </SizableText>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {(['openai', 'anthropic', 'ollama'] as const).map((type) => (
          <ProviderTypeCard
            key={type}
            label={PROVIDER_TYPE_META[type].label}
            description={PROVIDER_TYPE_META[type].description}
            badge={type === 'openai' ? 'Recommended' : undefined}
            onClick={() => onCreate(type)}
          />
        ))}
      </div>

      {providers.length ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="bg-background/70 flex flex-col gap-1 rounded-lg border p-4">
            <SizableText size="xs" className="text-muted-foreground">
              Configured Providers
            </SizableText>
            <SizableText size="2xl">{providers.length}</SizableText>
          </div>
          <div className="bg-background/70 flex flex-col gap-1 rounded-lg border p-4">
            <SizableText size="xs" className="text-muted-foreground">
              Default Provider
            </SizableText>
            <SizableText size="sm" weight="bold">
              {selectedProviderLabel || 'Not set'}
            </SizableText>
          </div>
        </div>
      ) : null}
    </div>
  )
}

function ProviderListActions({
  provider,
  isDefault,
  onEdit,
  onDuplicate,
  onDelete,
  onSetDefault,
}: {
  provider: ProviderListItem
  isDefault: boolean
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onSetDefault: () => void
}) {
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false)

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="iconSm"
            variant="ghost"
            aria-label={`Open actions for ${provider.label}`}
            onClick={(event) => event.stopPropagation()}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-44">
          <DropdownMenuItem onSelect={onEdit}>
            <Pencil className="size-4" />
            Edit
          </DropdownMenuItem>
          {!isDefault ? (
            <DropdownMenuItem onSelect={onSetDefault}>
              <Check className="size-4" />
              Use by default
            </DropdownMenuItem>
          ) : null}
          <DropdownMenuItem onSelect={onDuplicate}>
            <CopyIcon className="size-4" />
            Duplicate
          </DropdownMenuItem>
          <DropdownMenuItem
            className="text-destructive"
            onSelect={(event) => {
              event.preventDefault()
              setIsDeleteDialogOpen(true)
            }}
          >
            <Trash className="size-4" />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <AlertDialog open={isDeleteDialogOpen} onOpenChange={setIsDeleteDialogOpen}>
        <AlertDialogPortal>
          <AlertDialogContent className="max-w-[460px] gap-4">
            <AlertDialogTitle className="text-xl font-bold">Delete Provider?</AlertDialogTitle>
            <AlertDialogDescription>
              {provider.label} will be removed from Assistant Providers. Existing chats keep their history, but future
              runs will no longer use this provider.
            </AlertDialogDescription>
            <div className="flex justify-end gap-2">
              <AlertDialogCancel asChild>
                <Button size="sm" variant="ghost">
                  Cancel
                </Button>
              </AlertDialogCancel>
              <AlertDialogAction asChild>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={() => {
                    onDelete()
                    setIsDeleteDialogOpen(false)
                  }}
                >
                  Delete Provider
                </Button>
              </AlertDialogAction>
            </div>
          </AlertDialogContent>
        </AlertDialogPortal>
      </AlertDialog>
    </>
  )
}

function ProviderListRow({
  provider,
  isActive,
  isDefault,
  onSelect,
  onEdit,
  onDuplicate,
  onDelete,
  onSetDefault,
}: {
  provider: ProviderListItem
  isActive: boolean
  isDefault: boolean
  onSelect: () => void
  onEdit: () => void
  onDuplicate: () => void
  onDelete: () => void
  onSetDefault: () => void
}) {
  return (
    <div
      className={cn(
        'flex items-start gap-2 rounded-lg border p-3 transition-colors',
        isActive
          ? 'border-primary bg-background shadow-sm'
          : 'bg-background/60 hover:border-border hover:bg-background',
      )}
    >
      <button type="button" className="flex min-w-0 flex-1 flex-col gap-2 text-left" onClick={onSelect}>
        <div className="flex flex-wrap items-center gap-2">
          <SizableText size="sm" weight="bold">
            {provider.label}
          </SizableText>
          <Badge variant="outline">{PROVIDER_TYPE_META[provider.type].label}</Badge>
          {provider.type === 'openai' ? (
            <Badge variant={provider.authMode === 'login' ? 'secondary' : 'outline'}>
              {provider.authMode === 'login' ? 'ChatGPT Pro' : 'API Key'}
            </Badge>
          ) : null}
          {isDefault ? <Badge variant="accent">Default</Badge> : null}
        </div>
        <div className="flex flex-col gap-1">
          <SizableText size="xs" className="text-muted-foreground">
            {provider.model}
          </SizableText>
          <SizableText size="xs" className="text-muted-foreground">
            {getProviderConnectionSummary(provider)}
          </SizableText>
        </div>
      </button>

      <ProviderListActions
        provider={provider}
        isDefault={isDefault}
        onEdit={onEdit}
        onDuplicate={onDuplicate}
        onDelete={onDelete}
        onSetDefault={onSetDefault}
      />
    </div>
  )
}

/** Renders the assistant provider settings section. */
export function AIProvidersSettings() {
  const providers = useAIProviders()
  const deleteProvider = useDeleteProvider()
  const duplicateProvider = useDuplicateProvider()
  const selectedProvider = useSelectedProvider()
  const setSelectedProvider = useSetSelectedProvider()
  const [editingId, setEditingId] = useState<string | null>(null)
  const addProviderDialog = useAppDialog(AddProviderDialog, {
    className: 'w-[min(920px,calc(100vw-2rem))] max-h-[90vh]',
  })
  const providerItems = (providers.data || []) as ProviderListItem[]
  const selectedProviderId = selectedProvider.data?.id || null

  useEffect(() => {
    if (!providerItems.length) {
      if (editingId) setEditingId(null)
      return
    }

    if (editingId && providerItems.some((provider) => provider.id === editingId)) {
      return
    }

    setEditingId(selectedProviderId || providerItems[0]?.id || null)
  }, [editingId, providerItems, selectedProviderId])

  function beginAdd(type: AddProviderDialogInput = 'choose') {
    addProviderDialog.open(type)
  }

  function beginEdit(providerId: string) {
    setEditingId(providerId)
  }

  if (!providerItems.length) {
    return (
      <SettingsSection title="Assistant Providers">
        <ProviderSetupOverview
          providers={providerItems}
          selectedProviderLabel={selectedProvider.data?.label || null}
          onCreate={beginAdd}
        />
        {addProviderDialog.content}
      </SettingsSection>
    )
  }

  return (
    <SettingsSection title="Assistant Providers">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-2">
          <SizableText size="sm" className="text-muted-foreground max-w-[720px]">
            Configure the model backends the assistant can use. OpenAI supports ChatGPT Pro sign-in or API keys,
            Anthropic uses API keys, and Ollama connects to a local model server.
          </SizableText>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {providerItems.length} provider{providerItems.length === 1 ? '' : 's'}
            </Badge>
            {selectedProvider.data ? <Badge variant="secondary">Default: {selectedProvider.data.label}</Badge> : null}
          </div>
        </div>
        <Button size="sm" onClick={() => beginAdd()}>
          <Plus className="mr-2 h-4 w-4" />
          Add Provider
        </Button>
      </div>

      <div className="grid gap-4 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="bg-background/70 flex flex-col rounded-lg border">
          <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
            <div className="flex flex-col gap-1">
              <SizableText size="sm" weight="bold">
                Configured Providers
              </SizableText>
              <SizableText size="xs" className="text-muted-foreground">
                Choose a provider to edit it or set it as the default assistant backend.
              </SizableText>
            </div>
            <Badge variant="outline">{providerItems.length}</Badge>
          </div>

          <div className="flex flex-col gap-2 p-3">
            {providerItems.length ? (
              providerItems.map((provider) => (
                <ProviderListRow
                  key={provider.id}
                  provider={provider}
                  isActive={editingId === provider.id}
                  isDefault={selectedProviderId === provider.id}
                  onSelect={() => beginEdit(provider.id)}
                  onEdit={() => beginEdit(provider.id)}
                  onDuplicate={() =>
                    duplicateProvider.mutate(provider.id, {
                      onSuccess: (duplicate) => {
                        setEditingId(duplicate.id)
                      },
                    })
                  }
                  onDelete={() => {
                    if (editingId === provider.id) {
                      const fallbackProviderId =
                        providerItems.find((item) => item.id !== provider.id && item.id === selectedProviderId)?.id ||
                        providerItems.find((item) => item.id !== provider.id)?.id ||
                        null
                      setEditingId(fallbackProviderId)
                    }
                    deleteProvider.mutate(provider.id)
                  }}
                  onSetDefault={() => setSelectedProvider.mutate(provider.id)}
                />
              ))
            ) : (
              <div className="flex flex-col gap-2 rounded-lg border border-dashed p-4">
                <SizableText size="sm" weight="bold">
                  No providers configured yet.
                </SizableText>
                <SizableText size="xs" className="text-muted-foreground">
                  Start with OpenAI if you want ChatGPT Pro sign-in, or pick another provider on the right.
                </SizableText>
              </div>
            )}
          </div>
        </div>

        {editingId ? (
          <ProviderEditForm
            key={editingId}
            providerId={editingId}
            onSave={() => setEditingId(null)}
            onCancel={() => setEditingId(null)}
          />
        ) : null}
      </div>
      {addProviderDialog.content}
    </SettingsSection>
  )
}

function ProviderForm({
  initialType = 'openai',
  onSave,
  onCancel,
  showTypeSelector = true,
  requireExplicitOpenAIAuthModeSelection = false,
}: {
  initialType?: ProviderFormData['type']
  onSave: () => void
  onCancel: () => void
  showTypeSelector?: boolean
  requireExplicitOpenAIAuthModeSelection?: boolean
}) {
  const addProvider = useAddProvider()
  const updateProvider = useUpdateProvider()
  const deleteProvider = useDeleteProvider()
  const [form, setForm] = useState<ProviderFormData>(() => createProviderForm(initialType))
  const [draftProviderId, setDraftProviderId] = useState<string | null>(null)

  function handleTypeChange(type: 'openai' | 'anthropic' | 'ollama') {
    const preset = PROVIDER_TYPE_META[type]
    setForm((current) => ({
      ...current,
      type,
      label: current.label || preset.label,
      model: preset.model,
      baseUrl: preset.baseUrl,
      apiKey: type === 'ollama' ? '' : current.apiKey,
      authMode: type === 'openai' ? (current.type === 'openai' ? current.authMode : 'login') : 'apiKey',
      openaiAuth: type === 'openai' ? current.openaiAuth : undefined,
    }))
  }

  function handleSave() {
    if (form.type === 'openai' && form.authMode === 'login' && !form.openaiAuth) {
      toast.error('Start ChatGPT Pro Sign In first.')
      return
    }

    const input = {
      label: getGeneratedProviderLabel(form.type, form.model),
      type: form.type,
      model: form.model || undefined,
      apiKey: form.type === 'openai' && form.authMode === 'login' ? undefined : form.apiKey || undefined,
      baseUrl: form.baseUrl || undefined,
      authMode: form.type === 'openai' ? form.authMode : undefined,
    }

    if (draftProviderId) {
      updateProvider.mutate(
        {
          id: draftProviderId,
          ...input,
        },
        {onSuccess: onSave},
      )
      return
    }

    addProvider.mutate(input, {onSuccess: onSave})
  }

  function handleCancel() {
    if (draftProviderId) {
      deleteProvider.mutate(draftProviderId, {
        onSuccess: onCancel,
      })
      return
    }
    onCancel()
  }

  return (
    <ProviderFormFields
      providerId={draftProviderId}
      form={form}
      setForm={setForm}
      showLabelField={false}
      showTypeSelector={showTypeSelector}
      requireExplicitOpenAIAuthModeSelection={requireExplicitOpenAIAuthModeSelection}
      onTypeChange={handleTypeChange}
      onProviderIdChange={setDraftProviderId}
      onLoginProviderAdded={onSave}
      onSave={handleSave}
      onCancel={handleCancel}
      saveLabel={
        form.type === 'openai' && form.authMode === 'login'
          ? 'Finish Setup'
          : draftProviderId
          ? 'Finish Setup'
          : 'Add Provider'
      }
      saveDisabled={form.type === 'openai' && form.authMode === 'login' && !form.openaiAuth}
      isSaving={addProvider.isLoading || updateProvider.isLoading || deleteProvider.isLoading}
    />
  )
}

function ProviderEditForm({
  providerId,
  onSave,
  onCancel,
}: {
  providerId: string
  onSave: () => void
  onCancel: () => void
}) {
  const updateProvider = useUpdateProvider()
  const providerQuery = useQuery({
    queryKey: ['AI_PROVIDER_EDIT', providerId],
    queryFn: () => client.aiConfig.getProvider.query(providerId),
  })
  const [form, setForm] = useState<ProviderFormData | null>(null)
  const lastSavedInputRef = useRef<string | null>(null)
  const pendingInputRef = useRef<string | null>(null)

  useEffect(() => {
    if (providerQuery.data && !form) {
      const initialForm = {
        label: providerQuery.data.label,
        type: providerQuery.data.type as ProviderFormData['type'],
        model: providerQuery.data.model,
        apiKey: providerQuery.data.apiKey || '',
        baseUrl: providerQuery.data.baseUrl || '',
        authMode:
          providerQuery.data.type === 'openai'
            ? (providerQuery.data.authMode as ProviderFormData['authMode']) || 'apiKey'
            : 'apiKey',
        openaiAuth:
          providerQuery.data.type === 'openai'
            ? (providerQuery.data.openaiAuth as ProviderFormData['openaiAuth'] | undefined)
            : undefined,
      }
      lastSavedInputRef.current = JSON.stringify(buildProviderMutationInput(providerId, initialForm))
      setForm(initialForm)
    }
  }, [form, providerId, providerQuery.data])

  useEffect(() => {
    if (!form || !lastSavedInputRef.current) return
    const nextInput = buildProviderMutationInput(providerId, form)
    const serializedInput = JSON.stringify(nextInput)

    if (serializedInput === lastSavedInputRef.current || serializedInput === pendingInputRef.current) {
      return
    }

    const timeout = window.setTimeout(() => {
      pendingInputRef.current = serializedInput
      updateProvider.mutate(nextInput, {
        onSuccess: () => {
          lastSavedInputRef.current = serializedInput
          if (pendingInputRef.current === serializedInput) {
            pendingInputRef.current = null
          }
        },
        onError: () => {
          if (pendingInputRef.current === serializedInput) {
            pendingInputRef.current = null
          }
        },
      })
    }, 250)

    return () => window.clearTimeout(timeout)
  }, [form, providerId, updateProvider])

  if (!form) return <Spinner size="small" />

  const setNonNullForm: React.Dispatch<React.SetStateAction<ProviderFormData>> = (nextForm) => {
    setForm((current) => {
      if (!current) return current
      return typeof nextForm === 'function'
        ? (nextForm as (current: ProviderFormData) => ProviderFormData)(current)
        : nextForm
    })
  }

  function handleTypeChange(type: 'openai' | 'anthropic' | 'ollama') {
    const preset = PROVIDER_TYPE_META[type]
    setNonNullForm((current) => {
      if (!current) return current
      return {
        ...current,
        type,
        label: current.label || preset.label,
        model: preset.model,
        baseUrl: preset.baseUrl,
        apiKey: type === 'ollama' ? '' : current.apiKey,
        authMode: type === 'openai' ? (current.type === 'openai' ? current.authMode : 'login') : 'apiKey',
        openaiAuth: type === 'openai' ? current.openaiAuth : undefined,
      }
    })
  }

  return (
    <ProviderFormFields
      providerId={providerId}
      form={form}
      setForm={setNonNullForm}
      showTypeSelector={false}
      onTypeChange={handleTypeChange}
      showActions={false}
      onSave={onSave}
      onCancel={onCancel}
      saveLabel=""
      isSaving={updateProvider.isLoading}
    />
  )
}

function ProviderFormFields({
  providerId,
  form,
  setForm,
  showActions = true,
  showLabelField = true,
  showTypeSelector = true,
  requireExplicitOpenAIAuthModeSelection = false,
  onTypeChange,
  onProviderIdChange,
  onLoginProviderAdded,
  onSave,
  onCancel,
  saveLabel,
  saveDisabled,
  isSaving,
}: {
  providerId: string | null
  form: ProviderFormData
  setForm: React.Dispatch<React.SetStateAction<ProviderFormData>>
  showActions?: boolean
  showLabelField?: boolean
  showTypeSelector?: boolean
  requireExplicitOpenAIAuthModeSelection?: boolean
  onTypeChange: (type: 'openai' | 'anthropic' | 'ollama') => void
  onProviderIdChange?: (providerId: string) => void
  onLoginProviderAdded?: (providerId: string) => void
  onSave: () => void
  onCancel: () => void
  saveLabel: string
  saveDisabled?: boolean
  isSaving: boolean
}) {
  const openUrl = useOpenUrl()
  const ollamaModels = useOllamaModels(form.type === 'ollama' ? form.baseUrl || 'http://localhost:11434' : null)
  const openaiModelsApiKey = useOpenAIModels(
    form.type === 'openai' && form.authMode === 'apiKey' ? form.apiKey || null : null,
  )
  const openaiModelsProvider = useOpenAIModelsForProvider(
    form.type === 'openai' && form.authMode === 'login' && providerId ? providerId : null,
  )
  const startOpenaiLogin = useStartOpenaiLogin()
  const [openaiLoginSessionId, setOpenaiLoginSessionId] = useState<string | null>(null)
  const [openaiLoginUserCode, setOpenaiLoginUserCode] = useState<string | null>(null)
  const [openaiLoginError, setOpenaiLoginError] = useState<string | null>(null)
  const [isOpenAIAuthModeCommitted, setIsOpenAIAuthModeCommitted] = useState(
    () => !(requireExplicitOpenAIAuthModeSelection && form.type === 'openai'),
  )
  const openaiLoginStatus = useOpenaiLoginStatus(openaiLoginSessionId)
  const anthropicModels = useAnthropicModels(form.type === 'anthropic' ? form.apiKey || null : null)
  const [showApiKey, setShowApiKey] = useState(false)
  const openaiModels = form.authMode === 'login' ? openaiModelsProvider : openaiModelsApiKey
  const activeOpenaiUserCode = openaiLoginStatus.data?.userCode || openaiLoginUserCode
  const openaiVerificationUrl = openaiLoginStatus.data?.verificationUrl || 'https://auth.openai.com/codex/device'
  const isAddProviderFlow = !!onProviderIdChange || !!onLoginProviderAdded
  const isOpenAIAuthModeChoicePending =
    requireExplicitOpenAIAuthModeSelection && form.type === 'openai' && !isOpenAIAuthModeCommitted
  const isOpenAILoginMissingConnection =
    form.type === 'openai' && isOpenAIAuthModeCommitted && form.authMode === 'login' && !form.openaiAuth
  const isOpenAILoginPending =
    startOpenaiLogin.isLoading || openaiLoginStatus.data?.status === 'pending' || !!openaiLoginSessionId
  const hasOpenAIApiKey = form.apiKey.trim().length > 10
  const hasAnthropicApiKey = form.apiKey.trim().length > 10
  const hasOllamaBaseUrl = form.baseUrl.trim().length > 0
  const isAddProviderConnectionChecking =
    isAddProviderFlow &&
    (form.type === 'openai'
      ? form.authMode === 'login'
        ? isOpenAILoginPending
        : openaiModelsApiKey.isFetching
      : form.type === 'anthropic'
      ? anthropicModels.isFetching
      : ollamaModels.isFetching)
  const isAddProviderConnectionConfirmed = !isAddProviderFlow
    ? true
    : form.type === 'openai'
    ? isOpenAIAuthModeChoicePending
      ? false
      : form.authMode === 'login'
      ? !!form.openaiAuth
      : hasOpenAIApiKey && !!openaiModelsApiKey.data?.length
    : form.type === 'anthropic'
    ? hasAnthropicApiKey && !!anthropicModels.data?.length
    : hasOllamaBaseUrl && !!ollamaModels.data?.length
  const shouldShowModelSection = !isAddProviderFlow || isAddProviderConnectionConfirmed
  const addProviderConnectionHint = isAddProviderFlow
    ? form.type === 'openai'
      ? isOpenAIAuthModeChoicePending
        ? null
        : form.authMode === 'login'
        ? 'Complete ChatGPT Pro sign-in first. Seed will show model options after the connection is confirmed.'
        : !hasOpenAIApiKey
        ? 'Enter an OpenAI API key to confirm the connection before choosing a model.'
        : openaiModelsApiKey.isFetching
        ? 'Confirming the OpenAI connection...'
        : 'Seed could not confirm the OpenAI connection yet. Check the API key and try again.'
      : form.type === 'anthropic'
      ? !hasAnthropicApiKey
        ? 'Enter an Anthropic API key to confirm the connection before choosing a model.'
        : anthropicModels.isFetching
        ? 'Confirming the Anthropic connection...'
        : 'Seed could not confirm the Anthropic connection yet. Check the API key and try again.'
      : !hasOllamaBaseUrl
      ? 'Enter an Ollama base URL to confirm the connection before choosing a model.'
      : ollamaModels.isFetching
      ? 'Confirming the Ollama connection...'
      : 'Seed could not confirm the Ollama connection yet. Check the server URL and try again.'
    : null
  const modelSectionDescription =
    form.type === 'openai'
      ? form.authMode === 'login'
        ? 'Models are loaded live from OpenAI after sign-in and refreshed whenever you reopen the picker.'
        : 'Choose the OpenAI model this provider should use.'
      : form.type === 'anthropic'
      ? 'Choose the Claude model this provider should use.'
      : 'Choose the local Ollama model. If Seed cannot fetch the list, type the model name manually.'

  function startOpenaiLoginFlow() {
    setOpenaiLoginError(null)
    setOpenaiLoginUserCode(null)
    startOpenaiLogin.mutate(
      providerId
        ? {providerId}
        : {
            draft: {
              label: form.label || undefined,
              model: form.model || undefined,
              baseUrl: form.baseUrl || undefined,
            },
          },
      {
        onSuccess: (result) => {
          if (result.providerId) {
            onProviderIdChange?.(result.providerId)
          }
          setOpenaiLoginError(null)
          setOpenaiLoginSessionId(result.sessionId)
          setOpenaiLoginUserCode(result.userCode || null)
          openUrl(result.authUrl)
        },
        onError: (error) => {
          setOpenaiLoginSessionId(null)
          setOpenaiLoginUserCode(null)
          setOpenaiLoginError((error as Error).message || 'Could not start OpenAI login.')
        },
      },
    )
  }

  useEffect(() => {
    if (!openaiLoginSessionId) return
    if (!openaiLoginStatus.data) return
    if (openaiLoginStatus.data.status === 'success') {
      const connectedProviderId = openaiLoginStatus.data.providerId || providerId
      const shouldCloseAddedProviderDialog = !!connectedProviderId && !providerId

      if (connectedProviderId && connectedProviderId !== providerId && !shouldCloseAddedProviderDialog) {
        onProviderIdChange?.(connectedProviderId)
      }

      if (!shouldCloseAddedProviderDialog) {
        setForm((current) => ({
          ...current,
          authMode: 'login',
          openaiAuth: {
            email: openaiLoginStatus.data.email || undefined,
            chatgptAccountId: openaiLoginStatus.data.chatgptAccountId || undefined,
            chatgptPlanType: openaiLoginStatus.data.chatgptPlanType || undefined,
            lastRefreshAt: new Date().toISOString(),
          },
        }))
      }

      setOpenaiLoginError(null)
      toast.success('Connected to OpenAI')
      setOpenaiLoginSessionId(null)
      setOpenaiLoginUserCode(null)

      if (shouldCloseAddedProviderDialog && connectedProviderId) {
        onLoginProviderAdded?.(connectedProviderId)
        return
      }

      if (connectedProviderId && connectedProviderId === providerId) {
        openaiModelsProvider.refetch().catch(() => {})
      }
      return
    }
    if (openaiLoginStatus.data.status === 'error') {
      const message = openaiLoginStatus.data.message || 'OpenAI login failed'
      setOpenaiLoginError(message)
      toast.error(message)
      setOpenaiLoginSessionId(null)
      setOpenaiLoginUserCode(null)
    }
  }, [
    onLoginProviderAdded,
    onProviderIdChange,
    openaiLoginSessionId,
    openaiLoginStatus.data,
    openaiModelsProvider,
    providerId,
    setForm,
  ])

  useEffect(() => {
    if (!requireExplicitOpenAIAuthModeSelection) {
      setIsOpenAIAuthModeCommitted(true)
      return
    }
    if (form.type === 'openai') {
      setIsOpenAIAuthModeCommitted(false)
      return
    }
    setIsOpenAIAuthModeCommitted(true)
  }, [form.type, requireExplicitOpenAIAuthModeSelection])

  useEffect(() => {
    if (form.type !== 'openai' || form.authMode !== 'login') {
      setOpenaiLoginSessionId(null)
      setOpenaiLoginUserCode(null)
      setOpenaiLoginError(null)
    }
  }, [form.authMode, form.type])

  function returnToOpenAIAuthModeSelection() {
    setOpenaiLoginSessionId(null)
    setOpenaiLoginUserCode(null)
    setOpenaiLoginError(null)
    setIsOpenAIAuthModeCommitted(false)
  }

  useEffect(() => {
    if (form.type !== 'openai' || form.authMode !== 'login') return
    const availableLoginModels = openaiModels.data?.length ? openaiModels.data : [...OPENAI_LOGIN_MODELS]
    if (availableLoginModels.includes(form.model)) return
    setForm((current) => {
      if (current.type !== 'openai' || current.authMode !== 'login') return current
      if (availableLoginModels.includes(current.model)) return current
      return {
        ...current,
        model: availableLoginModels[0] || normalizeOpenAILoginModel(current.model),
      }
    })
  }, [form.authMode, form.model, form.type, openaiModels.data, setForm])

  function handleModelPickerOpenChange(open: boolean) {
    if (!open) return
    if (form.type === 'openai') {
      if (form.authMode === 'login' && providerId) {
        openaiModelsProvider.refetch().catch(() => {})
        return
      }
      if (form.authMode === 'apiKey' && form.apiKey) {
        openaiModelsApiKey.refetch().catch(() => {})
      }
      return
    }
    if (form.type === 'anthropic' && form.apiKey) {
      anthropicModels.refetch().catch(() => {})
      return
    }
    if (form.type === 'ollama' && form.baseUrl) {
      ollamaModels.refetch().catch(() => {})
    }
  }

  const modelOptions =
    form.type === 'openai'
      ? openaiModels.data?.length
        ? openaiModels.data
        : form.authMode === 'login'
        ? [...OPENAI_LOGIN_MODELS]
        : OPENAI_API_KEY_FALLBACK_MODELS
      : form.type === 'anthropic'
      ? anthropicModels.data?.length
        ? anthropicModels.data
        : ANTHROPIC_MODELS_FALLBACK
      : ollamaModels.data || []

  return (
    <div className="flex flex-col gap-4">
      {showTypeSelector ? (
        <div className="grid gap-2 md:grid-cols-3">
          {(['openai', 'anthropic', 'ollama'] as const).map((type) => (
            <ProviderTypeCard
              key={type}
              label={PROVIDER_TYPE_META[type].label}
              description={PROVIDER_TYPE_META[type].description}
              active={form.type === type}
              onClick={() => onTypeChange(type)}
            />
          ))}
        </div>
      ) : null}

      {showLabelField ? (
        <Field id="provider-label" label="Label">
          <Input
            value={form.label}
            onChangeText={(v) => setForm((current) => ({...current, label: v}))}
            placeholder="Provider name"
          />
        </Field>
      ) : null}

      <ProviderFormSection
        title={form.type === 'openai' ? 'Authentication' : form.type === 'anthropic' ? 'Credentials' : 'Endpoint'}
        description={
          form.type === 'openai'
            ? isOpenAIAuthModeChoicePending
              ? 'Choose whether Seed should use ChatGPT Pro sign-in or a standard OpenAI API key.'
              : null
            : form.type === 'anthropic'
            ? 'Anthropic providers use an API key stored on this device.'
            : 'Point Seed at the Ollama server that hosts your local models.'
        }
        action={
          form.type === 'openai' && requireExplicitOpenAIAuthModeSelection && isOpenAIAuthModeCommitted ? (
            <Button size="sm" variant="ghost" className="h-auto px-2 py-1" onClick={returnToOpenAIAuthModeSelection}>
              <Undo className="size-4" />
              Cancel
            </Button>
          ) : null
        }
      >
        {form.type === 'openai' ? (
          <div className="flex flex-col gap-4">
            {isOpenAIAuthModeChoicePending ? (
              <div className="grid gap-2 md:grid-cols-2">
                {(
                  [
                    {
                      value: 'login',
                      label: 'ChatGPT Pro Sign In',
                      description: 'Browser-based sign-in using your ChatGPT plan.',
                    },
                    {
                      value: 'apiKey',
                      label: 'API Key',
                      description: 'Use a standard OpenAI API key for API access.',
                    },
                  ] as const
                ).map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => {
                      setOpenaiLoginSessionId(null)
                      setOpenaiLoginUserCode(null)
                      setOpenaiLoginError(null)
                      setIsOpenAIAuthModeCommitted(true)
                      setForm((current) => ({
                        ...current,
                        authMode: option.value,
                        model:
                          option.value === 'login'
                            ? normalizeOpenAILoginModel(current.model)
                            : current.model || getDefaultOpenAIModel('apiKey'),
                        ...(option.value === 'apiKey' ? {openaiAuth: undefined} : {}),
                      }))
                    }}
                    className="bg-background/60 hover:border-border hover:bg-background flex min-h-[96px] flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors"
                  >
                    <div className="flex w-full items-center justify-between gap-2">
                      <SizableText size="sm" weight="bold">
                        {option.label}
                      </SizableText>
                    </div>
                    <SizableText size="xs" className="text-muted-foreground">
                      {option.description}
                    </SizableText>
                  </button>
                ))}
              </div>
            ) : form.authMode === 'login' ? (
              <>
                <div className="flex flex-col gap-1">
                  <SizableText size="xs" className="text-muted-foreground">
                    Seed uses OpenAI&apos;s device-code flow. The browser opens immediately and this page waits for
                    confirmation.
                  </SizableText>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    variant="brand"
                    disabled={startOpenaiLogin.isLoading || openaiLoginStatus.data?.status === 'pending'}
                    onClick={startOpenaiLoginFlow}
                  >
                    {form.openaiAuth ? 'Reset ChatGPT Authentication' : 'Start ChatGPT Pro Sign In'}
                  </Button>
                  {isOpenAILoginPending ? <Spinner size="small" /> : null}
                  {isOpenAILoginPending ? (
                    <Button size="sm" variant="outline" onClick={() => openUrl(openaiVerificationUrl)}>
                      <ExternalLink className="size-4" />
                      Open verification page
                    </Button>
                  ) : null}
                </div>

                {form.openaiAuth ? (
                  <SizableText size="xs" className="text-muted-foreground">
                    Connected
                    {form.openaiAuth.email ? ` as ${form.openaiAuth.email}` : ''}
                    {form.openaiAuth.chatgptPlanType ? ` (${form.openaiAuth.chatgptPlanType})` : ''}.
                    {form.openaiAuth.lastRefreshAt
                      ? ` Last refresh: ${formattedDateLong(new Date(form.openaiAuth.lastRefreshAt))}.`
                      : ''}
                  </SizableText>
                ) : null}

                {openaiLoginStatus.data?.status === 'pending' ? (
                  <div className="bg-background flex flex-col gap-2 rounded-lg border p-3">
                    <SizableText size="xs" className="text-muted-foreground">
                      Waiting for OpenAI login to complete in your browser.
                    </SizableText>
                    {activeOpenaiUserCode ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <code className="bg-muted rounded px-2 py-1 text-xs font-semibold">{activeOpenaiUserCode}</code>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            copyTextToClipboard(activeOpenaiUserCode)
                            toast.success('Device code copied to clipboard')
                          }}
                        >
                          <CopyIcon className="size-3.5" />
                          Copy code
                        </Button>
                        <SizableText size="xs" className="text-muted-foreground">
                          Enter this at {openaiVerificationUrl}.
                        </SizableText>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {openaiLoginError ? (
                  <div className="border-destructive/30 bg-destructive/5 flex flex-col gap-2 rounded-lg border p-3">
                    <SizableText size="xs" className="text-destructive">
                      {openaiLoginError}
                    </SizableText>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        size="sm"
                        variant="link"
                        className="text-destructive h-auto p-0"
                        disabled={startOpenaiLogin.isLoading}
                        onClick={startOpenaiLoginFlow}
                      >
                        Retry sign in
                      </Button>
                      <SizableText size="xs" className="text-muted-foreground">
                        Seed already retries transient connection failures automatically.
                      </SizableText>
                    </div>
                  </div>
                ) : null}
              </>
            ) : (
              <Field id="provider-apikey" label="API Key">
                <div className="flex items-center gap-2">
                  <Input
                    type={showApiKey ? 'text' : 'password'}
                    value={form.apiKey}
                    onChangeText={(v) => setForm((current) => ({...current, apiKey: v}))}
                    placeholder="sk-..."
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => setShowApiKey((value) => !value)}
                    className="text-muted-foreground hover:text-foreground"
                  >
                    {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                </div>
              </Field>
            )}

            {addProviderConnectionHint ? (
              <div className="flex items-center gap-2">
                {isAddProviderConnectionChecking ? <Spinner size="small" /> : null}
                <SizableText size="xs" className="text-muted-foreground">
                  {addProviderConnectionHint}
                </SizableText>
              </div>
            ) : null}
          </div>
        ) : form.type === 'anthropic' ? (
          <div className="flex flex-col gap-4">
            <Field id="provider-apikey" label="API Key">
              <div className="flex items-center gap-2">
                <Input
                  type={showApiKey ? 'text' : 'password'}
                  value={form.apiKey}
                  onChangeText={(v) => setForm((current) => ({...current, apiKey: v}))}
                  placeholder="sk-ant-..."
                  className="flex-1"
                />
                <button
                  type="button"
                  onClick={() => setShowApiKey((value) => !value)}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {showApiKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                </button>
              </div>
            </Field>

            {addProviderConnectionHint ? (
              <div className="flex items-center gap-2">
                {isAddProviderConnectionChecking ? <Spinner size="small" /> : null}
                <SizableText size="xs" className="text-muted-foreground">
                  {addProviderConnectionHint}
                </SizableText>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <Field id="provider-baseurl" label="Base URL">
              <Input
                value={form.baseUrl}
                onChangeText={(v) => setForm((current) => ({...current, baseUrl: v}))}
                placeholder="http://localhost:11434"
              />
            </Field>

            {addProviderConnectionHint ? (
              <div className="flex items-center gap-2">
                {isAddProviderConnectionChecking ? <Spinner size="small" /> : null}
                <SizableText size="xs" className="text-muted-foreground">
                  {addProviderConnectionHint}
                </SizableText>
              </div>
            ) : null}
          </div>
        )}
      </ProviderFormSection>

      {shouldShowModelSection ? (
        <ProviderFormSection title="Model" description={modelSectionDescription}>
          {isOpenAIAuthModeChoicePending ? (
            <SizableText size="xs" className="text-muted-foreground">
              Choose ChatGPT Pro sign-in or API key access first.
            </SizableText>
          ) : isOpenAILoginMissingConnection ? (
            <SizableText size="xs" className="text-muted-foreground">
              Complete ChatGPT Pro sign-in first. Once connected, Seed loads the models available to your account.
            </SizableText>
          ) : (
            <Field id="provider-model" label="Model">
              {modelOptions.length > 0 ? (
                <Select
                  value={form.model}
                  onValueChange={(v) => setForm((current) => ({...current, model: v}))}
                  onOpenChange={handleModelPickerOpenChange}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select a model" />
                  </SelectTrigger>
                  <SelectContent>
                    {modelOptions.map((m: string) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  value={form.model}
                  onChangeText={(v) => setForm((current) => ({...current, model: v}))}
                  placeholder={form.type === 'ollama' ? 'e.g. llama3' : 'Model name'}
                />
              )}
              {form.type === 'openai' && openaiModels.isFetching ? (
                <SizableText size="xs" className="text-muted-foreground mt-1">
                  Refreshing models from OpenAI...
                </SizableText>
              ) : null}
              {form.type === 'openai' &&
              form.authMode === 'login' &&
              form.openaiAuth &&
              !openaiModels.isFetching &&
              !openaiModels.data?.length ? (
                <SizableText size="xs" className="text-muted-foreground mt-1">
                  Could not load the live model list from OpenAI. Showing a fallback catalog.
                </SizableText>
              ) : null}
              {form.type === 'anthropic' && anthropicModels.isFetching ? (
                <SizableText size="xs" className="text-muted-foreground mt-1">
                  Refreshing models from Anthropic...
                </SizableText>
              ) : null}
              {form.type === 'ollama' && ollamaModels.isFetching ? (
                <SizableText size="xs" className="text-muted-foreground mt-1">
                  Refreshing models from Ollama...
                </SizableText>
              ) : null}
              {form.type === 'ollama' && !ollamaModels.isLoading && ollamaModels.data?.length === 0 && form.baseUrl ? (
                <SizableText size="xs" className="text-muted-foreground mt-1">
                  Could not connect to Ollama. Type a model name manually.
                </SizableText>
              ) : null}
            </Field>
          )}
        </ProviderFormSection>
      ) : null}

      {showActions ? (
        <div className="flex justify-end gap-2">
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={isSaving}>
            Cancel
          </Button>
          {!isOpenAIAuthModeChoicePending && !isOpenAILoginMissingConnection && shouldShowModelSection ? (
            <Button variant="brand" size="sm" onClick={onSave} disabled={isSaving || saveDisabled}>
              {saveLabel}
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
