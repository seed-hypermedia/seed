import {grpcClient} from '@/grpc-client'
import {useMnemonics, useRegisterKey} from '@/models/daemon'
import {trpc} from '@/trpc'
import {fileUpload} from '@/utils/file-upload'
import {useNavRoute} from '@/utils/navigation'
import {extractWords} from '@/utils/onboarding'
import {useNavigate} from '@/utils/useNavigate'
import {eventStream, UnpackedHypermediaId, useOpenUrl} from '@shm/shared'
import {DocumentChange} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {IS_PROD_DESKTOP} from '@shm/shared/constants'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {CheckboxField} from '@shm/ui/components/checkbox'
import {ScrollArea} from '@shm/ui/components/scroll-area'
import {copyTextToClipboard} from '@shm/ui/copy-to-clipboard'
import {toast} from '@shm/ui/toast'
import {ArrowLeft} from '@tamagui/lucide-icons'
import {nanoid} from 'nanoid'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {
  Button,
  ButtonFrame,
  Dialog,
  Form,
  H2,
  Input,
  SizableText,
  Text,
  TextArea,
  View,
  XStack,
  YStack,
} from 'tamagui'
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
      <Dialog.Portal>
        <Dialog.Overlay
          height="100vh"
          bg={'#00000088'}
          width="100vw"
          animation="fast"
          opacity={0.8}
          enterStyle={{opacity: 0}}
          exitStyle={{opacity: 0}}
        />
        <Dialog.Content
          overflow="hidden"
          h="80%"
          w="90%"
          maxWidth={1200}
          maxHeight={800}
          p={0}
          backgroundColor={'$background'}
          animation={[
            'fast',
            {
              opacity: {
                overshootClamping: true,
              },
            },
          ]}
          enterStyle={{y: -10, opacity: 0}}
          exitStyle={{y: -10, opacity: 0}}
        >
          <Onboarding
            modal={true}
            onComplete={() => {
              handleOpenChange(false)
            }}
          />
        </Dialog.Content>
      </Dialog.Portal>
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
  const [wentThroughRecovery, setWentThroughRecovery] = useState(false)

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
        console.log('Dispatching site template event')
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
      setWentThroughRecovery(true)
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
      setWentThroughRecovery(false)
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
        navigate({
          key: 'document',
          id: account,
          immediatelyPromptTemplate: wentThroughRecovery,
        })
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
    wentThroughRecovery,
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
    <YStack flex={1} backgroundColor="$background" className="window-drag">
      {currentStep === 'welcome' && <WelcomeStep onNext={handleNext} />}
      {currentStep === 'profile' && (
        <ProfileStep
          onSkip={handleSkip}
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
            handleSubscription(id)
            setInitialAccountIdCount(globalState.initialAccountIdCount + 1)
          }}
        />
      )}
      {currentStep === 'ready' && <ReadyStep onComplete={handleNext} />}
      <OnboardingProgress currentStep={currentStep} />
    </YStack>
  )
}

function WelcomeStep({onNext}: {onNext: () => void}) {
  const openUrl = useOpenUrl()

  return (
    <StepWrapper>
      <FullLogoIcon />
      <StepTitle>WELCOME TO THE OPEN WEB</StepTitle>
      <XStack
        gap="$6"
        width="100%"
        paddingHorizontal={0}
        flex={1}
        alignItems="center"
      >
        <YStack
          padding="$2"
          borderRadius="$4"
          flex={1}
          gap="$4"
          alignItems="center"
          justifyContent="flex-start"
          width={200}
        >
          <YStack flex={1} justifyContent="center">
            <CollabIcon />
          </YStack>
          <YStack height={80} justifyContent="flex-start">
            <Text fontSize="$5" textAlign="center">
              Collaborate With Your Peers
            </Text>
          </YStack>
        </YStack>

        <YStack
          padding="$2"
          width={200}
          borderRadius="$4"
          flex={1}
          gap="$4"
          alignItems="center"
          justifyContent="flex-start"
        >
          <YStack flex={1} justifyContent="center">
            <PublishIcon />
          </YStack>
          <YStack height={80} justifyContent="flex-start">
            <Text fontSize="$5" textAlign="center">
              Publish To The Web
            </Text>
          </YStack>
        </YStack>

        <YStack
          padding="$2"
          width={200}
          borderRadius="$4"
          flex={1}
          gap="$4"
          alignItems="center"
          justifyContent="flex-start"
        >
          <YStack flex={1} justifyContent="center">
            <ArchiveIcon />
          </YStack>
          <YStack height={80} justifyContent="flex-start">
            <Text fontSize="$5" textAlign="center">
              Archive Content, Available Offline
            </Text>
          </YStack>
        </YStack>
      </XStack>

      <YStack gap="$4" alignItems="center" className="no-window-drag">
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
        <Button
          onPress={onNext}
          size="$4"
          id="welcome-next"
          borderRadius="$2"
          backgroundColor="$brand5"
          borderWidth={0}
          color="white"
          hoverStyle={{backgroundColor: '$brand4'}}
          focusStyle={{backgroundColor: '$brand6'}}
        >
          NEXT
        </Button>
      </YStack>
    </StepWrapper>
  )
}

