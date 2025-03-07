import {DESKTOP_APPDATA} from '@shm/shared/constants'
import {app, ipcMain} from 'electron'
import Store from 'electron-store'
import path from 'path'
import type {
  OnboardingFormData,
  OnboardingState,
  OnboardingStep,
} from './app-onboarding'

const ONBOARDING_INITIAL_STATE: OnboardingState = {
  hasCompletedOnboarding: false,
  hasSkippedOnboarding: false,
  currentStep: 'welcome',
  formData: {
    name: '',
  },
}
const store = new Store<OnboardingState>({
  name: 'onboarding',
  cwd: path.join(app?.getPath('userData') || process.cwd(), DESKTOP_APPDATA),
  defaults: ONBOARDING_INITIAL_STATE,
})

const getInitialState = (): OnboardingState => ONBOARDING_INITIAL_STATE

export function setupOnboardingHandlers() {
  ipcMain.on('get-onboarding-state', (event) => {
    console.log('📥 Getting onboarding state:', store.store)
    event.returnValue = store.store
  })

  ipcMain.on('set-onboarding-completed', (_, value: boolean) => {
    console.log('📝 Setting completed:', value)
    store.set('hasCompletedOnboarding', value)
    if (value) {
      // Reset state when completing
      store.set({
        ...getInitialState(),
        hasCompletedOnboarding: true,
      })
    }
    console.log('📝 New store state:', store.store)
  })

  ipcMain.on('set-onboarding-skipped', (_, value: boolean) => {
    console.log('📝 Setting skipped:', value)
    store.set('hasSkippedOnboarding', value)
    if (value) {
      // Reset state when skipping
      store.set({
        ...getInitialState(),
        hasSkippedOnboarding: true,
      })
    }
    console.log('📝 New store state:', store.store)
  })

  ipcMain.on('set-onboarding-step', (_, step: OnboardingStep) => {
    console.log('📝 Setting onboarding step:', step)
    store.set('currentStep', step)
    console.log('📝 New store state:', store.store)
  })

  ipcMain.on(
    'set-onboarding-form-data',
    (_, data: Partial<OnboardingFormData>) => {
      console.log('📝 Setting form data:', data)
      const currentData = store.get('formData')
      store.set('formData', {...currentData, ...data})
      console.log('📝 New store state:', store.store)
    },
  )

  ipcMain.on('reset-onboarding-state', () => {
    console.log('🔄 Resetting onboarding state')
    store.set(getInitialState())
    console.log('📝 New store state:', store.store)
  })
}
