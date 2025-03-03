import {grpcClient} from '@/grpc-client'
import {useMnemonics, useRegisterKey} from '@/models/daemon'
import {trpc} from '@/trpc'
import {fileUpload} from '@/utils/file-upload'
import {useOpenUrl} from '@shm/shared'
import {DocumentChange} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {IS_PROD_DESKTOP} from '@shm/shared/constants'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId} from '@shm/shared/utils/entity-id-url'
import {CheckboxField} from '@shm/ui/checkbox-field'
import {toast} from '@shm/ui/toast'
import {ExternalLink} from '@tamagui/lucide-icons'
import copyTextToClipboard from 'copy-text-to-clipboard'
import {nanoid} from 'nanoid'
import {useCallback, useEffect, useState} from 'react'
import {
  Button,
  ButtonFrame,
  Form,
  Input,
  SizableText,
  Text,
  TextArea,
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
  setHasCompletedOnboarding,
  setHasSkippedOnboarding,
  setOnboardingFormData,
  setOnboardingStep,
  validateImage,
} from '../app-onboarding'
import {ImageForm} from '../pages/image-form'

interface OnboardingProps {
  onComplete: () => void
}

interface ProfileFormData {
  name: string
  icon?: ImageData
  seedExperimentalLogo?: ImageData
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

export function Onboarding({onComplete}: OnboardingProps) {
  // Check if onboarding has been completed or skipped
  const state = getOnboardingState()

  // If onboarding has been completed or skipped, don't show it
  useEffect(() => {
    if (state.hasCompletedOnboarding || state.hasSkippedOnboarding) {
      console.log(
        'Onboarding already completed or skipped, skipping to main app',
      )
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
    } else if (currentStep === 'ready') {
      console.log('Completing onboarding')
      setHasCompletedOnboarding(true)
      // Clean up form data but keep the completed flag
      cleanupOnboardingFormData()
      onComplete()
    }

    const afterState = getOnboardingState()
    console.log('After - Store state:', afterState)
    console.groupEnd()
  }, [currentStep, onComplete])

  return (
    <YStack flex={1} backgroundColor="$background" className="window-drag">
      <DebugBox />
      {currentStep === 'welcome' && <WelcomeStep onNext={handleNext} />}
      {currentStep === 'profile' && (
        <ProfileStep onSkip={handleSkip} onNext={handleNext} />
      )}
      {currentStep === 'recovery' && <RecoveryStep onNext={handleNext} />}
      {currentStep === 'ready' && <ReadyStep onComplete={handleNext} />}
    </YStack>
  )
}

function WelcomeStep({onNext}: {onNext: () => void}) {
  const openUrl = useOpenUrl()

  return (
    <StepWrapper>
      <YStack gap="$6" alignItems="center" maxWidth={600}>
        <FullLogoIcon />
        <StepTitle>WELCOME TO THE OPEN WEB</StepTitle>
        <XStack gap="$6" width="100%" paddingHorizontal={0}>
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
          <Button
            variant="outlined"
            onPress={() => openUrl('https://seed.hyper.media')}
            icon={ExternalLink}
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
          </Button>
          <Button
            onPress={onNext}
            backgroundColor="$brand2"
            color="white"
            size="$4"
            borderRadius="$2"
            borderWidth={0}
            hoverStyle={{backgroundColor: '$brand3'}}
            focusStyle={{backgroundColor: '$brand3'}}
          >
            NEXT
          </Button>
        </YStack>

        <XStack gap="$2" paddingTop="$4">
          <YStack
            width={8}
            height={8}
            backgroundColor="$brand5"
            borderRadius={8}
          />
          <YStack
            width={8}
            height={8}
            backgroundColor="$gray8"
            borderRadius={8}
          />
          <YStack
            width={8}
            height={8}
            backgroundColor="$gray8"
            borderRadius={8}
          />
          <YStack
            width={8}
            height={8}
            backgroundColor="$gray8"
            borderRadius={8}
          />
        </XStack>
      </YStack>
    </StepWrapper>
  )
}

function ProfileStep({
  onSkip,
  onNext,
}: {
  onSkip: () => void
  onNext: () => void
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
    <StepWrapper>
      <YStack gap="$6" alignItems="center" maxWidth={600}>
        <StepTitle>CREATE YOUR SITE</StepTitle>
        <Text fontSize="$5" textAlign="center" color="$gray11">
          Your site is more than just a collection of pages, it's a reflection
          of who you are or what your brand stands for. Whether it's personal,
          professional, or creative, this is your space to shine.
        </Text>

        <Form
          width="100%"
          maxWidth={400}
          onSubmit={onNext}
          className="no-window-drag"
        >
          <YStack gap="$4" width="100%" className="no-window-drag">
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

          <XStack
            marginTop="$8"
            gap="$4"
            className="no-window-drag"
            alignItems="center"
            justifyContent="center"
          >
            <Button onPress={onSkip} bg="$brand11">
              SKIP
            </Button>
            <Button
              backgroundColor="$brand2"
              color="white"
              disabled={!formData.name.trim()}
              onPress={onNext}
            >
              NEXT
            </Button>
          </XStack>
        </Form>
        <Button
          variant="outlined"
          onPress={() => {}}
          hoverStyle={{
            backgroundColor: '$brand11',
            borderColor: 'transparent',
          }}
          focusStyle={{
            backgroundColor: '$brand11',
            borderColor: 'transparent',
          }}
        >
          I already have a Site
        </Button>
      </YStack>
    </StepWrapper>
  )
}

function RecoveryStep({onNext}: {onNext: () => void}) {
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
      onNext()
    } catch (error) {
      console.error('❌ Profile submission failed:', error)
      console.groupEnd()
      throw error
    }
  }

  return (
    <StepWrapper>
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

      <YStack gap="$4" width="100%" maxWidth={500} className="no-window-drag">
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

        <XStack marginTop="$4" gap="$4" justifyContent="center">
          <Button
            onPress={handleSubmit}
            backgroundColor="$brand2"
            color="white"
            size="$4"
            borderRadius="$2"
            borderWidth={0}
            hoverStyle={{backgroundColor: '$brand3'}}
            focusStyle={{backgroundColor: '$brand3'}}
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
          <ContentIcon width={130} />
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

function DebugBox() {
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
    >
      <Text fontSize="$3" fontFamily="$mono">
        Debug: Onboarding State
      </Text>
      <Text fontSize="$2" fontFamily="$mono" color="$gray11">
        {JSON.stringify(state, null, 2)}
      </Text>
    </YStack>
  )
}

