import {grpcClient} from '@/grpc-client'
import {useMnemonics, useRegisterKey} from '@/models/daemon'
import {trpc} from '@/trpc'
import {fileUpload} from '@/utils/file-upload'
import {useNavRoute} from '@/utils/navigation'
import {extractWords} from '@/utils/onboarding'
import {useNavigate} from '@/utils/useNavigate'
import {UnpackedHypermediaId, useOpenUrl} from '@shm/shared'
import {DocumentChange} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {IS_PROD_DESKTOP} from '@shm/shared/constants'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {CheckboxField} from '@shm/ui/checkbox-field'
import {toast} from '@shm/ui/toast'
import {ArrowLeft} from '@tamagui/lucide-icons'
import copyTextToClipboard from 'copy-text-to-clipboard'
import {nanoid} from 'nanoid'
import {useCallback, useEffect, useMemo, useState} from 'react'
import {
  Button,
  ButtonFrame,
  Form,
  Input,
  ScrollView,
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
  setOnboardingFormData,
  setOnboardingStep,
  validateImage,
} from '../app-onboarding'
import {ImageForm} from '../pages/image-form'
import {dispatchSiteTemplateEvent} from './site-template'

interface OnboardingProps {
  onComplete: () => void
}

interface ProfileFormData {
  name: string
  icon?: ImageData
  seedExperimentalLogo?: ImageData
}

export function Onboarding({onComplete}: OnboardingProps) {
  // Check if onboarding has been completed or skipped
  const state = getOnboardingState()
  const navigate = useNavigate('replace')
  const route = useNavRoute()
  const [account, setAccount] = useState<UnpackedHypermediaId | undefined>(
    undefined,
  )

  console.log(`== ~ Onboarding ~ route:`, route)
  // If onboarding has been completed or skipped, don't show it
  useEffect(() => {
    if (state.hasCompletedOnboarding || state.hasSkippedOnboarding) {
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
  }, [onComplete])

  // Initialize step from store
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(() => {
    console.log('🔄 Initializing onboarding with state:', state)
    return state.currentStep
  })

  const handleSkip = useCallback(() => {
    console.group('🚀 Skipping Onboarding')
    const beforeState = getOnboardingState()
    console.log('Before state:', beforeState)

    setHasSkippedOnboarding(true)
    // Clean up form data but keep the skipped flag
    cleanupOnboardingFormData()

    const afterState = getOnboardingState()
    console.log('After state:', afterState)
    console.groupEnd()

    onComplete()
  }, [onComplete])

  const handleNext = useCallback(() => {
    console.group('🚀 Next Step in Onboarding')
    const beforeState = getOnboardingState()
    console.log('Before - Local step:', currentStep)
    console.log('Before - Store state:', beforeState)

    if (currentStep === 'welcome') {
      console.log('Moving from welcome to profile')
      setOnboardingStep('profile')
      setCurrentStep('profile')
    } else if (currentStep === 'profile') {
      console.log('Moving from profile to recovery')
      setOnboardingStep('recovery')
      setCurrentStep('recovery')
    } else if (currentStep === 'recovery') {
      console.log('Moving from recovery to ready')
      setOnboardingStep('ready')
      setCurrentStep('ready')
    } else if (currentStep === 'existing') {
      console.log('Moving from existing to ready')
      setOnboardingStep('ready')
      setCurrentStep('ready')
    } else if (currentStep === 'ready') {
      console.log('Completing onboarding')
      setHasCompletedOnboarding(true)
      // Clean up form data but keep the completed flag
      cleanupOnboardingFormData()
      if (account) {
        console.log('Dispatching site template event')
        navigate({
          key: 'document',
          id: account,
        })
      }
      onComplete()
    }

    const afterState = getOnboardingState()
    console.log('After - Store state:', afterState)
    console.groupEnd()
  }, [currentStep, onComplete])

  const handleExistingSite = useCallback(() => {
    setOnboardingStep('existing')
    setCurrentStep('existing')
  }, [])

  const handlePrev = useCallback(() => {
    console.group('🚀 Previous Step in Onboarding')
    const beforeState = getOnboardingState()
    console.log('Before - Local step:', currentStep)
    console.log('Before - Store state:', beforeState)

    if (currentStep === 'recovery') {
      setOnboardingStep('profile')
      setCurrentStep('profile')
    } else if (currentStep === 'profile') {
      setOnboardingStep('welcome')
      setCurrentStep('welcome')
    } else if (currentStep === 'existing') {
      setOnboardingStep('profile')
      setCurrentStep('profile')
    }

    const afterState = getOnboardingState()
    console.log('After - Store state:', afterState)
    console.groupEnd()
  }, [currentStep])

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
          hoverStyle={{
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
          hoverStyle={{backgroundColor: '$brand6'}}
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
              minWidth={72}
              minHeight={72}
              w="100%"
              maxWidth={72}
            >
              <Text fontSize="$2" color="$gray11">
                Site Icon
              </Text>
              <ImageForm
                height={72}
                emptyLabel="ADD SITE ICON"
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
                height={72}
                emptyLabel="ADD SITE LOGO"
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
              Secret Words
            </Text>
            <TextArea
              size="$4"
              placeholder="Enter or paste your secret words here"
              value={secretWords}
              onChange={(e) => setSecretWords(e.nativeEvent.text)}
              minHeight={120}
              backgroundColor="white"
              borderRadius="$4"
            />
          </YStack>

          <CheckboxField
            id="save-existing-wordss"
            value={shouldSaveWords}
            onValue={setShouldSaveWords}
          >
            Save secret words to this device
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
          invalidateQueries([
            queryKeys.ENTITY,
            hmId('d', createdAccount!.accountId).id,
          ])
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
        Save these secret words somewhere safe. You'll need them to recover your
        account if you lose access.
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
            regenerate
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
                )
              }
            }}
          >
            Copy
          </Button>
        </XStack>

        <CheckboxField
          value={shouldSaveWords}
          id="register-save-words"
          onValue={setShouldSaveWords}
        >
          Save words on this device
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
          backgroundColor="$brand2"
          color="white"
          size="$4"
          borderRadius="$2"
          borderWidth={0}
          hoverStyle={{backgroundColor: '$brand3'}}
          focusStyle={{backgroundColor: '$brand3'}}
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
      <ScrollView>
        <Text fontSize="$3" fontFamily="$mono">
          Debug: Onboarding State
        </Text>
        <Text fontSize="$2" fontFamily="$mono" color="$gray11">
          {JSON.stringify(state, null, 2)}
        </Text>
      </ScrollView>
    </YStack>
  )
}

// SVG Components
interface IconProps {
  color?: string
  size?: string | number
}

