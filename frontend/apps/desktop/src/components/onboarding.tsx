import {grpcClient} from '@/grpc-client'
import {desktopUniversalClient} from '@/desktop-universal-client'
import {
  useDisconnectVault,
  useImportKey,
  useListKeys,
  NamedKey,
  useRegisterKey,
  useStartVaultConnection,
  useVaultStatus,
} from '@/models/daemon'
import {client} from '@/trpc'
import {buildVaultConnectionURL, normalizeVaultOriginURL} from '@/utils/vault-connection'
import {fileUpload} from '@/utils/file-upload'
import {getImportKeyFilePathError, normalizeImportKeyFilePath} from '@/utils/onboarding-import'
import {extractWords, isWordsValid} from '@/utils/onboarding'
import {useNavigate} from '@/utils/useNavigate'
import {UnpackedHypermediaId} from '@seed-hypermedia/client/hm-types'
import {eventStream, postAccountCreateAction, useOpenUrl, useUniversalAppContext} from '@shm/shared'
import {DAEMON_HTTP_URL, IS_PROD_DESKTOP} from '@shm/shared/constants'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {useMutation} from '@tanstack/react-query'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {CheckboxField} from '@shm/ui/components/checkbox'
import {Dialog, DialogContent, DialogOverlay, DialogPortal} from '@shm/ui/components/dialog'
import {Input} from '@shm/ui/components/input'
import {Label} from '@shm/ui/components/label'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {Textarea} from '@shm/ui/components/textarea'
import {Prev as ArrowLeft} from '@shm/ui/icons'
import {Spinner} from '@shm/ui/spinner'
import {SizableText, Text} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {cn} from '@shm/ui/utils'
import {useCallback, useEffect, useMemo, useRef, useState} from 'react'
import {VaultBackendMode, VaultConnectionStatus} from '@shm/shared/client/.generated/daemon/v1alpha/daemon_pb'
import {useAppContext} from '../app-context'
import {
  cleanupOnboardingFormData,
  getOnboardingState,
  ImageData,
  ImageValidationError,
  OnboardingState,
  OnboardingStep,
  resetOnboardingState,
  setHasCompletedOnboarding,
  setHasSkippedOnboarding,
  setInitialAccountIdCount,
  setOnboardingFormData,
  setOnboardingStep,
  validateImage,
} from '../app-onboarding'
import {ImageForm} from '../pages/image-form'
import {
  AnalyticsIcon,
  ArchiveIcon,
  CollabIcon,
  ContentIcon,
  DiscordIcon,
  FullLogoIcon,
  PublishIcon,
} from './onboarding-icons'

interface OnboardingProps {
  onComplete: () => void
  modal?: boolean
}

interface ProfileFormData {
  name: string
  icon?: ImageData
}

export const [dispatchEditPopover, editPopoverEvents] = eventStream<boolean>()
export const [dispatchOnboardingDialog, onboardingDialogEvents] = eventStream<boolean>()

export function OnboardingDialog() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    return onboardingDialogEvents.subscribe((open) => {
      setOpen(open)
    })
  }, [])

  const handleOpenChange = (val: boolean) => {
    dispatchOnboardingDialog(val)
    setOpen(val)
  }

  if (!open) return null

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogContent
          className="no-window-drag h-[90vh] max-h-[900px] min-h-[500px] w-[90vw] max-w-[900px]"
          contentClassName="gap-0 p-0"
          showCloseButton={false}
        >
          <Onboarding
            modal={true}
            onComplete={() => {
              handleOpenChange(false)
            }}
          />
        </DialogContent>
      </DialogPortal>
    </Dialog>
  )
}

