import {IS_PROD_DESKTOP, SKIP_ONBOARDING} from '@shm/shared/constants'

export interface OnboardingState {
  hasCompletedOnboarding: boolean
  hasSkippedOnboarding: boolean
}

declare global {
  interface Window {
    onboarding: {
      getState: () => OnboardingState
      setCompleted: (value: boolean) => void
      setSkipped: (value: boolean) => void
    }
  }
}

export const getOnboardingState = (): OnboardingState => {
  // In development, if SKIP_ONBOARDING is true, always return completed state
  if (!IS_PROD_DESKTOP && SKIP_ONBOARDING) {
    return {
      hasCompletedOnboarding: true,
      hasSkippedOnboarding: true,
    }
  }

  // In development, if SKIP_ONBOARDING is false, always return initial state
  if (!IS_PROD_DESKTOP && !SKIP_ONBOARDING) {
    return {
      hasCompletedOnboarding: false,
      hasSkippedOnboarding: false,
    }
  }

  // In production, use the stored values
  return window.onboarding.getState()
}

export const setHasCompletedOnboarding = (value: boolean) => {
  window.onboarding.setCompleted(value)
}

export const setHasSkippedOnboarding = (value: boolean) => {
  window.onboarding.setSkipped(value)
}
