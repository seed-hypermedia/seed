import {grpcClient} from '@/grpc-client'
import {useMnemonics, useRegisterKey} from '@/models/daemon'
import {trpc} from '@/trpc'
import {fileUpload} from '@/utils/file-upload'
import {DocumentChange} from '@shm/shared/client/.generated/documents/v3alpha/documents_pb'
import {IS_PROD_DESKTOP} from '@shm/shared/constants'
import {invalidateQueries} from '@shm/shared/models/query-client'
import {queryKeys} from '@shm/shared/models/query-keys'
import {hmId} from '@shm/shared/utils/entity-id-url'
import React, {useCallback, useEffect, useState} from 'react'
import {Button, Form, Input, Text, XStack, YStack} from 'tamagui'
import {
  OnboardingState,
  OnboardingStep,
  getOnboardingState,
  resetOnboardingState,
  setHasCompletedOnboarding,
  setHasSkippedOnboarding,
  setOnboardingFormData,
  setOnboardingStep,
} from '../app-onboarding'
import {ImageForm} from '../pages/image-form'

interface OnboardingProps {
  onComplete: () => void
}

const WelcomeStep = ({onNext}: {onNext: () => void}) => {
  return (
    <YStack
      flex={1}
      padding="$4"
      space="$4"
      alignItems="center"
      justifyContent="center"
    >
      <Text fontSize="$8" fontWeight="bold" textAlign="center">
        WELCOME TO THE OPEN WEB
      </Text>

      <XStack marginTop="$8" space="$4">
        <Button onPress={onNext} backgroundColor="$blue10">
          NEXT
        </Button>
      </XStack>
    </YStack>
  )
}

interface ProfileFormData {
  name: string
  icon?: string | File
  seedExperimentalLogo?: string | File
}

