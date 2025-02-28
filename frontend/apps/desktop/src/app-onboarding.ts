import {IS_PROD_DESKTOP, SKIP_ONBOARDING} from '@shm/shared/constants'

export type OnboardingStep = 'welcome' | 'profile'

export interface OnboardingFormData {
  name: string
  icon?: string | File
  seedExperimentalLogo?: string | File
}

export interface OnboardingState {
  hasCompletedOnboarding: boolean
  hasSkippedOnboarding: boolean
  currentStep: OnboardingStep
  formData: OnboardingFormData
}

declare global {
  interface Window {
    onboarding: {
      getState: () => OnboardingState
      setCompleted: (value: boolean) => void
      setSkipped: (value: boolean) => void
      setStep: (step: OnboardingStep) => void
      setFormData: (data: Partial<OnboardingFormData>) => void
      resetState: () => void
    }
  }
}

export const getOnboardingState = (): OnboardingState => {
  // In development, if SKIP_ONBOARDING is true, always return completed state
  if (!IS_PROD_DESKTOP && SKIP_ONBOARDING) {
    return {
      hasCompletedOnboarding: true,
      hasSkippedOnboarding: true,
      currentStep: 'welcome',
      formData: {
        name: '',
      },
    }
  }

  // Always use the stored values unless SKIP_ONBOARDING is true
  return window.onboarding.getState()
}

export const setHasCompletedOnboarding = (value: boolean) => {
  if (!IS_PROD_DESKTOP && SKIP_ONBOARDING) return
  window.onboarding.setCompleted(value)
}

export const setHasSkippedOnboarding = (value: boolean) => {
  if (!IS_PROD_DESKTOP && SKIP_ONBOARDING) return
  window.onboarding.setSkipped(value)
}

export const setOnboardingStep = (step: OnboardingStep) => {
  if (!IS_PROD_DESKTOP && SKIP_ONBOARDING) return
  window.onboarding.setStep(step)
}

export const setOnboardingFormData = (data: Partial<OnboardingFormData>) => {
  if (!IS_PROD_DESKTOP && SKIP_ONBOARDING) return
  window.onboarding.setFormData(data)
}

export const resetOnboardingState = () => {
  if (!IS_PROD_DESKTOP && SKIP_ONBOARDING) return
  window.onboarding.resetState()
}