function FullLogoIcon() {
  return (
    <svg
      width="245"
      height="51"
      viewBox="0 0 245 51"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        d="M44.0441 26.5761C44.1264 24.2059 43.8841 20.1314 41.9509 16.5153C41.0738 14.8745 39.718 13.4292 38.1444 12.4245C36.9382 11.6544 35.604 11.1431 34.2594 11.0011C34.2578 11.001 34.2565 11.0021 34.2564 11.0037C34.2563 11.0052 34.2549 11.0064 34.2533 11.0062C32.5596 10.8206 30.848 11.2198 29.3535 12.4245C24.9063 16.0094 26.5762 22.6407 30.3298 25.6137C30.3315 25.615 30.3336 25.6158 30.3358 25.616C30.3379 25.6161 30.3397 25.6167 30.3414 25.618C30.6747 25.8717 31.8811 26.804 33.1036 27.9193C33.1084 27.9237 33.1162 27.9206 33.1166 27.914C33.1171 27.9075 33.1248 27.9044 33.1296 27.9088C33.8812 28.5939 34.6398 29.3488 35.2059 30.0581C35.9451 30.9842 36.5112 32.7118 36.3792 34.2353C36.2289 35.9691 35.1743 37.4384 32.4414 37.1611C32.4399 37.161 32.4385 37.162 32.4384 37.1635C32.4383 37.165 32.437 37.1661 32.4355 37.166C32.2133 37.1444 31.9799 37.1111 31.7349 37.0655C25.8652 35.9715 24.6603 28.9537 24.3445 26.2724C24.0756 23.9891 24.2532 22.5228 24.3473 21.7467C24.5627 19.9691 25.4108 17.7224 26.1025 16.102C26.4109 15.3797 26.0318 15.1302 25.5934 15.781C23.6797 18.6216 22.5379 22.4433 22.4491 25.0009C22.3669 27.371 22.6092 31.4455 24.5423 35.0617C25.4194 36.7024 26.7752 38.1477 28.3488 39.1524C29.5551 39.9226 30.8892 40.4338 32.2338 40.5758C32.2354 40.576 32.2367 40.5748 32.2369 40.5733C32.237 40.5717 32.2383 40.5705 32.2399 40.5707C33.9336 40.7563 35.6452 40.3572 37.1397 39.1524C41.5869 35.5676 39.9171 28.9362 36.1634 25.9633C36.1617 25.9619 36.1596 25.9611 36.1574 25.961C36.1553 25.9608 36.1535 25.9602 36.1518 25.9589C35.8186 25.7052 34.6121 24.7729 33.3897 23.6577C33.3849 23.6533 33.3771 23.6564 33.3766 23.6629C33.3762 23.6694 33.3684 23.6726 33.3636 23.6682C32.612 22.983 31.8535 22.2282 31.2874 21.5189C30.4976 20.5294 29.9053 18.6249 30.1511 17.0321C30.3972 15.4375 31.4832 14.1552 34.0519 14.4158C34.0533 14.416 34.0547 14.4149 34.0548 14.4134C34.0549 14.4119 34.0562 14.4108 34.0577 14.411C34.2799 14.4326 34.5134 14.4658 34.7584 14.5115C40.628 15.6054 41.8329 22.6232 42.1487 25.3046C42.4177 27.5878 42.24 29.0541 42.146 29.8303L42.1459 29.8304L42.1458 29.8313C42.0312 31.4812 41.1376 33.806 40.4064 35.4826C40.0924 36.2024 40.4614 36.4467 40.8998 35.796C42.8135 32.9554 43.9553 29.1336 44.0441 26.5761Z"
        fill="#54CD85"
      />
      <path
        d="M44.0441 26.5763C44.1264 24.2062 43.8841 20.1317 41.9509 16.5155C41.0738 14.8747 39.718 13.4294 38.1444 12.4247C35.2866 10.6001 30.7858 12.9196 30.1511 17.0323C30.3972 15.4377 31.4832 14.1554 34.0519 14.4161C34.0533 14.4162 34.0547 14.4151 34.0548 14.4136C34.0549 14.4122 34.0562 14.411 34.0577 14.4112C34.2799 14.4328 34.5134 14.4661 34.7584 14.5117C40.628 15.6057 41.8329 22.6235 42.1487 25.3048C42.4177 27.588 42.24 29.0544 42.146 29.8305L42.1459 29.8306L42.1458 29.8316C42.0312 31.4814 41.1376 33.8062 40.4064 35.4828C40.0924 36.2027 40.4614 36.447 40.8998 35.7962C42.8135 32.9556 43.9553 29.1339 44.0441 26.5763Z"
        fill="#038E7A"
      />
      <path
        d="M32.4355 37.1662C32.2133 37.1446 31.9799 37.1113 31.7349 37.0657C25.8652 35.9717 24.6603 28.9539 24.3445 26.2726C24.0756 23.9894 24.2532 22.523 24.3473 21.7469C24.5627 19.9693 25.4108 17.7226 26.1025 16.1023C26.4109 15.3799 26.0318 15.1305 25.5934 15.7812C23.6797 18.6218 22.5379 22.4435 22.4491 25.0011C22.3669 27.3712 22.6092 31.4457 24.5423 35.0619C25.4194 36.7027 26.7752 38.148 28.3488 39.1527C30.8033 40.7198 36.0031 38.5744 36.3792 34.2355C36.2289 35.9693 35.1743 37.4387 32.4414 37.1613C32.4399 37.1612 32.4385 37.1623 32.4384 37.1638C32.4383 37.1652 32.437 37.1663 32.4355 37.1662Z"
        fill="#038E7A"
      />
      <path
        d="M62.548 20.6091C62.4826 20.7181 62.4099 20.8017 62.3299 20.8598C62.2573 20.9107 62.1664 20.9361 62.0574 20.9361C61.9339 20.9361 61.7885 20.8743 61.6214 20.7508C61.4542 20.6272 61.2435 20.4928 60.9891 20.3474C60.742 20.1948 60.4404 20.0567 60.0843 19.9332C59.7355 19.8096 59.3103 19.7479 58.8089 19.7479C58.3365 19.7479 57.9186 19.8133 57.5552 19.9441C57.1991 20.0676 56.8975 20.2384 56.6504 20.4565C56.4106 20.6745 56.2289 20.9325 56.1054 21.2304C55.9818 21.5211 55.9201 21.8373 55.9201 22.1788C55.9201 22.6149 56.0254 22.9783 56.2362 23.269C56.4542 23.5524 56.7376 23.7958 57.0865 23.9993C57.4426 24.2028 57.8423 24.3809 58.2856 24.5335C58.7362 24.6788 59.194 24.8315 59.6592 24.9913C60.1315 25.1512 60.5894 25.3329 61.0327 25.5364C61.4833 25.7326 61.883 25.9833 62.2318 26.2886C62.5879 26.5938 62.8714 26.9681 63.0821 27.4114C63.3001 27.8547 63.4092 28.3998 63.4092 29.0466C63.4092 29.7297 63.2929 30.3729 63.0603 30.9761C62.8278 31.572 62.4862 32.0916 62.0356 32.5349C61.5923 32.9783 61.0436 33.3271 60.3895 33.5815C59.7427 33.8358 59.0051 33.963 58.1766 33.963C57.1592 33.963 56.2362 33.7813 55.4077 33.4179C54.5792 33.0473 53.8706 32.5495 53.282 31.9245L53.8924 30.9216C53.9506 30.8416 54.0196 30.7762 54.0996 30.7253C54.1868 30.6672 54.2813 30.6381 54.383 30.6381C54.4775 30.6381 54.5828 30.6781 54.6991 30.7581C54.8227 30.8307 54.9608 30.9252 55.1134 31.0415C55.266 31.1578 55.4404 31.2849 55.6366 31.423C55.8328 31.5611 56.0545 31.6883 56.3016 31.8046C56.556 31.9208 56.843 32.019 57.1628 32.0989C57.4826 32.1716 57.8423 32.2079 58.242 32.2079C58.7435 32.2079 59.1904 32.1389 59.5828 32.0008C59.9753 31.8627 60.306 31.6701 60.5749 31.423C60.851 31.1687 61.0618 30.8671 61.2071 30.5182C61.3525 30.1694 61.4251 29.7806 61.4251 29.3518C61.4251 28.8794 61.3161 28.4942 61.0981 28.1963C60.8874 27.891 60.6076 27.6367 60.2587 27.4332C59.9099 27.2297 59.5102 27.0589 59.0596 26.9208C58.609 26.7755 58.1512 26.6301 57.686 26.4848C57.2209 26.3322 56.7631 26.1578 56.3125 25.9615C55.8619 25.7653 55.4622 25.511 55.1134 25.1985C54.7645 24.886 54.4811 24.4971 54.2631 24.032C54.0523 23.5596 53.9469 22.9783 53.9469 22.2878C53.9469 21.7355 54.0523 21.2014 54.2631 20.6854C54.4811 20.1694 54.7936 19.7115 55.2006 19.3118C55.6148 18.9121 56.1199 18.5924 56.7158 18.3525C57.319 18.1127 58.0094 17.9928 58.7871 17.9928C59.6592 17.9928 60.4513 18.1309 61.1635 18.407C61.883 18.6832 62.5153 19.0829 63.0603 19.6062L62.548 20.6091ZM73.2647 27.0626C73.2647 26.612 73.1993 26.2014 73.0684 25.8307C72.9449 25.4528 72.7596 25.1294 72.5125 24.8605C72.2727 24.5844 71.9783 24.3736 71.6295 24.2283C71.2806 24.0756 70.8846 23.9993 70.4413 23.9993C69.511 23.9993 68.7734 24.2719 68.2283 24.8169C67.6905 25.3547 67.3562 26.1033 67.2254 27.0626H73.2647ZM74.8344 32.2406C74.5946 32.5313 74.3075 32.7857 73.9732 33.0037C73.6389 33.2144 73.2792 33.3889 72.894 33.5269C72.5161 33.665 72.1237 33.7668 71.7167 33.8322C71.3097 33.9049 70.9064 33.9412 70.5067 33.9412C69.7436 33.9412 69.0386 33.814 68.3918 33.5596C67.7523 33.298 67.1963 32.9201 66.724 32.4259C66.2588 31.9245 65.8955 31.3067 65.6338 30.5727C65.3722 29.8387 65.2414 28.9957 65.2414 28.0437C65.2414 27.2733 65.3577 26.5538 65.5902 25.8852C65.8301 25.2166 66.1716 24.6389 66.615 24.1519C67.0583 23.6578 67.5997 23.2726 68.2392 22.9964C68.8788 22.713 69.5982 22.5713 70.3977 22.5713C71.059 22.5713 71.6695 22.6839 72.2291 22.9092C72.7959 23.1272 73.2828 23.447 73.6898 23.8685C74.1041 24.2828 74.4275 24.7987 74.66 25.4165C74.8926 26.0269 75.0088 26.7246 75.0088 27.5095C75.0088 27.8147 74.9761 28.0182 74.9107 28.12C74.8453 28.2217 74.7218 28.2726 74.5401 28.2726H67.16C67.1818 28.9703 67.2763 29.5771 67.4434 30.0931C67.6179 30.6091 67.8577 31.0415 68.1629 31.3903C68.4681 31.7319 68.8315 31.9899 69.253 32.1643C69.6745 32.3315 70.1469 32.415 70.6702 32.415C71.1571 32.415 71.575 32.3605 71.9238 32.2515C72.2799 32.1352 72.5852 32.0117 72.8395 31.8809C73.0939 31.7501 73.3046 31.6301 73.4718 31.5211C73.6462 31.4049 73.7952 31.3467 73.9187 31.3467C74.0786 31.3467 74.2022 31.4085 74.2894 31.532L74.8344 32.2406ZM84.7833 27.0626C84.7833 26.612 84.7179 26.2014 84.5871 25.8307C84.4635 25.4528 84.2782 25.1294 84.0311 24.8605C83.7913 24.5844 83.4969 24.3736 83.1481 24.2283C82.7993 24.0756 82.4032 23.9993 81.9599 23.9993C81.0296 23.9993 80.292 24.2719 79.7469 24.8169C79.2091 25.3547 78.8748 26.1033 78.744 27.0626H84.7833ZM86.353 32.2406C86.1132 32.5313 85.8262 32.7857 85.4918 33.0037C85.1575 33.2144 84.7978 33.3889 84.4126 33.5269C84.0347 33.665 83.6423 33.7668 83.2353 33.8322C82.8283 33.9049 82.425 33.9412 82.0253 33.9412C81.2622 33.9412 80.5573 33.814 79.9105 33.5596C79.2709 33.298 78.715 32.9201 78.2426 32.4259C77.7775 31.9245 77.4141 31.3067 77.1525 30.5727C76.8908 29.8387 76.76 28.9957 76.76 28.0437C76.76 27.2733 76.8763 26.5538 77.1089 25.8852C77.3487 25.2166 77.6902 24.6389 78.1336 24.1519C78.5769 23.6578 79.1183 23.2726 79.7578 22.9964C80.3974 22.713 81.1168 22.5713 81.9163 22.5713C82.5776 22.5713 83.1881 22.6839 83.7477 22.9092C84.3145 23.1272 84.8014 23.447 85.2084 23.8685C85.6227 24.2828 85.9461 24.7987 86.1786 25.4165C86.4112 26.0269 86.5275 26.7246 86.5275 27.5095C86.5275 27.8147 86.4948 28.0182 86.4293 28.12C86.3639 28.2217 86.2404 28.2726 86.0587 28.2726H78.6786C78.7004 28.9703 78.7949 29.5771 78.9621 30.0931C79.1365 30.6091 79.3763 31.0415 79.6815 31.3903C79.9868 31.7319 80.3501 31.9899 80.7716 32.1643C81.1932 32.3315 81.6655 32.415 82.1888 32.415C82.6757 32.415 83.0936 32.3605 83.4424 32.2515C83.7985 32.1352 84.1038 32.0117 84.3581 31.8809C84.6125 31.7501 84.8232 31.6301 84.9904 31.5211C85.1648 31.4049 85.3138 31.3467 85.4373 31.3467C85.5972 31.3467 85.7208 31.4085 85.808 31.532L86.353 32.2406ZM96.1057 25.3729C95.7423 24.886 95.3499 24.548 94.9283 24.3591C94.5068 24.1628 94.0344 24.0647 93.5112 24.0647C92.4865 24.0647 91.698 24.4317 91.1456 25.1658C90.5933 25.8998 90.3171 26.9463 90.3171 28.3053C90.3171 29.0248 90.3789 29.6425 90.5025 30.1585C90.626 30.6672 90.8077 31.0887 91.0475 31.423C91.2874 31.7501 91.5817 31.9899 91.9305 32.1425C92.2794 32.2951 92.6754 32.3714 93.1187 32.3714C93.7583 32.3714 94.3142 32.2261 94.7866 31.9354C95.2663 31.6447 95.706 31.2341 96.1057 30.7035V25.3729ZM98.0461 17.7312V33.7886H96.8905C96.6144 33.7886 96.44 33.6541 96.3673 33.3852L96.1929 32.0444C95.7205 32.6112 95.1827 33.0691 94.5795 33.4179C93.9763 33.7668 93.2786 33.9412 92.4865 33.9412C91.8542 33.9412 91.2801 33.8213 90.7641 33.5815C90.2481 33.3344 89.8084 32.9746 89.4451 32.5022C89.0817 32.0299 88.8019 31.4412 88.6057 30.7362C88.4094 30.0313 88.3113 29.221 88.3113 28.3053C88.3113 27.4913 88.4203 26.7355 88.6384 26.0378C88.8564 25.3329 89.1689 24.7224 89.5759 24.2065C89.9828 23.6905 90.4807 23.2871 91.0693 22.9964C91.6653 22.6985 92.3339 22.5495 93.0751 22.5495C93.751 22.5495 94.3288 22.6658 94.8084 22.8983C95.2953 23.1236 95.7278 23.4397 96.1057 23.8467V17.7312H98.0461ZM119.803 18.1672V33.7886H117.688V26.681H109.262V33.7886H107.147V18.1672H109.262V25.1331H117.688V18.1672H119.803ZM132.611 22.7457L126.452 37.048C126.387 37.1934 126.303 37.3097 126.201 37.3969C126.107 37.4841 125.958 37.5277 125.754 37.5277H124.315L126.332 33.1454L121.775 22.7457H123.454C123.621 22.7457 123.752 22.7893 123.847 22.8765C123.948 22.9565 124.017 23.0473 124.054 23.149L127.008 30.104C127.124 30.4092 127.222 30.729 127.302 31.0633C127.404 30.7217 127.513 30.3983 127.629 30.0931L130.496 23.149C130.54 23.0328 130.613 22.9383 130.714 22.8656C130.823 22.7857 130.943 22.7457 131.074 22.7457H132.611ZM136.277 31.1287C136.633 31.6083 137.022 31.9463 137.443 32.1425C137.865 32.3387 138.337 32.4368 138.86 32.4368C139.892 32.4368 140.684 32.0698 141.237 31.3358C141.789 30.6018 142.065 29.5553 142.065 28.1963C142.065 27.4768 142 26.8591 141.869 26.3431C141.745 25.8271 141.564 25.4056 141.324 25.0785C141.084 24.7442 140.79 24.5008 140.441 24.3482C140.092 24.1956 139.696 24.1192 139.253 24.1192C138.62 24.1192 138.064 24.2646 137.585 24.5553C137.112 24.846 136.676 25.2566 136.277 25.7871V31.1287ZM136.179 24.4572C136.644 23.883 137.181 23.4216 137.792 23.0727C138.402 22.7239 139.1 22.5495 139.885 22.5495C140.524 22.5495 141.102 22.673 141.618 22.9201C142.134 23.1599 142.574 23.5197 142.937 23.9993C143.301 24.4717 143.58 25.0604 143.777 25.7653C143.973 26.4703 144.071 27.2806 144.071 28.1963C144.071 29.0102 143.962 29.7697 143.744 30.4746C143.526 31.1723 143.21 31.7791 142.796 32.2951C142.389 32.8038 141.887 33.2072 141.291 33.5051C140.702 33.7958 140.038 33.9412 139.296 33.9412C138.62 33.9412 138.039 33.8285 137.552 33.6033C137.072 33.3707 136.647 33.0509 136.277 32.644V37.5277H134.325V22.7457H135.492C135.768 22.7457 135.939 22.8801 136.004 23.149L136.179 24.4572ZM153.938 27.0626C153.938 26.612 153.872 26.2014 153.741 25.8307C153.618 25.4528 153.432 25.1294 153.185 24.8605C152.946 24.5844 152.651 24.3736 152.302 24.2283C151.954 24.0756 151.557 23.9993 151.114 23.9993C150.184 23.9993 149.446 24.2719 148.901 24.8169C148.363 25.3547 148.029 26.1033 147.898 27.0626H153.938ZM155.507 32.2406C155.267 32.5313 154.98 32.7857 154.646 33.0037C154.312 33.2144 153.952 33.3889 153.567 33.5269C153.189 33.665 152.797 33.7668 152.39 33.8322C151.983 33.9049 151.579 33.9412 151.18 33.9412C150.416 33.9412 149.712 33.814 149.065 33.5596C148.425 33.298 147.869 32.9201 147.397 32.4259C146.932 31.9245 146.568 31.3067 146.307 30.5727C146.045 29.8387 145.914 28.9957 145.914 28.0437C145.914 27.2733 146.031 26.5538 146.263 25.8852C146.503 25.2166 146.845 24.6389 147.288 24.1519C147.731 23.6578 148.273 23.2726 148.912 22.9964C149.552 22.713 150.271 22.5713 151.071 22.5713C151.732 22.5713 152.342 22.6839 152.902 22.9092C153.469 23.1272 153.956 23.447 154.363 23.8685C154.777 24.2828 155.1 24.7987 155.333 25.4165C155.565 26.0269 155.682 26.7246 155.682 27.5095C155.682 27.8147 155.649 28.0182 155.584 28.12C155.518 28.2217 155.395 28.2726 155.213 28.2726H147.833C147.855 28.9703 147.949 29.5771 148.116 30.0931C148.291 30.6091 148.531 31.0415 148.836 31.3903C149.141 31.7319 149.504 31.9899 149.926 32.1643C150.347 32.3315 150.82 32.415 151.343 32.415C151.83 32.415 152.248 32.3605 152.597 32.2515C152.953 32.1352 153.258 32.0117 153.512 31.8809C153.767 31.7501 153.977 31.6301 154.145 31.5211C154.319 31.4049 154.468 31.3467 154.592 31.3467C154.751 31.3467 154.875 31.4085 154.962 31.532L155.507 32.2406ZM159.907 24.9586C160.256 24.2028 160.685 23.6142 161.194 23.1926C161.703 22.7639 162.324 22.5495 163.058 22.5495C163.29 22.5495 163.512 22.5749 163.723 22.6258C163.941 22.6767 164.133 22.7566 164.301 22.8656L164.159 24.3155C164.115 24.4971 164.006 24.588 163.832 24.588C163.73 24.588 163.581 24.5662 163.385 24.5226C163.189 24.479 162.967 24.4572 162.72 24.4572C162.371 24.4572 162.059 24.508 161.782 24.6098C161.514 24.7115 161.27 24.8642 161.052 25.0676C160.841 25.2639 160.649 25.511 160.474 25.8089C160.307 26.0996 160.155 26.4339 160.016 26.8118V33.7886H158.065V22.7457H159.177C159.388 22.7457 159.533 22.7857 159.613 22.8656C159.693 22.9455 159.748 23.0836 159.777 23.2799L159.907 24.9586ZM166.007 33.7886V22.7457H167.173C167.449 22.7457 167.62 22.8801 167.686 23.149L167.827 24.2828C168.234 23.7813 168.692 23.3707 169.201 23.0509C169.71 22.7312 170.298 22.5713 170.967 22.5713C171.708 22.5713 172.308 22.7784 172.766 23.1926C173.231 23.6069 173.565 24.1665 173.768 24.8714C173.928 24.4717 174.132 24.1265 174.379 23.8358C174.633 23.5451 174.917 23.3053 175.229 23.1163C175.542 22.9274 175.872 22.7893 176.221 22.7021C176.577 22.6149 176.937 22.5713 177.3 22.5713C177.882 22.5713 178.398 22.6658 178.848 22.8547C179.306 23.0364 179.691 23.3053 180.004 23.6614C180.324 24.0175 180.567 24.4572 180.734 24.9804C180.901 25.4964 180.985 26.0887 180.985 26.7573V33.7886H179.034V26.7573C179.034 25.8925 178.845 25.2384 178.467 24.7951C178.089 24.3445 177.544 24.1192 176.832 24.1192C176.512 24.1192 176.207 24.1774 175.916 24.2937C175.633 24.4027 175.382 24.5662 175.164 24.7842C174.946 25.0022 174.771 25.2784 174.641 25.6127C174.517 25.9397 174.455 26.3213 174.455 26.7573V33.7886H172.504V26.7573C172.504 25.8707 172.326 25.2094 171.97 24.7733C171.614 24.3373 171.094 24.1192 170.411 24.1192C169.931 24.1192 169.488 24.2501 169.081 24.5117C168.674 24.766 168.3 25.1149 167.958 25.5582V33.7886H166.007ZM191.325 27.0626C191.325 26.612 191.26 26.2014 191.129 25.8307C191.005 25.4528 190.82 25.1294 190.573 24.8605C190.333 24.5844 190.039 24.3736 189.69 24.2283C189.341 24.0756 188.945 23.9993 188.502 23.9993C187.571 23.9993 186.834 24.2719 186.289 24.8169C185.751 25.3547 185.417 26.1033 185.286 27.0626H191.325ZM192.895 32.2406C192.655 32.5313 192.368 32.7857 192.034 33.0037C191.699 33.2144 191.34 33.3889 190.954 33.5269C190.577 33.665 190.184 33.7668 189.777 33.8322C189.37 33.9049 188.967 33.9412 188.567 33.9412C187.804 33.9412 187.099 33.814 186.452 33.5596C185.813 33.298 185.257 32.9201 184.784 32.4259C184.319 31.9245 183.956 31.3067 183.694 30.5727C183.433 29.8387 183.302 28.9957 183.302 28.0437C183.302 27.2733 183.418 26.5538 183.651 25.8852C183.891 25.2166 184.232 24.6389 184.675 24.1519C185.119 23.6578 185.66 23.2726 186.3 22.9964C186.939 22.713 187.659 22.5713 188.458 22.5713C189.119 22.5713 189.73 22.6839 190.289 22.9092C190.856 23.1272 191.343 23.447 191.75 23.8685C192.164 24.2828 192.488 24.7987 192.72 25.4165C192.953 26.0269 193.069 26.7246 193.069 27.5095C193.069 27.8147 193.037 28.0182 192.971 28.12C192.906 28.2217 192.782 28.2726 192.601 28.2726H185.22C185.242 28.9703 185.337 29.5771 185.504 30.0931C185.678 30.6091 185.918 31.0415 186.223 31.3903C186.529 31.7319 186.892 31.9899 187.313 32.1643C187.735 32.3315 188.207 32.415 188.731 32.415C189.218 32.415 189.635 32.3605 189.984 32.2515C190.34 32.1352 190.646 32.0117 190.9 31.8809C191.154 31.7501 191.365 31.6301 191.532 31.5211C191.707 31.4049 191.856 31.3467 191.979 31.3467C192.139 31.3467 192.263 31.4085 192.35 31.532L192.895 32.2406ZM202.647 25.3729C202.284 24.886 201.892 24.548 201.47 24.3591C201.049 24.1628 200.576 24.0647 200.053 24.0647C199.028 24.0647 198.24 24.4317 197.687 25.1658C197.135 25.8998 196.859 26.9463 196.859 28.3053C196.859 29.0248 196.921 29.6425 197.044 30.1585C197.168 30.6672 197.35 31.0887 197.589 31.423C197.829 31.7501 198.124 31.9899 198.472 32.1425C198.821 32.2951 199.217 32.3714 199.661 32.3714C200.3 32.3714 200.856 32.2261 201.328 31.9354C201.808 31.6447 202.248 31.2341 202.647 30.7035V25.3729ZM204.588 17.7312V33.7886H203.432C203.156 33.7886 202.982 33.6541 202.909 33.3852L202.735 32.0444C202.262 32.6112 201.725 33.0691 201.121 33.4179C200.518 33.7668 199.82 33.9412 199.028 33.9412C198.396 33.9412 197.822 33.8213 197.306 33.5815C196.79 33.3344 196.35 32.9746 195.987 32.5022C195.624 32.0299 195.344 31.4412 195.147 30.7362C194.951 30.0313 194.853 29.221 194.853 28.3053C194.853 27.4913 194.962 26.7355 195.18 26.0378C195.398 25.3329 195.711 24.7224 196.118 24.2065C196.525 23.6905 197.022 23.2871 197.611 22.9964C198.207 22.6985 198.876 22.5495 199.617 22.5495C200.293 22.5495 200.871 22.6658 201.35 22.8983C201.837 23.1236 202.27 23.4397 202.647 23.8467V17.7312H204.588ZM209.702 22.7457V33.7886H207.762V22.7457H209.702ZM210.116 19.2791C210.116 19.4681 210.076 19.6461 209.996 19.8133C209.924 19.9732 209.822 20.1185 209.691 20.2493C209.568 20.3729 209.419 20.471 209.244 20.5437C209.077 20.6163 208.899 20.6527 208.71 20.6527C208.521 20.6527 208.343 20.6163 208.176 20.5437C208.016 20.471 207.874 20.3729 207.751 20.2493C207.627 20.1185 207.529 19.9732 207.456 19.8133C207.384 19.6461 207.347 19.4681 207.347 19.2791C207.347 19.0902 207.384 18.9121 207.456 18.745C207.529 18.5705 207.627 18.4216 207.751 18.298C207.874 18.1672 208.016 18.0655 208.176 17.9928C208.343 17.9201 208.521 17.8838 208.71 17.8838C208.899 17.8838 209.077 17.9201 209.244 17.9928C209.419 18.0655 209.568 18.1672 209.691 18.298C209.822 18.4216 209.924 18.5705 209.996 18.745C210.076 18.9121 210.116 19.0902 210.116 19.2791ZM218.875 28.8176C217.981 28.8467 217.218 28.9194 216.586 29.0357C215.961 29.1447 215.448 29.29 215.049 29.4717C214.656 29.6534 214.369 29.8678 214.188 30.1149C214.013 30.362 213.926 30.6381 213.926 30.9434C213.926 31.2341 213.973 31.4848 214.068 31.6956C214.162 31.9063 214.289 32.0807 214.449 32.2188C214.616 32.3496 214.809 32.4477 215.027 32.5131C215.252 32.5713 215.492 32.6003 215.746 32.6003C216.088 32.6003 216.401 32.5676 216.684 32.5022C216.967 32.4296 217.233 32.3278 217.48 32.197C217.734 32.0662 217.974 31.9099 218.199 31.7283C218.432 31.5466 218.657 31.3394 218.875 31.1069V28.8176ZM212.607 24.3046C213.217 23.7159 213.875 23.2762 214.58 22.9855C215.285 22.6948 216.066 22.5495 216.924 22.5495C217.541 22.5495 218.09 22.6512 218.57 22.8547C219.049 23.0582 219.453 23.3416 219.78 23.705C220.107 24.0684 220.354 24.5081 220.521 25.024C220.688 25.54 220.772 26.1069 220.772 26.7246V33.7886H219.911C219.722 33.7886 219.576 33.7595 219.475 33.7014C219.373 33.636 219.293 33.5124 219.235 33.3307L219.017 32.2842C218.726 32.5531 218.443 32.7929 218.166 33.0037C217.89 33.2072 217.6 33.3816 217.294 33.5269C216.989 33.665 216.662 33.7704 216.313 33.8431C215.972 33.923 215.59 33.963 215.169 33.963C214.74 33.963 214.337 33.9049 213.959 33.7886C213.581 33.665 213.25 33.4833 212.967 33.2435C212.69 33.0037 212.469 32.7021 212.302 32.3387C212.142 31.9681 212.062 31.532 212.062 31.0306C212.062 30.5945 212.182 30.1767 212.422 29.7769C212.661 29.37 213.05 29.0102 213.588 28.6977C214.126 28.3852 214.827 28.1309 215.692 27.9346C216.557 27.7312 217.618 27.6149 218.875 27.5858V26.7246C218.875 25.8671 218.69 25.2203 218.319 24.7842C217.948 24.3409 217.407 24.1192 216.695 24.1192C216.215 24.1192 215.812 24.181 215.485 24.3046C215.165 24.4208 214.885 24.5553 214.645 24.7079C214.413 24.8533 214.209 24.9877 214.035 25.1112C213.868 25.2275 213.701 25.2857 213.534 25.2857C213.403 25.2857 213.29 25.253 213.196 25.1876C213.101 25.1149 213.021 25.0277 212.956 24.9259L212.607 24.3046Z"
        fill="#038E7A"
      />
    </svg>
  )
}

