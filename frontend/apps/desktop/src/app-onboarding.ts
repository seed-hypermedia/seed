export function getOnboardingState(): OnboardingState {
  return window.onboarding.getState()
}

export function setHasCompletedOnboarding(value: boolean) {
  window.onboarding.setCompleted(value)
}

export function setHasSkippedOnboarding(value: boolean) {
  window.onboarding.setSkipped(value)
}

export function setInitialAccountIdCount(count: number) {
  window.onboarding.setInitialAccountIdCount(count)
}

export function setOnboardingStep(step: OnboardingStep) {
  window.onboarding.setStep(step)
}

export function setOnboardingFormData(data: Partial<OnboardingFormData>) {
  window.onboarding.setFormData(data)
}

export function resetOnboardingState() {
  window.onboarding.resetState()
}

// This function only clears the form data, but keeps the hasCompletedOnboarding and hasSkippedOnboarding flags
export function cleanupOnboardingFormData() {
  const currentState = window.onboarding.getState()

  // Set the form data to empty but keep the completion flags
  window.onboarding.setFormData({
    name: '',
    icon: undefined,
    seedExperimentalLogo: undefined,
  })

  // Reset the step to welcome for next time
  window.onboarding.setStep('welcome')
}

// Maximum file size (5MB)
export const MAX_IMAGE_SIZE = 5 * 1024 * 1024
// Allowed image types
export const ALLOWED_IMAGE_TYPES = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]

export type OnboardingStep =
  | 'welcome'
  | 'profile'
  | 'recovery'
  | 'ready'
  | 'existing'

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
  initialAccountIdCount: number
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
      setInitialAccountIdCount: (count: number) => void
    }
  }
}
