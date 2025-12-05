import {grpcClient} from '@/grpc-client'
import {useMnemonics, useRegisterKey} from '@/models/daemon'
import {trpc} from '@/trpc'
import {fileUpload} from '@/utils/file-upload'
import {extractWords, isWordsValid} from '@/utils/onboarding'
import {useNavigate} from '@/utils/useNavigate'
import {
  eventStream,
  UnpackedHypermediaId,
  useOpenUrl,
  useUniversalAppContext,
} from '@shm/shared'
import {DocumentChange} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {IS_PROD_DESKTOP} from '@shm/shared/constants'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {useNavRoute} from '@shm/shared/utils/navigation'
import {Button} from '@shm/ui/button'
import {CheckboxField} from '@shm/ui/components/checkbox'
import {
  Dialog,
  DialogContent,
  DialogOverlay,
  DialogPortal,
} from '@shm/ui/components/dialog'
import {Input} from '@shm/ui/components/input'
import {Label} from '@shm/ui/components/label'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {Textarea} from '@shm/ui/components/textarea'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {Prev as ArrowLeft, Copy, Reload} from '@shm/ui/icons'
import {SizableText, Text} from '@shm/ui/text'
import {toast} from '@shm/ui/toast'
import {cn} from '@shm/ui/utils'
import {nanoid} from 'nanoid'
import {useCallback, useEffect, useMemo, useState} from 'react'
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
  seedExperimentalLogo?: ImageData
}

export const [dispatchEditPopover, editPopoverEvents] = eventStream<boolean>()
export const [dispatchOnboardingDialog, onboardingDialogEvents] =
  eventStream<boolean>()