export function Onboarding({onComplete, modal = false}: OnboardingProps) {
  // Get the global state
  const globalState = getOnboardingState()
  const navigate = useNavigate('replace')
  const [account, setAccount] = useState<UnpackedHypermediaId | undefined>(undefined)
  const {selectedIdentity, setSelectedIdentity} = useUniversalAppContext()

  // Initialize local state based on whether we're in modal mode
  const [localState, setLocalState] = useState(() => {
    if (modal) {
      // In modal mode, start fresh regardless of global state
      return {
        hasCompletedOnboarding: false,
        hasSkippedOnboarding: false,
        currentStep: 'welcome' as OnboardingStep,
        formData: {
          name: '',
          icon: undefined,
        },
      }
    }
    // In non-modal mode, use global state
    return globalState
  })

  // Only check global state for completion in non-modal mode
  useEffect(() => {
    const state = modal ? localState : globalState
    if (!modal && (state.hasCompletedOnboarding || state.hasSkippedOnboarding)) {
      console.log('Onboarding already completed or skipped, skipping to main app')
      if (account) {
        // Ensure the account is selected when onboarding was previously completed
        setSelectedIdentity?.(account.uid)
        // Navigate to library — vault-created accounts may not have home docs.
        navigate({key: 'library'})
      }
      onComplete()
    }
  }, [
    modal,
    globalState.hasCompletedOnboarding,
    globalState.hasSkippedOnboarding,
    account,
    navigate,
    onComplete,
    setSelectedIdentity,
  ])

  // Initialize step from local state
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(() => {
    console.log('🔄 Initializing onboarding with state:', localState)
    return localState.currentStep
  })

  const handleSkip = useCallback(() => {
    console.group('🚀 Skipping Onboarding')
    const beforeState = modal ? localState : getOnboardingState()
    console.log('Before state:', beforeState)

    if (modal) {
      setLocalState((prev) => ({...prev, hasSkippedOnboarding: true}))
    } else {
      setHasSkippedOnboarding(true)
      // Clean up form data but keep the skipped flag
      cleanupOnboardingFormData()
    }

    const afterState = modal ? localState : getOnboardingState()
    console.log('After state:', afterState)
    console.groupEnd()

    onComplete()
  }, [modal, localState, onComplete])

  const completeOnboarding = useCallback(
    (nextAccount?: UnpackedHypermediaId) => {
      console.log('Completing onboarding')
      if (modal) {
        setLocalState((prev) => ({...prev, hasCompletedOnboarding: true}))
      } else {
        setHasCompletedOnboarding(true)
        cleanupOnboardingFormData()
      }

      const resolvedAccount = nextAccount ?? account
      if (resolvedAccount) {
        setSelectedIdentity?.(resolvedAccount.uid)
        navigate({key: 'library'})
      }

      onComplete()
    },
    [account, modal, navigate, onComplete, setSelectedIdentity],
  )

  const handleNext = useCallback(() => {
    console.group('🚀 Next Step in Onboarding')
    const beforeState = modal ? localState : getOnboardingState()
    console.log('Before - Local step:', currentStep)
    console.log('Before - Store state:', beforeState)

    if (currentStep === 'welcome') {
      console.log('Moving from welcome to profile')
      if (modal) {
        setLocalState((prev) => ({...prev, currentStep: 'profile'}))
      } else {
        setOnboardingStep('profile')
      }
      setCurrentStep('profile')
    } else if (currentStep === 'profile') {
      console.log('Moving from profile to vault')
      if (modal) {
        setLocalState((prev) => ({...prev, currentStep: 'vault'}))
      } else {
        setOnboardingStep('vault')
      }
      setCurrentStep('vault')
    } else if (currentStep === 'vault') {
      console.log('Moving from vault to create account')
      if (modal) {
        setLocalState((prev) => ({...prev, currentStep: 'recovery'}))
      } else {
        setOnboardingStep('recovery')
      }
      setCurrentStep('recovery')
    } else if (currentStep === 'recovery') {
      console.log('Moving from create account to ready')
      if (modal) {
        setLocalState((prev) => ({...prev, currentStep: 'ready'}))
      } else {
        setOnboardingStep('ready')
      }
      setCurrentStep('ready')
    } else if (currentStep === 'existing') {
      console.log('Moving from restore from phrase to ready')
      if (modal) {
        setLocalState((prev) => ({...prev, currentStep: 'ready'}))
      } else {
        setOnboardingStep('ready')
      }
      setCurrentStep('ready')
    } else if (currentStep === 'import') {
      console.log('Moving from import to ready')
      if (modal) {
        setLocalState((prev) => ({...prev, currentStep: 'ready'}))
      } else {
        setOnboardingStep('ready')
      }
      setCurrentStep('ready')
    } else if (currentStep === 'ready') {
      if (modal) {
        setInitialAccountIdCount(globalState.initialAccountIdCount + 1)
      }
      completeOnboarding()
    }

    const afterState = modal ? localState : getOnboardingState()
    console.log('After - Store state:', afterState)
    console.groupEnd()
  }, [currentStep, modal, localState, completeOnboarding, globalState.initialAccountIdCount])

  const handleRestoreFromRecoveryPhrase = useCallback(() => {
    if (modal) {
      setLocalState((prev) => ({...prev, currentStep: 'existing'}))
    } else {
      setOnboardingStep('existing')
    }
    setCurrentStep('existing')
  }, [modal])

  const handleImportKeyFile = useCallback(() => {
    if (modal) {
      setLocalState((prev) => ({...prev, currentStep: 'import'}))
    } else {
      setOnboardingStep('import')
    }
    setCurrentStep('import')
  }, [modal])

  const handlePrev = useCallback(() => {
    console.group('🚀 Previous Step in Onboarding')
    const beforeState = modal ? localState : getOnboardingState()
    console.log('Before - Local step:', currentStep)
    console.log('Before - Store state:', beforeState)

    if (currentStep === 'recovery') {
      if (modal) {
        setLocalState((prev) => ({...prev, currentStep: 'vault'}))
      } else {
        setOnboardingStep('vault')
      }
      setCurrentStep('vault')
    } else if (currentStep === 'vault') {
      if (modal) {
        setLocalState((prev) => ({...prev, currentStep: 'profile'}))
      } else {
        setOnboardingStep('profile')
      }
      setCurrentStep('profile')
    } else if (currentStep === 'profile') {
      if (modal) {
        setLocalState((prev) => ({...prev, currentStep: 'welcome'}))
      } else {
        setOnboardingStep('welcome')
      }
      setCurrentStep('welcome')
    } else if (currentStep === 'existing') {
      if (modal) {
        setLocalState((prev) => ({...prev, currentStep: 'vault'}))
      } else {
        setOnboardingStep('vault')
      }
      setCurrentStep('vault')
    } else if (currentStep === 'import') {
      if (modal) {
        setLocalState((prev) => ({...prev, currentStep: 'vault'}))
      } else {
        setOnboardingStep('vault')
      }
      setCurrentStep('vault')
    }

    const afterState = modal ? localState : getOnboardingState()
    console.log('After - Store state:', afterState)
    console.groupEnd()
  }, [currentStep, modal, localState])

  async function handleSubscription(id: UnpackedHypermediaId) {
    console.log('[Onboarding] Starting subscription for account:', {
      uid: id.uid,
      path: '/',
      recursive: true,
    })

    try {
      await grpcClient.subscriptions.subscribe({
        account: id.uid,
        path: '',
        recursive: true,
      })
      invalidateQueries([queryKeys.SUBSCRIPTIONS])
      console.log('[Onboarding] Successfully subscribed to account:', id.uid)
    } catch (error) {
      console.error('[Onboarding] Failed to subscribe to new account!', {
        error,
        accountId: id.uid,
      })
    }
  }

  return (
    <div className={cn('bg-background window-drag flex flex-1 flex-col', !modal && 'size-full')}>
      {currentStep === 'welcome' && <WelcomeStep onNext={handleNext} />}
      {currentStep === 'profile' && <ProfileStep onSkip={handleSkip} onNext={handleNext} onPrev={handlePrev} />}
      {currentStep === 'vault' && (
        <VaultStep
          initialAccountIdCount={globalState.initialAccountIdCount}
          onNext={handleNext}
          onPrev={handlePrev}
          onUseRecoveryPhrase={handleRestoreFromRecoveryPhrase}
          onImportKeyFile={handleImportKeyFile}
          onRemoteAccountsReady={(accountId, accountCount) => {
            const syncedAccount = hmId(accountId)
            console.log('🔄 Resolved remote-synced account during onboarding:', syncedAccount)
            setAccount(syncedAccount)
            setSelectedIdentity?.(syncedAccount.uid)
            handleSubscription(syncedAccount)
            setInitialAccountIdCount(accountCount)
            toast.success('Remote vault connected and accounts synced to this device.')
            completeOnboarding(syncedAccount)
          }}
        />
      )}
      {currentStep === 'recovery' && (
        <CreateAccountStep
          onNext={handleNext}
          onPrev={handlePrev}
          onAccountCreate={(id) => {
            console.log('🔄 Setting account:', id)
            setAccount(id)
            setSelectedIdentity?.(id.uid)
            handleSubscription(id)
            setInitialAccountIdCount(globalState.initialAccountIdCount + 1)
          }}
        />
      )}
      {currentStep === 'existing' && (
        <RestoreFromPhraseStep
          onNext={handleNext}
          onPrev={handlePrev}
          onAccountCreate={(id) => {
            console.log('🔄 Setting account:', id)
            setAccount(id)
            setSelectedIdentity?.(id.uid)
            handleSubscription(id)
            setInitialAccountIdCount(globalState.initialAccountIdCount + 1)
          }}
        />
      )}
      {currentStep === 'import' && (
        <ImportKeyStep
          onNext={handleNext}
          onPrev={handlePrev}
          onAccountCreate={(id) => {
            console.log('🔄 Setting account:', id)
            setAccount(id)
            setSelectedIdentity?.(id.uid)
            handleSubscription(id)
            setInitialAccountIdCount(globalState.initialAccountIdCount + 1)
          }}
        />
      )}
      {currentStep === 'ready' && <ReadyStep onComplete={handleNext} />}
      <OnboardingProgress currentStep={currentStep} />
    </div>
  )
}