// SVG Components
interface IconProps {
  color?: string
  size?: string | number
}

function FullLogoIcon(props: IconProps) {
  return (
    <svg
      width={244}
      height={50}
      viewBox="0 0 244 50"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <image href="/assets/full-logo.svg" width="244" height="50" />
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

function PublishIcon({size = '150', ...props}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 150 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <image href="/assets/welcome1-publish.svg" width={size} height={size} />
    </svg>
  )
}

function ArchiveIcon({size = '150', ...props}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 150 150"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <image href="/assets/welcome1-archive.svg" width={size} height={size} />
    </svg>
  )
}

function AnalyticsIcon({size = '52', ...props}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 52 52"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <image href="/assets/welcome4-analytics.svg" width={size} height={size} />
    </svg>
  )
}

function ContentIcon({size = '52', ...props}: IconProps) {
  return (
    <svg viewBox="0 0 53 45" fill="none" {...props}>
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M19.413 0.806271C16.123 1.22996 13.1137 2.74369 10.721 5.17837C7.90546 8.04319 6.32992 12.2229 6.56471 16.2044L6.62591 17.2426L6.36556 17.4867C6.22239 17.621 5.76907 17.9219 5.35812 18.1555C3.59731 19.1564 2.05581 20.9448 1.21666 22.9605C0.343904 25.0569 0.263694 27.6403 1.00123 29.8969C1.91962 32.7068 4.23377 35.0806 7.07471 36.127L7.49477 36.2817L7.68685 36.0266C7.96294 35.6597 8.78963 34.8796 9.32908 34.4769L9.79256 34.1309L9.44333 33.6194C8.63328 32.4327 8.33861 31.3867 8.39795 29.9091C8.44429 28.7549 8.71897 27.873 9.32297 26.9392C11.6761 23.3016 16.8994 23.2371 19.3549 26.8152C19.6987 27.3161 20.2294 28.5071 20.2294 28.7777C20.2294 28.8547 20.2505 28.9177 20.2762 28.9177C20.3021 28.9177 20.5732 28.7088 20.8789 28.4534C21.1846 28.198 21.5476 27.9082 21.6856 27.8092L21.9366 27.6292L21.6158 27.1826C19.122 23.7114 20.971 18.8366 25.1682 17.8164C25.6475 17.6999 26.0296 17.6745 26.7927 17.7082C27.9133 17.7579 28.7208 17.9866 29.582 18.4983C30.2373 18.8878 31.2561 19.9011 31.6561 20.5616C32.8824 22.5857 32.7845 25.2564 31.4141 27.1638C31.2451 27.3991 31.1068 27.6095 31.1068 27.6313C31.1068 27.6533 31.2958 27.8011 31.5268 27.9597C31.7578 28.1184 32.1169 28.4048 32.3245 28.596C32.5322 28.7872 32.7121 28.9278 32.7242 28.9085C32.7364 28.8892 32.8444 28.5757 32.9643 28.2118C33.4779 26.6534 34.8189 25.2447 36.4011 24.6017C38.8212 23.618 41.7096 24.3634 43.2902 26.3797C44.2362 27.5865 44.558 28.4504 44.6159 29.9396C44.651 30.8399 44.6282 31.1122 44.4693 31.6914C44.2532 32.479 43.954 33.1107 43.5059 33.7254C43.2273 34.1076 43.2088 34.165 43.3406 34.2387C43.9045 34.5543 45.1663 35.7319 45.5359 36.2875C45.5725 36.3426 45.8039 36.2997 46.1549 36.1726C49.4697 34.9722 51.8685 32.0866 52.4216 28.6345C52.5774 27.662 52.4908 25.7104 52.2517 24.8055C51.848 23.2776 51.1656 22.0099 50.057 20.7285C49.1851 19.7208 49.1863 19.7283 49.7064 18.4825C50.1782 17.3526 50.3418 16.4466 50.3375 14.9893C50.3335 13.6329 50.1964 12.8417 49.7607 11.6585C48.9183 9.37094 47.0446 7.36543 44.7669 6.31298C43.6242 5.78503 42.6294 5.55934 41.2136 5.50708C38.9897 5.42483 37.2451 5.90521 35.479 7.08615C34.1661 7.96413 34.076 7.94503 33.098 6.58288C30.9438 3.58222 27.3006 1.41762 23.4357 0.842087C22.4594 0.696701 20.4055 0.678395 19.413 0.806271ZM25.8848 19.3722C24.3442 19.599 23.122 20.5616 22.4482 22.0789C22.2415 22.5444 22.2191 22.7025 22.2191 23.7001V24.8055L22.5912 25.5663C23.3431 27.1038 24.8191 28.0334 26.5082 28.0334C28.1928 28.0334 29.6585 27.117 30.4146 25.591C30.7586 24.8968 30.7847 24.7909 30.8229 23.9317C30.8575 23.1544 30.8339 22.9211 30.6688 22.4064C30.0057 20.338 27.9936 19.0619 25.8848 19.3722ZM13.3114 25.9544C11.9584 26.2974 10.724 27.3955 10.2814 28.6498C9.53186 30.7743 10.4414 33.079 12.4186 34.0656C12.77 34.241 13.3345 34.4326 13.6838 34.4949C15.6861 34.8528 17.8109 33.5833 18.5069 31.6135C18.7357 30.9659 18.7769 29.7975 18.5957 29.0946C18.2379 27.7066 17.1803 26.5533 15.8254 26.0737C15.1655 25.84 13.9836 25.784 13.3114 25.9544ZM37.5932 25.9481C36.4734 26.2197 35.325 27.1058 34.797 28.1054C33.8663 29.8681 34.221 31.979 35.6767 33.3408C36.2874 33.9121 36.5406 34.0671 37.2768 34.3204C39.3079 35.0192 41.5924 34.0566 42.5435 32.1013C44.1619 28.7743 41.1869 25.0764 37.5932 25.9481ZM22.6152 29.1912C21.7001 29.7826 20.7903 30.8201 20.2433 31.896C19.9693 32.4348 19.6103 33.7394 19.6103 34.1963C19.6103 34.5757 19.6384 34.6176 20.3191 35.2581C21.0898 35.9832 21.927 37.1518 22.2546 37.9601L22.4607 38.4686H26.5082H30.5557L30.7618 37.9601C31.086 37.1603 31.9141 36.001 32.6925 35.2574C33.3666 34.6134 33.4061 34.5548 33.4061 34.1989C33.4061 33.7506 33.1384 32.7432 32.8401 32.0686C32.3464 30.9524 31.253 29.6878 30.2779 29.105L29.7774 28.8059L29.0919 29.1193C27.4098 29.8882 25.577 29.8925 23.9682 29.1315C23.617 28.9652 23.2949 28.8293 23.2523 28.8293C23.2099 28.8293 22.9232 28.9922 22.6152 29.1912ZM10.5889 35.6055C9.53203 36.3035 8.53388 37.4658 8.0222 38.5943C7.51131 39.721 7.45569 40.0918 7.45303 42.3892L7.45065 44.4971L7.69879 44.7106L7.94694 44.9243H14.352H20.7572L21.046 44.6659L21.3348 44.4075L21.3297 42.4329C21.3241 40.2704 21.2719 39.9331 20.7491 38.6772C20.4458 37.9485 19.6681 36.8389 19.1087 36.3366C18.9132 36.1612 18.5056 35.8494 18.2029 35.6438L17.6524 35.27L17.0174 35.5834C16.1717 36.0009 15.3315 36.1859 14.3043 36.1811C13.3213 36.1765 12.6447 36.0193 11.7716 35.5932C11.4243 35.4236 11.1253 35.285 11.1071 35.285C11.089 35.285 10.8557 35.4292 10.5889 35.6055ZM34.7326 35.695C33.2707 36.7226 32.3495 38.039 31.8943 39.7509C31.7443 40.3148 31.6971 40.8083 31.6616 42.1828C31.6108 44.1547 31.6708 44.5362 32.069 44.7714C32.308 44.9125 32.8198 44.9243 38.7124 44.9243H45.0969L45.3624 44.6401L45.6278 44.3558L45.5855 42.2745C45.5399 40.0327 45.4812 39.6683 44.9913 38.5879C44.4892 37.4803 43.468 36.2886 42.4568 35.6298L41.8925 35.2621L41.3691 35.541C40.5966 35.9527 39.6204 36.18 38.618 36.1814C37.6215 36.1828 36.8849 36.0152 36.0141 35.5886C35.6732 35.4216 35.3747 35.2863 35.3508 35.2879C35.3269 35.2896 35.0487 35.4727 34.7326 35.695Z"
        fill="#038E7A"
      />
    </svg>
  )
}

function DiscordIcon({size = '52', ...props}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 52 52"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <image href="/assets/welcome4-discord.svg" width={size} height={size} />
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

function StepWrapper({children}: {children: React.ReactNode}) {
  return (
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
      {children}
    </YStack>
  )
}
