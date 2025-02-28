import {DESKTOP_APPDATA} from '@shm/shared/constants'
import {app, ipcMain} from 'electron'
import Store from 'electron-store'
import path from 'path'
import type {OnboardingState} from './app-onboarding'

const store = new Store<OnboardingState>({
  name: 'onboarding',
  cwd: path.join(app?.getPath('userData') || process.cwd(), DESKTOP_APPDATA),
  defaults: {
    hasCompletedOnboarding: false,
    hasSkippedOnboarding: false,
  },
})

export function setupOnboardingHandlers() {
  ipcMain.on('get-onboarding-state', (event) => {
    event.returnValue = {
      hasCompletedOnboarding: store.get('hasCompletedOnboarding'),
      hasSkippedOnboarding: store.get('hasSkippedOnboarding'),
    }
  })

  ipcMain.on('set-onboarding-completed', (_, value: boolean) => {
    store.set('hasCompletedOnboarding', value)
  })

  ipcMain.on('set-onboarding-skipped', (_, value: boolean) => {
    store.set('hasSkippedOnboarding', value)
  })
}