function WelcomeStep({onNext}: {onNext: () => void}) {
  return (
    <StepWrapper>
      <FullLogoIcon />
      <StepTitle>WELCOME TO THE OPEN WEB</StepTitle>
      <div className="flex w-full flex-1 items-center gap-6 px-0">
        <div className="flex w-[200px] flex-1 flex-col items-center justify-start gap-4 rounded-lg p-2">
          <div className="flex flex-1 justify-center">
            <CollabIcon />
          </div>
          <div className="flex h-20 justify-start">
            <Text size="lg" className="text-secondary-foreground text-center">
              Collaborate With Your Peers
            </Text>
          </div>
        </div>

        <div className="flex w-[200px] flex-1 flex-col items-center justify-start gap-4 rounded-lg p-2">
          <div className="flex flex-1 justify-center">
            <PublishIcon />
          </div>
          <div className="flex h-20 justify-start">
            <Text size="lg" className="text-secondary-foreground text-center">
              Publish To The Web
            </Text>
          </div>
        </div>

        <div className="flex w-[200px] flex-1 flex-col items-center justify-start gap-4 rounded-lg p-2">
          <div className="flex flex-1 justify-center">
            <ArchiveIcon />
          </div>
          <div className="flex h-20 justify-start">
            <Text size="lg" className="text-secondary-foreground text-center">
              Archive Content, Available Offline
            </Text>
          </div>
        </div>
      </div>

      <div className="no-window-drag flex flex-col items-center gap-4">
        {/* <Button
          variant="outlined"
          onPress={() => openUrl('https://seed.hyper.media')}
          icon={ExternalLink}
          chromeless
          hoverStyl4={{
            backgroundColor: '$brand11',
            borderColor: 'transparent',
          }}
          focusStyle={{
            backgroundColor: '$brand11',
            borderColor: 'transparent',
          }}
        >
          Getting Started Guides
        </Button> */}
        <Button variant="default" onClick={onNext} id="welcome-next">
          NEXT
        </Button>
      </div>
    </StepWrapper>
  )
}

