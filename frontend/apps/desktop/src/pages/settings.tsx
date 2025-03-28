import {useIPC} from '@/app-context'
import {useEditProfileDialog} from '@/components/edit-profile-dialog'
import {IconForm} from '@/components/icon-form'
import {ListItem} from '@/components/list-item'
import {AccountWallet, WalletPage} from '@/components/payment-settings'
import {useAutoUpdatePreference} from '@/models/app-settings'
import {
  useDaemonInfo,
  useDeleteKey,
  useMyAccountIds,
  useSavedMnemonics,
} from '@/models/daemon'
import {useExperiments, useWriteExperiments} from '@/models/experiments'
import {
  useGatewayUrl,
  usePushOnCopy,
  usePushOnPublish,
  useSetGatewayUrl,
  useSetPushOnCopy,
  useSetPushOnPublish,
} from '@/models/gateway-settings'
import {usePeerInfo} from '@/models/networking'
import {useOpenUrl} from '@/open-url'
import {trpc} from '@/trpc'
import {
  COMMIT_HASH,
  LIGHTNING_API_URL,
  SEED_HOST_URL,
  VERSION,
} from '@shm/shared/constants'
import {getMetadataName} from '@shm/shared/content'
import {useEntity} from '@shm/shared/models/entity'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {Field} from '@shm/ui/form-fields'
import {getDaemonFileUrl} from '@shm/ui/get-file-url'
import {HMIcon} from '@shm/ui/hm-icon'
import {Copy, ExternalLink, Pencil} from '@shm/ui/icons'
import {InfoListHeader, InfoListItem, TableList} from '@shm/ui/table-list'
import {toast} from '@shm/ui/toast'
import {
  AtSign,
  Check,
  Code2,
  Eye,
  EyeOff,
  Info,
  Plus,
  RadioTower,
  Trash,
  UserRoundPlus,
} from '@tamagui/lucide-icons'
import copyTextToClipboard from 'copy-text-to-clipboard'
import {useEffect, useId, useMemo, useState} from 'react'
import {
  AlertDialog,
  Button,
  Checkbox,
  Heading,
  Input,
  Label,
  Paragraph,
  RadioGroup,
  ScrollView,
  Separator,
  SizableText,
  Spinner,
  Tabs,
  TabsContentProps,
  TabsProps,
  TextArea,
  Tooltip,
  View,
  XGroup,
  XStack,
  YStack,
} from 'tamagui'

import {dispatchOnboardingDialog} from '@/components/onboarding'
import React from 'react'

export default function Settings() {
  const [activeTab, setActiveTab] = useState('accounts')
  return (
    <Tabs
      flex={1}
      onValueChange={(v) => setActiveTab(v)}
      defaultValue="accounts"
      flexDirection="column"
      borderWidth="$0.25"
      overflow="hidden"
      borderColor="$backgroundStrong"
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
  )
}