function CollabIcon({size = '150', ...props}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 150 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M96.4605 50.5551C95.8993 50.1917 95.2445 49.907 94.541 49.7025L109.801 41.9045C92.3624 30.6091 63.2279 29.1166 44.7266 38.5711L58.7002 47.6225C59.0018 47.11 59.5237 46.6391 60.2655 46.2598C62.6636 45.0343 66.44 45.2278 68.7 46.6918C70.9603 48.1558 70.8486 50.3362 68.4505 51.5614C67.7084 51.9404 66.8343 52.1832 65.914 52.2949L76.3008 59.0229L86.5308 53.7954C86.8008 54.2215 87.2151 54.6293 87.7762 54.9927C90.0366 56.4567 93.8126 56.6502 96.2107 55.4247C98.6088 54.1992 98.7205 52.0191 96.4605 50.5551Z"
        fill="#244D4D"
      />
      <path
        d="M94.541 49.7023L94.8557 43.5618L110.116 35.7642L109.801 41.9043L94.541 49.7023Z"
        fill="#244D4D"
      />
      <path
        d="M98.0802 52.9966L98.2682 49.3258L98.3989 46.7734L86.8457 47.6548L86.5312 53.7953C86.8013 54.2215 87.2155 54.6293 87.7767 54.9927C90.037 56.4567 93.813 56.6502 96.2111 55.4246C97.4477 54.7931 98.0713 53.9071 98.0802 52.9966Z"
        fill="#1F3838"
      />
      <path
        d="M96.775 44.4145C96.2138 44.0511 95.5589 43.7664 94.8554 43.5619L110.115 35.7639C92.6768 24.4685 63.5423 22.976 45.041 32.4302L59.0147 41.4816C59.3162 40.9691 59.8382 40.4982 60.5803 40.1189C62.9784 38.8934 66.7548 39.0869 69.0148 40.5509C71.2751 42.0149 71.1633 44.1953 68.7652 45.4205C68.0231 45.7995 67.1491 46.0423 66.2288 46.1541L76.6156 52.882L86.8456 47.6545C87.1156 48.0807 87.5298 48.4885 88.091 48.8519C90.3513 50.3159 94.1274 50.5094 96.5255 49.2838C98.9235 48.0589 99.0353 45.8788 96.775 44.4145Z"
        fill="#346056"
      />
      <path
        d="M73.8804 27.1536C86.6888 27.1536 99.084 30.2485 108.201 35.6835L94.4265 42.7223C94.0824 42.898 93.8803 43.2663 93.9171 43.6508C93.9535 44.0356 94.2214 44.3589 94.5924 44.4667C95.2301 44.6522 95.7922 44.9005 96.2628 45.2054C97.0499 45.7152 97.4846 46.3293 97.4559 46.8902C97.4271 47.4514 96.9317 48.0177 96.0969 48.4445C95.2099 48.8976 94.0346 49.1474 92.788 49.1474C91.1951 49.1474 89.6701 48.7513 88.6038 48.0609C88.1712 47.7805 87.8476 47.474 87.6422 47.1501C87.464 46.8688 87.1591 46.712 86.8453 46.712C86.7005 46.712 86.5538 46.7454 86.417 46.8155L76.6716 51.7953L68.5647 46.5442C68.7827 46.4582 68.9927 46.3636 69.1945 46.2604C70.6667 45.5079 71.5136 44.3941 71.5785 43.1239C71.6437 41.8537 70.915 40.6591 69.5273 39.7603C68.164 38.877 66.2652 38.3706 64.3181 38.3706C62.7561 38.3706 61.3154 38.685 60.1511 39.2799C59.6202 39.5511 59.172 39.868 58.8108 40.2268L46.9542 32.5467C54.4597 29.0612 63.9449 27.1536 73.8804 27.1536ZM73.8804 26.2109C63.4743 26.2109 53.2201 28.2508 45.041 32.4304L59.0147 41.4817C59.3162 40.9692 59.8382 40.4984 60.5803 40.1194C61.6402 39.5778 62.9698 39.3133 64.3184 39.3133C66.0209 39.3133 67.7537 39.7345 69.0151 40.5513C71.2754 42.0154 71.1636 44.1958 68.7656 45.421C68.0234 45.8 67.1494 46.0428 66.2291 46.1545L76.6159 52.8825L86.8459 47.655C87.1159 48.0811 87.5301 48.4889 88.0913 48.8523C89.3523 49.6691 91.0858 50.0904 92.788 50.0904C94.1369 50.0904 95.4659 49.8259 96.5261 49.2843C98.9242 48.0588 99.0359 45.8787 96.7756 44.4147C96.2144 44.0513 95.5596 43.7665 94.856 43.562L110.116 35.7641C100.386 29.462 87.0134 26.2109 73.8804 26.2109Z"
        fill="#346056"
      />
      <path
        d="M76.3008 59.0233L76.6152 52.8828L86.8452 47.6553L86.5305 53.7957L76.3008 59.0233Z"
        fill="#244D4D"
      />
      <path
        d="M65.9141 52.2952L66.2285 46.1548L76.6153 52.8828L76.3008 59.0232L65.9141 52.2952Z"
        fill="#1F3838"
      />
      <path
        d="M58.7005 47.6225L59.0149 41.482L45.0413 32.4307L44.7266 38.5711L58.7005 47.6225Z"
        fill="#1F3838"
      />
      <path
        d="M121.081 52.2573L105.348 59.049L104.609 65.389C102.404 65.645 99.879 65.0979 98.2549 63.8895C97.7185 63.4903 97.3316 63.0568 97.0897 62.6141L86.5422 67.1672L92.7356 71.7757L85.8301 73.2746L90.7242 76.9162L90.103 82.2439L90.1042 82.2442C89.9888 83.1283 90.4621 84.0832 91.5536 84.8954C93.7141 86.503 97.4699 86.9411 99.9424 85.8736C100.811 85.4989 101.399 84.9867 101.711 84.4123L116.084 95.1071C125.307 91.1259 130.272 87.3437 131.319 80.8402L131.337 80.8227L132.307 72.504C133.095 65.7417 129.416 58.4587 121.081 52.2573Z"
        fill="#A8E5B5"
      />
      <path
        d="M90.7426 76.7604L95.6119 74.8625L95.7135 73.9906L86.5425 67.1665L85.8301 73.2736L90.7245 76.9153L90.7426 76.7604Z"
        fill="#73E9A2"
      />
      <path
        d="M116.725 89.6239C135.8 81.3897 137.751 64.6601 121.083 52.2573L105.349 59.049C106.038 59.2988 106.673 59.6255 107.209 60.0244C109.37 61.632 109.117 63.8004 106.645 64.8677C104.172 65.9349 100.416 65.4968 98.2557 63.8895C97.7193 63.4903 97.3323 63.0568 97.0905 62.6138L86.543 67.1669L95.714 73.9907C94.6538 74.0087 93.6267 74.1939 92.7584 74.5687C90.286 75.6359 90.0331 77.8044 92.1936 79.412C94.3541 81.0196 98.11 81.4577 100.582 80.3901C101.451 80.0154 102.039 79.5032 102.351 78.9289L116.725 89.6239Z"
        fill="#B9EFC5"
      />
      <path
        d="M120.953 53.3399C128.442 59.0603 132.139 65.8109 131.371 72.3944C130.604 78.9779 125.453 84.6967 116.848 88.5402L102.914 78.1727C102.78 78.0729 102.624 78.0116 102.461 77.9927C102.358 77.9807 102.252 77.9856 102.149 78.0083C101.882 78.067 101.654 78.2385 101.523 78.4785C101.301 78.8878 100.846 79.2497 100.209 79.5246C99.1778 79.9698 97.7824 80.1311 96.3802 79.9676C94.9783 79.8042 93.6573 79.3259 92.7563 78.6555C92.0041 78.0958 91.6098 77.4548 91.675 76.8966C91.7399 76.3385 92.2711 75.8055 93.1319 75.4338C93.8526 75.1228 94.7512 74.9495 95.7299 74.9327C96.1334 74.9259 96.4877 74.663 96.6113 74.279C96.735 73.8948 96.6003 73.4748 96.2767 73.2338L88.4157 67.3845L96.7601 63.7827C97.0198 64.0879 97.3314 64.3763 97.6927 64.6451C98.8683 65.5198 100.477 66.1137 102.224 66.3173C103.97 66.5209 105.672 66.3133 107.018 65.7325C108.536 65.0774 109.453 64.0205 109.601 62.7571C109.748 61.4936 109.099 60.2543 107.772 59.2673C107.704 59.2167 107.635 59.1671 107.564 59.1188L120.953 53.3399ZM121.083 52.2573L105.349 59.049C106.038 59.2988 106.673 59.6255 107.209 60.0244C109.37 61.632 109.117 63.8004 106.645 64.8677C105.408 65.4013 103.851 65.5587 102.333 65.3817C100.815 65.2047 99.3358 64.6932 98.2557 63.8895C97.7193 63.4903 97.3323 63.0568 97.0905 62.6141L86.543 67.1672L95.714 73.991C94.6538 74.009 93.6267 74.1942 92.7584 74.569C90.286 75.6362 90.0331 77.8047 92.1936 79.4123C93.2737 80.2159 94.753 80.7275 96.2709 80.9045C97.7891 81.0814 99.3459 80.9244 100.582 80.3904C101.45 80.0157 102.038 79.5038 102.351 78.9292L116.724 89.6239C135.8 81.3897 137.751 64.6601 121.083 52.2573Z"
        fill="#B9EFC5"
      />
      <path
        d="M101.711 84.4121L102.35 78.9292L116.723 89.624L116.084 95.1068L101.711 84.4121Z"
        fill="#73E9A2"
      />
      <path
        d="M110.357 115.842L94.8415 106.884C94.6045 106.747 94.3201 106.72 94.0623 106.809C93.8039 106.898 93.597 107.095 93.4953 107.349C93.3218 107.781 92.9124 108.193 92.3111 108.54C90.2774 109.714 86.8418 109.714 84.8083 108.54C83.9964 108.072 83.5304 107.48 83.5304 106.919C83.5304 106.357 83.9964 105.765 84.8083 105.297C85.488 104.904 86.3602 104.628 87.3307 104.498C87.7305 104.445 88.0523 104.142 88.1304 103.747C88.2087 103.351 88.0263 102.949 87.6766 102.747L77.777 97.0318C77.4855 96.8631 77.1258 96.8631 76.8343 97.0318L66.9922 102.714C66.6162 102.148 66.0566 101.644 65.3322 101.226C62.6999 99.706 58.5761 99.706 55.9441 101.226C54.5123 102.053 53.7236 103.208 53.7236 104.481C53.7236 105.753 54.5119 106.908 55.9441 107.735C56.3473 107.968 56.7897 108.167 57.2639 108.331L44.2547 115.842C43.9629 116.01 43.7832 116.322 43.7832 116.659C43.7832 116.996 43.9629 117.307 44.2547 117.475C53.3666 122.736 65.3362 125.366 77.3055 125.366C89.2747 125.366 101.244 122.736 110.357 117.475C110.648 117.307 110.828 116.995 110.828 116.659C110.828 116.322 110.648 116.01 110.357 115.842Z"
        fill="#E8E8E8"
      />
      <path
        d="M94.4857 99.8925C94.242 100.499 93.7169 101.076 92.898 101.549C91.3847 102.422 89.2627 102.726 87.3211 102.465V95.756L77.4214 90.0405L66.6743 96.2453C66.516 95.5105 65.9539 94.799 64.9767 94.2348C62.6445 92.8883 58.8632 92.8883 56.5312 94.2348C55.3651 94.908 54.7822 95.7903 54.7822 96.673V103.112L44.8418 108.851V116.57C62.8349 126.959 92.008 126.959 110.001 116.57V108.85L94.4857 99.8925Z"
        fill="#54CD85"
      />
      <path
        d="M94.4857 99.8925C94.242 100.499 93.7169 101.076 92.898 101.549C90.5657 102.895 86.7844 102.895 84.4525 101.549C82.1205 100.202 82.1202 98.0191 84.4525 96.6727C85.2714 96.2 86.2704 95.8969 87.3211 95.756L77.4214 90.0405L66.6743 96.2453C66.516 95.5105 65.9539 94.799 64.9767 94.2348C62.6445 92.8883 58.8632 92.8883 56.5312 94.2348C54.199 95.5812 54.199 97.7644 56.5312 99.1108C57.5085 99.6751 58.7407 99.9996 60.0137 100.091L44.8418 108.85C62.8349 119.239 92.008 119.239 110.001 108.85L94.4857 99.8925Z"
        fill="#73E9A2"
      />
      <path
        d="M77.4214 91.1287L84.8649 95.4261C84.5517 95.5538 84.2562 95.6977 83.9813 95.8563C82.5495 96.6829 81.7608 97.8386 81.7608 99.1107C81.7608 100.383 82.5495 101.538 83.9813 102.365C85.2503 103.098 86.9173 103.501 88.6755 103.501C90.4338 103.501 92.1007 103.098 93.3697 102.365C93.9597 102.024 94.4456 101.62 94.8108 101.168L108.085 108.832C99.7065 113.269 88.8947 115.699 77.4214 115.699C65.9481 115.699 55.1367 113.269 46.7577 108.833L60.4852 100.907C60.8437 100.7 61.0252 100.283 60.9325 99.8797C60.8397 99.4762 60.4944 99.1805 60.0814 99.1508C58.9064 99.0666 57.8131 98.7623 57.0027 98.2945C56.1908 97.8258 55.7248 97.2346 55.7248 96.6728C55.7248 96.111 56.1905 95.5198 57.0027 95.0511C57.9754 94.4896 59.3429 94.1676 60.7543 94.1676C62.1659 94.1676 63.5332 94.4896 64.5059 95.0511C65.2036 95.454 65.6466 95.9484 65.7531 96.4438C65.8165 96.7383 66.017 96.9848 66.2922 97.1069C66.4144 97.1611 66.5445 97.1877 66.6746 97.1877C66.8378 97.1877 67.0007 97.1455 67.1461 97.0613L77.4214 91.1287ZM77.4214 90.04L66.6743 96.2448C66.516 95.51 65.9539 94.7985 64.9767 94.2343C63.8109 93.5611 62.2823 93.2246 60.754 93.2243C59.2254 93.2243 57.6974 93.5608 56.5312 94.2343C54.199 95.5807 54.199 97.7639 56.5312 99.1104C57.5085 99.6746 58.7407 99.9991 60.0137 100.09L44.8418 108.85C53.8374 114.043 65.6313 116.641 77.4214 116.641C89.2144 116.641 101.004 114.045 110.001 108.85L94.4863 99.8923C94.2426 100.499 93.7175 101.076 92.8986 101.549C91.7324 102.222 90.2041 102.559 88.6758 102.559C87.1475 102.559 85.6192 102.222 84.4531 101.549C82.1208 100.202 82.1208 98.0189 84.4531 96.6725C85.2721 96.1998 86.271 95.8967 87.3217 95.7559L77.4214 90.04Z"
        fill="#73E9A2"
      />
      <path
        d="M31.6124 86.861C31.6124 86.861 30.9952 86.425 31.1669 85.1658C31.3041 84.1616 31.3971 83.2796 31.778 83.0335C32.0743 82.8418 32.0909 83.5573 32.1132 84.3239C32.1132 84.3239 33.2313 82.5537 33.8405 82.1588C34.4501 81.7642 33.659 83.2974 33.1655 84.2483C33.1655 84.2483 34.593 82.2366 35.0122 82.4282C35.4313 82.6199 33.9428 84.4957 33.9428 84.4957C33.9428 84.4957 35.4301 83.2557 35.6887 83.4808C35.9282 83.6892 34.4329 85.2555 34.4329 85.2555C34.4329 85.2555 35.5969 84.4255 35.8773 84.6463C36.0861 84.8107 34.3778 86.7667 32.9637 87.1895C32.4797 87.3343 31.8879 87.1598 31.6124 86.861Z"
        fill="#E0AF9E"
      />
      <path
        d="M65.5648 71.0442L59.2336 67.0657L59.4473 61.3545C59.4485 61.3315 59.4494 61.3089 59.4497 61.2859L59.451 61.2516L59.4482 61.2522C59.4513 60.3922 58.9054 59.5167 57.7947 58.8186C55.5145 57.3858 51.736 57.2444 49.355 58.5027C48.6184 58.8921 48.1029 59.37 47.8084 59.8865L33.7113 51.0283C24.7668 55.7553 20.0301 62.171 19.5531 68.7866L19.5418 68.7927L19.5222 69.3193C19.5222 69.3199 19.5222 69.3205 19.5222 69.3211L19.2335 77.0337C19.2335 77.0343 19.2335 77.0349 19.2335 77.0355L19.209 77.6891L19.2234 77.694C19.258 84.2864 23.5034 90.9874 32.0153 96.3362L47.5043 88.1506C46.236 88.0116 45.0166 87.6412 44.0611 87.0408C42.1228 85.8227 41.8978 84.0657 43.3346 82.7924L45.4014 81.7C47.7263 80.9852 50.745 81.2659 52.6832 82.4841C53.6387 83.0844 54.1735 83.8165 54.3043 84.5567L65.2761 78.7582L58.7398 74.6509L65.5648 71.0442Z"
        fill="#038E7A"
      />
      <path
        d="M44.35 79.3267C42.0698 77.894 42.1516 75.7123 44.5325 74.454C46.9134 73.1958 50.6919 73.3372 52.9721 74.77C53.9276 75.3704 54.4625 76.1024 54.5932 76.8426L65.565 71.0441L55.0867 64.4598C56.0052 64.3352 56.8762 64.0807 57.6128 63.6913C59.9937 62.433 60.0755 60.2514 57.7952 58.8186C55.515 57.3858 51.7365 57.2444 49.3556 58.5027C48.619 58.8921 48.1034 59.37 47.8089 59.8865L33.7119 51.0283C15.3426 60.7364 14.7122 77.5676 32.3042 88.6218L47.7933 80.4362C46.5246 80.2975 45.3052 79.9271 44.35 79.3267Z"
        fill="#44AE75"
      />
      <path
        d="M33.6746 52.1187L47.3074 60.6851C47.4489 60.7739 47.6099 60.8229 47.7737 60.829C47.8619 60.8324 47.951 60.8232 48.0382 60.8014C48.2874 60.739 48.5005 60.5773 48.6279 60.3542C48.8416 59.9794 49.2454 59.6277 49.7961 59.3368C50.789 58.8121 52.1676 58.5414 53.578 58.5941C54.9885 58.6471 56.3429 59.02 57.2938 59.6173C58.0876 60.1163 58.5309 60.7243 58.5101 61.2855C58.489 61.8469 58.0016 62.4201 57.1725 62.8582C56.5599 63.1818 55.7952 63.4129 54.9603 63.5259C54.5672 63.5792 54.2494 63.8727 54.1655 64.2606C54.0816 64.6482 54.2494 65.0471 54.5853 65.2581L63.681 70.9736L55.0769 75.5209C54.7224 74.941 54.1821 74.4169 53.4736 73.9717C52.2328 73.192 50.582 72.7266 48.8253 72.6608C47.0686 72.595 45.3876 72.9357 44.0919 73.6206C42.6301 74.393 41.7989 75.5187 41.7511 76.7896C41.7034 78.0607 42.4482 79.2452 43.8482 80.1248C44.2426 80.3724 44.6773 80.5883 45.1451 80.7695L32.3483 87.5324C24.4322 82.4184 20.2165 75.9789 20.4645 69.3556C20.7124 62.7326 25.3981 56.6265 33.6746 52.1187ZM33.7119 51.0288C15.3426 60.7368 14.7122 77.5681 32.3042 88.6223L47.7933 80.4367C46.5246 80.2977 45.3055 79.9273 44.35 79.3269C42.0698 77.8941 42.1516 75.7125 44.5325 74.4542C45.7231 73.8251 47.2631 73.5459 48.7901 73.6031C50.3175 73.6604 51.832 74.0538 52.9721 74.7702C53.9276 75.3705 54.4625 76.1025 54.5932 76.8428L65.565 71.0443L55.0867 64.4599C56.0052 64.3353 56.8762 64.0809 57.6128 63.6915C59.9937 62.4332 60.0755 60.2516 57.7952 58.8188C56.6551 58.1024 55.1406 57.7087 53.6132 57.6518C52.0858 57.5948 50.5459 57.8737 49.3556 58.5029C48.619 58.8923 48.1034 59.3702 47.8089 59.8867L33.7119 51.0288Z"
        fill="#44AE75"
      />
      <path
        d="M32.0156 96.3368L32.3046 88.6224L47.7937 80.4365L47.5047 88.1509L32.0156 96.3368Z"
        fill="#237A66"
      />
      <path
        d="M54.3047 84.5568L54.5934 76.8424L65.5652 71.0439L65.2762 78.7583L54.3047 84.5568Z"
        fill="#237A66"
      />
    </svg>
  )
}