function ProfileStep({onSkip, onNext, onPrev}: {onSkip?: () => void; onNext: () => void; onPrev: () => void}) {
  // Initialize form data from store
  const [formData, setFormData] = useState<ProfileFormData>(() => {
    const state = getOnboardingState()
    return {
      name: state.formData.name || '',
      icon: state.formData.icon,
    }
  })

  const handleImageUpload = async (file: File) => {
    try {
      const imageData = await fileToImageData(file)
      const newData = {
        ...formData,
        icon: imageData,
      }
      setFormData(newData)
      setOnboardingFormData(newData)
    } catch (error) {
      if (error instanceof ImageValidationError) {
        toast.error(error.message)
      } else {
        toast.error('Failed to process image')
        console.error('Image processing error:', error)
      }
    }
  }

  const handleImageRemove = () => {
    const newData = {
      ...formData,
      icon: undefined,
    }
    setFormData(newData)
    setOnboardingFormData(newData)
  }

  const updateFormData = (updates: Partial<ProfileFormData>) => {
    const newData = {...formData, ...updates}
    setFormData(newData)
    setOnboardingFormData(newData)
  }

  useEffect(() => {
    return () => {
      setFormData({
        name: '',
        icon: undefined,
      })
    }
  }, [])

  return (
    <StepWrapper onPrev={onPrev}>
      <StepTitle>CREATE YOUR SITE</StepTitle>
      <Text size="lg" className="text-muted-foreground text-center">
        Your site is more than just a collection of pages, it's a reflection of who you are or what your brand stands
        for. Whether it's personal, professional, or creative, this is your space to shine.
      </Text>

      <form
        onSubmit={(e) => {
          e.preventDefault()
          onNext()
        }}
        className="no-window-drag flex w-full max-w-[400px] flex-1 flex-col gap-4 pt-4"
      >
        <div className="no-window-drag flex w-full flex-1 flex-col gap-4 pt-4">
          <div className="flex flex-col">
            <Label htmlFor="account-name">Account Name</Label>
            <Input
              id="account-name"
              value={formData.name}
              onChange={(e) => {
                const text = e.target.value
                updateFormData({name: text})
              }}
              placeholder="Enter your account name"
            />
          </div>

          <div className="flex min-h-[100px] w-full max-w-[100px] min-w-[100px] flex-none flex-col gap-2">
            <Text size="sm" className="text-muted-foreground">
              Site Icon
            </Text>
            <ImageForm
              height={100}
              emptyLabel="SITE ICON"
              suggestedSize="512px x 512px"
              url={formData.icon?.base64}
              uploadOnChange={false}
              onImageUpload={(file) => {
                if (file instanceof File) {
                  handleImageUpload(file)
                }
              }}
              onRemove={() => handleImageRemove()}
            />
          </div>
        </div>
        <div className="no-window-drag flex flex-col gap-4 self-center">
          <div className="no-window-drag mt-8 flex items-center justify-center gap-4">
            {onSkip && (
              <Button type="button" onClick={onSkip} variant="link" id="profile-skip">
                SKIP
              </Button>
            )}
            <Button id="profile-next" disabled={!formData.name.trim()} onClick={onNext} variant="default">
              NEXT
            </Button>
          </div>
        </div>
      </form>
    </StepWrapper>
  )
}

function modeFromBackend(backendMode: VaultBackendMode | undefined): 'local' | 'remote' {
  return backendMode === VaultBackendMode.REMOTE ? 'remote' : 'local'
}

function statusFromConnection(connectionStatus: VaultConnectionStatus | undefined): 'connected' | 'disconnected' {
  return connectionStatus === VaultConnectionStatus.CONNECTED ? 'connected' : 'disconnected'
}

