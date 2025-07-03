import {useIPC} from '@/app-context'
import {useEditProfileDialog} from '@/components/edit-profile-dialog'
import {NotifSettingsDialog} from '@/components/email-notifs-dialog'
import {IconForm} from '@/components/icon-form'
import {ListItem} from '@/components/list-item'
import {AccountWallet, WalletPage} from '@/components/payment-settings'
import {useAllDocumentCapabilities} from '@/models/access-control'
import {useAutoUpdatePreference} from '@/models/app-settings'
import {
  useDaemonInfo,
  useDeleteKey,
  useMyAccountIds,
  useSavedMnemonics,
} from '@/models/daemon'
import {useEmailNotifications} from '@/models/email-notifications'
import {useExperiments, useWriteExperiments} from '@/models/experiments'
import {
  useGatewayUrl,
  usePushOnCopy,
  usePushOnPublish,
  useSetGatewayUrl,
  useSetPushOnCopy,
  useSetPushOnPublish,
} from '@/models/gateway-settings'
import {useLinkDevice, useLinkDeviceStatus} from '@/models/linked-devices'
import {usePeerInfo} from '@/models/networking'
import {useSystemThemeWriter} from '@/models/settings'
import {useOpenUrl} from '@/open-url'
import {trpc} from '@/trpc'
import {zodResolver} from '@hookform/resolvers/zod'
import {encode as cborEncode} from '@ipld/dag-cbor'
import {
  COMMIT_HASH,
  LIGHTNING_API_URL,
  SEED_HOST_URL,
  VERSION,
} from '@shm/shared/constants'
import {getMetadataName} from '@shm/shared/content'
import {DeviceLinkSession} from '@shm/shared/hm-types'
import {useEntity} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
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
import {Checkbox} from '@shm/ui/components/checkbox'
import {RadioGroup, RadioGroupItem} from '@shm/ui/components/radio-group'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {panelContainerStyles, windowContainerStyles} from '@shm/ui/container'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {CopyUrlField} from '@shm/ui/copy-url-field'
import {Field} from '@shm/ui/form-fields'
import {FormInput} from '@shm/ui/form-input'
import {FormField} from '@shm/ui/forms'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
import {HMIcon} from '@shm/ui/hm-icon'
import {Copy, ExternalLink, Pencil} from '@shm/ui/icons'
import {SelectDropdown} from '@shm/ui/select-dropdown'
import {Separator} from '@shm/ui/separator'
import {Spinner} from '@shm/ui/spinner'
import {InfoListHeader, InfoListItem, TableList} from '@shm/ui/table-list'
import {toast} from '@shm/ui/toast'
import {Tooltip} from '@shm/ui/tooltip'
import {DialogTitle, useAppDialog} from '@shm/ui/universal-dialog'
import {useIsDark} from '@shm/ui/use-is-dark'
import {cn} from '@shm/ui/utils'
import {
  AtSign,
  Check,
  Code2,
  Cog,
  Eye,
  EyeOff,
  Info,
  Plus,
  RadioTower,
  Trash,
  UserRoundPlus,
  X,
} from 'lucide-react'
import {base58btc} from 'multiformats/bases/base58'
import {useEffect, useId, useMemo, useState} from 'react'
import {useForm} from 'react-hook-form'
import QRCode from 'react-qr-code'
import {
  Form,
  Heading,
  Input,
  Label,
  Paragraph,
  SizableText,
  Tabs,
  TabsContentProps,
  TabsProps,
  Text,
  TextArea,
} from 'tamagui'
import {z} from 'zod'