export function DeleteDraftLogs() {
  const [isConfirming, setIsConfirming] = useState(false)
  const destroyDraftLogs = trpc.diagnosis.destroyDraftLogFolder.useMutation()

  if (isConfirming) {
    return (
      <Button
        icon={Trash}
        theme="red"
        onPress={() => {
          destroyDraftLogs.mutateAsync().then(() => {
            toast.success('Cleaned up Draft Logs')
            setIsConfirming(false)
          })
        }}
      >
        Confirm Delete Draft Log Folder?
      </Button>
    )
  }
  return (
    <Button
      icon={Trash}
      theme="red"
      onPress={() => {
        setIsConfirming(true)
      }}
    >
      Delete All Draft Logs
    </Button>
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
        <XStack jc="space-between">
          {enabledDevTools ? <EnabledTag /> : <View />}
          <Button
            size="$2"
            theme={enabledDevTools ? 'red' : 'green'}
            onPress={() => {
              writeExperiments.mutate({developerTools: !enabledDevTools})
            }}
          >
            {enabledDevTools ? 'Disable Debug Tools' : `Enable Debug Tools`}
          </Button>
        </XStack>
      </SettingsSection>
      <SettingsSection title="Publication Content Dev Tools">
        <SizableText fontSize="$4">
          Debug options for the formatting of all publication content
        </SizableText>
        <XStack jc="space-between">
          {enabledPubContentDevMenu ? <EnabledTag /> : <View />}
          <Button
            size="$2"
            theme={enabledPubContentDevMenu ? 'red' : 'green'}
            onPress={() => {
              writeExperiments.mutate({
                pubContentDevMenu: !enabledPubContentDevMenu,
              })
            }}
          >
            {enabledPubContentDevMenu
              ? 'Disable Publication Debug Panel'
              : `Enable Publication Debug Panel`}
          </Button>
        </XStack>
      </SettingsSection>
      <SettingsSection title="Draft Logs">
        <XStack space>
          <Button
            size="$2"
            icon={ExternalLink}
            onPress={() => {
              openDraftLogs.mutate()
            }}
          >
            Open Draft Log Folder
          </Button>
          <DeleteDraftLogs />
        </XStack>
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
      <XStack gap="$4">
        <YStack flex={0} alignItems="center" flexGrow={0}>
          <IconForm url={getDaemonFileUrl(profile?.icon)} />
        </YStack>
        <YStack flex={1} space>
          <YStack>
            <Label size="$3" htmlFor="accountid">
              Account Id
            </Label>
            <XGroup>
              <XGroup.Item>
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
                />
              </XGroup.Item>
              <XGroup.Item>
                <Tooltip content="Copy your account id">
                  <Button size="$3" icon={Copy} onPress={onCopy} />
                </Tooltip>
              </XGroup.Item>
            </XGroup>
          </YStack>
          <XStack>
            <Button
              icon={Pencil}
              onPress={() => {
                editProfileDialog.open(true)
              }}
            >
              Edit My Profile
            </Button>
          </XStack>
        </YStack>
      </XStack>
      {editProfileDialog.content}
    </>
  )
}