function PublishIcon({size = '151', ...props}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 151 151"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M131.483 23.0703H17.3086V128.507H131.483V23.0703Z"
        fill="#D2F1D3"
      />
      <path
        d="M131.483 23.0703H17.3086V30.6861H131.483V23.0703Z"
        fill="#1F3838"
      />
      <path
        d="M128.395 25.2832H121.895V26.4727H128.395V25.2832Z"
        fill="#FCFCFC"
      />
      <path
        d="M128.395 27.2832H121.895V28.4727H128.395V27.2832Z"
        fill="#FCFCFC"
      />
      <path
        d="M117.195 26.8778C117.195 27.4301 116.748 27.8777 116.195 27.8777C115.643 27.8777 115.195 27.4301 115.195 26.8778C115.195 26.3255 115.643 25.8779 116.195 25.8779C116.747 25.8776 117.195 26.3255 117.195 26.8778Z"
        fill="#FCFCFC"
      />
      <path
        d="M113.178 26.8778C113.178 27.4301 112.73 27.8777 112.178 27.8777C111.625 27.8777 111.178 27.4301 111.178 26.8778C111.178 26.3255 111.625 25.8779 112.178 25.8779C112.73 25.8776 113.178 26.3255 113.178 26.8778Z"
        fill="#FCFCFC"
      />
      <path
        d="M22.0955 26.8783C22.0955 27.4306 21.6479 27.8782 21.0956 27.8782C20.5433 27.8782 20.0957 27.4306 20.0957 26.8783C20.0957 26.326 20.5433 25.8784 21.0956 25.8784C21.6476 25.8781 22.0955 26.326 22.0955 26.8783Z"
        fill="#54CD85"
      />
      <path
        d="M26.7947 26.8783C26.7947 27.4306 26.3471 27.8782 25.7948 27.8782C25.2425 27.8782 24.7949 27.4306 24.7949 26.8783C24.7949 26.326 25.2425 25.8784 25.7948 25.8784C26.3471 25.8784 26.7947 26.326 26.7947 26.8783Z"
        fill="#A8E5B5"
      />
      <path
        d="M31.4959 26.8783C31.4959 27.4306 31.0483 27.8782 30.496 27.8782C29.9437 27.8782 29.4961 27.4306 29.4961 26.8783C29.4961 26.326 29.9437 25.8784 30.496 25.8784C31.0483 25.8781 31.4959 26.326 31.4959 26.8783Z"
        fill="#DEF8DF"
      />
      <path
        d="M131.483 23.0703H17.3086V128.507H131.483V23.0703Z"
        fill="#D2F1D3"
      />
      <path
        d="M131.483 23.0703H17.3086V30.6861H131.483V23.0703Z"
        fill="#1F3838"
      />
      <path
        d="M128.395 25.2832H121.895V26.4727H128.395V25.2832Z"
        fill="#FCFCFC"
      />
      <path
        d="M128.395 27.2832H121.895V28.4727H128.395V27.2832Z"
        fill="#FCFCFC"
      />
      <path
        d="M117.195 26.8778C117.195 27.4301 116.748 27.8777 116.195 27.8777C115.643 27.8777 115.195 27.4301 115.195 26.8778C115.195 26.3255 115.643 25.8779 116.195 25.8779C116.747 25.8776 117.195 26.3255 117.195 26.8778Z"
        fill="#FCFCFC"
      />
      <path
        d="M113.178 26.8778C113.178 27.4301 112.73 27.8777 112.178 27.8777C111.625 27.8777 111.178 27.4301 111.178 26.8778C111.178 26.3255 111.625 25.8779 112.178 25.8779C112.73 25.8776 113.178 26.3255 113.178 26.8778Z"
        fill="#FCFCFC"
      />
      <path
        d="M22.0955 26.8783C22.0955 27.4306 21.6479 27.8782 21.0956 27.8782C20.5433 27.8782 20.0957 27.4306 20.0957 26.8783C20.0957 26.326 20.5433 25.8784 21.0956 25.8784C21.6476 25.8781 22.0955 26.326 22.0955 26.8783Z"
        fill="#54CD85"
      />
      <path
        d="M26.7947 26.8783C26.7947 27.4306 26.3471 27.8782 25.7948 27.8782C25.2425 27.8782 24.7949 27.4306 24.7949 26.8783C24.7949 26.326 25.2425 25.8784 25.7948 25.8784C26.3471 25.8784 26.7947 26.326 26.7947 26.8783Z"
        fill="#A8E5B5"
      />
      <path
        d="M31.4959 26.8783C31.4959 27.4306 31.0483 27.8782 30.496 27.8782C29.9437 27.8782 29.4961 27.4306 29.4961 26.8783C29.4961 26.326 29.9437 25.8784 30.496 25.8784C31.0483 25.8781 31.4959 26.326 31.4959 26.8783Z"
        fill="#DEF8DF"
      />
      <path
        d="M131.483 23.0698H17.3086V128.507H131.483V23.0698Z"
        fill="#D2F1D3"
      />
      <path
        d="M131.483 23.0698H17.3086V128.507H131.483V23.0698Z"
        fill="#D2F1D3"
      />
      <path
        d="M131.483 23.0698H17.3086V32.2516H131.483V23.0698Z"
        fill="#1F3838"
      />
      <path
        d="M131.483 23.0698H17.3086V30.6856H131.483V23.0698Z"
        fill="#1F3838"
      />
      <path
        d="M128.395 25.2822H121.895V26.4717H128.395V25.2822Z"
        fill="#FCFCFC"
      />
      <path
        d="M128.395 27.2827H121.895V28.4722H128.395V27.2827Z"
        fill="#FCFCFC"
      />
      <path
        d="M22.0955 26.8778C22.0955 27.4301 21.6479 27.8777 21.0956 27.8777C20.5433 27.8777 20.0957 27.4301 20.0957 26.8778C20.0957 26.3255 20.5433 25.8779 21.0956 25.8779C21.6476 25.8776 22.0955 26.3255 22.0955 26.8778Z"
        fill="#54CD85"
      />
      <path
        d="M26.7947 26.8778C26.7947 27.4301 26.3471 27.8777 25.7948 27.8777C25.2425 27.8777 24.7949 27.4301 24.7949 26.8778C24.7949 26.3255 25.2425 25.8779 25.7948 25.8779C26.3471 25.8779 26.7947 26.3255 26.7947 26.8778Z"
        fill="#A8E5B5"
      />
      <path
        d="M31.4959 26.8778C31.4959 27.4301 31.0483 27.8777 30.496 27.8777C29.9437 27.8777 29.4961 27.4301 29.4961 26.8778C29.4961 26.3255 29.9437 25.8779 30.496 25.8779C31.0483 25.8776 31.4959 26.3255 31.4959 26.8778Z"
        fill="#DEF8DF"
      />
      <path
        d="M61.4879 46.0884H26.3828V78.4884H61.4879V46.0884Z"
        fill="#54CD85"
      />
      <path
        d="M61.4879 44.5083H26.3828V76.9083H61.4879V44.5083Z"
        fill="#54CD85"
      />
      <path d="M122.46 81.4077H76.834V113.808H122.46V81.4077Z" fill="#54CD85" />
      <path
        d="M122.782 44.5083H65.9316V48.1083H122.782V44.5083Z"
        fill="#1F3838"
      />
      <path
        d="M122.782 53.8584H65.9316V57.4584H122.782V53.8584Z"
        fill="#1F3838"
      />
      <path d="M122.782 63.208H65.9316V66.808H122.782V63.208Z" fill="#1F3838" />
      <path
        d="M122.782 72.5576H65.9316V76.1576H122.782V72.5576Z"
        fill="#1F3838"
      />
      <path
        d="M73.5892 81.9082H26.0098V85.5082H73.5892V81.9082Z"
        fill="#1F3838"
      />
      <path
        d="M73.5892 91.2578H26.0098V94.8578H73.5892V91.2578Z"
        fill="#1F3838"
      />
      <path
        d="M73.5892 100.608H26.0098V104.208H73.5892V100.608Z"
        fill="#1F3838"
      />
      <path
        d="M73.5892 109.958H26.0098V113.558H73.5892V109.958Z"
        fill="#1F3838"
      />
      <path
        d="M122.46 79.1578C131.777 79.1578 139.33 71.6049 139.33 62.2879C139.33 52.9709 131.777 45.418 122.46 45.418C113.143 45.418 105.59 52.9709 105.59 62.2879C105.59 71.6049 113.143 79.1578 122.46 79.1578Z"
        fill="#54CD85"
      />
      <path
        opacity="0.23"
        d="M122.46 45.418C121.277 45.418 120.124 45.5407 119.01 45.7723C126.672 47.3647 132.43 54.1534 132.43 62.2879C132.43 70.4224 126.672 77.2111 119.01 78.8035C120.124 79.0351 121.277 79.1578 122.46 79.1578C131.777 79.1578 139.33 71.605 139.33 62.2879C139.33 52.9708 131.777 45.418 122.46 45.418Z"
        fill="#244D4D"
      />
      <path d="M135.26 59.1885H109.66V65.3886H135.26V59.1885Z" fill="#FCFCFC" />
    </svg>
  )
}

