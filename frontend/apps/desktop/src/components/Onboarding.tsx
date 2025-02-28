import React from 'react'
import {Button, Text, XStack, YStack} from 'tamagui'
import {
  setHasCompletedOnboarding,
  setHasSkippedOnboarding,
} from '../app-onboarding'

interface OnboardingProps {
  onComplete: () => void
}

export const Onboarding: React.FC<OnboardingProps> = ({onComplete}) => {
  const handleSkip = () => {
    setHasSkippedOnboarding(true)
    onComplete()
  }

  const handleComplete = () => {
    setHasCompletedOnboarding(true)
    onComplete()
  }

  return (
    <YStack
      flex={1}
      padding="$4"
      space="$4"
      alignItems="center"
      justifyContent="center"
    >
      <Text fontSize="$8" fontWeight="bold">
        Welcome to Seed
      </Text>
      <Text fontSize="$6" textAlign="center">
        Let's get you started with the basics
      </Text>

      <XStack marginTop="$8" space="$4">
        <Button onPress={handleSkip} variant="outlined">
          Skip
        </Button>
        <Button onPress={handleComplete} backgroundColor="$blue10">
          Get Started
        </Button>
      </XStack>
    </YStack>
  )
}
