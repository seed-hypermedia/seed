import {IS_PROD_DESKTOP, SKIP_ONBOARDING} from '@shm/shared/constants'

// Maximum file size (5MB)
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024
// Allowed image types
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]

export type OnboardingStep = 'welcome' | 'profile' | 'recovery' | 'ready'

export interface ImageData {
  base64: string
  type: string
  name: string
  size: number
}

export interface OnboardingFormData {
  name: string
  icon?: ImageData
  seedExperimentalLogo?: ImageData
}

export interface OnboardingState {
  hasCompletedOnboarding: boolean
  hasSkippedOnboarding: boolean
  currentStep: OnboardingStep
  formData: OnboardingFormData
}

export class ImageValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ImageValidationError'
  }
}

export function validateImage(file: File): void {
  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    throw new ImageValidationError(
      `Invalid file type. Allowed types: ${ALLOWED_IMAGE_TYPES.join(', ')}`,
    )
  }
  if (file.size > MAX_IMAGE_SIZE) {
    throw new ImageValidationError(
      `File too large. Maximum size: ${MAX_IMAGE_SIZE / 1024 / 1024}MB`,
    )
  }
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