function ArchiveIcon({size = '151', ...props}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 151 151"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        d="M115.562 70.8032H30.5176V125.788H115.562V70.8032Z"
        fill="#244D4D"
      />
      <path
        d="M88.7608 65.1089H115.562V70.8035H87.2207L88.7608 65.1089Z"
        fill="#244D4D"
      />
      <path
        d="M45.623 31.6241L45.92 32.7259L46.2147 31.6234C46.4812 30.6267 46.5383 29.6368 46.5482 28.6693L46.5483 28.6693L46.5482 28.6628C46.5377 27.6949 46.4786 26.7048 46.2086 25.7085L45.9117 24.6126L45.6171 25.7091C45.3492 26.7061 45.2921 27.6962 45.2835 28.6641L45.2834 28.6641L45.2835 28.6705C45.2954 29.6381 45.3545 30.6279 45.623 31.6241Z"
        fill="#038E7A"
        stroke="#038E7A"
        strokeWidth="0.612717"
      />
      <path
        d="M51.4852 33.1542L51.1908 34.2584L51.9981 33.4496C52.7269 32.7194 53.2711 31.8911 53.764 31.0579L53.7641 31.0579L53.7673 31.0522C54.242 30.2088 54.6858 29.3225 54.9504 28.3241L55.2413 27.226L54.4377 28.0289C53.7073 28.7586 53.1624 29.5877 52.6712 30.4214L52.6711 30.4213L52.6679 30.427C52.1947 31.2708 51.751 32.1575 51.4852 33.1542Z"
        fill="#038E7A"
        stroke="#038E7A"
        strokeWidth="0.612717"
      />
      <path
        d="M55.7968 37.411L54.9895 38.2198L56.0932 37.9233C57.0899 37.6554 57.976 37.2097 58.8184 36.7352L58.8184 36.7353L58.8241 36.7319C59.6571 36.2387 60.4842 35.6925 61.2125 34.9608L62.0142 34.1553L60.9163 34.4487C59.9187 34.7152 59.0325 35.1603 58.1901 35.6371L58.1901 35.6371L58.1845 35.6404C57.3532 36.1347 56.5257 36.6808 55.7968 37.411Z"
        fill="#038E7A"
        stroke="#038E7A"
        strokeWidth="0.612717"
      />
      <path
        d="M57.4027 43.2524L56.3005 43.5495L57.4033 43.8442C58.4007 44.1106 59.3905 44.1677 60.3575 44.1776L60.3575 44.1777L60.364 44.1776C61.3318 44.167 62.3219 44.108 63.3183 43.838L64.4142 43.5411L63.3177 43.2464C62.3206 42.9785 61.3306 42.9215 60.3627 42.9129L60.3627 42.9128L60.3562 42.9129C59.3886 42.9248 58.3988 42.9839 57.4027 43.2524Z"
        fill="#038E7A"
        stroke="#038E7A"
        strokeWidth="0.612717"
      />
      <path
        d="M55.8719 49.1141L54.7678 48.8197L55.5765 49.627C56.3067 50.3558 57.1349 50.9006 57.9684 51.393L57.9684 51.3931L57.974 51.3962C58.8174 51.8709 59.7043 52.3147 60.702 52.5793L61.8004 52.8705L60.9973 52.0666C60.2675 51.3362 59.4384 50.7913 58.6048 50.3001L58.6048 50.3L58.5991 50.2968C57.7553 49.8236 56.8686 49.3799 55.8719 49.1141Z"
        fill="#038E7A"
        stroke="#038E7A"
        strokeWidth="0.612717"
      />
      <path
        d="M51.6168 53.4257L50.808 52.6184L51.1045 53.7221C51.3723 54.7188 51.8174 55.6041 52.2926 56.4473L52.2926 56.4474L52.2959 56.453C52.7891 57.286 53.3353 58.1131 54.067 58.8414L54.8725 59.6431L54.5791 58.5452C54.3126 57.5475 53.8668 56.6612 53.3908 55.8192L53.3908 55.8191L53.3874 55.8134C52.8931 54.9821 52.347 54.1546 51.6168 53.4257Z"
        fill="#038E7A"
        stroke="#038E7A"
        strokeWidth="0.612717"
      />
      <path
        d="M45.7751 55.0316L45.4781 53.9297L45.1833 55.0322C44.9169 56.029 44.8598 57.0188 44.8499 57.9864L44.8498 57.9864L44.8499 57.9929C44.8604 58.9607 44.9195 59.9508 45.1895 60.9472L45.4864 62.0431L45.781 60.9466C46.049 59.9495 46.106 58.9595 46.1146 57.9916L46.1147 57.9916L46.1146 57.9851C46.1027 57.0176 46.0436 56.0277 45.7751 55.0316Z"
        fill="#038E7A"
        stroke="#038E7A"
        strokeWidth="0.612717"
      />
      <path
        d="M39.9131 53.5003L40.207 52.3975L39.4004 53.2049C38.6708 53.9352 38.1266 54.7642 37.6343 55.5967L37.6343 55.5967L37.6311 55.6024C37.1564 56.4458 36.7125 57.3321 36.448 58.3305L36.1571 59.4285L36.9607 58.6257C37.6911 57.8959 38.236 57.0668 38.7272 56.2332L38.7272 56.2332L38.7304 56.2275C39.2036 55.3838 39.6473 54.4977 39.9131 53.5003Z"
        fill="#038E7A"
        stroke="#038E7A"
        strokeWidth="0.612717"
      />
      <path
        d="M35.6009 49.2447L36.4082 48.4359L35.3045 48.7325C34.3078 49.0003 33.4224 49.446 32.5794 49.9205L32.5794 49.9204L32.5736 49.9238C31.7406 50.417 30.9135 50.9632 30.1852 51.695L29.3835 52.5004L30.4814 52.2071C31.4791 51.9405 32.3648 51.4947 33.2074 51.0187L33.2074 51.0188L33.2132 51.0154C34.0452 50.521 34.8721 49.9749 35.6009 49.2447Z"
        fill="#038E7A"
        stroke="#038E7A"
        strokeWidth="0.612717"
      />
      <path
        d="M33.9956 43.403L35.0975 43.106L33.995 42.8113C32.9983 42.5448 32.0084 42.4877 31.0408 42.4778L31.0408 42.4778L31.0344 42.4778C30.0665 42.4884 29.0764 42.5475 28.08 42.8174L26.9841 43.1143L28.0807 43.409C29.0777 43.6769 30.0678 43.734 31.0356 43.7425L31.0356 43.7426L31.0421 43.7425C32.0097 43.7307 32.9995 43.6716 33.9956 43.403Z"
        fill="#038E7A"
        stroke="#038E7A"
        strokeWidth="0.612717"
      />
      <path
        d="M35.5258 37.5411L36.6289 37.8352L35.8213 37.0283C35.0917 36.2994 34.2627 35.7546 33.4293 35.2622L33.4294 35.2621L33.4238 35.259C32.5804 34.7843 31.6941 34.3405 30.6956 34.0759L29.5976 33.785L30.4005 34.5886C31.1302 35.319 31.9593 35.8639 32.7929 36.3551L32.7929 36.3552L32.7986 36.3584C33.6424 36.8316 34.5291 37.2753 35.5258 37.5411Z"
        fill="#038E7A"
        stroke="#038E7A"
        strokeWidth="0.612717"
      />
      <path
        d="M39.7817 33.2299L40.5904 34.0364L40.2938 32.9334C40.026 31.9374 39.581 31.0514 39.1058 30.2082L39.1058 30.2081L39.1025 30.2025C38.6093 29.3695 38.0631 28.5425 37.3314 27.8141L36.5259 27.0124L36.8193 28.1103C37.0858 29.108 37.5309 29.9942 38.0077 30.8365L38.0077 30.8365L38.011 30.8421C38.5052 31.674 39.0507 32.501 39.7817 33.2299Z"
        fill="#038E7A"
        stroke="#038E7A"
        strokeWidth="0.612717"
      />
      <path
        d="M109.577 43.9844H54.2656V114.987H109.577V43.9844Z"
        fill="#EBEBEB"
      />
      <path
        d="M109.577 114.987L54.265 115.084H54.1685V114.987L54.1152 43.9841V43.834H54.2654L109.577 43.8686H109.692L109.692 43.9838L109.577 114.987ZM109.577 114.987L109.461 43.9844L109.577 44.0996L54.265 44.1342L54.4152 43.9841L54.3619 114.987L54.2654 114.89L109.577 114.987Z"
        fill="#DBDBDB"
      />
      <path
        d="M60.3145 59.1598L81.9201 59.105L103.526 59.1598L81.9201 59.2143L60.3145 59.1598Z"
        fill="#C7C7C7"
      />
      <path
        d="M60.3145 60.9212L81.9201 60.8667L103.526 60.9212L81.9201 60.9758L60.3145 60.9212Z"
        fill="#C7C7C7"
      />
      <path
        d="M60.3145 62.6837L81.9201 62.6289L103.526 62.6837L81.9201 62.7383L60.3145 62.6837Z"
        fill="#C7C7C7"
      />
      <path
        d="M60.3145 64.4456L81.9201 64.3911L103.526 64.4456L81.9201 64.5005L60.3145 64.4456Z"
        fill="#C7C7C7"
      />
      <path
        d="M60.3145 66.2079L81.9201 66.1533L103.526 66.2079L81.9201 66.2624L60.3145 66.2079Z"
        fill="#C7C7C7"
      />
      <path
        d="M60.3145 67.9701L81.9201 67.9155L103.526 67.9701L81.9201 68.0246L60.3145 67.9701Z"
        fill="#C7C7C7"
      />
      <path
        d="M60.3145 69.7318L81.9201 69.6772L103.526 69.7318L81.9201 69.7866L60.3145 69.7318Z"
        fill="#C7C7C7"
      />
      <path
        d="M60.3145 71.494L81.9201 71.4395L103.526 71.494L81.9201 71.5485L60.3145 71.494Z"
        fill="#C7C7C7"
      />
      <path
        d="M60.3145 73.256L81.9201 73.2012L103.526 73.256L81.9201 73.3105L60.3145 73.256Z"
        fill="#C7C7C7"
      />
      <path
        d="M60.3145 75.0179L81.9201 74.9634L103.526 75.0179L81.9201 75.0724L60.3145 75.0179Z"
        fill="#C7C7C7"
      />
      <path
        d="M60.3145 76.7801L81.9201 76.7256L103.526 76.7801L81.9201 76.8347L60.3145 76.7801Z"
        fill="#C7C7C7"
      />
      <path
        d="M60.3145 78.5421L81.9201 78.4873L103.526 78.5421L81.9201 78.5967L60.3145 78.5421Z"
        fill="#C7C7C7"
      />
      <path
        d="M60.3145 80.304L81.9201 80.2495L103.526 80.304L81.9201 80.3586L60.3145 80.304Z"
        fill="#C7C7C7"
      />
      <path
        d="M60.3145 82.0663L81.9201 82.0117L103.526 82.0663L81.9201 82.1208L60.3145 82.0663Z"
        fill="#C7C7C7"
      />
      <path
        d="M60.3145 83.828L81.9201 83.7734L103.526 83.828L81.9201 83.8828L60.3145 83.828Z"
        fill="#C7C7C7"
      />
      <path
        d="M68.1596 78.4873H64.8828V85.8825H68.1596V78.4873Z"
        fill="#FFC727"
      />
      <path
        d="M74.2397 74.543H70.9629V85.8825H74.2397V74.543Z"
        fill="#FFC727"
      />
      <path
        d="M80.3178 70.1274H77.041V85.8822H80.3178V70.1274Z"
        fill="#FFC727"
      />
      <path
        d="M86.3979 68.2305H83.1211V85.8825H86.3979V68.2305Z"
        fill="#FFC727"
      />
      <path
        d="M92.476 64.8506H89.1992V85.8824H92.476V64.8506Z"
        fill="#FFC727"
      />
      <path
        d="M98.5541 61.5107H95.2773V85.8825H98.5541V61.5107Z"
        fill="#FFC727"
      />
      <path
        d="M61.4863 57.9229L61.5715 64.9127L61.63 71.9026C61.6701 76.5626 61.6818 81.2223 61.6891 85.8823L61.4863 85.6795L71.9959 85.671L82.5056 85.6949L93.0152 85.7619L103.525 85.8823L93.0152 86.0027L82.5056 86.0698L71.9959 86.0937L61.4863 86.0852L61.2832 86.0848L61.2835 85.8823C61.2909 81.2223 61.3028 76.5626 61.3426 71.9026L61.4012 64.9127L61.4863 57.9229Z"
        fill="#C7C7C7"
      />
      <path
        d="M68.1596 87.3599H64.8828V87.6561H68.1596V87.3599Z"
        fill="#C7C7C7"
      />
      <path
        d="M74.2397 87.3599H70.9629V87.6561H74.2397V87.3599Z"
        fill="#C7C7C7"
      />
      <path
        d="M80.3178 87.3599H77.041V87.6561H80.3178V87.3599Z"
        fill="#C7C7C7"
      />
      <path
        d="M86.3979 87.3599H83.1211V87.6561H86.3979V87.3599Z"
        fill="#C7C7C7"
      />
      <path
        d="M92.476 87.3599H89.1992V87.6561H92.476V87.3599Z"
        fill="#C7C7C7"
      />
      <path
        d="M98.5541 87.3599H95.2773V87.6561H98.5541V87.3599Z"
        fill="#C7C7C7"
      />
      <path
        d="M65.2539 79.4206C66.8568 79.3992 68.455 79.2711 70.0398 79.0573C71.6259 78.8526 73.2012 78.5735 74.7553 78.2074C77.8593 77.4716 80.9119 76.4734 83.7577 75.0366C86.6221 73.6467 89.2936 71.852 91.6246 69.6803L92.0673 69.2786L92.487 68.8537L93.3225 67.9984C93.839 67.3918 94.3926 66.814 94.8628 66.1679C95.8778 64.9317 96.72 63.5681 97.5459 62.1953L97.572 62.2091C96.1155 65.0637 94.2179 67.7245 91.8786 69.9489C90.735 71.0886 89.451 72.0775 88.1324 73.0043C86.8123 73.9331 85.4068 74.7361 83.9629 75.4539C81.0644 76.8726 77.98 77.8916 74.8319 78.5539C71.6822 79.2013 68.4615 79.5551 65.2539 79.4206Z"
        fill="#263238"
      />
      <path
        d="M98.4736 64.475L98.0196 64.5887L97.4626 62.3522L95.2725 63.0713L95.127 62.6267L97.7941 61.7515L98.4736 64.475Z"
        fill="#263238"
      />
      <path
        d="M59.3932 98.6992H104.451V96.8761H59.3932V98.6992Z"
        fill="#DBDBDB"
      />
      <path
        d="M59.3921 103.301H84.7598V101.478H59.3921V103.301Z"
        fill="#DBDBDB"
      />
      <path
        d="M69.2358 53.6538H94.6035V51.8304H69.2358V53.6538Z"
        fill="#DBDBDB"
      />
      <path
        d="M99.0576 111.189L43.7461 111.161L43.7822 40.1582L84.8508 40.179L99.087 53.7152L99.0576 111.189Z"
        fill="#B9EFC5"
      />
      <path
        d="M84.8505 40.1792L99.0866 53.7153L84.8438 53.7083L84.8505 40.1792Z"
        fill="#73E9A2"
      />
      <path
        d="M49.1713 53.8979L79.9238 53.9136L79.9248 52.0901L49.1722 52.0745L49.1713 53.8979Z"
        fill="white"
      />
      <path
        d="M49.1693 58.499L79.9219 58.5146L79.9228 56.6912L49.1702 56.6755L49.1693 58.499Z"
        fill="white"
      />
      <path
        d="M49.1654 63.1016L79.918 63.1172L79.9189 61.2937L49.1663 61.2782L49.1654 63.1016Z"
        fill="white"
      />
      <path
        d="M49.1647 67.7041L94.2227 67.7271L94.2236 65.9039L49.1656 65.881L49.1647 67.7041Z"
        fill="white"
      />
      <path
        d="M49.1627 72.3062L94.2207 72.3291L94.2216 70.5057L49.1637 70.4828L49.1627 72.3062Z"
        fill="white"
      />
      <path
        d="M49.1608 76.9073L94.2188 76.9302L94.2197 75.1067L49.1617 75.0838L49.1608 76.9073Z"
        fill="white"
      />
      <path
        d="M49.1588 81.5093L94.2168 81.5322L94.2177 79.7088L49.1598 79.6859L49.1588 81.5093Z"
        fill="white"
      />
      <path
        d="M49.1569 86.1109L94.2148 86.1338L94.2158 84.3103L49.1578 84.2875L49.1569 86.1109Z"
        fill="white"
      />
      <path
        d="M49.1549 90.7129L94.2129 90.7358L94.2138 88.9124L49.1559 88.8895L49.1549 90.7129Z"
        fill="white"
      />
      <path
        d="M49.151 95.315L94.209 95.3379L94.2099 93.5144L49.1519 93.4916L49.151 95.315Z"
        fill="white"
      />
      <path
        d="M49.1491 99.9175L94.207 99.9404L94.208 98.117L49.15 98.0941L49.1491 99.9175Z"
        fill="white"
      />
      <path
        d="M49.1471 104.519L94.2051 104.542L94.206 102.719L49.148 102.696L49.1471 104.519Z"
        fill="white"
      />
      <path
        d="M30.7148 125.482H115.76L121.61 75.0591H36.5654L30.7148 125.482Z"
        fill="#346056"
      />
      <path
        d="M95.4153 69.8374H122.217L121.611 75.0593H93.2695L95.4153 69.8374Z"
        fill="#346056"
      />
    </svg>
  )
}

