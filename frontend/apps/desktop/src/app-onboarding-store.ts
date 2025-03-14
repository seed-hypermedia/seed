import {ipcMain} from 'electron'
import type {
  OnboardingFormData,
  OnboardingState,
  OnboardingStep,
} from './app-onboarding'
import {appStore} from './app-store.mjs'

const ONBOARDING_STORAGE_KEY = 'onboarding-v001'

const ONBOARDING_INITIAL_STATE: OnboardingState = {
  hasCompletedOnboarding: false,
  hasSkippedOnboarding: false,
  currentStep: 'welcome',
  formData: {
    name: '',
  },
}

let obState =
  (appStore.get(ONBOARDING_STORAGE_KEY) as OnboardingState) ||
  ONBOARDING_INITIAL_STATE

const getInitialState = (): OnboardingState => ONBOARDING_INITIAL_STATE

export function getOnboardingState() {
  return obState
}

export function setOnboardingState(state: Partial<OnboardingState>) {
  obState = {
    ...obState,
    ...state,
    formData: {...obState.formData, ...state.formData},
  }
  appStore.set(ONBOARDING_STORAGE_KEY, obState)
}

export function setupOnboardingHandlers() {
  ipcMain.on('get-onboarding-state', (event) => {
    console.log('📥 Getting onboarding state:', obState)
    event.returnValue = obState
  })

  ipcMain.on('set-onboarding-completed', (_, value: boolean) => {
    console.log('📝 Setting completed:', value)
    setOnboardingState({hasCompletedOnboarding: value})
    console.log('📝 New store state:', getOnboardingState())
  })

  ipcMain.on('set-onboarding-skipped', (_, value: boolean) => {
    console.log('📝 Setting skipped:', value)
    setOnboardingState({hasSkippedOnboarding: value})
    console.log('📝 New store state:', getOnboardingState())
  })

  ipcMain.on('set-onboarding-step', (_, step: OnboardingStep) => {
    console.log('📝 Setting onboarding step:', step)
    setOnboardingState({currentStep: step})
    console.log('📝 New store state:', getOnboardingState())
  })

  ipcMain.on(
    'set-onboarding-form-data',
    (_, data: Partial<OnboardingFormData>) => {
      console.log('📝 Setting form data:', data)
      setOnboardingState({formData: {...obState.formData, ...data}})
      console.log('📝 New store state:', getOnboardingState())
    },
  )

  ipcMain.on('reset-onboarding-state', () => {
    console.log('🔄 Resetting onboarding state')
    setOnboardingState(getInitialState())
    console.log('📝 New store state:', getOnboardingState())
  })
}