export default function Settings() {
  const [activeTab, setActiveTab] = useState('accounts')
  const isDark = useIsDark()
  return (
    <div
      className={cn(
        windowContainerStyles,
        'h-full max-h-full min-h-0 w-full overflow-hidden pt-0',
      )}
    >
      <div className={cn(panelContainerStyles)}>
        <Tabs
          flex={1}
          height="50%"
          onValueChange={(v) => setActiveTab(v)}
          defaultValue="accounts"
          flexDirection="column"
          overflow="hidden"
        >
          <Tabs.List
            aria-label="Manage your account"
            alignItems="center"
            justifyContent="center"
            flexShrink={0}
            flex="none"
            style={{
              flexShrink: 0,
            }}
          >
            <Tab
              value="accounts"
              active={activeTab === 'accounts'}
              icon={AtSign}
              label="Accounts"
            />
            <Tab
              value="general"
              active={activeTab === 'general'}
              icon={Cog}
              label="General"
            />
            <Tab
              value="gateway"
              active={activeTab === 'gateway'}
              icon={RadioTower}
              label="Gateway"
            />
            <Tab
              value="app-info"
              active={activeTab === 'app-info'}
              icon={Info}
              label="App Info"
            />
            {/* <Tab
          value="experiments"
          active={activeTab === 'experiments'}
          icon={Biohazard}
          label="Experiments"
        /> */}
            <Tab
              value="developer"
              active={activeTab === 'developer'}
              icon={Code2}
              label="Developers"
            />
          </Tabs.List>
          <Separator />
          <TabsContent value="accounts">
            <AccountKeys />
          </TabsContent>
          <TabsContent value="general">
            <GeneralSettings />
          </TabsContent>
          <TabsContent value="gateway">
            <GatewaySettings />
          </TabsContent>
          <TabsContent value="app-info">
            <AppSettings />
            {/* <DevicesInfo /> */}
          </TabsContent>
          {/* <TabsContent value="experiments">
        <ExperimentsSettings />
      </TabsContent> */}
          <TabsContent value="developer">
            <DeveloperSettings />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

export function DeleteDraftLogs() {
  const [isConfirming, setIsConfirming] = useState(false)
  const destroyDraftLogs = trpc.diagnosis.destroyDraftLogFolder.useMutation()

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

function GeneralSettings() {
  const [theme, setTheme, isInitialLoading] = useSystemThemeWriter()
  return (
    <div className="flex flex-col gap-4">
      <Heading>General Settings</Heading>
      {!isInitialLoading && (
        <div className="flex gap-4">
          <Label>Theme</Label>
          <SelectDropdown
            value={theme || 'system'}
            onValue={setTheme}
            triggerProps={{style: {maxWidth: 200}}}
            options={[
              {label: 'System Default', value: 'system'},
              {label: 'Light', value: 'light'},
              {label: 'Dark', value: 'dark'},
            ]}
          />
        </div>
      )}
    </div>
  )
}

export function DeveloperSettings() {
  const experiments = useExperiments()
  const writeExperiments = useWriteExperiments()
  const enabledDevTools = experiments.data?.developerTools
  const enabledPubContentDevMenu = experiments.data?.pubContentDevMenu
  const openDraftLogs = trpc.diagnosis.openDraftLogFolder.useMutation()
  return (
    <>
      <SettingsSection title="Developer Tools">
        <SizableText fontSize="$4">
          Adds features across the app for helping diagnose issues. Mostly
          useful for Seed Developers.
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
        <SizableText fontSize="$4">
          Debug options for the formatting of all publication content
        </SizableText>
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
            {enabledPubContentDevMenu
              ? 'Disable Publication Debug Panel'
              : `Enable Publication Debug Panel`}
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

export function ProfileForm({
  profile,
  accountId,
}: {
  profile: any // TODO: protile type
  accountId: string
}) {
  const editProfileDialog = useEditProfileDialog()
  function onCopy() {
    copyTextToClipboard(accountId)
    toast.success('Account ID copied!')
  }
  return (
    <>
      <div className="flex gap-4">
        <div className="flex flex-shrink-0 flex-grow-0 flex-col items-center">
          <IconForm url={getDaemonFileUrl(profile?.icon)} />
        </div>
        <div className="flex flex-1 flex-col gap-3">
          <div className="flex flex-col">
            <Label size="$3" htmlFor="accountid">
              Account Id
            </Label>
            <div className="flex">
              <Input
                size="$3"
                id="accountid"
                userSelect="none"
                disabled
                value={accountId}
                data-testid="account-id"
                flex={1}
                hoverStyle={{
                  cursor: 'default',
                }}
                className="flex-1 rounded-r-none"
              />
              <Tooltip content="Copy your account id">
                <Button size="sm" onClick={onCopy} className="rounded-l-none">
                  <Copy className="h-4 w-4" />
                </Button>
              </Tooltip>
            </div>
          </div>
          <div className="flex">
            <Button
              onClick={() => {
                editProfileDialog.open(true)
              }}
            >
              <Pencil className="mr-2 h-4 w-4" />
              Edit My Profile
            </Button>
          </div>
        </div>
      </div>
      {editProfileDialog.content}
    </>
  )
}

function AccountKeys() {
  const isDark = useIsDark()
  const deleteKey = useDeleteKey()
  const keys = useMyAccountIds()
  const deleteWords = trpc.secureStorage.delete.useMutation()
  const [walletId, setWalletId] = useState<string | undefined>(undefined)
  const [selectedAccount, setSelectedAccount] = useState<undefined | string>(
    () => {
      if (keys.data && keys.data.length) {
        return keys.data[0]
      }
      return undefined
    },
  )

  const {data: mnemonics, refetch: mnemonicsRefetch} =
    useSavedMnemonics(selectedAccount)

  const selectedAccountId = selectedAccount
    ? hmId('d', selectedAccount)
    : undefined

  const {data: profile} = useEntity(selectedAccountId)

  const [showWords, setShowWords] = useState<boolean>(false)

  useEffect(() => {
    if (keys.data && keys.data.length) {
      setSelectedAccount(keys.data[0])
    }
  }, [keys.data])

  useEffect(() => {
    if (selectedAccount) {
      mnemonicsRefetch()
    }
  }, [selectedAccount])

  function handleDeleteCurrentAccount() {
    if (!selectedAccount) return
    deleteKey.mutateAsync({accountId: selectedAccount}).then(() => {
      setSelectedAccount(undefined)
      toast.success('Profile removed correctly')
    })
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
    <div className="flex flex-1 gap-3 overflow-hidden">
      <div className="flex max-w-[25%] flex-1 flex-col gap-2">
        <div className="flex flex-1 flex-col">
          <ScrollArea>
            {keys.data?.map((key) => (
              <KeyItem
                item={key}
                isActive={key == selectedAccount}
                onSelect={() => setSelectedAccount(key)}
              />
            ))}
          </ScrollArea>
        </div>
      </div>
      <div
        className={cn(
          'border-border flex flex-[3] flex-col rounded-lg border',
          isDark ? 'bg-background' : 'bg-muted',
        )}
      >
        <ScrollArea>
          <div className="flex flex-col gap-4 p-4">
            <div className="mb-4 flex gap-4">
              {selectedAccountId ? (
                <HMIcon
                  id={selectedAccountId}
                  metadata={profile?.document?.metadata}
                  size={80}
                />
              ) : null}
              <div className="mt-2 flex flex-1 flex-col gap-3">
                <Field id="username" label="Profile Name">
                  <Input
                    disabled
                    value={getMetadataName(profile?.document?.metadata)}
                  />
                </Field>
                <Field id="accountid" label="Account ID">
                  <Input disabled value={selectedAccount} />
                </Field>
              </div>
            </div>
            {mnemonics ? (
              <div className="flex flex-col gap-2">
                <Field label="Secret Recovery Phrase" id="words">
                  <div className="flex gap-3">
                    <TextArea
                      f={1}
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
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setShowWords((v) => !v)}
                      >
                        {showWords ? (
                          <EyeOff className="h-4 w-4" />
                        ) : (
                          <Eye className="h-4 w-4" />
                        )}
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
                            <AlertDialogTitle className="text-2xl font-bold">
                              Delete Words
                            </AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you really sure? you cant recover the secret
                              words after you delete them. please save them
                              securely in another place before you delete
                            </AlertDialogDescription>
                            <div className="flex justify-end gap-3">
                              <AlertDialogCancel asChild>
                                <Button variant="ghost">Cancel</Button>
                              </AlertDialogCancel>
                              <AlertDialogAction asChild>
                                <Button
                                  variant="destructive"
                                  onClick={() =>
                                    deleteWords
                                      .mutateAsync(selectedAccount)
                                      .then(() => {
                                        toast.success('Words deleted!')
                                        invalidateQueries([
                                          'trpc.secureStorage.get',
                                        ])
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

            <AlertDialog>
              <Tooltip content="Delete account from device">
                <AlertDialogTrigger asChild>
                  <Button size="sm" variant="destructive" className="self-end">
                    <Trash className="mr-2 h-4 w-4" />
                    Delete Account
                  </Button>
                </AlertDialogTrigger>
              </Tooltip>
              <AlertDialogPortal>
                <AlertDialogContent className="max-w-[600px] gap-4">
                  <AlertDialogTitle className="text-2xl font-bold">
                    Delete Account
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    Are you sure? This account will be removed. Make sure you
                    have saved the Secret Recovery Phrase for this account if
                    you want to recover it later.
                  </AlertDialogDescription>
                  <div className="flex justify-end gap-3">
                    <AlertDialogCancel asChild>
                      <Button variant="ghost">Cancel</Button>
                    </AlertDialogCancel>
                    <AlertDialogAction asChild>
                      <Button
                        variant="destructive"
                        onClick={handleDeleteCurrentAccount}
                      >
                        Delete Permanently
                      </Button>
                    </AlertDialogAction>
                  </div>
                </AlertDialogContent>
              </AlertDialogPortal>
            </AlertDialog>
            <Separator />
            <SettingsSection title="Wallets">
              <AccountWallet
                accountUid={selectedAccount}
                onOpenWallet={(walletId) => setWalletId(walletId)}
              />
            </SettingsSection>
            <SettingsSection title="Linked Devices">
              <LinkedDevices
                accountUid={selectedAccount}
                accountName={getMetadataName(profile?.document?.metadata)}
              />
            </SettingsSection>
            <EmailNotificationSettings
              key={selectedAccount}
              accountUid={selectedAccount}
            />
          </div>
        </ScrollArea>
      </div>
    </div>
  ) : (
    <div className="flex h-full flex-1 flex-col items-center justify-center gap-4 p-6">
      <div className="bg-muted flex h-20 w-20 items-center justify-center rounded-lg">
        <UserRoundPlus size={50} className="text-muted-foreground" />
      </div>
      <Heading>No Accounts Found</Heading>
      <Paragraph textAlign="center" maxWidth={400} color="$color11">
        Create a new profile to get started with Seed. You'll need to create a
        profile to use all the features.
      </Paragraph>
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

function EmailNotificationSettings({accountUid}: {accountUid: string}) {
  const emailNotifs = useEmailNotifications(accountUid)
  const notifSettingsDialog = useAppDialog(NotifSettingsDialog)
  const hasNoNotifs =
    emailNotifs.data?.account &&
    !emailNotifs.data.account.notifyAllMentions &&
    !emailNotifs.data.account.notifyAllReplies
  return (
    <SettingsSection title="Email Notifications">
      {emailNotifs.data?.account ? (
        <div className="flex flex-col gap-3">
          <SizableText>
            Recipient Email:{' '}
            <Text fontWeight="bold">{emailNotifs.data.account.email}</Text>
          </SizableText>
          {emailNotifs.data.account.notifyAllMentions && (
            <CheckmarkRow checked label="Notify when someone mentions me" />
          )}
          {emailNotifs.data.account.notifyAllReplies && (
            <CheckmarkRow checked label="Notify when someone replies to me" />
          )}
          {emailNotifs.data.account.notifyOwnedDocChange && (
            <CheckmarkRow
              checked
              label="Notify when someone changes a document I own"
            />
          )}
          {hasNoNotifs ? (
            <div className="flex items-center gap-3">
              <X color="$color9" size={24} />
              <SizableText color="$color9">
                No notifications enabled
              </SizableText>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="flex">
        <Button
          size="sm"
          onClick={() => notifSettingsDialog.open({accountUid})}
        >
          <Pencil className="mr-2 h-4 w-4" />
          Edit Notification Settings
        </Button>
      </div>
      {notifSettingsDialog.content}
    </SettingsSection>
  )
}

function CheckmarkRow({checked, label}: {checked: boolean; label: string}) {
  return (
    <div className="flex items-center gap-3">
      <div className="w-6">
        {checked ? <Check className="text-primary" /> : null}
      </div>
      <SizableText fontWeight={checked ? 'bold' : 'normal'}>
        {label}
      </SizableText>
    </div>
  )
}

function LinkedDevices({
  accountUid,
  accountName,
}: {
  accountUid: string
  accountName: string
}) {
  const linkDevice = useAppDialog(LinkDeviceDialog)
  const {data: capabilities} = useAllDocumentCapabilities(hmId('d', accountUid))
  const devices = capabilities?.filter((c) => c.role === 'agent')
  return (
    <div className="flex flex-col gap-3">
      {devices?.length ? (
        <div className="flex flex-col gap-2">
          {devices.map((d) => (
            <Tooltip content={`Copy ID of ${d.label}`} key={d.accountUid}>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  copyTextToClipboard(hmId('d', d.accountUid).id)
                  toast('Device ID copied to clipboard')
                }}
                className="justify-start"
              >
                <SizableText>{d.label}</SizableText>
              </Button>
            </Tooltip>
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

function LinkDeviceDialog({
  input,
  onClose,
}: {
  input: {accountUid: string; accountName: string}
  onClose: () => void
}) {
  const [linkDeviceUrl, setLinkDeviceUrl] = useState<null | string>(null)
  const [linkSession, setLinkSession] = useState<null | DeviceLinkSession>(null)
  const linkDeviceStatus = useLinkDeviceStatus()
  const gatewayUrl = useGatewayUrl()
  if (
    linkDeviceStatus.data?.redeemTime &&
    linkSession &&
    linkDeviceStatus.data?.secretToken === linkSession.secretToken
  ) {
    return (
      <div className="flex flex-col gap-4">
        <Heading>Device Linked!</Heading>
        <Paragraph>
          You have signed in to{' '}
          <Text fontWeight="bold">{input.accountName}</Text> in the web browser.
        </Paragraph>
        <div className="flex justify-center">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              onClose()
            }}
          >
            Close
            <Check className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    )
  }
  return (
    <>
      <DialogTitle>Link New Web Session</DialogTitle>

      {linkDeviceUrl ? (
        <Paragraph>
          Open this URL to log in to{' '}
          <Text fontWeight="bold">{input.accountName}</Text>
        </Paragraph>
      ) : (
        <Paragraph>
          You will sign in to <Text fontWeight="bold">{input.accountName}</Text>{' '}
          from a web browser.
        </Paragraph>
      )}
      {linkDeviceUrl ? (
        <div className="flex flex-col gap-4">
          <CopyUrlField url={linkDeviceUrl} label="Device Login" />
          {linkDeviceUrl ? (
            <Paragraph>Or, scan this code with your smartphone:</Paragraph>
          ) : null}
          <QRCode value={linkDeviceUrl} size={465} />
        </div>
      ) : (
        <DeviceLabelForm
          accountUid={input.accountUid}
          onSuccess={async (linkSession) => {
            setLinkSession(linkSession)
            setLinkDeviceUrl(
              `${gatewayUrl.data}/hm/device-link#${base58btc.encode(
                cborEncode(linkSession),
              )}`,
            )
          }}
        />
      )}
    </>
  )
}

function DeviceLabelForm({
  onSuccess,
  accountUid,
}: {
  onSuccess: (linkSession: DeviceLinkSession) => Promise<void>
  accountUid: string
}) {
  const linkDevice = useLinkDevice()

  const {
    control,
    handleSubmit,
    setFocus,
    formState: {errors},
  } = useForm<{label: string}>({
    resolver: zodResolver(
      z.object({label: z.string().min(1, 'Device label is required')}),
    ),
    defaultValues: {
      label: `Web Device ${new Date().toLocaleDateString()}`,
    },
  })

  useEffect(() => {
    setFocus('label')
  }, [setFocus])

  if (linkDevice.isLoading) {
    return (
      <div className="flex items-center justify-center">
        <Spinner />
      </div>
    )
  }
  return (
    <Form
      onSubmit={handleSubmit(async (data) => {
        const linkSession = await linkDevice.mutateAsync({
          label: data.label,
          accountUid,
        })
        onSuccess(linkSession)
      })}
    >
      <div className="flex flex-col gap-4">
        {linkDevice.error ? (
          <Paragraph color="$red10">
            Error linking device: {linkDevice.error.message}
          </Paragraph>
        ) : null}
        <FormField name="label" label="Device Label" errors={errors}>
          <FormInput control={control} name="label" placeholder="My Device" />
        </FormField>
        <Form.Trigger asChild>
          <Button>Link Device</Button>
        </Form.Trigger>
      </div>
    </Form>
  )
}

function KeyItem({
  item,
  isActive,
  onSelect,
}: {
  item: string
  isActive: boolean
  onSelect: () => void
}) {
  const id = hmId('d', item)
  const entity = useEntity(id)
  return (
    <ListItem
      active={isActive}
      icon={
        <HMIcon id={id} metadata={entity.data?.document?.metadata} size={24} />
      }
      title={entity.data?.document?.metadata.name || item}
      subTitle={item.substring(item.length - 8)}
      backgroundColor={isActive ? '$brand12' : undefined}
      onPress={onSelect}
    />
  )
}

// function DevicesInfo() {
//   const {data: deviceInfo} = useDaemonInfo()
//   return (
//     <YStack gap="$3">
//       <Heading>My Device</Heading>

//       {deviceInfo ? (
//         <table>
//           <tbody>
//             <tr>
//               <td>peerId</td>
//               <td>{deviceInfo.}</td>
//             </tr>
//             <tr>
//               <td>state</td>
//               <td>{State[deviceInfo.state]}</td>
//             </tr>
//             <tr>
//               <td>startTime</td>
//               <td>{JSON.stringify(deviceInfo.startTime)}</td>
//             </tr>
//           </tbody>
//         </table>
//       ) : null}
//     </YStack>
//   )
// }

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
  const isDark = useIsDark()
  return (
    <div
      className={cn(
        'flex items-center gap-6 rounded border p-3 px-6',
        isDark ? 'bg-background' : 'bg-muted',
      )}
    >
      <Heading fontSize={42}>{experiment.emoji}</Heading>
      <div className="flex flex-1 flex-col gap-3">
        <div className="flex flex-1 gap-3">
          <Heading size="$6" marginVertical={0}>
            {experiment.label}
          </Heading>
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
      <Check size="$1" color="$brand5" />
      <SizableText size="$1" color="$brand5" fontWeight="bold">
        Enabled
      </SizableText>
    </div>
  )
}

type ExperimentType = {
  key: string
  label: string
  emoji: string
  description: string
}
const EXPERIMENTS = //: ExperimentType[]
  [
    // {
    //   key: 'webImporting',
    //   label: 'Web Importing',
    //   emoji: '🛰️',
    //   description:
    //     'When opening a Web URL from the Quick Switcher, automatically convert to a Hypermedia Document.',
    // },
    // {
    //   key: 'nostr',
    //   label: 'Nostr Embeds',
    //   emoji: '🍀',
    //   description: 'Embed Nostr notes into documents for permanent referencing.',
    // },
    {
      key: 'hosting',
      label: 'Seed Hosting Publish Workflow',
      emoji: '☁️',
      description:
        'Test the new publishing workflow with the Seed Hosting service.',
    },
  ] as const

function GatewaySettings({}: {}) {
  const gatewayUrl = useGatewayUrl()

  const setGatewayUrl = useSetGatewayUrl()
  const [gwUrl, setGWUrl] = useState('')

  useEffect(() => {
    if (gatewayUrl.data) {
      setGWUrl(gatewayUrl.data)
    }
  }, [gatewayUrl.data])

  return (
    <div className="flex flex-col gap-3">
      <TableList>
        <InfoListHeader title="URL" />
        <TableList.Item>
          <div className="flex w-full gap-3">
            <Input size="$3" flex={1} value={gwUrl} onChangeText={setGWUrl} />
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
            <Paragraph theme="red">Error loading settings.</Paragraph>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => pushOnCopy.refetch()}
            >
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
              const validValue =
                value === 'always' || value === 'never' || value === 'ask'
                  ? value
                  : 'always'

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
                <RadioGroupItem
                  value={option.value}
                  id={`${id}-${option.value}`}
                />

                <Label size="$2" htmlFor={`${id}-${option.value}`}>
                  {option.label}
                </Label>
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
            <Paragraph theme="red">Error loading settings.</Paragraph>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => pushOnPublish.refetch()}
            >
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
              const validValue =
                value === 'always' || value === 'never' || value === 'ask'
                  ? value
                  : 'always'

              setPushOnPublish.mutate(validValue, {
                onSuccess: () => {
                  toast.success('Push on publish changed!')
                },
                onError: (error) => {
                  console.error(
                    'Failed to update push on publish setting:',
                    error,
                  )
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
                <RadioGroupItem
                  value={option.value}
                  id={`${id}-${option.value}`}
                />

                <Label size="$2" htmlFor={`${id}-${option.value}`}>
                  {option.label}
                </Label>
              </div>
            )
          })}
        </RadioGroup>
      </TableList.Item>
    </TableList>
  )
}

function ExperimentsSettings({}: {}) {
  const experiments = useExperiments()
  const writeExperiments = useWriteExperiments()
  return (
    <div className="flex flex-col gap-3">
      <div className="my-4 flex flex-col space-y-4 self-stretch">
        {EXPERIMENTS.map((experiment) => {
          return (
            <ExperimentSection
              key={experiment.key}
              id={experiment.key}
              value={!!experiments.data?.[experiment.key]}
              experiment={experiment}
              onValue={(isEnabled) => {
                console.log(experiment.key, 'isEnabled', isEnabled)
                writeExperiments.mutate({[experiment.key]: isEnabled})
              }}
            />
          )
        })}
      </div>
    </div>
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
          copyTextToClipboard(data?.addrs.sort().join(', '))
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
  const appInfo = trpc.getAppInfo.useQuery().data
  const openUrl = useOpenUrl()
  const {value: autoUpdate, setAutoUpdate} = useAutoUpdatePreference()
  const daemonInfo = trpc.getDaemonInfo.useQuery().data
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
          <SizableText size="$1" flex={0} minWidth={140} width={140}>
            Check for updates?
          </SizableText>
          <div className="flex flex-1">
            <div className="flex flex-1">
              <Checkbox
                id="auto-update"
                checked={autoUpdate.data == 'true'}
                onCheckedChange={(newVal) => {
                  let val = newVal ? 'true' : 'false'
                  // TODO: use the actual type for autoUpdate
                  setAutoUpdate(val as 'true' | 'false')
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
            openUrl(
              `https://github.com/seed-hypermedia/seed/commit/${COMMIT_HASH}`,
            )
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

const TabsContent = (props: TabsContentProps) => {
  return (
    <Tabs.Content
      // backgroundColor="$background"
      gap="$3"
      flex={1}
      {...props}
    >
      <ScrollArea>
        <div className="flex flex-1 flex-col gap-4 p-4 pb-5">
          {props.children}
        </div>
      </ScrollArea>
    </Tabs.Content>
  )
}

function Tab(props: TabsProps & {icon: any; label: string; active: boolean}) {
  const {icon: Icon, label, active, ...rest} = props
  return (
    <Tabs.Tab
      data-testid={`tab-${props.value}`}
      borderRadius={0}
      flexDirection="column"
      {...props}
      p="$4"
      paddingBottom="$3"
      height="auto"
      gap="$2"
      bg="$colorTransparent"
      hoverStyle={{cursor: 'default', bg: '$color6'}}
      {...rest}
    >
      <Icon className={active ? 'text-brand-5' : 'text-color'} />
      <SizableText flex={1} size="$1" color={active ? '$brand5' : '$color'}>
        {label}
      </SizableText>
    </Tabs.Tab>
  )
}

function SettingsSection({
  title,
  children,
}: React.PropsWithChildren<{title: string}>) {
  const isDark = useIsDark()
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded p-3',
        isDark ? 'bg-background' : 'bg-muted',
      )}
    >
      <Heading size="$7">{title}</Heading>
      {children}
    </div>
  )
}