function AnalyticsIcon({size = '52', ...props}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 53 54"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M47.9586 0.84686C47.3559 0.94209 46.9054 1.17762 46.4426 1.63941C45.8868 2.19414 45.6403 2.78383 45.6421 3.55474C45.6432 4.00554 45.7245 4.36652 45.906 4.72605C45.973 4.85882 46.0279 4.98818 46.0279 5.01344C46.0279 5.05881 45.6422 5.60642 44.6954 6.90525C44.4284 7.27152 43.8576 8.05816 43.4268 8.65335C42.9961 9.24853 42.5469 9.86661 42.4285 10.0268C42.3102 10.1871 41.3177 11.5544 40.2231 13.0652C39.1284 14.5761 38.0756 16.0276 37.8835 16.2909C37.6914 16.5541 36.8466 17.7193 36.0062 18.8802C34.8912 20.4201 34.4611 20.9843 34.4156 20.9665C34.3812 20.9531 34.1633 20.9327 33.9313 20.9212C33.3061 20.8903 32.7629 21.0353 32.2694 21.3651L32.1418 21.4503L31.6243 21.1336C31.3396 20.9594 30.9756 20.7372 30.8153 20.6398C30.6551 20.5423 28.5948 19.2803 26.237 17.8353L21.95 15.2079L21.9258 14.6568C21.9062 14.2125 21.8807 14.0468 21.7938 13.8016C21.4967 12.9626 20.7647 12.2931 19.8897 12.06C19.3068 11.9047 18.5341 11.9912 17.9756 12.2742C17.0319 12.7524 16.4074 13.8465 16.4921 14.8731L16.5181 15.1879L13.8669 16.8111C12.4088 17.7039 10.1133 19.1098 8.76578 19.9354L6.31587 21.4365L5.89191 21.225C5.41219 20.9856 5.11168 20.9108 4.62929 20.9108C3.89697 20.9108 3.25446 21.1839 2.71459 21.7246C2.44555 21.994 2.34041 22.1369 2.20723 22.4137C1.67784 23.5141 1.88108 24.7245 2.73782 25.5735C3.57919 26.4073 4.82783 26.5987 5.88983 26.0567C6.41664 25.7879 6.82977 25.3706 7.08903 24.8454C7.28906 24.4401 7.36789 24.0657 7.35857 23.5646L7.35087 23.1501L12.4407 20.0326C15.2401 18.318 17.544 16.9152 17.5605 16.9152C17.577 16.9152 17.6981 16.98 17.8296 17.0592C18.6664 17.5631 19.7941 17.5559 20.6304 17.0413C20.7505 16.9674 20.8732 16.9163 20.9031 16.9278C20.933 16.9393 22.7915 18.071 25.0331 19.4427C27.2748 20.8145 29.3898 22.1085 29.7332 22.3184C30.0765 22.5283 30.5167 22.799 30.7113 22.9201L31.065 23.1402L31.0692 23.5967C31.0742 24.1416 31.1519 24.468 31.381 24.9065C32.056 26.1983 33.6762 26.7296 34.9877 26.0893C35.9132 25.6374 36.5104 24.6852 36.5126 23.6578C36.5137 23.1925 36.4543 22.917 36.2625 22.497C36.1853 22.3278 36.122 22.1746 36.122 22.1566C36.122 22.1262 37.1677 20.6814 44.8345 10.1185L47.6681 6.21463L47.8989 6.24651C48.8004 6.37092 49.5911 6.12706 50.2269 5.52838C50.7979 4.99076 51.0719 4.36989 51.0797 3.59636C51.085 3.07672 51.0285 2.81963 50.8072 2.35467C50.6067 1.93338 50.1651 1.44812 49.7675 1.21217C49.259 0.910373 48.5118 0.759497 47.9586 0.84686ZM47.8969 13.0458C46.9414 13.1575 46.0505 13.6015 45.38 14.3C44.8245 14.8788 44.472 15.5477 44.2872 16.3741C44.2224 16.6637 44.2174 18.066 44.2174 35.832C44.2174 53.598 44.2224 50.0004 44.2872 50.29C44.4646 51.0833 44.8221 51.7665 45.3616 52.3433C46.552 53.6158 48.4572 53.988 50.0883 53.2667C50.4773 53.0946 50.9787 52.7354 51.3185 52.3853C51.8686 51.8185 52.2074 51.2088 52.4066 50.4276L52.5 50.0611V35.8112V16.5614L52.386 16.1481C51.9144 14.4376 50.5293 13.2407 48.7957 13.0456C48.3817 12.999 48.2969 12.999 47.8969 13.0458ZM18.3693 24.2601C16.6911 24.6444 15.473 25.8917 15.1367 27.5702C15.0928 27.7891 15.0825 30.4416 15.0825 41.4717V50.1027L15.1931 50.5031C15.4052 51.2702 15.7519 51.8813 16.2716 52.4041C17.5343 53.6744 19.4743 53.9957 21.0669 53.1983C22.357 52.5524 23.1929 51.33 23.3426 49.8704C23.4027 49.285 23.4027 28.5335 23.3426 27.9482C23.1655 26.222 22.0255 24.8396 20.3684 24.3415C20.0394 24.2426 19.9103 24.2273 19.307 24.2158C18.8288 24.2066 18.544 24.22 18.3693 24.2601ZM3.89156 33.1678C2.2503 33.5096 1.0725 34.6186 0.608261 36.2593L0.517194 36.5812L0.50371 45.6547C0.493887 52.2682 0.503042 49.8181 0.537504 50.0601C0.664116 50.9494 1.1068 51.8333 1.73149 52.4441C2.52438 53.2195 3.50864 53.6225 4.61635 53.6253C5.38622 53.6273 5.90586 53.5024 6.57421 53.1549C7.6567 52.592 8.4557 51.5374 8.6979 50.352C8.77565 49.9712 8.77764 54.6972 8.76699 45.729L8.75604 36.498L8.64138 36.1324C8.40409 35.3761 8.09239 34.8444 7.58711 34.3341C7.06564 33.8076 6.41052 33.4293 5.67511 33.2301C5.24183 33.1128 4.31185 33.0803 3.89156 33.1678ZM33.0376 33.1679C31.3906 33.4804 30.1577 34.6802 29.7227 36.3939C29.6602 36.6403 29.6527 37.465 29.6393 45.613C29.6285 52.1162 29.6374 49.6675 29.6717 49.949C29.7965 50.9717 30.1984 51.7789 30.9349 52.4861C31.7199 53.2396 32.6881 53.6261 33.7912 53.6261C35.6704 53.6261 37.2697 52.4105 37.7917 50.5855C37.9568 50.0081 37.9602 54.7787 37.9421 45.5662L37.9246 36.6645L37.8141 36.2483C37.4123 34.7356 36.3008 33.6215 34.7974 33.2246C34.3733 33.1127 33.4804 33.0839 33.0376 33.1679Z"
        fill="#038E7A"
      />
    </svg>
  )
}