function ProfileStep({
  onSkip,
  onNext,
  onPrev,
  onExistingSite,
}: {
  onSkip: () => void
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
      <Text fontSize="$5" textAlign="center" color="$gray11">
        Your site is more than just a collection of pages, it's a reflection of
        who you are or what your brand stands for. Whether it's personal,
        professional, or creative, this is your space to shine.
      </Text>

      <Form
        width="100%"
        maxWidth={400}
        onSubmit={onNext}
        className="no-window-drag"
        flex={1}
      >
        <YStack
          gap="$4"
          width="100%"
          className="no-window-drag"
          flex={1}
          paddingTop="$4"
        >
          <Input
            size="$4"
            placeholder="Site name"
            value={formData.name}
            onChange={(e) => updateFormData({name: e.nativeEvent.text})}
          />

          <XStack gap="$4" width="100%">
            <YStack
              gap="$2"
              flex={0}
              minWidth={100}
              minHeight={100}
              w="100%"
              maxWidth={100}
            >
              <Text fontSize="$2" color="$gray11">
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
            </YStack>

            <YStack gap="$2" flex={1} minHeight={72}>
              <Text fontSize="$2" color="$gray11">
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
            </YStack>
          </XStack>
        </YStack>
        <YStack gap="$4" className="no-window-drag" alignSelf="center">
          <Button
            type="button"
            id="profile-existing"
            chromeless
            size="$3"
            onPress={onExistingSite}
            hoverStyle={{
              cursor: 'pointer',
              backgroundColor: 'transparent',
              borderColor: 'transparent',
            }}
            focusStyle={{
              backgroundColor: 'transparent',
              borderColor: 'transparent',
            }}
          >
            I already have a Site
          </Button>
          <XStack
            marginTop="$8"
            gap="$4"
            className="no-window-drag"
            alignItems="center"
            justifyContent="center"
          >
            <Button onPress={onSkip} bg="$brand11" id="profile-skip">
              SKIP
            </Button>
            <Button
              id="profile-next"
              borderRadius="$2"
              backgroundColor="$brand5"
              borderWidth={0}
              color="white"
              hoverStyle={{backgroundColor: '$brand6'}}
              focusStyle={{backgroundColor: '$brand6'}}
              disabled={!formData.name.trim()}
              onPress={onNext}
            >
              NEXT
            </Button>
          </XStack>
        </YStack>
      </Form>
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

  const handleSubmit = async () => {
    // if (!isWordsValid(secretWords)) {
    //   toast.error('Invalid mnemonic')
    //   console.log('Invalid mnemonic', mnemonic)
    //   return
    // }
    // Create the Account
    let createdAccount
    const name = `temp${nanoid(8)}`
    try {
      console.group('👤 Creating Account')
      if (!secretWords.trim()) {
        throw new Error('Mnemonics not found')
      }
      console.log('Using temporary name:', name)

      createdAccount = await register.mutateAsync({
        name,
        mnemonic,
      })
      console.log('✅ Account created:', createdAccount)
      console.groupEnd()
    } catch (error) {
      console.error('❌ Failed to create account:', error)
      throw new Error('Failed to create account: ' + (error as Error).message)
    }

    // Update account key name
    let renamedKey
    try {
      console.group('🔑 Updating Account Key')
      console.log('Renaming from', name, 'to', createdAccount.accountId)

      renamedKey = await grpcClient.daemon.updateKey({
        currentName: name,
        newName: createdAccount.accountId,
      })
      console.log('✅ Account key updated:', renamedKey)
      console.groupEnd()
    } catch (error) {
      console.error('❌ Failed to update account key:', error)
      throw new Error(
        'Failed to update account key: ' + (error as Error).message,
      )
    }

    // Save mnemonics to secure storage only if checkbox is checked
    try {
      console.group('💾 Saving Mnemonics')
      console.log('Saving to key:', renamedKey.name)
      console.log('Should save words:', shouldSaveWords)

      if (shouldSaveWords) {
        saveWords.mutate({key: renamedKey.name, value: secretWords})
        console.log('✅ Mnemonics saved')
      } else {
        console.log('⏭️ Skipping mnemonic save as per user preference')
      }
      console.groupEnd()
    } catch (error) {
      console.error('❌ Failed to save mnemonics:', error)
      throw new Error('Failed to save mnemonics: ' + (error as Error).message)
    }
    onAccountCreate(hmId('d', createdAccount.accountId))
    onNext()
  }

  return (
    <StepWrapper onPrev={onPrev}>
      <StepTitle>ADD EXISTING KEY</StepTitle>
      <Text fontSize="$5" textAlign="center" color="$gray11">
        Add the keys to your existing site.
      </Text>

      <Form onSubmit={handleSubmit} w={400} flex={1}>
        <YStack gap="$4">
          <YStack gap="$2">
            <Text fontSize="$2" color="$gray11">
              Secret Recovery Phrase
            </Text>
            <TextArea
              size="$4"
              placeholder="Enter or paste your Secret Recovery Phrase here..."
              value={secretWords}
              onChange={(e) => setSecretWords(e.nativeEvent.text)}
              minHeight={120}
              backgroundColor="white"
              borderRadius="$4"
            />
          </YStack>

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
        </YStack>
        <View f={1} />
        <XStack
          marginTop="$8"
          gap="$4"
          className="no-window-drag"
          alignItems="center"
          justifyContent="center"
        >
          <Button
            disabled={!secretWords.trim()}
            onPress={handleSubmit}
            borderRadius="$2"
            backgroundColor="$brand5"
            borderWidth={0}
            color="white"
            hoverStyle={{backgroundColor: '$brand6'}}
            focusStyle={{backgroundColor: '$brand6'}}
          >
            NEXT
          </Button>
        </XStack>
      </Form>
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
      const name = `temp${nanoid(8)}`
      try {
        console.group('👤 Creating Account')
        if (!mnemonics.data) {
          throw new Error('Mnemonics not found')
        }
        console.log('Using temporary name:', name)

        createdAccount = await register.mutateAsync({
          name,
          mnemonic: mnemonics.data,
        })
        console.log('✅ Account created:', createdAccount)
        console.groupEnd()
      } catch (error) {
        console.error('❌ Failed to create account:', error)
        throw new Error('Failed to create account: ' + (error as Error).message)
      }

      // Update account key name
      let renamedKey
      try {
        console.group('🔑 Updating Account Key')
        console.log('Renaming from', name, 'to', createdAccount.accountId)

        renamedKey = await grpcClient.daemon.updateKey({
          currentName: name,
          newName: createdAccount.accountId,
        })
        console.log('✅ Account key updated:', renamedKey)
        console.groupEnd()
      } catch (error) {
        console.error('❌ Failed to update account key:', error)
        throw new Error(
          'Failed to update account key: ' + (error as Error).message,
        )
      }

      // Save mnemonics to secure storage only if checkbox is checked
      try {
        console.group('💾 Saving Mnemonics')
        console.log('Saving to key:', renamedKey.name)
        console.log('Should save words:', shouldSaveWords)

        if (shouldSaveWords) {
          saveWords.mutate({key: renamedKey.name, value: mnemonics.data})
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
          const id = hmId('d', createdAccount!.accountId)
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
      onAccountCreate(hmId('d', createdAccount.accountId))
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
        fontSize="$6"
        textAlign="center"
        color="$gray11"
        className="no-window-drag"
      >
        Store this Secret Recover Phrase somewhere safe. You'll need it to
        recover your account if you lose access.
      </Text>

      <YStack
        gap="$4"
        width="100%"
        maxWidth={400}
        className="no-window-drag"
        flex={1}
      >
        <TextArea
          flex={1}
          disabled
          value={
            Array.isArray(mnemonics.data)
              ? mnemonics.data.join(', ')
              : mnemonics.data
          }
        />

        <XStack gap="$4">
          <Button size="$2" flex={1} onPress={() => mnemonics.refetch()}>
            Regenerate
          </Button>
          <Button
            size="$2"
            flex={1}
            onPress={() => {
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
            Copy
          </Button>
        </XStack>

        <CheckboxField
          checked={shouldSaveWords}
          id="register-save-words"
          onCheckedChange={(v) =>
            setShouldSaveWords(v === 'indeterminate' ? false : v)
          }
        >
          Store the Secret Recovery Phrase on this device
        </CheckboxField>
        <View f={1} />
        <XStack marginTop="$4" gap="$4" justifyContent="center">
          <Button
            onPress={handleSubmit}
            borderRadius="$2"
            backgroundColor="$brand5"
            borderWidth={0}
            color="white"
            hoverStyle={{backgroundColor: '$brand6'}}
            focusStyle={{backgroundColor: '$brand6'}}
          >
            NEXT
          </Button>
        </XStack>
      </YStack>
    </StepWrapper>
  )
}

function ReadyStep({onComplete}: {onComplete: () => void}) {
  const openUrl = useOpenUrl()

  return (
    <StepWrapper>
      <StepTitle>READY TO GO</StepTitle>
      <YStack marginTop="$8" gap="$4" className="no-window-drag" maxWidth={400}>
        <ButtonFrame
          h="auto"
          padding="$4"
          borderRadius="$4"
          gap="$4"
          bg="rgba(88,101,202,0.2)"
          onPress={() => openUrl('https://discord.gg/7Y7DrhQZFs')}
        >
          <DiscordIcon />
          <YStack flex={1}>
            <SizableText>Join our Discord</SizableText>
            <SizableText size="$2" color="$gray11">
              Here you will be able to get support and send feedback.
            </SizableText>
          </YStack>
        </ButtonFrame>
        <XStack gap="$4" h="auto" padding="$4" borderRadius="$4" bg="$brand11">
          <ContentIcon />
          <YStack flex={1}>
            <SizableText>All Content is Public</SizableText>
            <SizableText size="$2" color="$gray11">
              all content created using Seed Hypermedia is public by default,
              meaning it can be accessed and shared by others within the network
            </SizableText>
          </YStack>
        </XStack>
        <XStack gap="$4" h="auto" padding="$4" borderRadius="$4" bg="$brand11">
          <AnalyticsIcon />
          <YStack flex={1}>
            <SizableText>Analytics</SizableText>
            <SizableText size="$2" color="$gray11">
              We collect anonymous analytics to improve your experience and
              enhance the platform.
            </SizableText>
          </YStack>
        </XStack>

        <Button
          onPress={onComplete}
          backgroundColor="$brand5"
          color="white"
          size="$4"
          borderRadius="$2"
          borderWidth={0}
          hoverStyle={{backgroundColor: '$brand4'}}
          focusStyle={{backgroundColor: '$brand4'}}
        >
          DONE
        </Button>
      </YStack>
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
    <YStack
      position="absolute"
      top={16}
      right={16}
      backgroundColor="$background"
      padding="$2"
      borderRadius="$4"
      borderWidth={1}
      borderColor="$border"
      opacity={0.8}
      elevation={4}
      zIndex={1000}
      className="no-window-drag"
      width={300}
      maxHeight={300}
    >
      <ScrollArea>
        <div className="p-3">
          <Text fontSize="$3" fontFamily="$mono">
            Debug: Onboarding State
          </Text>
          <Text fontSize="$2" fontFamily="$mono" color="$gray11">
            {JSON.stringify(state, null, 2)}
          </Text>
        </div>
      </ScrollArea>
    </YStack>
  )
}

function StepTitle({children}: {children: React.ReactNode}) {
  return (
    <Text
      fontSize="$9"
      color="$brand5"
      textAlign="center"
      className="no-window-drag"
    >
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
      <YStack
        className="window-drag"
        flex={1}
        padding="$4"
        gap="$4"
        alignItems="center"
        justifyContent="center"
        backgroundColor="$brand12"
        backgroundImage="linear-gradient(to bottom, $green3, $green4)"
      >
        <YStack
          gap="$6"
          alignItems="center"
          justifyContent="center"
          width={600}
          height={600}
          className="no-window-drag"
        >
          {onPrev ? (
            <View
              position="absolute"
              top={-60}
              left={-100}
              zIndex="$zIndex.9"
              className="no-window-drag"
            >
              <Button
                size="$5"
                onPress={onPrev}
                icon={ArrowLeft}
                chromeless
                hoverStyle={{
                  backgroundColor: 'transparent',
                  borderColor: 'transparent',
                }}
                focusStyle={{
                  backgroundColor: 'transparent',
                  borderColor: 'transparent',
                }}
              />
            </View>
          ) : null}
          {children}
        </YStack>
      </YStack>
    </>
  )
}

function OnboardingProgress({currentStep}: {currentStep: OnboardingStep}) {
  const showExistingStep = currentStep === 'existing'

  return (
    <XStack
      gap="$2"
      paddingTop="$4"
      position="absolute"
      bottom="$4"
      left="50%"
      transform="translateX(-50%)"
    >
      <OnboardingProgressStep active={currentStep === 'welcome'} />
      <OnboardingProgressStep active={currentStep === 'profile'} />
      {showExistingStep ? (
        <OnboardingProgressStep active={currentStep === 'existing'} />
      ) : (
        <OnboardingProgressStep active={currentStep === 'recovery'} />
      )}
      <OnboardingProgressStep active={currentStep === 'ready'} />
    </XStack>
  )
}

function OnboardingProgressStep({active}: {active: boolean}) {
  return (
    <YStack
      width={8}
      height={8}
      backgroundColor={active ? '$brand5' : '$gray8'}
      borderRadius={8}
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

  const route = useNavRoute()
  const replace = useNavigate('replace')

  if (IS_PROD_DESKTOP) return null

  return (
    <XStack
      className="no-window-drag"
      zIndex="$zIndex.9"
      position="absolute"
      bottom={10}
      right={10}
      gap="$2"
    >
      <Button
        size="$2"
        opacity={0.7}
        onPress={() => dispatchEditPopover(true)}
        bg="$brand5"
        color="white"
        hoverStyle={{opacity: 1, bg: '$brand4'}}
      >
        show Edit Dialog
      </Button>
      {route.key === 'document' ? (
        <Button
          size="$2"
          opacity={0.7}
          onPress={() => replace({...route, immediatelyPromptTemplate: true})}
          bg="$brand5"
          color="white"
          hoverStyle={{opacity: 1, bg: '$brand4'}}
        >
          show template dialog
        </Button>
      ) : null}
      <Button
        size="$2"
        backgroundColor="$red10"
        color="white"
        onPress={handleReset}
        opacity={0.7}
        hoverStyle={{opacity: 1, bg: '$red14'}}
      >
        Reset Onboarding
      </Button>
    </XStack>
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
    <YStack
      gap="$4"
      padding="$4"
      borderRadius="$4"
      elevation="$3"
      marginBottom="$6"
    >
      <H2 fontWeight="bold">Let's Get Started!</H2>
      <SizableText>
        Create an account to get started. It's free and takes less than a
        minute.
      </SizableText>
      <YStack gap="$2">
        <Button
          bg="$brand5"
          color="white"
          hoverStyle={{bg: '$brand4'}}
          onPress={() => {
            console.log('== ~ onPress ~ create site:')
            dispatchOnboardingDialog(true)
          }}
        >
          Create a Site
        </Button>
        {/* <Button size="#3" chromeless hoverStyle={{bg: '$color44}}>
          I already have a Site
        </Button> */}
      </YStack>
    </YStack>
  )
}