const ProfileStep = ({
  onSkip,
  onNext,
}: {
  onSkip: () => void
  onNext: () => void
}) => {
  const register = useRegisterKey()
  const mnemonics = useMnemonics()
  const saveWords = trpc.secureStorage.write.useMutation()
  // Initialize form data from store
  const [formData, setFormData] = useState<ProfileFormData>(() => {
    const state = getOnboardingState()
    return {
      name: state.formData.name || '',
      icon: state.formData.icon as string | undefined,
      seedExperimentalLogo: state.formData.seedExperimentalLogo as
        | string
        | undefined,
    }
  })

  const handleSubmit = async () => {
    console.log('Submitting form data to backend:', formData)

    // Upload the images if they are Files
    if (formData.icon instanceof File) {
      const ipfsIcon = await fileUpload(formData.icon)
      console.log('Uploaded icon:', ipfsIcon)
      setOnboardingFormData({...formData, icon: ipfsIcon})
    }
    if (formData.seedExperimentalLogo instanceof File) {
      const ipfsSeedExperimentalLogo = await fileUpload(
        formData.seedExperimentalLogo,
      )
      console.log('Uploaded seedExperimentalLogo:', ipfsSeedExperimentalLogo)
      setOnboardingFormData({
        ...formData,
        seedExperimentalLogo: ipfsSeedExperimentalLogo,
      })
    }

    // Create the Account
    if (!mnemonics.data) {
      throw new Error('Mnemonics not found')
    }
    const createdAccount = await register.mutateAsync({
      name: formData.name,
      mnemonic: mnemonics.data,
    })

    // Update account key name
    const renamedKey = await grpcClient.daemon.updateKey({
      currentName: formData.name,
      newName: createdAccount.accountId,
    })

    // Save mnemonics to secure storage
    saveWords.mutate({key: renamedKey.name, value: mnemonics.data})

    // doc metadata edit
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

    if (typeof formData.icon == 'string') {
      changes.push(
        new DocumentChange({
          op: {
            case: 'setMetadata',
            value: {
              key: 'icon',
              value: `ipfs://${formData.icon}`,
            },
          },
        }),
      )
    }

    if (typeof formData.seedExperimentalLogo == 'string') {
      changes.push(
        new DocumentChange({
          op: {
            case: 'setMetadata',
            value: {
              key: 'seedExperimentalLogo',
              value: `ipfs://${formData.seedExperimentalLogo}`,
            },
          },
        }),
      )
    }
    const doc = await grpcClient.documents.createDocumentChange({
      account: createdAccount.accountId,
      signingKeyName: createdAccount.publicKey,
      baseVersion: undefined, // undefined because this is the first change of this document
      changes,
    })

    if (doc) {
      invalidateQueries([
        queryKeys.ENTITY,
        hmId('d', createdAccount!.accountId).id,
      ])
      invalidateQueries([queryKeys.LIST_ROOT_DOCUMENTS])
    }

    // Remove onboarding state
    resetOnboardingState()

    onNext()
  }

  const updateFormData = (updates: Partial<ProfileFormData>) => {
    const newData = {...formData, ...updates}
    setFormData(newData)
    // Only send string URLs to the store, not File objects
    setOnboardingFormData({
      ...newData,
      icon: typeof newData.icon === 'string' ? newData.icon : undefined,
      seedExperimentalLogo:
        typeof newData.seedExperimentalLogo === 'string'
          ? newData.seedExperimentalLogo
          : undefined,
    })
  }

  return (
    <YStack
      flex={1}
      padding="$4"
      space="$4"
      alignItems="center"
      justifyContent="center"
    >
      <Text fontSize="$8" fontWeight="bold" textAlign="center">
        CREATE YOUR SITE
      </Text>
      <Text fontSize="$6" textAlign="center" color="$gray11">
        Let's set up your personal space on the open web
      </Text>

      <Form width="100%" maxWidth={400} onSubmit={handleSubmit}>
        <YStack space="$4" width="100%">
          <Input
            size="$4"
            placeholder="Site name"
            value={formData.name}
            onChange={(e) => updateFormData({name: e.nativeEvent.text})}
          />

          <YStack space="$2">
            <Text fontSize="$3" color="$gray11">
              Site Icon
            </Text>
            <ImageForm
              emptyLabel="ADD SITE ICON"
              url={
                typeof formData.icon === 'string' ? formData.icon : undefined
              }
              uploadOnChange={false}
              onImageUpload={(url) => updateFormData({icon: url})}
              onRemove={() => updateFormData({icon: undefined})}
            />
          </YStack>

          <YStack space="$2">
            <Text fontSize="$3" color="$gray11">
              Site Logo
            </Text>
            <ImageForm
              emptyLabel="ADD SITE LOGO"
              url={
                typeof formData.seedExperimentalLogo === 'string'
                  ? formData.seedExperimentalLogo
                  : undefined
              }
              uploadOnChange={false}
              onImageUpload={(url) =>
                updateFormData({seedExperimentalLogo: url})
              }
              onRemove={() => updateFormData({seedExperimentalLogo: undefined})}
            />
          </YStack>
        </YStack>

        <XStack marginTop="$8" space="$4">
          <Button onPress={onSkip} variant="outlined">
            SKIP
          </Button>
          <Button
            backgroundColor="$blue10"
            disabled={!formData.name.trim()}
            onPress={handleSubmit}
          >
            NEXT
          </Button>
        </XStack>
      </Form>
    </YStack>
  )
}

const DebugBox = () => {
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

export const Onboarding: React.FC<OnboardingProps> = ({onComplete}) => {
  // Initialize step from store
  const [currentStep, setCurrentStep] = useState<OnboardingStep>(() => {
    const state = getOnboardingState()
    console.log('🔄 Initializing onboarding with state:', state)
    return state.currentStep
  })

  const handleSkip = useCallback(() => {
    console.group('🚀 Skipping Onboarding')
    const beforeState = getOnboardingState()
    console.log('Before state:', beforeState)

    setHasSkippedOnboarding(true)
    resetOnboardingState()

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
      // Update store first
      setOnboardingStep('profile')
      // Force immediate state update
      setCurrentStep('profile')
    } else if (currentStep === 'profile') {
      console.log('Completing onboarding')
      setHasCompletedOnboarding(true)
      resetOnboardingState()
      onComplete()
    }

    const afterState = getOnboardingState()
    console.log('After - Store state:', afterState)
    console.groupEnd()
  }, [currentStep, onComplete])

  return (
    <YStack flex={1} backgroundColor="$background">
      <DebugBox />
      {currentStep === 'welcome' && <WelcomeStep onNext={handleNext} />}
      {currentStep === 'profile' && (
        <ProfileStep onSkip={handleSkip} onNext={handleNext} />
      )}
    </YStack>
  )
}