function VaultStep({
  initialAccountIdCount,
  onNext,
  onPrev,
  onUseRecoveryPhrase,
  onImportKeyFile,
  onRemoteAccountsReady,
}: {
  initialAccountIdCount: number
  onNext: () => void
  onPrev: () => void
  onUseRecoveryPhrase: () => void
  onImportKeyFile: () => void
  onRemoteAccountsReady: (accountId: string, accountCount: number) => void
}) {
  const openUrl = useOpenUrl()
  const vaultStatus = useVaultStatus()
  const startVaultConnection = useStartVaultConnection()
  const disconnectVault = useDisconnectVault()
  const [selectedMode, setSelectedMode] = useState<'local' | 'remote'>('local')
  const [remoteVaultURL, setRemoteVaultURL] = useState('')
  const listKeys = useListKeys({
    refetchInterval:
      selectedMode === 'remote' && statusFromConnection(vaultStatus.data?.connectionStatus) === 'connected'
        ? 2_000
        : false,
  })
  const hasResolvedRemoteAccounts = useRef(false)

  useEffect(() => {
    setSelectedMode(modeFromBackend(vaultStatus.data?.backendMode))
  }, [vaultStatus.data?.backendMode])

  useEffect(() => {
    if (vaultStatus.data?.remoteVaultUrl) {
      setRemoteVaultURL(vaultStatus.data.remoteVaultUrl)
    }
  }, [vaultStatus.data?.remoteVaultUrl])

  const connectionState = statusFromConnection(vaultStatus.data?.connectionStatus)
  const isPending = startVaultConnection.isPending || disconnectVault.isPending
  const canContinue = selectedMode === 'local' || connectionState === 'connected'

  useEffect(() => {
    if (selectedMode !== 'remote' || connectionState !== 'connected') {
      hasResolvedRemoteAccounts.current = false
      return
    }
    if (initialAccountIdCount !== 0 || hasResolvedRemoteAccounts.current) {
      return
    }

    const syncedKeys = listKeys.data ?? []
    if (syncedKeys.length === 0) {
      return
    }

    hasResolvedRemoteAccounts.current = true
    onRemoteAccountsReady(syncedKeys[0].accountId, syncedKeys.length)
  }, [connectionState, initialAccountIdCount, listKeys.data, onRemoteAccountsReady, selectedMode])

  const handleDisconnect = async () => {
    try {
      await disconnectVault.mutateAsync()
      setSelectedMode('local')
      toast.success('Remote vault disconnected')
      return true
    } catch (error) {
      toast.error('Failed to disconnect remote vault: ' + (error instanceof Error ? error.message : String(error)))
      return false
    }
  }

  const handleModeChange = async (nextMode: 'local' | 'remote') => {
    setSelectedMode(nextMode)
    if (nextMode === 'remote') {
      return
    }

    const daemonMode = modeFromBackend(vaultStatus.data?.backendMode)
    if (daemonMode === 'remote' || connectionState === 'connected') {
      const disconnected = await handleDisconnect()
      if (!disconnected) {
        setSelectedMode('remote')
      }
    }
  }

  const handleStartConnection = async () => {
    let normalizedVaultURL = ''
    try {
      normalizedVaultURL = normalizeVaultOriginURL(remoteVaultURL, 'vault URL')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Invalid vault URL')
      return
    }

    try {
      const handoff = await startVaultConnection.mutateAsync({
        vaultUrl: normalizedVaultURL,
        force: connectionState === 'connected',
      })
      const browserURL = buildVaultConnectionURL(handoff.vaultUrl, handoff.handoffToken, DAEMON_HTTP_URL)
      openUrl(browserURL)
      toast.success('Opened browser handoff. Complete sign-in, then return here.')
    } catch (error) {
      toast.error('Failed to start vault connection: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  return (
    <StepWrapper onPrev={onPrev}>
      <StepTitle>CHOOSE YOUR VAULT</StepTitle>
      <Text size="lg" className="text-muted-foreground max-w-[520px] text-center">
        First choose where Seed should keep your encrypted vault. After that you can create a new account, restore from
        an existing recovery phrase, or import a key file.
      </Text>

      <div className="flex w-full max-w-[520px] flex-1 flex-col gap-4 pt-4">
        <div className="border-border bg-background/70 flex flex-col gap-3 rounded-lg border p-4">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="vault-mode"
              checked={selectedMode === 'local'}
              onChange={() => handleModeChange('local')}
              disabled={isPending}
            />
            <div className="flex flex-col gap-1">
              <Text size="lg">Local only</Text>
              <Text size="sm" className="text-muted-foreground">
                Keep your encrypted vault on this device only.
              </Text>
            </div>
          </label>
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="vault-mode"
              checked={selectedMode === 'remote'}
              onChange={() => handleModeChange('remote')}
              disabled={isPending}
            />
            <div className="flex flex-col gap-1">
              <Text size="lg">Remote sync</Text>
              <Text size="sm" className="text-muted-foreground">
                Keep the same encrypted vault here and sync a remote copy for multi-device continuity.
              </Text>
            </div>
          </label>
        </div>

        {selectedMode === 'remote' ? (
          <div className="border-border bg-background/70 flex flex-col gap-4 rounded-lg border p-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="onboarding-vault-url">Remote Vault URL</Label>
              <Input
                id="onboarding-vault-url"
                value={remoteVaultURL}
                onChange={(event) => setRemoteVaultURL(event.currentTarget.value)}
                placeholder="https://example.com/vault"
                disabled={isPending}
              />
            </div>
            <Text size="sm" className="text-muted-foreground">
              Open the browser handoff to sign in and connect this device before continuing.
            </Text>
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={handleStartConnection} disabled={isPending || !remoteVaultURL.trim()}>
                {connectionState === 'connected' ? 'Reconnect in Browser' : 'Connect in Browser'}
              </Button>
              {connectionState === 'connected' ? (
                <Button variant="outline" onClick={handleDisconnect} disabled={isPending}>
                  Disconnect
                </Button>
              ) : null}
              <Text
                size="sm"
                className={cn(connectionState === 'connected' ? 'text-green-700' : 'text-muted-foreground')}
              >
                {connectionState === 'connected' ? 'Remote vault connected.' : 'Waiting for connection.'}
              </Text>
            </div>
            {vaultStatus.data?.syncStatus?.lastSyncError ? (
              <Text size="sm" className="text-destructive">
                {vaultStatus.data.syncStatus.lastSyncError}
              </Text>
            ) : null}
          </div>
        ) : (
          <div className="border-border bg-background/70 rounded-lg border p-4">
            <Text size="sm" className="text-muted-foreground">
              You can add remote sync later from Settings.
            </Text>
          </div>
        )}

        <div className="mt-auto flex flex-col items-center gap-3">
          <Button variant="default" onClick={onNext} disabled={!canContinue}>
            CREATE NEW ACCOUNT
          </Button>
          <div className="flex flex-col items-center gap-1">
            <Button type="button" size="sm" variant="link" onClick={onUseRecoveryPhrase} disabled={!canContinue}>
              Restore from Recovery Phrase
            </Button>
            <Button type="button" size="sm" variant="link" onClick={onImportKeyFile} disabled={!canContinue}>
              Import Key File
            </Button>
          </div>
        </div>
      </div>
    </StepWrapper>
  )
}

function ImportKeyStep({
  onNext,
  onPrev,
  onAccountCreate,
}: {
  onNext: () => void
  onPrev: () => void
  onAccountCreate: (id: UnpackedHypermediaId) => void
}) {
  const {pickKeyImportFile} = useAppContext()
  const importKey = useImportKey()
  const [filePath, setFilePath] = useState('')
  const [password, setPassword] = useState('')
  const [submitError, setSubmitError] = useState<string | null>(null)

  const handleChooseFile = async () => {
    try {
      const selectedPath = await pickKeyImportFile()
      if (!selectedPath) return

      setFilePath(selectedPath)
      setSubmitError(null)
    } catch (error) {
      console.error('❌ Failed to open key import file picker:', error)
      toast.error('Failed to open file picker')
    }
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()

    const normalizedPath = normalizeImportKeyFilePath(filePath)
    const validationError = getImportKeyFilePathError(normalizedPath)

    setFilePath(normalizedPath)

    if (validationError) {
      setSubmitError(validationError)
      return
    }

    try {
      const importedAccount = await importKey.mutateAsync({
        filePath: normalizedPath,
        password: password.length > 0 ? password : undefined,
      })
      setSubmitError(null)
      onAccountCreate(hmId(importedAccount.accountId))
      onNext()
    } catch (error) {
      console.error('❌ Failed to import account key:', error)
      const message = error instanceof Error ? error.message : 'Unknown import error'
      setSubmitError(message)
      toast.error('Failed to import key: ' + message)
    }
  }

  return (
    <StepWrapper onPrev={onPrev}>
      <StepTitle>IMPORT KEY FILE</StepTitle>
      <Text size="lg" className="text-muted-foreground text-center">
        Choose an exported `.hmkey.json` file. Seed passes the selected file path (and optional password) to the daemon,
        which reads the key file directly from disk.
      </Text>

      <form onSubmit={handleSubmit} className="flex w-full max-w-[420px] flex-1 flex-col gap-4 pt-4">
        <div className="border-border bg-background/70 flex flex-col gap-2 rounded-lg border p-4">
          <Text size="sm" className="text-secondary-foreground">
            Leave password empty for plaintext exports. Enter a password only if the key file was exported with
            encryption.
          </Text>
        </div>

        {filePath ? (
          <div className="flex flex-col gap-2">
            <Text size="sm" className="text-muted-foreground">
              Selected File
            </Text>
            <div className="border-border bg-background rounded-md border px-3 py-2">
              <Text size="sm" className="font-mono break-all">
                {filePath}
              </Text>
            </div>
          </div>
        ) : null}

        {submitError ? (
          <Text size="sm" className="text-destructive">
            {submitError}
          </Text>
        ) : null}

        <div className="flex flex-col gap-2">
          <Label htmlFor="import-key-password">Password (optional)</Label>
          <Input
            id="import-key-password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.currentTarget.value)}
            autoComplete="off"
            placeholder="Only needed for encrypted files"
          />
        </div>

        <div className="mt-auto flex gap-4">
          <Button type="button" variant="outline" className="flex-1" onClick={handleChooseFile}>
            Choose File
          </Button>
          <Button type="submit" variant="default" className="flex-1" disabled={importKey.isPending}>
            {importKey.isPending ? 'IMPORTING...' : 'IMPORT KEY'}
          </Button>
        </div>
      </form>
    </StepWrapper>
  )
}

function RestoreFromPhraseStep({
  onNext,
  onPrev,
  onAccountCreate,
}: {
  onNext: () => void
  onPrev: () => void
  onAccountCreate: (id: UnpackedHypermediaId) => void
}) {
  const [secretWords, setSecretWords] = useState('')
  const register = useRegisterKey()
  const saveWords = useMutation({
    mutationFn: (input: Parameters<typeof client.secureStorage.write.mutate>[0]) =>
      client.secureStorage.write.mutate(input),
  })
  const [shouldSaveWords, setShouldSaveWords] = useState(true)

  const mnemonic = useMemo(() => {
    return extractWords(secretWords)
  }, [secretWords])

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()

    try {
      // Validate mnemonic
      const validation = isWordsValid(secretWords)
      if (validation !== true) {
        toast.error(typeof validation === 'string' ? validation : 'Invalid mnemonic')
        console.log('Invalid mnemonic', mnemonic)
        return
      }

      // Create the Account
      let createdAccount
      try {
        console.group('👤 Creating Account from Existing Mnemonics')
        if (!secretWords.trim()) {
          throw new Error('Mnemonics not found')
        }

        createdAccount = await register.mutateAsync({
          mnemonic,
        })
        console.log('✅ Account created:', createdAccount)
        console.groupEnd()
      } catch (error) {
        console.error('❌ Failed to create account:', error)
        toast.error('Failed to create account: ' + (error as Error).message)
        return
      }

      // Save mnemonics to secure storage only if checkbox is checked
      try {
        console.group('💾 Saving Mnemonics')
        console.log('Saving to key:', createdAccount.publicKey)
        console.log('Should save words:', shouldSaveWords)

        if (shouldSaveWords) {
          saveWords.mutate({key: createdAccount.publicKey, value: secretWords})
          console.log('✅ Mnemonics saved')
        } else {
          console.log('⏭️ Skipping mnemonic save as per user preference')
        }
        console.groupEnd()
      } catch (error) {
        console.error('❌ Failed to save mnemonics:', error)
        toast.error('Failed to save mnemonics: ' + (error as Error).message)
        return
      }

      onAccountCreate(hmId(createdAccount.accountId))
      onNext()
    } catch (error) {
      console.error('❌ Existing account setup failed:', error)
      toast.error('Failed to setup account: ' + (error as Error).message)
    }
  }

  return (
    <StepWrapper onPrev={onPrev}>
      <StepTitle>ADD EXISTING KEY</StepTitle>
      <Text size="lg" className="text-muted-foreground text-center">
        Add the keys to your existing site.
      </Text>

      <form onSubmit={handleSubmit} className="flex w-full max-w-[400px] flex-1 flex-col gap-4 pt-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Text size="sm" className="text-muted-foreground">
              Secret Recovery Phrase
            </Text>
            <Textarea
              placeholder="Enter or paste your Secret Recovery Phrase here..."
              value={secretWords}
              onChange={(e) => setSecretWords(e.target.value)}
              className="no-window-drag resize-none bg-white opacity-100!"
            />
          </div>

          <CheckboxField
            id="save-existing-wordss"
            checked={shouldSaveWords}
            onCheckedChange={(v) => setShouldSaveWords(v === 'indeterminate' ? false : v)}
            variant="brand"
          >
            Store the Secret Recovery Phrase securely on this device.
          </CheckboxField>
        </div>
        <div className="flex-1" />
        <div className="no-window-drag mt-8 flex items-center justify-center gap-4">
          <Button type="submit" variant="default" disabled={!secretWords.trim()}>
            NEXT
          </Button>
        </div>
      </form>
    </StepWrapper>
  )
}

function CreateAccountStep({
  onNext,
  onPrev,
  onAccountCreate,
}: {
  onNext: () => void
  onPrev: () => void
  onAccountCreate: (id: UnpackedHypermediaId) => void
}) {
  const register = useRegisterKey()
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const hasStarted = useRef(false)
  const generatedMnemonicRef = useRef<string[] | null>(null)
  const createdAccountRef = useRef<NamedKey | null>(null)
  const [formData] = useState<ProfileFormData>(() => {
    const state = getOnboardingState()
    return {
      name: state.formData.name || '',
      icon: state.formData.icon,
    }
  })

  async function handleSubmit() {
    try {
      setIsSubmitting(true)
      setSubmitError(null)
      console.group('📝 Starting Profile Submission')
      console.log('Current form data:', formData)

      let icon = ''
      try {
        console.group('🖼️ Processing Images')
        if (formData.icon) {
          const iconFile = base64ToFile(formData.icon)
          const ipfsIcon = await fileUpload(iconFile)
          icon = ipfsIcon
          console.log('✅ Icon uploaded to IPFS:', icon)
        } else {
          console.log('ℹ️ No icon to process')
        }
        console.groupEnd()
      } catch (error) {
        console.error('❌ Failed to upload images:', error)
        throw new Error('Failed to upload images: ' + (error as Error).message)
      }

      let createdAccount
      try {
        console.group('👤 Creating Account')
        createdAccount = createdAccountRef.current
        if (!createdAccount) {
          if (!generatedMnemonicRef.current) {
            const mnemonicResponse = await grpcClient.daemon.genMnemonic({})
            if (!mnemonicResponse.mnemonic.length) {
              throw new Error('Mnemonic generation failed')
            }
            generatedMnemonicRef.current = [...mnemonicResponse.mnemonic]
          }

          createdAccount = await register.mutateAsync({
            mnemonic: generatedMnemonicRef.current,
          })
          createdAccountRef.current = createdAccount
        }
        console.log('✅ Account created:', createdAccount)
        console.groupEnd()
      } catch (error) {
        console.error('❌ Failed to create account:', error)
        throw new Error('Failed to create account: ' + (error as Error).message)
      }

      try {
        console.group('📝 Creating Profile')
        await grpcClient.documents.updateProfile({
          account: createdAccount.accountId,
          profile: {
            name: formData.name,
            icon: icon ? `ipfs://${icon}` : '',
          },
          signingKeyName: createdAccount.publicKey,
        })

        const id = hmId(createdAccount.accountId)
        invalidateQueries([queryKeys.ACCOUNT, id.uid])
        invalidateQueries([queryKeys.LIST_ROOT_DOCUMENTS])
        console.log('✅ Profile created')
        console.groupEnd()
      } catch (error) {
        console.error('❌ Failed to create profile:', error)
        throw new Error('Failed to create profile: ' + (error as Error).message)
      }

      cleanupOnboardingFormData()
      onAccountCreate(hmId(createdAccount.accountId))
      await postAccountCreateAction(
        {
          accountUid: createdAccount.accountId,
        },
        {
          getSigner: desktopUniversalClient.getSigner!,
          publish: desktopUniversalClient.publish,
        },
      )
      console.groupEnd()
      onNext()
    } catch (error) {
      console.error('❌ Profile submission failed:', error)
      console.groupEnd()
      const message = error instanceof Error ? error.message : String(error)
      setSubmitError(message)
      toast.error('Account creation failed: ' + message)
    } finally {
      setIsSubmitting(false)
    }
  }

  useEffect(() => {
    if (hasStarted.current) return
    hasStarted.current = true
    handleSubmit()
  }, [])

  return (
    <StepWrapper onPrev={isSubmitting ? undefined : onPrev}>
      <StepTitle>CREATING YOUR SITE</StepTitle>
      <div className="no-window-drag flex w-full max-w-[420px] flex-1 flex-col items-center justify-center gap-4 text-center">
        <Text size="xl" className="text-muted-foreground">
          Seed is creating your account and storing it in this device&apos;s encrypted local vault.
        </Text>
        <Text size="sm" className="text-muted-foreground max-w-[360px]">
          Your account is being set up in this device&apos;s encrypted local vault.
        </Text>

        {isSubmitting ? (
          <div className="flex flex-col items-center gap-3">
            <Spinner />
            <Text size="sm" className="text-muted-foreground">
              This should only take a moment.
            </Text>
          </div>
        ) : submitError ? (
          <>
            <Text size="sm" className="text-destructive">
              {submitError}
            </Text>
            <div className="flex gap-3">
              <Button
                variant="outline"
                onClick={() => {
                  handleSubmit()
                }}
              >
                Retry
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </StepWrapper>
  )
}

function ReadyStep({onComplete}: {onComplete: () => void}) {
  const openUrl = useOpenUrl()

  return (
    <StepWrapper>
      <StepTitle>READY TO GO</StepTitle>
      <div className="no-window-drag mt-8 flex max-w-[400px] flex-col gap-4">
        <div
          className="flex h-auto items-center gap-4 rounded-md bg-blue-200 p-4 transition-colors hover:bg-blue-300"
          onClick={() => openUrl('https://discord.gg/7Y7DrhQZFs')}
        >
          <DiscordIcon className="size-13 shrink-0" />
          <div className="flex flex-1 flex-col">
            <SizableText weight="light" className="text-secondary-foreground">
              Join our Discord
            </SizableText>
            <SizableText size="sm" className="text-muted-foreground">
              Here you will be able to get support and send feedback.
            </SizableText>
          </div>
        </div>
        <div className="bg-brand-8/20 dark:bg-brand-6/20 flex h-auto items-center gap-4 rounded-md p-4 transition-colors">
          <ContentIcon className="size-13 shrink-0" />
          <div className="flex flex-1 flex-col">
            <SizableText weight="light" className="text-secondary-foreground">
              All Content is Public
            </SizableText>
            <SizableText size="sm" className="text-muted-foreground">
              all content created using Seed Hypermedia is public by default, meaning it can be accessed and shared by
              others within the network
            </SizableText>
          </div>
        </div>
        <div className="bg-brand-8/20 dark:bg-brand-6/20 flex h-auto items-center gap-4 rounded-md p-4 transition-colors">
          <AnalyticsIcon className="size-13 shrink-0" />
          <div className="flex flex-1 flex-col">
            <SizableText weight="light" className="text-secondary-foreground">
              Analytics
            </SizableText>
            <SizableText size="sm" className="text-muted-foreground">
              We collect anonymous analytics to improve your experience and enhance the platform.
            </SizableText>
          </div>
        </div>
        <Button variant="default" onClick={onComplete}>
          DONE
        </Button>
      </div>
    </StepWrapper>
  )
}

export function OnboardingDebugBox() {
  const [state, setState] = useState<OnboardingState>(getOnboardingState())

  useEffect(() => {
    // Update state every second to see changes
    const interval = setInterval(() => {
      setState(getOnboardingState())
    }, 1000)

    return () => clearInterval(interval)
  }, [])

  if (IS_PROD_DESKTOP) return null

  return (
    <div className="bg-background border-border no-window-drag absolute top-4 right-4 z-40 max-h-[300px] w-[300px] rounded-lg border p-2 opacity-80 shadow-lg">
      <ScrollArea>
        <div className="p-3">
          <Text size="md" style={{fontFamily: 'monospace'}}>
            Debug: Onboarding State
          </Text>
          <Text size="sm" style={{fontFamily: 'monospace'}} className="text-muted-foreground">
            {JSON.stringify(state, null, 2)}
          </Text>
        </div>
      </ScrollArea>
    </div>
  )
}

function StepTitle({children}: {children: React.ReactNode}) {
  return (
    <Text size="4xl" className="no-window-drag text-primary text-center">
      {children}
    </Text>
  )
}

function StepWrapper({children, onPrev}: {children: React.ReactNode; onPrev?: () => void}) {
  return (
    <>
      <div className="window-drag bg-primary flex flex-1 flex-col items-center justify-center gap-4 bg-gradient-to-b from-green-50 to-green-100 p-4">
        <div className="no-window-drag flex h-[600px] w-[600px] flex-col items-center justify-center gap-6">
          {onPrev ? (
            <div className="no-window-drag absolute top-10 left-15 z-40">
              <Button size="icon" onClick={onPrev}>
                <ArrowLeft className="text-secondary-foreground size-5" />
              </Button>
            </div>
          ) : null}
          {children}
        </div>
      </div>
    </>
  )
}

function OnboardingProgress({currentStep}: {currentStep: OnboardingStep}) {
  const showExistingStep = currentStep === 'existing' || currentStep === 'import'

  return (
    <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 transform gap-2 pt-4">
      <OnboardingProgressStep active={currentStep === 'welcome'} />
      <OnboardingProgressStep active={currentStep === 'profile'} />
      <OnboardingProgressStep active={currentStep === 'vault'} />
      {showExistingStep ? (
        <OnboardingProgressStep active={currentStep === 'existing' || currentStep === 'import'} />
      ) : (
        <OnboardingProgressStep active={currentStep === 'recovery'} />
      )}
      <OnboardingProgressStep active={currentStep === 'ready'} />
    </div>
  )
}

function OnboardingProgressStep({active}: {active: boolean}) {
  return <div className={cn('h-2 w-2 rounded-full', active ? 'bg-primary' : 'bg-gray-300')} />
}

async function fileToImageData(file: File): Promise<ImageData> {
  // Validate the file first
  validateImage(file)

  // Convert to base64
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve({
        base64: reader.result as string,
        type: file.type,
        name: file.name,
        size: file.size,
      })
    }
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

function base64ToFile(imageData: ImageData): File {
  // Convert base64 to blob
  // @ts-ignore
  const byteString = atob(imageData.base64.split(',')[1])
  const ab = new ArrayBuffer(byteString.length)
  const ia = new Uint8Array(ab)
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i)
  }
  const blob = new Blob([ab], {type: imageData.type})

  // Create File from blob
  return new File([blob], imageData.name, {type: imageData.type})
}

// gift, general, police, ticket, slogan, outdoor, health, hockey, wool, taste, dignity, yard

// This component creates a small floating button to reset the onboarding state
// Only shown when explicitly enabled or in development mode
export function ResetOnboardingButton() {
  const handleReset = () => {
    resetOnboardingState()
    toast.success('Onboarding state reset! Refresh to see changes.')
  }

  if (IS_PROD_DESKTOP) return null

  return (
    <div className="no-window-drag absolute right-2.5 bottom-2.5 z-40 flex gap-2">
      <Button size="sm" onClick={() => dispatchEditPopover(true)}>
        show Edit Dialog
      </Button>
      <Button variant="destructive" size="sm" onClick={handleReset}>
        Reset Onboarding
      </Button>
    </div>
  )
}

export function CreateAccountBanner() {
  const [show, setShow] = useState(() => {
    const obState = getOnboardingState()
    return !obState.hasCompletedOnboarding && !obState.hasSkippedOnboarding && obState.initialAccountIdCount === 0
  })
  if (!show) return null

  return (
    <div className="mb-6 flex flex-col gap-4 rounded-lg p-4 shadow-lg">
      <SizableText size="2xl" weight="bold">
        Let's Get Started!
      </SizableText>
      <SizableText>Create an account to get started. It's free and takes less than a minute.</SizableText>
      <div className="flex flex-col gap-2">
        <Button
          variant="default"
          onClick={() => {
            dispatchOnboardingDialog(true)
          }}
        >
          Create a Site
        </Button>
        {/* <Button size="#3" chromeless hoverStyle={{bg: '$color44}}>
          I already have a Site
        </Button> */}
      </div>
    </div>
  )
}