function AccountKeys() {
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
    <XStack style={{flex: 1}} gap="$4" overflow="hidden">
      <YStack f={1} maxWidth="25%" gap="$2">
        <YStack f={1} borderColor="$color7" borderWidth={1}>
          <ScrollView>
            {keys.data?.map((key) => (
              <KeyItem
                item={key}
                isActive={key == selectedAccount}
                onSelect={() => setSelectedAccount(key)}
              />
            ))}
          </ScrollView>
        </YStack>
        <XStack p="$1">
          <Button
            f={1}
            icon={Plus}
            size="$2"
            onPress={() => dispatchOnboardingDialog(true)}
            theme="brand"
            color="$color11"
          >
            Add Account
          </Button>
        </XStack>
      </YStack>
      <YStack f={3} borderColor="$color7" borderWidth={1}>
        <ScrollView>
          <YStack p="$4" gap="$4">
            <XStack marginBottom="$4" gap="$4">
              {selectedAccountId ? (
                <HMIcon
                  id={selectedAccountId}
                  metadata={profile?.document?.metadata}
                  size={80}
                />
              ) : null}
              <YStack f={1} gap="$3" marginTop="$2">
                <Field id="username" label="Profile name">
                  <Input
                    disabled
                    value={getMetadataName(profile?.document?.metadata)}
                  />
                </Field>
                <Field id="accountid" label="Account Id">
                  <Input disabled value={selectedAccount} />
                </Field>
              </YStack>
            </XStack>
            {mnemonics ? (
              <YStack gap="$2">
                <Field label="Secret Words" id="words">
                  <XStack gap="$3">
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
                    <YStack gap="$2">
                      <Button
                        size="$2"
                        icon={showWords ? EyeOff : Eye}
                        onPress={() => setShowWords((v) => !v)}
                      />
                      <Button
                        size="$2"
                        icon={Copy}
                        onPress={() => {
                          console.log('mnemonics', mnemonics)
                          copyTextToClipboard(mnemonics.join(', '))
                          toast.success('Words copied to clipboard')
                        }}
                      />

                      <AlertDialog native>
                        <Tooltip content="Delete words from device">
                          <AlertDialog.Trigger asChild>
                            <Button size="$2" theme="red" icon={Trash} />
                          </AlertDialog.Trigger>
                        </Tooltip>
                        <AlertDialog.Portal>
                          <AlertDialog.Overlay
                            key="overlay"
                            animation="fast"
                            opacity={0.5}
                            enterStyle={{opacity: 0}}
                            exitStyle={{opacity: 0}}
                          />
                          <AlertDialog.Content
                            bordered
                            elevate
                            key="content"
                            animation={[
                              'fast',
                              {
                                opacity: {
                                  overshootClamping: true,
                                },
                              },
                            ]}
                            enterStyle={{x: 0, y: -20, opacity: 0, scale: 0.9}}
                            exitStyle={{x: 0, y: 10, opacity: 0, scale: 0.95}}
                            x={0}
                            scale={1}
                            opacity={1}
                            y={0}
                            maxWidth={600}
                            gap="$4"
                          >
                            <AlertDialog.Title size="$8" fontWeight="bold">
                              Delete Words
                            </AlertDialog.Title>
                            <AlertDialog.Description>
                              Are you really sure? you cant recover the secret
                              words after you delete them. please save them
                              securely in another place before you delete
                            </AlertDialog.Description>
                            <XStack gap="$3" justifyContent="flex-end">
                              <AlertDialog.Cancel asChild>
                                <Button chromeless>Cancel</Button>
                              </AlertDialog.Cancel>
                              <AlertDialog.Action asChild>
                                <Button
                                  theme="red"
                                  onPress={() =>
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
                              </AlertDialog.Action>
                            </XStack>
                          </AlertDialog.Content>
                        </AlertDialog.Portal>
                      </AlertDialog>
                    </YStack>
                  </XStack>
                </Field>
              </YStack>
            ) : null}

            <AlertDialog native>
              <Tooltip content="Delete words from device">
                <AlertDialog.Trigger asChild>
                  <Button
                    size="$2"
                    theme="red"
                    icon={Trash}
                    alignSelf="flex-end"
                  >
                    Delete Account
                  </Button>
                </AlertDialog.Trigger>
              </Tooltip>
              <AlertDialog.Portal>
                <AlertDialog.Overlay
                  key="overlay"
                  animation="fast"
                  opacity={0.5}
                  enterStyle={{opacity: 0}}
                  exitStyle={{opacity: 0}}
                />
                <AlertDialog.Content
                  bordered
                  elevate
                  key="content"
                  animation={[
                    'fast',
                    {
                      opacity: {
                        overshootClamping: true,
                      },
                    },
                  ]}
                  enterStyle={{x: 0, y: -20, opacity: 0, scale: 0.9}}
                  exitStyle={{x: 0, y: 10, opacity: 0, scale: 0.95}}
                  x={0}
                  scale={1}
                  opacity={1}
                  y={0}
                  maxWidth={600}
                  gap="$4"
                >
                  <AlertDialog.Title size="$8" fontWeight="bold">
                    Delete Account
                  </AlertDialog.Title>
                  <AlertDialog.Description>
                    Are you really sure? Your account will be removed and can't
                    be recovered unless you have the secret words
                  </AlertDialog.Description>
                  <XStack gap="$3" justifyContent="flex-end">
                    <AlertDialog.Cancel asChild>
                      <Button chromeless>Cancel</Button>
                    </AlertDialog.Cancel>
                    <AlertDialog.Action asChild>
                      <Button theme="red" onPress={handleDeleteCurrentAccount}>
                        Delete Permanently
                      </Button>
                    </AlertDialog.Action>
                  </XStack>
                </AlertDialog.Content>
              </AlertDialog.Portal>
            </AlertDialog>
            <Separator />
            <SettingsSection title="Wallets">
              <AccountWallet
                accountUid={selectedAccount}
                onOpenWallet={(walletId) => setWalletId(walletId)}
              />
            </SettingsSection>
          </YStack>
        </ScrollView>
      </YStack>
    </XStack>
  ) : (
    <YStack
      style={{flex: 1, height: '100%'}}
      ai="center"
      jc="center"
      gap="$4"
      p="$6"
    >
      <YStack
        width={80}
        height={80}
        borderRadius="$6"
        backgroundColor="$color4"
        ai="center"
        jc="center"
      >
        <UserRoundPlus size={50} color="$color11" />
      </YStack>
      <Heading>No Accounts Found</Heading>
      <Paragraph textAlign="center" maxWidth={400} color="$color11">
        Create a new profile to get started with Seed. You'll need to create a
        profile to use all the features.
      </Paragraph>
      <Button
        mt="$4"
        size="$4"
        theme="brand"
        icon={Plus}
        color="white"
        onPress={() => dispatchWizardEvent(true)}
      >
        Create a new Profile
      </Button>
    </YStack>
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
      icon={
        <HMIcon id={id} metadata={entity.data?.document?.metadata} size={24} />
      }
      title={entity.data?.document?.metadata.name || item}
      subTitle={item.substring(item.length - 8)}
      hoverTheme
      pressTheme
      bg={isActive ? '$color5' : undefined}
      onPress={onSelect}
      cursor="default"
      hoverStyle={{cursor: 'default', backgroundColor: '$color6'}}
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
  return (
    <XStack
      alignItems="center"
      space="$6"
      paddingHorizontal="$6"
      borderWidth={1}
      borderRadius={'$4'}
      borderColor="$borderColor"
      padding="$3"
    >
      <Heading fontSize={42}>{experiment.emoji}</Heading>
      <YStack gap="$3" flex={1}>
        <XStack gap="$3" flex={1}>
          <Heading size="$6" marginVertical={0}>
            {experiment.label}
          </Heading>
        </XStack>
        <SizableText>{experiment.description}</SizableText>
        <XStack alignItems="center" jc="space-between">
          {value ? <EnabledTag /> : <View />}
          <Button
            theme={value ? 'red' : 'green'}
            onPress={() => {
              onValue(!value)
            }}
          >
            {value ? 'Disable Feature' : `Enable Feature`}
          </Button>
        </XStack>
      </YStack>
    </XStack>
  )
}

function EnabledTag() {
  return (
    <XStack
      padding="$1"
      paddingHorizontal="$3"
      gap="$3"
      alignItems="center"
      borderRadius="$2"
    >
      <Check size="$1" color="$brand5" />
      <SizableText size="$1" color="$brand5" fontWeight="bold">
        Enabled
      </SizableText>
    </XStack>
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
    <YStack gap="$3">
      <TableList>
        <InfoListHeader title="URL" />
        <TableList.Item>
          <XStack gap="$3" width="100%">
            <Input size="$3" flex={1} value={gwUrl} onChangeText={setGWUrl} />
            <Button
              size="$3"
              onPress={() => {
                setGatewayUrl.mutate(gwUrl)
                toast.success('Public Gateway URL changed!')
              }}
            >
              Save
            </Button>
          </XStack>
        </TableList.Item>
      </TableList>

      <PushOnPublishSetting />
      <PushOnCopySetting />
    </YStack>
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
          <YStack>
            <Paragraph theme="red">Error loading settings.</Paragraph>
            <Button theme="red" size="$2" onPress={() => pushOnCopy.refetch()}>
              Retry
            </Button>
          </YStack>
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
              <XStack key={option.value} gap="$3" ai="center">
                <RadioGroup.Item
                  size="$2"
                  value={option.value}
                  id={`${id}-${option.value}`}
                >
                  <RadioGroup.Indicator />
                </RadioGroup.Item>
                <Label size="$2" htmlFor={`${id}-${option.value}`}>
                  {option.label}
                </Label>
              </XStack>
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
          <YStack>
            <Paragraph theme="red">Error loading settings.</Paragraph>
            <Button
              theme="red"
              size="$2"
              onPress={() => pushOnPublish.refetch()}
            >
              Retry
            </Button>
          </YStack>
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
              <XStack key={option.value} gap="$3" ai="center">
                <RadioGroup.Item
                  size="$2"
                  value={option.value}
                  id={`${id}-${option.value}`}
                >
                  <RadioGroup.Indicator />
                </RadioGroup.Item>
                <Label size="$2" htmlFor={`${id}-${option.value}`}>
                  {option.label}
                </Label>
              </XStack>
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
    <YStack gap="$3">
      <YStack space marginVertical="$4" alignSelf="stretch">
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
      </YStack>
    </YStack>
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
            <Button size="$1" fontWeight="700" disabled>
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
    <YStack gap="$5">
      <TableList>
        <InfoListHeader title="Auto Update" />
        <TableList.Item ai="center">
          <SizableText size="$1" flex={0} minWidth={140} width={140}>
            Check for updates?
          </SizableText>
          <XStack f={1}>
            <XStack f={1}>
              <Checkbox
                id="auto-update"
                checked={autoUpdate.data == 'true'}
                onCheckedChange={(newVal) => {
                  let val = newVal ? 'true' : 'false'
                  // TODO: use the actual type for autoUpdate
                  setAutoUpdate(val as 'true' | 'false')
                }}
              >
                <Checkbox.Indicator>
                  <Check />
                </Checkbox.Indicator>
              </Checkbox>
            </XStack>
            <Tooltip content="Check for app updates automatically on Launch">
              <Button
                size="$1"
                chromeless
                bg="$backgroundTransparent"
                icon={Info}
              />
            </Tooltip>
          </XStack>
        </TableList.Item>
      </TableList>
      <TableList>
        <InfoListHeader
          title="Peer Info"
          right={
            addrs ? (
              <Tooltip content="Copy routing info so others can connect to you">
                <Button
                  size="$2"
                  icon={Copy}
                  onPress={() => {
                    navigator.clipboard.writeText(addrs)
                    toast.success('Copied Routing Address successfully')
                  }}
                >
                  Copy Addresses
                </Button>
              </Tooltip>
            ) : null
          }
        />
        <InfoListItem label="Peer ID" value={deviceInfo?.peerId} />
        <InfoListItem label="Protocol ID" value={deviceInfo?.protocolId} />
        <InfoListItem label="Addresses" value={addrs} />
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
      <TableList marginBottom="$4">
        <InfoListHeader
          title="Bundle Information"
          right={
            <Tooltip content="Copy App Info for Developers">
              <Button
                size="$2"
                icon={Copy}
                onPress={() => {
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
    </YStack>
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
      <ScrollView contentContainerStyle={{flex: 1}}>
        <YStack gap="$4" padding="$4" paddingBottom="$5" f={1}>
          {props.children}
        </YStack>
      </ScrollView>
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
      bg={active ? '$color5' : '$colorTransparent'}
      hoverStyle={{cursor: 'default', bg: '$color6'}}
      {...rest}
    >
      <Icon size={20} />
      <SizableText flex={1} size="$1">
        {label}
      </SizableText>
    </Tabs.Tab>
  )
}

function SettingsSection({
  title,
  children,
}: React.PropsWithChildren<{title: string}>) {
  return (
    <YStack gap="$3">
      <YStack gap="$4">
        <Heading size="$7">{title}</Heading>
        {children}
      </YStack>
    </YStack>
  )
}
