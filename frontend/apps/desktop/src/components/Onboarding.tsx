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
import {toast} from '@shm/ui/toast'
import {Copy, ExternalLink} from '@tamagui/lucide-icons'
import copyTextToClipboard from 'copy-text-to-clipboard'
import {nanoid} from 'nanoid'
import {useCallback, useEffect, useState} from 'react'
import {Button, Form, Input, Text, TextArea, XStack, YStack} from 'tamagui'
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
      <YStack gap="$8" alignItems="center" maxWidth={800}>
        <Text
          fontSize="$8"
          fontWeight="bold"
          textAlign="center"
          className="no-window-drag"
        >
          WELCOME TO THE OPEN WEB
        </Text>

        <XStack gap="$6" width="100%" paddingHorizontal="$4">
          <YStack
            backgroundColor="$background"
            padding="$4"
            borderRadius="$4"
            flex={1}
          >
            <Text fontSize="$5" fontWeight="bold" marginBottom="$2">
              Collaborate With Your Peers
            </Text>
            <Text color="$gray11">
              Work together seamlessly in a decentralized environment
            </Text>
          </YStack>

          <YStack
            backgroundColor="$background"
            padding="$4"
            borderRadius="$4"
            flex={1}
          >
            <Text fontSize="$5" fontWeight="bold" marginBottom="$2">
              Publish To The Web
            </Text>
            <Text color="$gray11">
              Share your content directly to the decentralized web
            </Text>
          </YStack>

          <YStack
            backgroundColor="$background"
            padding="$4"
            borderRadius="$4"
            flex={1}
          >
            <Text fontSize="$5" fontWeight="bold" marginBottom="$2">
              Archive Content, Available Offline
            </Text>
            <Text color="$gray11">
              Keep your content accessible even when offline
            </Text>
          </YStack>
        </XStack>

        <YStack gap="$4" alignItems="center" className="no-window-drag">
          <Button
            variant="outlined"
            onPress={() => openUrl('https://docs.seed.io/getting-started')}
            icon={ExternalLink}
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
            backgroundColor="$blue10"
            borderRadius="$round"
          />
          <YStack
            width={8}
            height={8}
            backgroundColor="$gray8"
            borderRadius="$round"
          />
          <YStack
            width={8}
            height={8}
            backgroundColor="$gray8"
            borderRadius="$round"
          />
          <YStack
            width={8}
            height={8}
            backgroundColor="$gray8"
            borderRadius="$round"
          />
        </XStack>
      </YStack>
    </YStack>
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
    <YStack
      className="window-drag"
      flex={1}
      padding="$4"
      gap="$4"
      alignItems="center"
      justifyContent="center"
    >
      <Text fontSize="$8" fontWeight="bold" textAlign="center">
        CREATE YOUR SITE
      </Text>
      <Text fontSize="$6" textAlign="center" color="$gray11">
        Let's set up your personal space on the open web
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

          <YStack gap="$2">
            <Text fontSize="$3" color="$gray11">
              Site Icon
            </Text>
            <ImageForm
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

          <YStack gap="$2">
            <Text fontSize="$3" color="$gray11">
              Site Logo
            </Text>
            <ImageForm
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
        </YStack>

        <XStack marginTop="$8" gap="$4" className="no-window-drag">
          <Button onPress={onSkip} variant="outlined">
            SKIP
          </Button>
          <Button
            backgroundColor="$blue10"
            color="white"
            disabled={!formData.name.trim()}
            onPress={onNext}
          >
            NEXT
          </Button>
        </XStack>
      </Form>
    </YStack>
  )
}

function RecoveryStep({onNext}: {onNext: () => void}) {
  const register = useRegisterKey()
  const mnemonics = useMnemonics()
  const saveWords = trpc.secureStorage.write.useMutation()

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

      // Save mnemonics to secure storage
      try {
        console.group('💾 Saving Mnemonics')
        console.log('Saving to key:', renamedKey.name)

        saveWords.mutate({key: renamedKey.name, value: mnemonics.data})
        console.log('✅ Mnemonics saved')
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
    <YStack
      className="window-drag"
      flex={1}
      padding="$4"
      gap="$4"
      alignItems="center"
      justifyContent="center"
    >
      <Text
        fontSize="$8"
        fontWeight="bold"
        textAlign="center"
        className="no-window-drag"
      >
        SAVE YOUR ACCOUNT
      </Text>
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
        <XStack gap="$3">
          <TextArea
            flex={1}
            disabled
            value={
              Array.isArray(mnemonics.data)
                ? mnemonics.data.join(', ')
                : mnemonics.data
            }
          />
          <YStack gap="$2">
            <Button
              size="$2"
              icon={Copy}
              onPress={() => {
                if (mnemonics.data) {
                  copyTextToClipboard(
                    Array.isArray(mnemonics.data)
                      ? mnemonics.data.join(', ')
                      : mnemonics.data,
                  )
                  toast.success('Words copied to clipboard')
                }
              }}
            />
          </YStack>
        </XStack>
        <XStack gap="$4">
          <Button onPress={() => mnemonics.refetch()}>regenerate</Button>
          <Button
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

        <XStack marginTop="$4" gap="$4" justifyContent="center">
          <Button onPress={handleSubmit} backgroundColor="$blue10">
            I SAVED MY WORDS
          </Button>
        </XStack>
      </YStack>
    </YStack>
  )
}

function ReadyStep({onComplete}: {onComplete: () => void}) {
  const openUrl = useOpenUrl()

  return (
    <YStack
      className="window-drag"
      flex={1}
      padding="$4"
      gap="$4"
      alignItems="center"
      justifyContent="center"
    >
      <Text
        fontSize="$8"
        fontWeight="bold"
        textAlign="center"
        className="no-window-drag"
      >
        READY TO GO
      </Text>

      <YStack marginTop="$8" gap="$4" className="no-window-drag">
        <Button
          onPress={() => openUrl('https://discord.gg/seed')}
          backgroundColor="$purple10"
          icon={ExternalLink}
        >
          JOIN DISCORD
        </Button>
        <Button onPress={onComplete} backgroundColor="$blue10">
          DONE
        </Button>
      </YStack>
    </YStack>
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