function ContentIcon({size = '52', ...props}: IconProps) {
  return (
    <svg viewBox="0 0 53 45" fill="none" width={130} {...props}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M19.413 0.806271C16.123 1.22996 13.1137 2.74369 10.721 5.17837C7.90546 8.04319 6.32992 12.2229 6.56471 16.2044L6.62591 17.2426L6.36556 17.4867C6.22239 17.621 5.76907 17.9219 5.35812 18.1555C3.59731 19.1564 2.05581 20.9448 1.21666 22.9605C0.343904 25.0569 0.263694 27.6403 1.00123 29.8969C1.91962 32.7068 4.23377 35.0806 7.07471 36.127L7.49477 36.2817L7.68685 36.0266C7.96294 35.6597 8.78963 34.8796 9.32908 34.4769L9.79256 34.1309L9.44333 33.6194C8.63328 32.4327 8.33861 31.3867 8.39795 29.9091C8.44429 28.7549 8.71897 27.873 9.32297 26.9392C11.6761 23.3016 16.8994 23.2371 19.3549 26.8152C19.6987 27.3161 20.2294 28.5071 20.2294 28.7777C20.2294 28.8547 20.2505 28.9177 20.2762 28.9177C20.3021 28.9177 20.5732 28.7088 20.8789 28.4534C21.1846 28.198 21.5476 27.9082 21.6856 27.8092L21.9366 27.6292L21.6158 27.1826C19.122 23.7114 20.971 18.8366 25.1682 17.8164C25.6475 17.6999 26.0296 17.6745 26.7927 17.7082C27.9133 17.7579 28.7208 17.9866 29.582 18.4983C30.2373 18.8878 31.2561 19.9011 31.6561 20.5616C32.8824 22.5857 32.7845 25.2564 31.4141 27.1638C31.2451 27.3991 31.1068 27.6095 31.1068 27.6313C31.1068 27.6533 31.2958 27.8011 31.5268 27.9597C31.7578 28.1184 32.1169 28.4048 32.3245 28.596C32.5322 28.7872 32.7121 28.9278 32.7242 28.9085C32.7364 28.8892 32.8444 28.5757 32.9643 28.2118C33.4779 26.6534 34.8189 25.2447 36.4011 24.6017C38.8212 23.618 41.7096 24.3634 43.2902 26.3797C44.2362 27.5865 44.558 28.4504 44.6159 29.9396C44.651 30.8399 44.6282 31.1122 44.4693 31.6914C44.2532 32.479 43.954 33.1107 43.5059 33.7254C43.2273 34.1076 43.2088 34.165 43.3406 34.2387C43.9045 34.5543 45.1663 35.7319 45.5359 36.2875C45.5725 36.3426 45.8039 36.2997 46.1549 36.1726C49.4697 34.9722 51.8685 32.0866 52.4216 28.6345C52.5774 27.662 52.4908 25.7104 52.2517 24.8055C51.848 23.2776 51.1656 22.0099 50.057 20.7285C49.1851 19.7208 49.1863 19.7283 49.7064 18.4825C50.1782 17.3526 50.3418 16.4466 50.3375 14.9893C50.3335 13.6329 50.1964 12.8417 49.7607 11.6585C48.9183 9.37094 47.0446 7.36543 44.7669 6.31298C43.6242 5.78503 42.6294 5.55934 41.2136 5.50708C38.9897 5.42483 37.2451 5.90521 35.479 7.08615C34.1661 7.96413 34.076 7.94503 33.098 6.58288C30.9438 3.58222 27.3006 1.41762 23.4357 0.842087C22.4594 0.696701 20.4055 0.678395 19.413 0.806271ZM25.8848 19.3722C24.3442 19.599 23.122 20.5616 22.4482 22.0789C22.2415 22.5444 22.2191 22.7025 22.2191 23.7001V24.8055L22.5912 25.5663C23.3431 27.1038 24.8191 28.0334 26.5082 28.0334C28.1928 28.0334 29.6585 27.117 30.4146 25.591C30.7586 24.8968 30.7847 24.7909 30.8229 23.9317C30.8575 23.1544 30.8339 22.9211 30.6688 22.4064C30.0057 20.338 27.9936 19.0619 25.8848 19.3722ZM13.3114 25.9544C11.9584 26.2974 10.724 27.3955 10.2814 28.6498C9.53186 30.7743 10.4414 33.079 12.4186 34.0656C12.77 34.241 13.3345 34.4326 13.6838 34.4949C15.6861 34.8528 17.8109 33.5833 18.5069 31.6135C18.7357 30.9659 18.7769 29.7975 18.5957 29.0946C18.2379 27.7066 17.1803 26.5533 15.8254 26.0737C15.1655 25.84 13.9836 25.784 13.3114 25.9544ZM37.5932 25.9481C36.4734 26.2197 35.325 27.1058 34.797 28.1054C33.8663 29.8681 34.221 31.979 35.6767 33.3408C36.2874 33.9121 36.5406 34.0671 37.2768 34.3204C39.3079 35.0192 41.5924 34.0566 42.5435 32.1013C44.1619 28.7743 41.1869 25.0764 37.5932 25.9481ZM22.6152 29.1912C21.7001 29.7826 20.7903 30.8201 20.2433 31.896C19.9693 32.4348 19.6103 33.7394 19.6103 34.1963C19.6103 34.5757 19.6384 34.6176 20.3191 35.2581C21.0898 35.9832 21.927 37.1518 22.2546 37.9601L22.4607 38.4686H26.5082H30.5557L30.7618 37.9601C31.086 37.1603 31.9141 36.001 32.6925 35.2574C33.3666 34.6134 33.4061 34.5548 33.4061 34.1989C33.4061 33.7506 33.1384 32.7432 32.8401 32.0686C32.3464 30.9524 31.253 29.6878 30.2779 29.105L29.7774 28.8059L29.0919 29.1193C27.4098 29.8882 25.577 29.8925 23.9682 29.1315C23.617 28.9652 23.2949 28.8293 23.2523 28.8293C23.2099 28.8293 22.9232 28.9922 22.6152 29.1912ZM10.5889 35.6055C9.53203 36.3035 8.53388 37.4658 8.0222 38.5943C7.51131 39.721 7.45569 40.0918 7.45303 42.3892L7.45065 44.4971L7.69879 44.7106L7.94694 44.9243H14.352H20.7572L21.046 44.6659L21.3348 44.4075L21.3297 42.4329C21.3241 40.2704 21.2719 39.9331 20.7491 38.6772C20.4458 37.9485 19.6681 36.8389 19.1087 36.3366C18.9132 36.1612 18.5056 35.8494 18.2029 35.6438L17.6524 35.27L17.0174 35.5834C16.1717 36.0009 15.3315 36.1859 14.3043 36.1811C13.3213 36.1765 12.6447 36.0193 11.7716 35.5932C11.4243 35.4236 11.1253 35.285 11.1071 35.285C11.089 35.285 10.8557 35.4292 10.5889 35.6055ZM34.7326 35.695C33.2707 36.7226 32.3495 38.039 31.8943 39.7509C31.7443 40.3148 31.6971 40.8083 31.6616 42.1828C31.6108 44.1547 31.6708 44.5362 32.069 44.7714C32.308 44.9125 32.8198 44.9243 38.7124 44.9243H45.0969L45.3624 44.6401L45.6278 44.3558L45.5855 42.2745C45.5399 40.0327 45.4812 39.6683 44.9913 38.5879C44.4892 37.4803 43.468 36.2886 42.4568 35.6298L41.8925 35.2621L41.3691 35.541C40.5966 35.9527 39.6204 36.18 38.618 36.1814C37.6215 36.1828 36.8849 36.0152 36.0141 35.5886C35.6732 35.4216 35.3747 35.2863 35.3508 35.2879C35.3269 35.2896 35.0487 35.4727 34.7326 35.695Z"
        fill="#038E7A"
      />
    </svg>
  )
}