export function OnboardingDialog() {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    onboardingDialogEvents.subscribe((open) => {
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
  const [account, setAccount] = useState<UnpackedHypermediaId | undefined>(
    undefined,
  )
  const {selectedIdentity, setSelectedIdentity} = useUniversalAppContext()

  // Track if user is using existing account path
  const [isExistingAccountPath, setIsExistingAccountPath] = useState(false)

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
          seedExperimentalLogo: undefined,
        },
      }
    }
    // In non-modal mode, use global state
    return globalState
  })

  // Only check global state for completion in non-modal mode
  useEffect(() => {
    const state = modal ? localState : globalState
    if (
      !modal &&
      (state.hasCompletedOnboarding || state.hasSkippedOnboarding)
    ) {
      console.log(
        'Onboarding already completed or skipped, skipping to main app',
      )
      if (account) {
        // Ensure the account is selected when onboarding was previously completed
        setSelectedIdentity?.(account.uid)
        navigate({
          key: 'document',
          id: account,
        })
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
      console.log('Moving from profile to recovery')
      if (modal) {
        setLocalState((prev) => ({...prev, currentStep: 'recovery'}))
      } else {
        setOnboardingStep('recovery')
      }
      setCurrentStep('recovery')
    } else if (currentStep === 'recovery') {
      console.log('Moving from recovery to ready')
      if (modal) {
        setLocalState((prev) => ({...prev, currentStep: 'ready'}))
      } else {
        setOnboardingStep('ready')
      }
      setCurrentStep('ready')
    } else if (currentStep === 'existing') {
      console.log('Moving from existing to ready')
      if (modal) {
        setLocalState((prev) => ({...prev, currentStep: 'ready'}))
      } else {
        setOnboardingStep('ready')
      }
      setCurrentStep('ready')
    } else if (currentStep === 'ready') {
      console.log('Completing onboarding')
      if (modal) {
        setLocalState((prev) => ({...prev, hasCompletedOnboarding: true}))
        // Update initialAccountIdCount in modal mode
        setInitialAccountIdCount(globalState.initialAccountIdCount + 1)
      } else {
        setHasCompletedOnboarding(true)
        // Clean up form data but keep the completed flag
        cleanupOnboardingFormData()
      }
      if (account) {
        // Ensure the account is selected when completing onboarding
        setSelectedIdentity?.(account.uid)

        // Navigate based on account type
        if (isExistingAccountPath) {
          // For existing accounts, go to document route
          navigate({
            key: 'document',
            id: account,
          })
        } else {
          // For new accounts, go to draft with welcome content
          navigate({
            key: 'draft',
            id: nanoid(10),
            editUid: account.uid,
            editPath: [],
            isWelcomeDraft: true,
          })
        }
      }
      onComplete()
    }

    const afterState = modal ? localState : getOnboardingState()
    console.log('After - Store state:', afterState)
    console.groupEnd()
  }, [
    currentStep,
    modal,
    localState,
    account,
    navigate,
    onComplete,
    globalState.initialAccountIdCount,
    setSelectedIdentity,
  ])

  const handleExistingSite = useCallback(() => {
    if (modal) {
      setLocalState((prev) => ({...prev, currentStep: 'existing'}))
    } else {
      setOnboardingStep('existing')
    }
    setCurrentStep('existing')
  }, [modal])

  const handlePrev = useCallback(() => {
    console.group('🚀 Previous Step in Onboarding')
    const beforeState = modal ? localState : getOnboardingState()
    console.log('Before - Local step:', currentStep)
    console.log('Before - Store state:', beforeState)

    if (currentStep === 'recovery') {
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
      // Reset the existing account flag when going back
      setIsExistingAccountPath(false)
      if (modal) {
        setLocalState((prev) => ({...prev, currentStep: 'profile'}))
      } else {
        setOnboardingStep('profile')
      }
      setCurrentStep('profile')
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
    <div
      className={cn(
        'bg-background window-drag flex flex-1 flex-col',
        !modal && 'size-full',
      )}
    >
      {currentStep === 'welcome' && <WelcomeStep onNext={handleNext} />}
      {currentStep === 'profile' && (
        <ProfileStep
          onSkip={modal ? handleSkip : undefined}
          onNext={handleNext}
          onPrev={handlePrev}
          onExistingSite={handleExistingSite}
        />
      )}
      {currentStep === 'recovery' && (
        <RecoveryStep
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
        <ExistingStep
          onNext={handleNext}
          onPrev={handlePrev}
          onAccountCreate={(id) => {
            console.log('🔄 Setting account:', id)
            setAccount(id)
            setSelectedIdentity?.(id.uid)
            handleSubscription(id)
            setInitialAccountIdCount(globalState.initialAccountIdCount + 1)
            setIsExistingAccountPath(true)
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

function ProfileStep({
  onSkip,
  onNext,
  onPrev,
  onExistingSite,
}: {
  onSkip?: () => void
  onNext: () => void
  onPrev: () => void
  onExistingSite: () => void
}) {
  // Initialize form data from store
  const [formData, setFormData] = useState<ProfileFormData>(() => {
    const state = getOnboardingState()
    return {
      name: state.formData.name || '',
      icon: state.formData.icon,
      seedExperimentalLogo: state.formData.seedExperimentalLogo,
    }
  })

  const handleImageUpload = async (
    file: File,
    type: 'icon' | 'seedExperimentalLogo',
  ) => {
    try {
      const imageData = await fileToImageData(file)
      const newData = {
        ...formData,
        [type]: imageData,
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

  const handleImageRemove = (type: 'icon' | 'seedExperimentalLogo') => {
    const newData = {
      ...formData,
      [type]: undefined,
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
        seedExperimentalLogo: undefined,
      })
    }
  }, [])

  return (
    <StepWrapper onPrev={onPrev}>
      <StepTitle>CREATE YOUR SITE</StepTitle>
      <Text size="lg" className="text-muted-foreground text-center">
        Your site is more than just a collection of pages, it's a reflection of
        who you are or what your brand stands for. Whether it's personal,
        professional, or creative, this is your space to shine.
      </Text>

      <form
        onSubmit={onNext}
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

          <div className="flex w-full gap-4">
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
                    handleImageUpload(file, 'icon')
                  }
                }}
                onRemove={() => handleImageRemove('icon')}
              />
            </div>

            <div className="flex min-h-[72px] flex-1 flex-col gap-2">
              <Text size="sm" className="text-muted-foreground">
                Site Logo
              </Text>
              <ImageForm
                height={100}
                suggestedSize="1920px x 1080px"
                emptyLabel="SITE LOGO"
                url={formData.seedExperimentalLogo?.base64}
                uploadOnChange={false}
                onImageUpload={(file) => {
                  if (file instanceof File) {
                    handleImageUpload(file, 'seedExperimentalLogo')
                  }
                }}
                onRemove={() => handleImageRemove('seedExperimentalLogo')}
              />
            </div>
          </div>
        </div>
        <div className="no-window-drag flex flex-col gap-4 self-center">
          <Button
            id="profile-existing"
            size="sm"
            variant="link"
            onClick={onExistingSite}
          >
            I already have a Site
          </Button>
          <div className="no-window-drag mt-8 flex items-center justify-center gap-4">
            {onSkip && (
              <Button onClick={onSkip} variant="link" id="profile-skip">
                SKIP
              </Button>
            )}
            <Button
              id="profile-next"
              disabled={!formData.name.trim()}
              onClick={onNext}
              variant="default"
            >
              NEXT
            </Button>
          </div>
        </div>
      </form>
    </StepWrapper>
  )
}

function ExistingStep({
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
  const saveWords = trpc.secureStorage.write.useMutation()
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
        toast.error(
          typeof validation === 'string' ? validation : 'Invalid mnemonic',
        )
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

      <form
        onSubmit={handleSubmit}
        className="flex w-full max-w-[400px] flex-1 flex-col gap-4 pt-4"
      >
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
            onCheckedChange={(v) =>
              setShouldSaveWords(v === 'indeterminate' ? false : v)
            }
            variant="brand"
          >
            Store the Secret Recovery Phrase securely on this device.
          </CheckboxField>
        </div>
        <div className="flex-1" />
        <div className="no-window-drag mt-8 flex items-center justify-center gap-4">
          <Button
            type="submit"
            variant="default"
            disabled={!secretWords.trim()}
          >
            NEXT
          </Button>
        </div>
      </form>
    </StepWrapper>
  )
}

function RecoveryStep({
  onNext,
  onPrev,
  onAccountCreate,
}: {
  onNext: () => void
  onPrev: () => void
  onAccountCreate: (id: UnpackedHypermediaId) => void
}) {
  const register = useRegisterKey()
  const mnemonics = useMnemonics()
  const saveWords = trpc.secureStorage.write.useMutation()
  const [shouldSaveWords, setShouldSaveWords] = useState(true)

  const [formData, setFormData] = useState<ProfileFormData>(() => {
    const state = getOnboardingState()
    return {
      name: state.formData.name || '',
      icon: state.formData.icon,
      seedExperimentalLogo: state.formData.seedExperimentalLogo,
    }
  })

  let icon = ''
  let seedExperimentalLogo = ''

  useEffect(() => {
    return () => {
      mnemonics.refetch()
    }
  }, [])

  async function handleSubmit() {
    try {
      console.group('📝 Starting Profile Submission')

      // Log initial state
      const initialState = getOnboardingState()
      console.log('Initial onboarding state:', initialState)
      console.log('Current form data:', formData)

      // Upload the images if they exist
      try {
        console.group('🖼️ Processing Images')

        // Handle icon
        if (formData.icon) {
          console.group('📤 Processing Site Icon')
          console.log('Image data:', {
            type: formData.icon.type,
            size: formData.icon.size,
            name: formData.icon.name,
          })

          console.log('Converting base64 to File...')
          const iconFile = base64ToFile(formData.icon)
          console.log('File created:', {
            type: iconFile.type,
            size: iconFile.size,
            name: iconFile.name,
          })

          console.log('Uploading to IPFS...')
          const ipfsIcon = await fileUpload(iconFile)

          icon = ipfsIcon
          console.log('✅ Icon uploaded to IPFS:', icon)
          console.groupEnd()
        } else {
          console.log('ℹ️ No icon to process')
        }

        // Handle logo
        if (formData.seedExperimentalLogo) {
          console.group('📤 Processing Site Logo')
          console.log('Image data:', {
            type: formData.seedExperimentalLogo.type,
            size: formData.seedExperimentalLogo.size,
            name: formData.seedExperimentalLogo.name,
          })

          console.log('Converting base64 to File...')
          const logoFile = base64ToFile(formData.seedExperimentalLogo)
          console.log('File created:', {
            type: logoFile.type,
            size: logoFile.size,
            name: logoFile.name,
          })

          console.log('Uploading to IPFS...')
          const ipfsSeedExperimentalLogo = await fileUpload(logoFile)
          seedExperimentalLogo = ipfsSeedExperimentalLogo
          console.log('✅ Logo uploaded to IPFS:', seedExperimentalLogo)
          console.groupEnd()
        } else {
          console.log('ℹ️ No logo to process')
        }

        console.groupEnd()
      } catch (error) {
        console.error('❌ Failed to upload images:', error)
        throw new Error('Failed to upload images: ' + (error as Error).message)
      }

      // Create the Account
      let createdAccount
      // const name = `temp${nanoid(8)}`
      try {
        console.group('👤 Creating Account')
        if (!mnemonics.data) {
          throw new Error('Mnemonics not found')
        }
        // console.log('Using temporary name:', name)

        createdAccount = await register.mutateAsync({
          // name,
          mnemonic: mnemonics.data,
        })
        console.log('✅ Account created:', createdAccount)
        console.groupEnd()
      } catch (error) {
        console.error('❌ Failed to create account:', error)
        throw new Error('Failed to create account: ' + (error as Error).message)
      }

      // // Update account key name
      // let renamedKey
      // try {
      //   console.group('🔑 Updating Account Key')
      //   console.log('Renaming from', name, 'to', createdAccount.accountId)

      //   renamedKey = await grpcClient.daemon.updateKey({
      //     currentName: name,
      //     newName: createdAccount.accountId,
      //   })
      //   console.log('✅ Account key updated:', renamedKey)
      //   console.groupEnd()
      // } catch (error) {
      //   console.error('❌ Failed to update account key:', error)
      //   throw new Error(
      //     'Failed to update account key: ' + (error as Error).message,
      //   )
      // }

      // Save mnemonics to secure storage only if checkbox is checked
      try {
        console.group('💾 Saving Mnemonics')
        console.log('Saving to key:', createdAccount.publicKey)
        console.log('Should save words:', shouldSaveWords)

        if (shouldSaveWords) {
          saveWords.mutate({
            key: createdAccount.publicKey,
            value: mnemonics.data,
          })
          console.log('✅ Mnemonics saved')
        } else {
          console.log('⏭️ Skipping mnemonic save as per user preference')
        }
        console.groupEnd()
      } catch (error) {
        console.error('❌ Failed to save mnemonics:', error)
        throw new Error('Failed to save mnemonics: ' + (error as Error).message)
      }

      // doc metadata edit
      try {
        console.group('📝 Creating Document Changes')
        console.log('Current uploaded URLs:', {icon, seedExperimentalLogo})

        let changes = [
          new DocumentChange({
            op: {
              case: 'setMetadata',
              value: {
                key: 'name',
                value: formData.name,
              },
            },
          }),
        ]

        if (icon) {
          changes.push(
            new DocumentChange({
              op: {
                case: 'setMetadata',
                value: {
                  key: 'icon',
                  value: `ipfs://${icon}`,
                },
              },
            }),
          )
        }

        if (seedExperimentalLogo) {
          console.log('Adding logo metadata:', `ipfs://${seedExperimentalLogo}`)
          changes.push(
            new DocumentChange({
              op: {
                case: 'setMetadata',
                value: {
                  key: 'seedExperimentalLogo',
                  value: `ipfs://${seedExperimentalLogo}`,
                },
              },
            }),
          )
        }

        console.log('Final changes to apply:', changes)
        const doc = await grpcClient.documents.createDocumentChange({
          account: createdAccount.accountId,
          signingKeyName: createdAccount.publicKey,
          baseVersion: undefined, // undefined because this is the first change of this document
          changes,
        })

        if (doc) {
          console.log('✅ Document changes created:', doc)
          console.log('Invalidating queries...')
          const id = hmId(createdAccount!.accountId)
          invalidateQueries([queryKeys.ENTITY, id.id])
          invalidateQueries([queryKeys.ACCOUNT, id.uid])
          invalidateQueries([queryKeys.RESOLVED_ENTITY, id.id])
          invalidateQueries([queryKeys.LIST_ROOT_DOCUMENTS])
          console.log('✅ Queries invalidated')
        }
        console.groupEnd()
      } catch (error) {
        console.error('❌ Failed to create document changes:', error)
        throw new Error(
          'Failed to create document changes: ' + (error as Error).message,
        )
      }

      // Clean up onboarding form data
      console.log('🧹 Cleaning up onboarding form data...')
      // Don't reset the entire state, just clean up the form data
      cleanupOnboardingFormData()
      console.log('✅ Onboarding form data cleaned up')

      console.log('✅ Profile submission completed successfully')
      console.groupEnd()
      onAccountCreate(hmId(createdAccount.accountId))
      onNext()
    } catch (error) {
      console.error('❌ Profile submission failed:', error)
      console.groupEnd()
      throw error
    }
  }

  return (
    <StepWrapper onPrev={onPrev}>
      <StepTitle>SAVE YOUR ACCOUNT</StepTitle>
      <Text
        size="xl"
        className="no-window-drag text-muted-foreground text-center"
      >
        Store this Secret Recover Phrase somewhere safe. You'll need it to
        recover your account if you lose access.
      </Text>

      <div className="no-window-drag flex w-full max-w-[400px] flex-1 flex-col gap-4">
        <Textarea
          className="flex-1 resize-none bg-white opacity-100!"
          disabled
          value={
            Array.isArray(mnemonics.data)
              ? mnemonics.data.join(', ')
              : mnemonics.data
          }
        />

        <div className="flex gap-4">
          <Button
            size="sm"
            className="flex-1"
            onClick={() => mnemonics.refetch()}
          >
            <Reload className="size-4" />
            Regenerate
          </Button>
          <Button
            size="sm"
            className="flex-1"
            onClick={() => {
              if (mnemonics.data) {
                copyTextToClipboard(
                  Array.isArray(mnemonics.data)
                    ? mnemonics.data.join(', ')
                    : mnemonics.data,
                ).then(() => {
                  toast.success('Copied to clipboard')
                })
              }
            }}
          >
            <Copy className="size-4" />
            Copy
          </Button>
        </div>

        <CheckboxField
          checked={shouldSaveWords}
          id="register-save-words"
          onCheckedChange={(v) =>
            setShouldSaveWords(v === 'indeterminate' ? false : v)
          }
        >
          Store the Secret Recovery Phrase on this device
        </CheckboxField>
        <div className="flex-1" />
        <div className="mt-4 flex justify-center gap-4">
          <Button variant="default" onClick={handleSubmit}>
            NEXT
          </Button>
        </div>
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
              all content created using Seed Hypermedia is public by default,
              meaning it can be accessed and shared by others within the network
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
              We collect anonymous analytics to improve your experience and
              enhance the platform.
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
          <Text
            size="sm"
            style={{fontFamily: 'monospace'}}
            className="text-muted-foreground"
          >
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

function StepWrapper({
  children,
  onPrev,
}: {
  children: React.ReactNode
  onPrev?: () => void
}) {
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
  const showExistingStep = currentStep === 'existing'

  return (
    <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 transform gap-2 pt-4">
      <OnboardingProgressStep active={currentStep === 'welcome'} />
      <OnboardingProgressStep active={currentStep === 'profile'} />
      {showExistingStep ? (
        <OnboardingProgressStep active={currentStep === 'existing'} />
      ) : (
        <OnboardingProgressStep active={currentStep === 'recovery'} />
      )}
      <OnboardingProgressStep active={currentStep === 'ready'} />
    </div>
  )
}

function OnboardingProgressStep({active}: {active: boolean}) {
  return (
    <div
      className={cn(
        'h-2 w-2 rounded-full',
        active ? 'bg-primary' : 'bg-gray-300',
      )}
    />
  )
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
    return (
      !obState.hasCompletedOnboarding &&
      !obState.hasSkippedOnboarding &&
      obState.initialAccountIdCount === 0
    )
  })
  if (!show) return null

  return (
    <div className="mb-6 flex flex-col gap-4 rounded-lg p-4 shadow-lg">
      <SizableText size="2xl" weight="bold">
        Let's Get Started!
      </SizableText>
      <SizableText>
        Create an account to get started. It's free and takes less than a
        minute.
      </SizableText>
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