function DiscordIcon({size = '53', ...props}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 53 40"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M17.8526 0.612133C14.7824 1.25287 12.2455 2.0448 9.36218 3.26253L8.41823 3.66119L7.73997 4.70481C6.21683 7.04837 4.43846 10.4728 3.47141 12.9244C2.04018 16.5527 1.10086 20.3731 0.693519 24.2231C0.385923 27.13 0.460377 33.0324 0.808192 33.3072C0.884332 33.3673 1.59168 33.8485 2.38007 34.3765C5.54666 36.497 8.87161 38.1408 12.4471 39.3534C13.2073 39.6112 13.8398 39.8221 13.8528 39.8221C13.9702 39.8221 15.9932 36.6064 16.4967 35.6194L16.6619 35.2956L15.9292 35.0121C15.1592 34.7141 12.7027 33.5141 12.414 33.2949C12.2482 33.169 12.2496 33.1633 12.4983 32.9553C12.6375 32.8388 12.8854 32.6483 13.0493 32.5318L13.3473 32.32L14.3512 32.7455C18.2689 34.4057 22.261 35.2146 26.5374 35.2146C30.8165 35.2146 34.65 34.4393 38.6058 32.7738L39.7024 32.3121L40.2501 32.7479L40.7977 33.1837L40.4342 33.3916C39.6844 33.8205 38.184 34.5502 37.2785 34.9265L36.3414 35.3159L36.9294 36.3675C37.4332 37.2684 38.6753 39.211 39.0424 39.6719C39.1509 39.8081 39.1988 39.8043 39.8345 39.609C42.4777 38.7974 46.187 37.1269 48.7133 35.6106C49.5794 35.0907 51.7768 33.644 52.1454 33.3509C52.3136 33.2171 52.3407 33.079 52.4302 31.8961C52.5746 29.9866 52.4833 25.5103 52.2634 23.7172C51.4182 16.8254 49.1757 10.7378 45.2369 4.64292C44.5507 3.581 44.6263 3.63185 42.4737 2.78141C40.0765 1.83425 37.6773 1.12429 35.1434 0.612133C34.3536 0.452433 33.8924 0.394253 33.8296 0.446362C33.7764 0.490546 33.4514 1.11779 33.1074 1.84024L32.4819 3.15376L32.1173 3.10721C29.8944 2.82314 29.0425 2.77238 26.4953 2.77238C23.9867 2.77238 22.4444 2.86598 20.8783 3.1132L20.5734 3.16135L19.8782 1.76106C19.4958 0.990978 19.1397 0.363899 19.0869 0.367693C19.0341 0.371487 18.4787 0.481439 17.8526 0.612133ZM16.8637 16.9242C14.1453 17.5829 12.5057 20.7802 13.3928 23.6927C13.9078 25.3833 15.3335 26.82 16.8408 27.1671C17.3973 27.2953 18.42 27.2773 18.9879 27.1293C19.6925 26.9459 20.2515 26.6203 20.8855 26.0245C23.0589 23.9821 23.1222 20.2938 21.02 18.1916C19.8622 17.0338 18.3342 16.5679 16.8637 16.9242ZM34.3369 16.8891C33.4563 17.0654 32.6508 17.5216 31.9607 18.235C29.9535 20.31 29.9785 23.8508 32.0148 25.9026C32.9183 26.813 33.9585 27.2586 35.1801 27.2586C35.5607 27.2586 36.0702 27.1986 36.3242 27.1241C37.8535 26.6749 39.1066 25.3803 39.6218 23.7172C39.9049 22.8034 39.9043 21.1546 39.6207 20.3023C39.3317 19.4337 38.9737 18.8576 38.3054 18.185C37.2053 17.0778 35.757 16.6048 34.3369 16.8891Z"
        fill="#5865F2"
      />
    </svg>
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
  // Show if environment variable is set to 'true' or if in development mode
  if (!__SHOW_OB_RESET_BTN__) return null

  const handleReset = () => {
    resetOnboardingState()
    toast.success('Onboarding state reset! Refresh to see changes.')
  }

  return (
    <XStack
      className="no-window-drag"
      zIndex="$zIndex.9"
      position="absolute"
      bottom={10}
      right={10}
    >
      <Button onPress={() => dispatchSiteTemplateEvent(true)}>
        show template dialog
      </Button>
      <Button
        size="$2"
        backgroundColor="$red10"
        color="white"
        onPress={handleReset}
        opacity={0.7}
        hoverStyle={{opacity: 1, bg: '$red11'}}
      >
        Reset Onboarding
      </Button>
    </XStack>
  )
}
